#!/usr/bin/env bash
# Publica um acampamento na internet pelo Cloudflare Tunnel (HTTPS automático,
# sem abrir portas no servidor/roteador e sem usar as portas 80/443).
#
#   ./scripts/cloudflare-tunel.sh HOST [SERVIÇO]
#   ex.: ./scripts/cloudflare-tunel.sh sao-pedro.movimentocampista.com.br http://app:3000
#
# Cria (ou reaproveita) o túnel "prefichas-HOST", aponta HOST para ele no DNS e
# imprime na saída padrão o token do túnel (TUNEL_TOKEN) para o container cloudflared.
#
# Precisa de um token da API da Cloudflare (CF_API_TOKEN) com as permissões:
#   Conta  → Cloudflare Tunnel → Editar
#   Zona   → DNS → Editar   (zona do domínio, ex.: movimentocampista.com.br)
# O token pode vir da variável CF_API_TOKEN ou do arquivo /etc/prefichas/cloudflare.env.
set -euo pipefail

HOST="${1:?informe o endereço, ex.: nome.movimentocampista.com.br}"
SERVICO="${2:-http://app:3000}"
API="${CF_API_URL:-https://api.cloudflare.com/client/v4}"

[ -z "${CF_API_TOKEN:-}" ] && [ -r /etc/prefichas/cloudflare.env ] && . /etc/prefichas/cloudflare.env
[ -n "${CF_API_TOKEN:-}" ] || { echo "Defina CF_API_TOKEN (token da API da Cloudflare)." >&2; exit 1; }
command -v jq >/dev/null || { echo "Instale o jq (apt-get install jq)." >&2; exit 1; }

cf() { # método caminho [json]
  local r
  r="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" ${3:+--data "$3"})"
  if [ "$(printf '%s' "$r" | jq -r '.success')" != true ]; then
    echo "Cloudflare recusou ($1 $2): $(printf '%s' "$r" | jq -c '.errors')" >&2; exit 1
  fi
  printf '%s' "$r"
}

# Zona: a parte do domínio cadastrada na Cloudflare (tenta do mais longo ao mais curto)
ZONA_ID="" CONTA_ID="" resto="$HOST"
while [[ "$resto" == *.*.* ]]; do
  resto="${resto#*.}"
  z="$(cf GET "/zones?name=$resto")"
  if [ "$(printf '%s' "$z" | jq '.result | length')" -gt 0 ]; then
    ZONA_ID="$(printf '%s' "$z" | jq -r '.result[0].id')"
    CONTA_ID="$(printf '%s' "$z" | jq -r '.result[0].account.id')"
    break
  fi
done
[ -n "$ZONA_ID" ] || { echo "Nenhuma zona da Cloudflare encontrada para $HOST (o token tem acesso ao domínio?)." >&2; exit 1; }

# Túnel (reaproveita se já existir)
NOME_TUNEL="prefichas-${HOST}"
t="$(cf GET "/accounts/$CONTA_ID/cfd_tunnel?name=$NOME_TUNEL&is_deleted=false")"
TUNEL_ID="$(printf '%s' "$t" | jq -r '.result[0].id // empty')"
if [ -z "$TUNEL_ID" ]; then
  TUNEL_ID="$(cf POST "/accounts/$CONTA_ID/cfd_tunnel" \
    "$(jq -nc --arg n "$NOME_TUNEL" '{name:$n, config_src:"cloudflare"}')" | jq -r '.result.id')"
  echo "✓ Túnel criado na Cloudflare" >&2
else
  echo "✓ Túnel existente reaproveitado" >&2
fi

# Para onde o túnel encaminha
cf PUT "/accounts/$CONTA_ID/cfd_tunnel/$TUNEL_ID/configurations" "$(jq -nc --arg h "$HOST" --arg s "$SERVICO" \
  '{config:{ingress:[{hostname:$h, service:$s}, {service:"http_status:404"}]}}')" >/dev/null

# DNS: HOST → túnel (cria ou corrige)
ALVO="$TUNEL_ID.cfargotunnel.com"
REG="$(jq -nc --arg n "$HOST" --arg c "$ALVO" '{type:"CNAME", name:$n, content:$c, proxied:true, comment:"Pré-fichas (túnel)"}')"
existente="$(cf GET "/zones/$ZONA_ID/dns_records?name=$HOST" | jq -r '.result[0].id // empty')"
if [ -n "$existente" ]; then cf PUT "/zones/$ZONA_ID/dns_records/$existente" "$REG" >/dev/null
else cf POST "/zones/$ZONA_ID/dns_records" "$REG" >/dev/null; fi
echo "✓ DNS: $HOST → túnel" >&2

cf GET "/accounts/$CONTA_ID/cfd_tunnel/$TUNEL_ID/token" | jq -r '.result'
