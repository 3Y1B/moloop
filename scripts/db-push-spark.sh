#!/usr/bin/env bash
# Push new migrations to the Spark's Supabase through an SSH tunnel. The credentials come from
# spark:~/supabase-moloop/.env and are never printed or written down. `supabase db push` lists what it will apply
# and asks before it does.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV=$(ssh spark 'grep -E "^(POSTGRES_PASSWORD|POSTGRES_PORT|POOLER_TENANT_ID)=" ~/supabase-moloop/.env')
get() { printf '%s\n' "$ENV" | sed -n "s/^$1=//p" | tr -d "\"'"; }
PASS=$(get POSTGRES_PASSWORD)
PORT=$(get POSTGRES_PORT); PORT=${PORT:-5432}
TENANT=$(get POOLER_TENANT_ID)
DB_USER=postgres${TENANT:+.$TENANT}
ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PASS")

SOCK=$(mktemp -u /tmp/moloop-spark-XXXX)
ssh -M -S "$SOCK" -fN -o ExitOnForwardFailure=yes -L "54329:localhost:$PORT" spark
trap 'ssh -S "$SOCK" -O exit spark 2>/dev/null' EXIT

supabase db push --db-url "postgresql://$DB_USER:$ENC@localhost:54329/postgres"
