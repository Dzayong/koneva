# KONEVA implementation backlog

This is the shared checklist for the remaining product and reliability work. Update the status here as each item is implemented, tested, deployed, and pushed.

## In progress: prepaid PAYG for WhatsApp sends

Product decisions captured so far:

- Customers add balance before sending; sending must stop when spendable balance is insufficient.
- Charge WhatsApp message sends, not AI separately; AI provider costs are operated by KONEVA.
- Show outbound activity by device, including successful and failed counts and cost per send.
- Never automatically retry an uncertain/failed WhatsApp send. The user may explicitly retry one selected failed message; that is a new send attempt.
- Warn the owner when the balance reaches 20% of its funded amount, using the KONEVA OTP sender number.
- Keep accounting idempotent under concurrent requests and process restarts. An ambiguous WhatsApp outcome must remain visibly uncertain and must not be resent automatically.

Implementation checklist:

- [ ] Confirm the per-message IDR tariff and who configures it.
- [ ] Confirm the wallet top-up/settlement route.
- [ ] Add an auditable wallet ledger and idempotent top-up credits.
- [ ] Reserve funds atomically before enqueue/send; reject sends without sufficient funds.
- [ ] Settle one reservation only for a WhatsApp-accepted send; release only when non-delivery is definite; hold ambiguous outcomes for reconciliation.
- [ ] Remove automatic BullMQ send retries; keep explicit user-selected retry as a distinct, auditable attempt.
- [ ] Add operator pricing controls and customer balance/top-up UI.
- [ ] Add per-device send/cost reporting and the 20% low-balance alert.
- [ ] Add concurrency, duplicate-delivery, crash/uncertain-outcome, and insufficient-funds tests.
- [ ] Deploy migrations and code, verify runtime, then push the completed PAYG change.

## Remaining after PAYG

- [ ] Enforce at most one active device-bound API key per device, including API-level and database-level enforcement. Device-bound keys are implemented, but multiple active keys are not currently prohibited.
- [ ] Complete per-device API usage reporting. The device detail page shows status totals from the currently loaded message data; it is not yet a complete API-hit or billing report.
- [ ] Define and enforce auto-reply destination scope for groups, communities, and channels. Current processing supports group messages and ignores private chats/channel traffic; it does not provide an explicit group/community/channel allowlist.
- [ ] Verify AI replies end to end with an operator-configured provider and key in a controlled test workspace.
- [ ] Triage remaining full-suite failures, including message retry and bot API/health tests; establish cause and fix before calling the full suite green.
- [ ] Decide and perform a separate production deployment if/when a production environment is intended. The latest deploy was the local personal Docker stack.

## Completed and pushed

- [x] Device-bound API keys and the device-page key panel (commit `017078e`; exact-one-key restriction remains above).
- [x] Operator-managed encrypted AI provider settings and per-rule AI prompt option (commit `017078e`; runtime provider verification remains above).
- [x] Local operator login origin updated to `https://192.168.1.12:13000`; kept in private `.env.personal`, not Git.
