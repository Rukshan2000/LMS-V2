-- Run once per database as a superuser, after creating the restricted app role:
--   CREATE ROLE <app_role> LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
--   psql -v owner=<migration_role> -v app=<app_role> -d <db> -f init-database.sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
