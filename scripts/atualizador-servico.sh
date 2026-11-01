#!/usr/bin/env bash
# Executado pelo serviço do servidor (systemd) quando o painel pede uma atualização.
# O painel só cria o arquivo atualizacao/solicitar; quem atualiza é este script,
# rodando no servidor, fora do container do site.
set -uo pipefail
cd "$(dirname "$0")/.."
DIR="atualizacao"
COMANDO="${ATUALIZADOR_COMANDO:-./scripts/atualizar.sh}"
DONO="$(stat -c '%u:%g' "$DIR" 2>/dev/null || echo 0:0)"

[ -f "$DIR/solicitar" ] || exit 0
exec 9>"$DIR/.trava"
flock -n 9 || exit 0          # já existe uma atualização em andamento
rm -f "$DIR/solicitar"

estado() { # etapa sucesso mensagem
  local msg="${3//\"/\'}"; msg="${msg//\\/}"
  printf '{"etapa":"%s","sucesso":%s,"mensagem":"%s","atualizado_em":"%s"}\n' \
    "$1" "$2" "$msg" "$(date -Iseconds)" > "$DIR/estado.json.tmp"
  mv "$DIR/estado.json.tmp" "$DIR/estado.json"
  chown "$DONO" "$DIR/estado.json" 2>/dev/null || true
}

estado executando null "Atualização em andamento"
: > "$DIR/log.txt"; chown "$DONO" "$DIR/log.txt" 2>/dev/null || true
if $COMANDO >> "$DIR/log.txt" 2>&1; then
  estado concluido true "$(grep -E '^✓' "$DIR/log.txt" | tail -1)"
else
  estado concluido false "$(grep -E '^✗' "$DIR/log.txt" | tail -1 || echo 'A atualização falhou')"
fi
chown "$DONO" "$DIR/log.txt" 2>/dev/null || true
