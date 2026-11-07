#!/usr/bin/env bash
# UM túnel da Cloudflare para todos os acampamentos da VM (em vez de um túnel por acampamento).
# Um único "cloudflared" (container prefichas-tunel, rede do host) atende todos; cada acampamento é só um
# endereço (hostname → http://127.0.0.1:PORTA) dentro desse túnel, mais um registro DNS.
#
#   sudo ./scripts/tunel-compartilhado.sh verificar HOST         # confere token, zona e permissões (não muda nada)
#   sudo ./scripts/tunel-compartilhado.sh adicionar HOST PORTA   # publica HOST → 127.0.0.1:PORTA (cria o túnel na 1ª vez)
#   sudo ./scripts/tunel-compartilhado.sh remover HOST           # tira HOST do túnel e apaga o DNS dele
#   sudo ./scripts/tunel-compartilhado.sh listar                 # endereços publicados no túnel
#   sudo ./scripts/tunel-compartilhado.sh unificar               # move os acampamentos que ainda têm túnel próprio
#
# Precisa do token da API da Cloudflare (CF_API_TOKEN ou /etc/prefichas/cloudflare.env) com:
#   Conta → Cloudflare Tunnel → Editar   ·   Zona → DNS → Editar   ·   Zona → Zona → Ler
set -euo pipefail
ETC="${PREFICHAS_ETC:-/etc/prefichas}"
PASTA="${TUNEL_PASTA:-/opt/prefichas-tunel}"
RAIZ_INSTANCIAS="${INSTANCIAS_RAIZ:-/opt}"
API="${CF_API_URL:-https://api.cloudflare.com/client/v4}"
CONTAINER=prefichas-tunel
ACAO="${1:-}"

erro() { echo "✗ $*" >&2; exit 1; }
dominio_valido() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; }
command -v jq >/dev/null || erro "Instale o jq (apt-get install jq)."
[ -z "${CF_API_TOKEN:-}" ] && [ -r "$ETC/cloudflare.env" ] && . "$ETC/cloudflare.env"
[ -n "${CF_API_TOKEN:-}" ] || erro "Token da Cloudflare não configurado (cole o token na aba Configurações do painel central)."

# ---- API da Cloudflare (o token vai pela entrada do curl, nunca na linha de comando) ----------------------------
CF_ERRO=""
cf() { # método caminho [json] → corpo na saída; retorna 1 se a Cloudflare recusar
  local r
  r="$(printf 'header = "Authorization: Bearer %s"\n' "$CF_API_TOKEN" | curl -sS -m 40 -K - -X "$1" "$API$2" \
        -H "Content-Type: application/json" ${3:+--data "$3"})" || { CF_ERRO="sem resposta da Cloudflare"; return 1; }
  if [ "$(printf '%s' "$r" | jq -r '.success' 2>/dev/null)" != true ]; then
    CF_ERRO="$(printf '%s' "$r" | jq -r '[.errors[]? | "\(.code) \(.message)"] | join("; ")' 2>/dev/null)"; CF_ERRO="${CF_ERRO:-resposta inesperada}"
    return 1
  fi
  printf '%s' "$r"
}
cf_ou_sai() { local r; r="$(cf "$@")" || erro "Cloudflare recusou ($1 ${2%%\?*}): ${CF_ERRO}"; printf '%s' "$r"; }

# ---- zona do domínio (tenta do nome mais longo ao mais curto) ------------------------------------------------------
ZONA_ID="" CONTA_ID=""
achar_zona() { # HOST
  local resto="$1" z
  ZONA_ID=""; CONTA_ID=""
  while [[ "$resto" == *.*.* ]]; do
    resto="${resto#*.}"
    z="$(cf GET "/zones?name=$resto")" || erro "A Cloudflare recusou a consulta da zona: ${CF_ERRO}. O token precisa de Zona › Zona › Ler e da zona ${resto} em \"Recursos da zona\"."
    if [ "$(printf '%s' "$z" | jq '.result | length')" -gt 0 ]; then
      ZONA_ID="$(printf '%s' "$z" | jq -r '.result[0].id')"; CONTA_ID="$(printf '%s' "$z" | jq -r '.result[0].account.id')"; return 0
    fi
  done
  erro "Nenhuma zona da Cloudflare encontrada para $1: o token não enxerga o domínio (inclua a zona em \"Recursos da zona\" e a permissão Zona › Zona › Ler)."
}

