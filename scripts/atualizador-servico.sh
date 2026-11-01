#!/usr/bin/env bash
# Executado pelo serviço do servidor (systemd, como root) quando o painel pede
# uma atualização.
#
# Segurança: o site só consegue escrever em atualizacao/pedido/. Este script
#  - apenas verifica e apaga o arquivo de pedido (nunca lê conteúdo dali);
#  - recusa atalhos (symlinks);
#  - escreve o andamento somente em atualizacao/estado/, pasta do root que o
#    site enxerga como somente leitura.
set -uo pipefail
cd "$(dirname "$0")/.."
PEDIDO="atualizacao/pedido/solicitar"
ESTADO="atualizacao/estado"
COMANDO="${ATUALIZADOR_COMANDO:-./scripts/atualizar.sh}"

[ -e "$PEDIDO" ] || [ -L "$PEDIDO" ] || exit 0
if [ -L "$PEDIDO" ] || [ ! -f "$PEDIDO" ]; then rm -f "$PEDIDO"; exit 0; fi

# A pasta de estado precisa ser uma pasta real do root (não um atalho)
if [ -L atualizacao ] || [ -L "$ESTADO" ] || [ ! -d "$ESTADO" ] || [ "$(stat -c %u "$ESTADO")" != 0 ]; then
  echo "Pasta $ESTADO inválida (precisa ser do root e não pode ser atalho). Rode scripts/instalar-atualizador.sh." >&2
  rm -f "$PEDIDO"; exit 1
fi
umask 022

exec 9>"$ESTADO/.trava"
flock -n 9 || exit 0          # já existe uma atualização em andamento

estado() { # etapa sucesso mensagem
  local msg="${3//\"/\'}"; msg="${msg//\\/}"
  printf '{"etapa":"%s","sucesso":%s,"mensagem":"%s","atualizado_em":"%s"}\n' \
    "$1" "$2" "$msg" "$(date -Iseconds)" > "$ESTADO/estado.json.tmp"
  mv -f "$ESTADO/estado.json.tmp" "$ESTADO/estado.json"
}

estado executando null "Atualização em andamento"
: > "$ESTADO/log.txt"
rm -f "$PEDIDO"
if $COMANDO >> "$ESTADO/log.txt" 2>&1; then
  estado concluido true "$(grep -E '^✓' "$ESTADO/log.txt" | tail -1)"
else
  estado concluido false "$(grep -E '^✗' "$ESTADO/log.txt" | tail -1 || echo 'A atualização falhou')"
fi
