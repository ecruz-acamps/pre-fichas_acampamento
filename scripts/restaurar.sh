#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh.
# ATENÇÃO: substitui TODOS os dados atuais do banco.
#   ./scripts/restaurar.sh backups/prefichas-2026-11-01_020000.dump
#   MODO=local ./scripts/restaurar.sh arquivo.dump
set -euo pipefail

ARQUIVO="${1:?informe o arquivo .dump}"
[ -f "$ARQUIVO" ] || { echo "Arquivo não encontrado: $ARQUIVO"; exit 1; }
cd "$(dirname "$0")/.."
MODO="${MODO:-docker}"

read -r -p "Isto vai SUBSTITUIR todos os dados atuais pelo backup $ARQUIVO. Digite RESTAURAR para continuar: " ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

if [ "$MODO" = "docker" ]; then
  docker compose stop app
  docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$ARQUIVO"
  docker compose start app
else
  : "${DATABASE_URL:?defina DATABASE_URL}"
  pg_restore -d "$DATABASE_URL" --clean --if-exists --no-owner < "$ARQUIVO"
fi
echo "Backup restaurado."
