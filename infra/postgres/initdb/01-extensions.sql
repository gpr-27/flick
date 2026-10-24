-- Runs once, when the data directory is first initialised.
-- pg_stat_statements is preloaded via shared_preload_libraries in compose; this
-- makes its view available in the application database for EXPLAIN/benchmark work.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
