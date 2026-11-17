#!/usr/bin/env bash
# Starts a local PostgreSQL 16 cluster (Debian/Ubuntu layout) and creates the
# dev and test databases. Safe to re-run. On other systems use docker-compose.yml.
set -euo pipefail
pg_ctlcluster 16 main start 2>/dev/null || true
for i in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 0.5; done
as_pg() { su postgres -c "$1"; }
as_pg "psql -tc \"select 1 from pg_roles where rolname='adengine'\"" | grep -q 1 ||
  as_pg "psql -c \"create role adengine login password 'adengine' createdb\""
for db in adengine adengine_test; do
  as_pg "psql -tc \"select 1 from pg_database where datname='$db'\"" | grep -q 1 ||
    as_pg "createdb -O adengine $db"
done
echo "postgres ready: adengine, adengine_test"
