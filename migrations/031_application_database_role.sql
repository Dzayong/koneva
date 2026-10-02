-- The API must not connect as the superuser created by POSTGRES_USER. Keep a
-- distinct NOLOGIN privilege role for runtime queries and an isolated login.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koneva_application') THEN
    CREATE ROLE koneva_application NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koneva_application' AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'koneva_application role has unsafe attributes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koneva_app') THEN
    CREATE ROLE koneva_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='koneva_app' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'koneva_app role has unsafe attributes';
  END IF;
END $$;

GRANT koneva_application TO koneva_app;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO koneva_application', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO koneva_application;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koneva_application;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO koneva_application;

-- Business/operator audit is append-only for the application connection.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON operator_audit FROM koneva_application;
GRANT SELECT, INSERT ON operator_audit TO koneva_application;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON operator_security_events FROM koneva_application;
GRANT SELECT, INSERT ON operator_security_events TO koneva_application;

-- Runtime MFA/password lifecycle uses only these fields; permissions and the
-- break-glass designation remain changeable only by offline administration.
REVOKE UPDATE ON operators FROM koneva_application;
GRANT UPDATE (password_hash, mfa_secret_enc, mfa_enrolled_at, mfa_last_step,
  enrollment_code_hash, enrollment_code_expires_at)
  ON operators TO koneva_application;

-- Keep ordinary migrations' future objects usable without granting the
-- superuser's identity to runtime. Audit tables stay explicitly restricted.
DO $$ DECLARE migrator_name TEXT := current_user;
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO koneva_application', migrator_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO koneva_application', migrator_name);
END $$;

COMMENT ON ROLE koneva_application IS 'Non-login runtime privileges; operator audit tables are INSERT/SELECT only.';
COMMENT ON ROLE koneva_app IS 'Non-superuser login used by API and device-manager containers; password injected from private .env.personal.';
