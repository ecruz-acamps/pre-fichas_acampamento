#!/usr/bin/env bash
# Sobe (ou atualiza) os containers desta instalação.
# 1º tenta a imagem pronta do commit atual no GitHub (ghcr.io) — rápido e sem usar a CPU do
#    servidor para compilar; 2º, se não houver, reconstrói localmente (como antes).
# Usado por scripts/novo-acampamento.sh e scripts/atualizar.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
COMMIT="${VERSAO_COMMIT:-$(git rev-parse HEAD 2>/dev/null || true)}"
REPO="$({ grep -E '^ATUALIZACAO_REPO=' .env 2>/dev/null || true; } | tail -1 | cut -d= -f2-)"
REPO="$(printf '%s' "${REPO:-ecruz-acamps/pre-fichas_acampamento}" | tr 'A-Z' 'a-z')"
LOCAL="$({ grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null || true; } | tail -1 | cut -d= -f2-)"
LOCAL="${LOCAL:-pre-fichas}-app:latest"

definir_env() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }

if [ "${SEM_BUILD:-0}" = 1 ]; then docker compose up -d; exit 0; fi

IMAGEM="ghcr.io/${REPO}:${COMMIT}"
if [ -n "$COMMIT" ] && [ "${SEMPRE_CONSTRUIR:-0}" != 1 ] && docker pull -q "$IMAGEM" >/dev/null 2>&1; then
  echo "→ Usando a imagem pronta ${COMMIT:0:7} (sem reconstruir no servidor)"
  definir_env IMAGEM_APP "$IMAGEM"
  docker compose up -d
else
  echo "→ Imagem pronta indisponível: reconstruindo no servidor (alguns minutos)…"
  definir_env IMAGEM_APP "$LOCAL"
  docker compose up -d --build
fi
# Remove imagens antigas sem uso (evita encher o disco a cada atualização)
docker image prune -f >/dev/null 2>&1 || true
