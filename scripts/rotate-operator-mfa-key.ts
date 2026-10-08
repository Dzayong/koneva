// MFA has been removed from Operator login. OPERATOR_MFA_ENC_KEY is no longer used.
// This script is no longer functional.
process.stderr.write('MFA has been removed from Operator login. OPERATOR_MFA_ENC_KEY rotation is no longer needed.\n');
process.exitCode = 1;
