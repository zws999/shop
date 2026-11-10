-- Run with psql as the schema owner after migrations.
-- Set runtime_role with -v runtime_role=YOUR_ALREADY_CREATED_LOGIN_ROLE.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM :"runtime_role";
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM :"runtime_role";
