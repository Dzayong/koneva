import pg from 'pg';

const { Pool } = pg;
const JOBS = ['messages_90d', 'webhook_logs_30d', 'security_logs_12mo', 'closed_accounts_30d', 'invoices_10y'] as const;
type Job = typeof JOBS[number];
const DELETE_ROUTINES: Partial<Record<Job, string>> = {
  messages_90d: 'retention_delete_messages_90d',
  webhook_logs_30d: 'retention_delete_webhook_logs_30d',
  security_logs_12mo: 'retention_delete_security_logs_12mo',
  closed_accounts_30d: 'retention_delete_closed_accounts_30d',
};

function nextDailyUtcRun(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function safeJsonCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_aggregate_report');
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('invalid_aggregate_report');
    }
    result[key] = count;
  }
  return result;
}

function splitReportCounts(value: unknown): { counts: Record<string, number>; oldest: Record<string, string> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_aggregate_report');
  const counts: Record<string, number> = {};
  const oldest: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number') counts[key] = item;
    else if (key.startsWith('oldest_') && (item === null || (typeof item === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/.test(item)))) {
      if (typeof item === 'string') oldest[key] = item;
    } else throw new Error('invalid_aggregate_report');
  }
  return { counts: safeJsonCounts(counts), oldest };
}

async function assertRetentionLogin(pool: pg.Pool): Promise<void> {
  const result = await pool.query<{ session_user: string; rolsuper: boolean; executor_member: boolean }>(`
    SELECT session_user,
      (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS rolsuper,
      pg_has_role(session_user, 'koneva_retention_executor', 'member') AS executor_member
  `);
  const role = result.rows[0];
  if (!role || role.rolsuper || !role.executor_member) throw new Error('dedicated_non_superuser_retention_login_required');
}

async function preview(pool: pg.Pool, job: Job): Promise<unknown> {
  const result = await pool.query('SELECT retention_persist_dry_run($1) AS saved', [job]);
  return result.rows[0]?.saved;
}

async function recordFailure(pool: pg.Pool, job: Job, mode: 'dry_run' | 'execute', errorCode: 'RETENTION_JOB_FAILED' | 'DELETE_DISABLED'): Promise<void> {
  await pool.query(
    `INSERT INTO retention_job_runs(job,mode,status,cutoff_at,candidate_counts,oldest_eligible,affected_counts,
       started_at,completed_at,duration_ms,error_code)
     VALUES ($1,$2,'failed',clock_timestamp(),'{}','{}','{}',clock_timestamp(),clock_timestamp(),0,$3)`,
    [job, mode, errorCode],
  );
}

