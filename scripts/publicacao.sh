#!/usr/bin/env bash
# Liga ou desliga a publicação na internet pela Cloudflare (túnel cloudflared).
# Executado como root pelo atualizador do servidor quando o painel pede
# (Configurações → Publicação na internet). Também pode ser usado no terminal:
#   sudo ./scripts/publicacao.sh ligar NOME      # publica NOME.<DOMINIO_BASE>
#   sudo ./scripts/publicacao.sh desligar
#
# O domínio base vem do .env (DOMINIO_BASE, padrão movimentocampista.com.br) e o
# token da API da Cloudflare de /etc/prefichas/cloudflare.env — nunca do site.
set -euo pipefail
cd "$(dirname "$0")/.."
ESTADO="atualizacao/estado"
ACAO="${1:-}" SUB="${2:-}"

valor_env() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
definir_env() { # chave valor
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}
registrar() { # ativo endereco sucesso mensagem
  [ -d "$ESTADO" ] || return 0
  local msg="${4//\"/\'}"
  local token=false; [ -r /etc/prefichas/cloudflare.env ] && grep -q '^CF_API_TOKEN=.' /etc/prefichas/cloudflare.env && token=true
  printf '{"ativo":%s,"endereco":"%s","sucesso":%s,"mensagem":"%s","token_configurado":%s,"dominio_base":"%s","em":"%s"}\n' \
    "$1" "$2" "$3" "$msg" "$token" "$BASE" "$(date -Iseconds)" > "$ESTADO/publicacao.json.tmp"
  mv -f "$ESTADO/publicacao.json.tmp" "$ESTADO/publicacao.json"
}

[ -f .env ] || { echo "✗ Instalação sem .env."; exit 1; }
BASE="$(valor_env DOMINIO_BASE)"; BASE="${BASE:-movimentocampista.com.br}"
PERFIS="$(valor_env COMPOSE_PROFILES)"
sem_tunel="$(printf '%s' "$PERFIS" | tr ',' '\n' | { grep -vx 'tunel' || true; } | { grep -v '^$' || true; } | paste -sd, -)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORTA_HTTP="$(valor_env PORTA_HTTP)"; PORTA_HTTP="${PORTA_HTTP:-80}"
URL_LOCAL="http://${IP}$([ "$PORTA_HTTP" = 80 ] || echo ":${PORTA_HTTP}")"

case "$ACAO" in
  ligar)
    [[ "$SUB" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || { echo "✗ Endereço inválido: use letras minúsculas, números e hífen."; registrar false "" false "Endereço inválido"; exit 1; }
    HOST="${SUB}.${BASE}"
    echo "→ Publicando ${HOST} na Cloudflare…"
    TOKEN="$(./scripts/cloudflare-tunel.sh "$HOST" http://app:3000)" || TOKEN=""
    if [ -z "$TOKEN" ]; then
      echo "✗ A Cloudflare não publicou o endereço (confira o token e o domínio)."
      registrar false "" false "A Cloudflare recusou: confira o token da API e o domínio ${BASE}"
      exit 1
    fi
    definir_env TUNEL_TOKEN "$TOKEN"
    definir_env COMPOSE_PROFILES "${sem_tunel:+${sem_tunel},}tunel"
    definir_env URL_PUBLICA "https://${HOST}"
    definir_env ENDERECO_PUBLICO "$HOST"
    docker compose up -d >/dev/null 2>&1 || docker compose up -d
    echo "✓ Publicado em https://${HOST}"
    registrar true "$HOST" true "Publicado em https://${HOST}"
    ;;
  desligar)
    echo "→ Desligando a publicação pela Cloudflare…"
    # Instalada só com a Cloudflare: liga o acesso pela rede local (Caddy sem domínio, porta livre)
    if [ -z "$sem_tunel" ] && [ "$(valor_env MULTI)" != 1 ]; then
      ocupada() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q . ; }
      p="$PORTA_HTTP"; ocupada "$p" && { p=8180; while ocupada "$p"; do p=$((p + 1)); done; }
      PORTA_HTTP="$p"; URL_LOCAL="http://${IP}$([ "$p" = 80 ] || echo ":$p")"
      sem_tunel="caddy"
      definir_env DOMINIO ":80"; definir_env PORTA_HTTP "$p"; definir_env COOKIE_SEGURO false
    fi
    docker compose stop tunel >/dev/null 2>&1 || true
    docker compose rm -f tunel >/dev/null 2>&1 || true
    definir_env COMPOSE_PROFILES "$sem_tunel"
    definir_env URL_PUBLICA "$URL_LOCAL"
    definir_env TUNEL_TOKEN ""
    docker compose up -d >/dev/null 2>&1 || docker compose up -d
    echo "✓ Publicação desligada. Acesso pela rede local: ${URL_LOCAL}"
    registrar false "$(valor_env ENDERECO_PUBLICO)" true "Publicação desligada. Acesso local: ${URL_LOCAL}"
    ;;
  *) echo "Uso: $0 ligar NOME | desligar"; exit 1 ;;
esac
