-- Keep the requested workspace name on a signup reservation only. A workspace,
-- trial, membership, and session are created atomically after email OTP proof.
ALTER TABLE users
  ADD COLUMN pending_signup_workspace_name VARCHAR(160);

COMMENT ON COLUMN users.pending_signup_workspace_name IS
  'Workspace name reserved for a pending email signup; cleared when the account is verified and activated.';
