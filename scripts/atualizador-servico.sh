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
PUBLICAR="atualizacao/pedido/publicar"
DADOS_PUB="atualizacao/pedido/publicacao.json"

# ---- Pedido de publicação na internet (Configurações → Publicação) ----------
# Único pedido que traz dados do site: lidos com jq e validados um a um.
if [ -e "$PUBLICAR" ] || [ -L "$PUBLICAR" ]; then
  if [ -L "$PUBLICAR" ] || [ -L "$DADOS_PUB" ] || [ ! -f "$DADOS_PUB" ] || [ "$(stat -c %s "$DADOS_PUB")" -gt 4096 ] || ! command -v jq >/dev/null; then
    rm -f "$PUBLICAR" "$DADOS_PUB"
  elif [ ! -L atualizacao ] && [ ! -L "$ESTADO" ] && [ -d "$ESTADO" ] && [ "$(stat -c %u "$ESTADO")" = 0 ]; then
    ATIVO="$(jq -r 'if (.ativo|type)=="boolean" then .ativo else "x" end' "$DADOS_PUB" 2>/dev/null || echo x)"
    SUB="$(jq -r 'if (.subdominio|type)=="string" then .subdominio else "" end' "$DADOS_PUB" 2>/dev/null || true)"
    TOK="$(jq -r 'if (.token|type)=="string" then .token else "" end' "$DADOS_PUB" 2>/dev/null || true)"
    rm -f "$PUBLICAR" "$DADOS_PUB"
    exec 8>"$ESTADO/.trava-publicacao"
    if flock -n 8; then
      : > "$ESTADO/log-publicacao.txt"
      printf '{"executando":true,"em":"%s"}\n' "$(date -Iseconds)" > "$ESTADO/publicacao-andamento.json"
      if [ -n "$TOK" ]; then
        if [[ "$TOK" =~ ^[A-Za-z0-9_-]{20,200}$ ]]; then
          mkdir -p /etc/prefichas && chmod 700 /etc/prefichas
          ( umask 077; printf 'CF_API_TOKEN=%s\n' "$TOK" > /etc/prefichas/cloudflare.env )
        else
          echo "✗ Token da Cloudflare em formato inválido." >> "$ESTADO/log-publicacao.txt"
          ATIVO="invalido"
        fi
      fi
      if [ "$ATIVO" = true ] && [[ "$SUB" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
        ./scripts/publicacao.sh ligar "$SUB" >> "$ESTADO/log-publicacao.txt" 2>&1 || true
      elif [ "$ATIVO" = false ]; then
        ./scripts/publicacao.sh desligar >> "$ESTADO/log-publicacao.txt" 2>&1 || true
      elif [ "$ATIVO" != invalido ]; then
        echo "✗ Pedido de publicação inválido." >> "$ESTADO/log-publicacao.txt"
      fi
      rm -f "$ESTADO/publicacao-andamento.json"
    fi
  fi
fi

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
