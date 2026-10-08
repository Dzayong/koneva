// MFA has been removed from Operator login. This script is no longer functional.
// To reset an operator's password, use the database directly with an accountable OPERATOR_ADMIN_LABEL.
process.stderr.write('MFA has been removed from Operator login. This script is no longer needed.\nTo reset a password, update the operators table directly (bcrypt hash, min 12 chars).\n');
process.exitCode = 1;
