#!/usr/bin/env bash
# Backup do banco (formato custom do pg_dump, compactado).
#   ./scripts/backup.sh                 # Docker Compose (padrão)
#   MODO=local ./scripts/backup.sh      # PostgreSQL instalado direto no servidor
# Agende no cron (todo dia às 2h), por exemplo:
#   0 2 * * * cd /opt/pre-fichas && ./scripts/backup.sh >> /var/log/pre-fichas-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
PASTA="${PASTA_BACKUP:-./backups}"
DIAS="${MANTER_DIAS:-30}"
MODO="${MODO:-docker}"
mkdir -p "$PASTA"
chmod 700 "$PASTA"
ARQUIVO="$PASTA/prefichas-$(date +%Y-%m-%d_%H%M%S).dump"

if [ "$MODO" = "docker" ]; then
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQUIVO"
else
  : "${DATABASE_URL:?defina DATABASE_URL}"
  pg_dump "$DATABASE_URL" -Fc > "$ARQUIVO"
fi

chmod 600 "$ARQUIVO"
echo "$(date '+%F %T') backup criado: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"

# Remove backups mais antigos que $DIAS dias
find "$PASTA" -name 'prefichas-*.dump' -mtime +"$DIAS" -delete