# ---- o túnel único -------------------------------------------------------------------------------------------------
TUNEL_ID=""
nome_do_tunel() { # estável e único por VM
  local h id; h="$(hostname -s 2>/dev/null | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
  id="$(head -c 6 /etc/machine-id 2>/dev/null || true)"
  printf 'prefichas-vm-%s%s' "${h:-servidor}" "${id:+-$id}"
}
garantir_tunel() { # usa CONTA_ID (já achado); define TUNEL_ID
  mkdir -p "$ETC" && chmod 700 "$ETC"
  local id="" t
  [ -r "$ETC/tunel.env" ] && id="$(. "$ETC/tunel.env"; [ "${CONTA_ANTIGA:-}" = "$CONTA_ID" ] && printf '%s' "${TUNEL_ID_SALVO:-}")"
  if [ -n "$id" ] && t="$(cf GET "/accounts/$CONTA_ID/cfd_tunnel/$id")" && [ "$(printf '%s' "$t" | jq -r '.result.deleted_at // empty')" = "" ]; then
    TUNEL_ID="$id"; return 0
  fi
  local nome; nome="$(nome_do_tunel)"
  t="$(cf_ou_sai GET "/accounts/$CONTA_ID/cfd_tunnel?name=$nome&is_deleted=false")"
  id="$(printf '%s' "$t" | jq -r '.result[0].id // empty')"
  if [ -z "$id" ]; then
    id="$(cf_ou_sai POST "/accounts/$CONTA_ID/cfd_tunnel" "$(jq -nc --arg n "$nome" '{name:$n, config_src:"cloudflare"}')" | jq -r '.result.id')"
    echo "✓ Túnel único criado na Cloudflare ($nome)" >&2
  else
    echo "✓ Túnel único existente reaproveitado ($nome)" >&2
  fi
  TUNEL_ID="$id"
  ( umask 077; printf 'CONTA_ANTIGA=%q\nTUNEL_ID_SALVO=%q\n' "$CONTA_ID" "$TUNEL_ID" > "$ETC/tunel.env.novo" && mv -f "$ETC/tunel.env.novo" "$ETC/tunel.env" )
}
garantir_conector() { # sobe (ou confere) o cloudflared único desta VM
  command -v docker >/dev/null || erro "Docker não encontrado."
  local token; token="$(cf_ou_sai GET "/accounts/$CONTA_ID/cfd_tunnel/$TUNEL_ID/token" | jq -r '.result')"
  [ -n "$token" ] && [ "$token" != null ] || erro "A Cloudflare não entregou o token do túnel."
  mkdir -p "$PASTA"; chmod 700 "$PASTA"
  local novo=0
  if [ ! -f "$PASTA/.env" ] || ! grep -qxF "TUNNEL_TOKEN=${token}" "$PASTA/.env"; then
    ( umask 077; printf 'TUNNEL_TOKEN=%s\n' "$token" > "$PASTA/.env.novo" && mv -f "$PASTA/.env.novo" "$PASTA/.env" ); novo=1
  fi
  [ -f "$PASTA/docker-compose.yml" ] || cat > "$PASTA/docker-compose.yml" <<'YML'
# Túnel único da Cloudflare (gerado por scripts/tunel-compartilhado.sh)
name: prefichas-tunel
services:
  tunel:
    image: cloudflare/cloudflared:latest
    container_name: prefichas-tunel
    restart: unless-stopped
    network_mode: host          # enxerga 127.0.0.1:PORTA de cada acampamento
    mem_limit: 256m
    command: tunnel --no-autoupdate run
    env_file: .env
    logging:
      driver: local
      options: { max-size: "5m", max-file: "3" }
YML
  if [ "$novo" = 1 ] || ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    (cd "$PASTA" && docker compose up -d --force-recreate >/dev/null) || erro "Não consegui subir o cloudflared do túnel único."
    echo "✓ cloudflared do túnel único no ar" >&2
  fi
}

# regras do túnel (sem a regra final "http_status:404", que é acrescentada ao gravar)
regras_atuais() { cf_ou_sai GET "/accounts/$CONTA_ID/cfd_tunnel/$TUNEL_ID/configurations" | jq -c '[.result.config.ingress // [] | .[] | select(.hostname != null)]'; }
gravar_regras() { # json (lista de regras com hostname)
  cf_ou_sai PUT "/accounts/$CONTA_ID/cfd_tunnel/$TUNEL_ID/configurations" \
    "$(jq -nc --argjson r "$1" '{config:{ingress: ($r + [{service:"http_status:404"}])}}')" >/dev/null
}
registro_dns() { # HOST → id|conteudo do registro existente (vazio se não há)
  cf_ou_sai GET "/zones/$ZONA_ID/dns_records?name=$1" | jq -r '.result[0] | select(. != null) | "\(.id)|\(.content)"'
}
guardar_lista() { # cópia local (só nomes e portas) para o painel mostrar sem chamar a Cloudflare
  mkdir -p "$ETC" && chmod 700 "$ETC"
  ( umask 022; printf '%s' "$1" | jq -r '.[] | "\(.hostname) \(.service)"' > "$ETC/tunel-hosts.novo" && mv -f "$ETC/tunel-hosts.novo" "$ETC/tunel-hosts" )
}
# pasta, porta e domínio de cada instância
valor_env_de() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
definir_env_em() { local f="$1" k="$2" v="$3"; if grep -qE "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"; else echo "$k=$v" >> "$f"; fi; }

