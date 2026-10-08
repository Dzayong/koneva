// Shared guard for the offline operator administration scripts (provision). These are run by a person with
// database access, never by the web API. There is no bootstrap account and no default password anywhere.
export interface AdminContext { databaseUrl: string; label: string; target: string }

const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,59}$/;

/**
 * Two ways in:
 *  - local/disposable: NODE_ENV development|test, loopback database, OPERATOR_PROVISION_LOCAL=true;
 *  - any other database (the owner's real one): OPERATOR_PROVISION_OFFLINE=true AND OPERATOR_PROVISION_CONFIRM_DATABASE
 *    equal to "<host>/<database>" of DATABASE_URL, typed by the person, so a stray environment cannot hit the wrong database.
 * Either way an accountable label (OPERATOR_ADMIN_LABEL, e.g. "pemilik-proyek") is mandatory and lands in the security log.
 */
export function adminContext(env: NodeJS.ProcessEnv = process.env): AdminContext {
  const databaseUrl = env['DATABASE_URL'];
  const label = env['OPERATOR_ADMIN_LABEL'] ?? '';
  if (!databaseUrl) throw new Error('DATABASE_URL must be set explicitly');
  if (!LABEL.test(label)) throw new Error('OPERATOR_ADMIN_LABEL is required (1-60 chars; who is running this)');
  const url = new URL(databaseUrl);
  const target = `${url.hostname}/${url.pathname.replace(/^\//, '')}`;
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  const local = env['OPERATOR_PROVISION_LOCAL'] === 'true' && ['development', 'test'].includes(env['NODE_ENV'] ?? '') && loopback;
  const confirmed = env['OPERATOR_PROVISION_OFFLINE'] === 'true' && env['OPERATOR_PROVISION_CONFIRM_DATABASE'] === target;
  if (!local && !confirmed) {
    throw new Error('Refusing: set OPERATOR_PROVISION_LOCAL=true on a loopback dev/test database, or OPERATOR_PROVISION_OFFLINE=true with OPERATOR_PROVISION_CONFIRM_DATABASE=<host>/<database>');
  }
  return { databaseUrl, label, target };
}