async function execute(pool: pg.Pool, job: Job): Promise<unknown> {
  const routine = DELETE_ROUTINES[job];
  if (!routine) throw new Error('invoice_retention_is_report_only');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dry = await client.query('SELECT retention_dry_run($1) AS report', [job]);
    const report = dry.rows[0]?.report as { cutoff_utc?: string } | undefined;
    if (!report?.cutoff_utc || !Number.isFinite(Date.parse(report.cutoff_utc))) throw new Error('invalid_aggregate_report');
    const { counts, oldest: oldestEligible } = splitReportCounts((dry.rows[0]?.report as { counts?: unknown })?.counts);
    const run = await client.query<{ id: string }>(
      `INSERT INTO retention_job_runs(job,mode,status,cutoff_at,candidate_counts,oldest_eligible)
       VALUES ($1,'execute','running',$2,$3::jsonb,$4::jsonb) RETURNING id`,
      [job, report.cutoff_utc, JSON.stringify({ ...counts, protected_invoice_candidates: Number((dry.rows[0]?.report as { protected_invoice_candidates: number }).protected_invoice_candidates ?? 0) }), JSON.stringify(oldestEligible)],
    );
    const totals: Record<string, number> = {};
    let status: 'partial' | 'succeeded' = 'succeeded';
    let pass = 0;
    for (; pass < 100; pass += 1) {
      const affected = await client.query(`SELECT ${routine}($1::timestamptz,500) AS result`, [report.cutoff_utc]);
      const result = affected.rows[0]?.result as { status?: string } & Record<string, unknown>;
      const resultStatus = result.status;
      if (resultStatus === 'partial') status = 'partial';
      const current = { ...result };
      delete current.status;
      const numeric = safeJsonCounts(current);
      for (const [key, count] of Object.entries(numeric)) totals[key] = (totals[key] ?? 0) + count;
      const deletedThisPass = Object.entries(numeric).some(([key, count]) => key !== 'unresolved_active_messages' && key.startsWith('blocked_') === false && count > 0);
      if (!deletedThisPass) break;
    }
    if (pass === 100) status = 'partial';
    const affectedCounts = safeJsonCounts(totals);
    await client.query(
      `UPDATE retention_job_runs SET status=$2,affected_counts=$3::jsonb,completed_at=clock_timestamp(),
       duration_ms=LEAST(2147483647,GREATEST(0,(extract(epoch FROM (clock_timestamp()-started_at))*1000)::bigint)) WHERE id=$1`,
      [run.rows[0]?.id, status, JSON.stringify(safeJsonCounts(affectedCounts))],
    );
    await client.query('COMMIT');
    return { run_id: run.rows[0]?.id, job, mode: 'execute', status, cutoff_utc: report.cutoff_utc, affected_counts: affectedCounts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function runJobs(pool: pg.Pool, jobs: readonly Job[]): Promise<void> {
  await assertRetentionLogin(pool);
  for (const job of jobs) {
    try { console.log(JSON.stringify(await preview(pool, job))); }
    catch {
      try { await recordFailure(pool, job, 'dry_run', 'RETENTION_JOB_FAILED'); } catch { /* preserve the original fail-closed outcome */ }
      console.error(JSON.stringify({ job, mode: 'dry_run', status: 'failed', error_code: 'RETENTION_JOB_FAILED' }));
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.RETENTION_DATABASE_URL;
  if (!databaseUrl) throw new Error('RETENTION_DATABASE_URL is required; DATABASE_URL fallback is intentionally disabled');
  const args = process.argv.slice(2);
  const schedule = args.includes('--schedule');
  const executeMode = args.includes('--execute');
  const jobArgIndex = args.indexOf('--job');
  const jobValue = jobArgIndex >= 0 ? args[jobArgIndex + 1] : undefined;
  const allowedArgs = new Set(['--schedule', '--execute', '--job', ...(jobValue ? [jobValue] : [])]);
  if (args.some((arg) => !allowedArgs.has(arg)) || args.filter((arg) => arg === '--job').length > 1) throw new Error('usage: data-retention [--job JOB] [--schedule | --execute]');
  if (jobValue && !JOBS.includes(jobValue as Job)) throw new Error('unknown_retention_job');
  if (schedule && executeMode) throw new Error('scheduled_mode_is_dry_run_only');
  if (schedule && jobValue) throw new Error('scheduled_mode_runs_all_database_jobs');
  if (executeMode && !jobValue) throw new Error('execute_requires_one_explicit_job');
  if (executeMode && jobValue === 'invoices_10y') throw new Error('invoice_retention_is_report_only');
  const pool = new Pool({ connectionString: databaseUrl, application_name: 'koneva-data-retention' });
  try {
    await assertRetentionLogin(pool);
    if (executeMode && (process.env.RETENTION_DELETE_ENABLED !== 'true' || process.env.RETENTION_LIVE_DELETE_APPROVED !== 'true')) {
      await recordFailure(pool, jobValue as Job, 'execute', 'DELETE_DISABLED');
      throw new Error('deletion requires both RETENTION_DELETE_ENABLED=true and RETENTION_LIVE_DELETE_APPROVED=true');
    }
    if (executeMode) {
      try { console.log(JSON.stringify(await execute(pool, jobValue as Job))); }
      catch (error) {
        try { await recordFailure(pool, jobValue as Job, 'execute', 'RETENTION_JOB_FAILED'); } catch { /* keep the original error private */ }
        throw error;
      }
    }
    else if (!schedule) await runJobs(pool, jobValue ? [jobValue as Job] : JOBS);
    else {
      console.log('Retention scheduler started in dry-run-only mode; next run is 03:00 UTC.');
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, nextDailyUtcRun()));
        try { await runJobs(pool, JOBS); }
        catch { console.error('Retention dry-run schedule failed; details withheld.'); }
      }
    }
  } finally { await pool.end(); }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'retention_runner_failed');
    process.exitCode = 1;
  });
}

export { nextDailyUtcRun, safeJsonCounts };