cmd_adicionar() { # HOST PORTA  (chamado com o cadeado já tomado)
  local host="$1" porta="$2" regras dns alvo reg
  achar_zona "$host"; garantir_tunel; garantir_conector
  regras="$(regras_atuais)"
  regras="$(printf '%s' "$regras" | jq -c --arg h "$host" --arg s "http://127.0.0.1:${porta}" 'map(select(.hostname != $h)) + [{hostname:$h, service:$s}]')"
  gravar_regras "$regras"
  alvo="${TUNEL_ID}.cfargotunnel.com"
  reg="$(jq -nc --arg n "$host" --arg c "$alvo" '{type:"CNAME", name:$n, content:$c, proxied:true, comment:"Pré-fichas (túnel único)"}')"
  dns="$(registro_dns "$host")"
  if [ -n "$dns" ]; then cf_ou_sai PUT "/zones/$ZONA_ID/dns_records/${dns%%|*}" "$reg" >/dev/null
  else cf_ou_sai POST "/zones/$ZONA_ID/dns_records" "$reg" >/dev/null; fi
  guardar_lista "$regras"
  echo "✓ ${host} → túnel único → 127.0.0.1:${porta}" >&2
}
cmd_remover() { # HOST
  local host="$1" regras dns
  achar_zona "$host"; garantir_tunel
  regras="$(regras_atuais | jq -c --arg h "$host" 'map(select(.hostname != $h))')"
  gravar_regras "$regras"; guardar_lista "$regras"
  dns="$(registro_dns "$host")"
  if [ -n "$dns" ] && [ "${dns#*|}" = "${TUNEL_ID}.cfargotunnel.com" ]; then
    cf_ou_sai DELETE "/zones/$ZONA_ID/dns_records/${dns%%|*}" >/dev/null
    echo "✓ ${host} removido do túnel único (DNS apagado)." >&2
  else
    echo "✓ ${host} removido do túnel único. O DNS não aponta para ele, então foi mantido." >&2
  fi
}

# ---- comandos ------------------------------------------------------------------------------------------------------
case "$ACAO" in
  verificar)
    HOST="${2:?Informe o endereço}"; dominio_valido "$HOST" || erro "Endereço inválido: $HOST"
    achar_zona "$HOST"
    cf GET "/accounts/$CONTA_ID/cfd_tunnel?is_deleted=false&per_page=1" >/dev/null \
      || erro "O token não tem permissão de túnel (${CF_ERRO}). Adicione a permissão Conta › Cloudflare Tunnel › Editar, incluindo a sua conta."
    cf GET "/zones/$ZONA_ID/dns_records?name=$HOST" >/dev/null \
      || erro "O token não consegue ler o DNS da zona (${CF_ERRO}). Adicione a permissão Zona › DNS › Editar para a zona."
    echo "✓ Cloudflare conferida: zona, túnel e DNS acessíveis para ${HOST}."
    ;;
  adicionar|remover|listar|unificar)
    mkdir -p "$ETC" && chmod 700 "$ETC"
    exec 9>"$ETC/tunel.lock"; flock -w 120 9 || erro "Outro pedido do túnel está em andamento. Tente de novo em instantes."
    ;;&
  adicionar)
    HOST="${2:?Informe o endereço}"; PORTA="${3:?Informe a porta local}"
    dominio_valido "$HOST" || erro "Endereço inválido: $HOST"
    [[ "$PORTA" =~ ^[0-9]{4,5}$ ]] && [ "$PORTA" -ge 1024 ] && [ "$PORTA" -le 65535 ] || erro "Porta inválida: $PORTA"
    cmd_adicionar "$HOST" "$PORTA"
    ;;
  remover)
    HOST="${2:?Informe o endereço}"; dominio_valido "$HOST" || erro "Endereço inválido: $HOST"
    cmd_remover "$HOST"
    ;;
  listar)
    # precisa de um endereço só para achar a zona/conta: usa o primeiro acampamento publicado
    H1=""; for f in "$RAIZ_INSTANCIAS"/prefichas-*/.env; do [ -f "$f" ] || continue; h="$(valor_env_de "$f" ENDERECO_PUBLICO)"; [ -n "$h" ] && { H1="$h"; break; }; done
    [ -n "$H1" ] || { [ -r "$ETC/tunel-hosts" ] && cat "$ETC/tunel-hosts"; exit 0; }
    achar_zona "$H1"; garantir_tunel
    regras_atuais | jq -r '.[] | "\(.hostname) → \(.service)"'
    ;;
  unificar)
    # Acampamentos que ainda têm túnel próprio (um cloudflared por acampamento) passam para o túnel único.
    # Para cada um: publica no túnel único, CONFERE que o site responde por ele e só então desliga o túnel antigo.
    # Se não responder, o DNS volta ao túnel antigo e nada muda para o público.
    falhou=0; movidos=0
    for f in "$RAIZ_INSTANCIAS"/prefichas-*/.env; do
      [ -f "$f" ] && [ ! -L "$f" ] || continue
      pasta="$(dirname "$f")"; nome="$(basename "$pasta")"
      case "$nome" in prefichas-gerenciador|prefichas-proxy|prefichas-tunel) continue ;; esac
      case ",$(valor_env_de "$f" COMPOSE_PROFILES)," in *,tunel,*) ;; *) continue ;; esac
      host="$(valor_env_de "$f" ENDERECO_PUBLICO)"; porta="$(valor_env_de "$f" PORTA_LOCAL)"
      if ! dominio_valido "$host" || ! [[ "$porta" =~ ^[0-9]{4,5}$ ]]; then echo "✗ $nome: endereço ou porta não encontrados no .env; pulei." >&2; falhou=1; continue; fi
      echo "→ $nome ($host): movendo para o túnel único…" >&2
      achar_zona "$host"
      antigo="$(registro_dns "$host")"
      cmd_adicionar "$host" "$porta"
      ok=0
      for _ in $(seq 1 12); do
        curl -fsS -m 15 "${TUNEL_VERIFICAR_BASE:-https://${host}}/api/saude" >/dev/null 2>&1 && { ok=1; break; }; sleep "${TUNEL_ESPERA:-5}"
      done
      if [ "$ok" != 1 ]; then
        echo "✗ $nome: o site não respondeu pelo túnel único; voltando ao túnel antigo (nada mudou para o público)." >&2
        if [ -n "$antigo" ]; then
          cf PUT "/zones/$ZONA_ID/dns_records/${antigo%%|*}" "$(jq -nc --arg n "$host" --arg c "${antigo#*|}" '{type:"CNAME", name:$n, content:$c, proxied:true, comment:"Pré-fichas (túnel)"}')" >/dev/null \
            || echo "! Não consegui restaurar o DNS de $host automaticamente: aponte-o para ${antigo#*|}." >&2
        fi
        falhou=1; continue
      fi
      # o túnel único atende: desliga o cloudflared próprio deste acampamento e apaga o túnel antigo
      (cd "$pasta" && docker compose stop tunel >/dev/null 2>&1; docker compose rm -f tunel >/dev/null 2>&1) || true
      perfis="$(valor_env_de "$f" COMPOSE_PROFILES | tr ',' '\n' | { grep -vx 'tunel' || true; } | { grep -v '^$' || true; } | paste -sd, -)"
      definir_env_em "$f" COMPOSE_PROFILES "$perfis"; definir_env_em "$f" TUNEL_TOKEN ""
      (cd "$pasta" && docker compose up -d >/dev/null 2>&1) || true
      velho="$(cf GET "/accounts/$CONTA_ID/cfd_tunnel?name=prefichas-${host}&is_deleted=false" | jq -r '.result[0].id // empty' 2>/dev/null || true)"
      if [ -n "$velho" ]; then
        cf DELETE "/accounts/$CONTA_ID/cfd_tunnel/$velho/connections" >/dev/null 2>&1 || true
        cf DELETE "/accounts/$CONTA_ID/cfd_tunnel/$velho" >/dev/null 2>&1 || echo "! Túnel antigo de $host não pôde ser apagado agora; ele já está sem uso (apague na Cloudflare, se quiser)." >&2
      fi
      movidos=$((movidos + 1)); echo "✓ $nome agora usa o túnel único." >&2
    done
    echo "✓ Túneis unificados: ${movidos} acampamento(s) movido(s)."
    [ "$falhou" = 0 ] || exit 1
    ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
