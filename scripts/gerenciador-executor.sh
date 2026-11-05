#!/usr/bin/env bash
# Executor do painel central (roda como root pelo systemd).
#   gerenciador-executor.sh pedidos   # executa os pedidos deixados pelo painel (um de cada vez)
#   gerenciador-executor.sh coletar   # publica a lista de instâncias e a situação do servidor
#
# Segurança: o painel só ESCREVE em pedidos/ e só LÊ estado/. Cada pedido é lido com jq e todos os
# campos são validados de novo aqui (o painel pode estar comprometido); nada vira comando de shell
# sem passar por expressão regular restrita; argumentos sempre entre aspas/arrays.
set -uo pipefail
BASE="${GERENCIADOR_DADOS:-/var/lib/prefichas-gerenciador}"
PEDIDOS="$BASE/pedidos"; ESTADO="$BASE/estado"; TAREFAS="$ESTADO/tarefas"
CODIGO="$(cd "$(dirname "$0")/.." && pwd)"     # clone do repositório do painel
REPO="$(git -C "$CODIGO" remote get-url origin 2>/dev/null || echo https://github.com/ecruz-acamps/pre-fichas_acampamento.git)"
umask 022
mkdir -p "$TAREFAS"
ETC="${PREFICHAS_ETC:-/etc/prefichas}"      # configurações do servidor (token, e-mails…), só root lê
CF_API="${CF_API_URL:-https://api.cloudflare.com/client/v4}"

RE_NOME='^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,'"'"'()-]{3,80}$'
RE_SUB='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
RE_DOM='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
RE_EMAIL='^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'
RE_PESSOA='^[A-Za-zÀ-ÖØ-öø-ÿ .'"'"'-]{2,80}$'
RE_CHAVE='^[A-Za-z0-9-]{3,20}$'
RE_INST='^prefichas-[a-z0-9-]{1,80}$'
RE_ID='^[0-9a-f-]{36}$'

# Confere com regex no modo byte a byte (LC_ALL=C): em locale UTF-8 o bash recusa a faixa de
# letras acentuadas da regex e TODA validação falhava. Só nas validações; o resto continua em UTF-8.
casa() { local LC_ALL=C; [[ "$1" =~ $2 ]]; }
json_str() { jq -Rn --arg v "$1" '$v'; }
estado_tarefa() { # id acao alvo situacao mensagem por inicio
  local f="$TAREFAS/$1.json"
  printf '{"id":"%s","acao":"%s","alvo":%s,"situacao":"%s","mensagem":%s,"por":%s,"inicio":"%s","fim":%s}\n' \
    "$1" "$2" "$(json_str "$3")" "$4" "$(json_str "$5")" "$(json_str "$6")" "$7" \
    "$([ "$4" = executando ] && echo null || echo "\"$(date -Iseconds)\"")" > "$f.tmp" && mv -f "$f.tmp" "$f"
}
instancias() { for f in /opt/prefichas-*/.env; do [ -f "$f" ] && basename "$(dirname "$f")"; done | grep -vx 'prefichas-gerenciador\|prefichas-proxy' || true; }
valor_env() { { grep -E "^$2=" "/opt/$1/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }

# ---------------------------------------------------------------- ações
acao_nova() { # arquivo
  local p="$1" nome pub sub dom email anome chave slug pasta args=()
  nome="$(jq -r '.nome // empty' "$p")"; pub="$(jq -r '.publicacao // empty' "$p")"
  sub="$(jq -r '.subdominio // empty' "$p")"; dom="$(jq -r '.dominio // empty' "$p")"
  email="$(jq -r '.admin_email // empty' "$p")"; anome="$(jq -r '.admin_nome // empty' "$p")"; chave="$(jq -r '.chave // empty' "$p")"
  casa "$nome" "$RE_NOME" || { echo "✗ Nome inválido."; return 1; }
  casa "$email" "$RE_EMAIL" || { echo "✗ E-mail inválido."; return 1; }
  casa "$anome" "$RE_PESSOA" || { echo "✗ Nome do administrador inválido."; return 1; }
  [ -z "$chave" ] || casa "$chave" "$RE_CHAVE" || { echo "✗ Chave inválida."; return 1; }
  slug="$(printf '%s' "$nome" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$nome")"
  slug="$(printf '%s' "$slug" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
  [ -n "$slug" ] || { echo "✗ Nome sem letras."; return 1; }
  pasta="/opt/prefichas-$slug"
  [ ! -e "$pasta" ] || { echo "✗ Já existe uma instância em $pasta."; return 1; }
  args=(--nome "$nome" --admin "$email" --nome-admin "$anome")
  case "$pub" in
    cloudflare)
      casa "$sub" "$RE_SUB" || { echo "✗ Endereço inválido."; return 1; }
      [ -r "$ETC/cloudflare.env" ] || { echo "✗ Token da Cloudflare não configurado na VM (cole o token na aba Configurações do painel central)."; return 1; }
      local base=""; [ -r "$ETC/painel.env" ] && base="$({ grep -E '^DOMINIO_BASE=' "$ETC/painel.env" || true; } | cut -d= -f2-)"
      casa "$base" "$RE_DOM" || base="$(valor_env "$(instancias | head -1)" DOMINIO_BASE)"; base="${base:-movimentocampista.com.br}"
      args+=(--dominio "${sub}.${base}" --cloudflare) ;;
    direta)
      casa "$dom" "$RE_DOM" || { echo "✗ Domínio inválido."; return 1; }
      args+=(--dominio "$dom" --compartilhado) ;;
    local) args+=(--dominio "") ;;
    *) echo "✗ Publicação inválida."; return 1 ;;
  esac
  [ -n "$chave" ] && args+=(--chave "$chave")
  echo "→ Baixando o sistema para $pasta…"
  git clone -q "$REPO" "$pasta" || { echo "✗ Falha ao baixar o sistema."; return 1; }
  echo "→ Instalando ${nome}…"
  if [ -r "$ETC/cloudflare.env" ]; then set -a; . "$ETC/cloudflare.env"; set +a; fi
  # e-mail de envio ("Esqueci minha senha") guardado na preparação da VM
  if [ -r "$ETC/smtp.env" ]; then set -a; . "$ETC/smtp.env"; set +a; fi
  (cd "$pasta" && ./scripts/novo-acampamento.sh "${args[@]}" </dev/null)
}
acao_atualizar() { local i="$1"; casa "$i" "$RE_INST" && [ -f "/opt/$i/.env" ] || { echo "✗ Instância inválida: $i"; return 1; }
  echo "→ Atualizando $i…"; (cd "/opt/$i" && ./scripts/atualizar.sh); }
# ---------------------------------------------------------------- Cloudflare (aba Configurações)
RE_TOKEN='^[A-Za-z0-9_-]{20,200}$'
valor_painel() { { grep -E "^$1=" "$ETC/painel.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
acao_cloudflare() { # arquivo do pedido
  local p="$1" token base resp ok n atual
  token="$(jq -r '.token // empty' "$p")"; base="$(jq -r '.dominio_base // empty' "$p")"
  casa "$base" "$RE_DOM" || { echo "✗ Domínio inválido."; return 1; }
  if [ -z "$token" ]; then
    [ -r "$ETC/cloudflare.env" ] || { echo "✗ Ainda não há token guardado: cole o token."; return 1; }
    token="$( . "$ETC/cloudflare.env"; printf '%s' "${CF_API_TOKEN:-}" )"
  fi
  casa "$token" "$RE_TOKEN" || { echo "✗ Token em formato inválido."; return 1; }
  echo "→ Conferindo o token na Cloudflare (domínio ${base})…"
  # o token vai pela entrada do curl, nunca na linha de comando (não aparece em 'ps')
  resp="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS -m 20 -K - -H 'Content-Type: application/json' "$CF_API/zones?name=${base}" 2>&1)" \
    || { echo "✗ Não consegui falar com a Cloudflare (saída HTTPS liberada?)."; return 1; }
  ok="$(printf '%s' "$resp" | jq -r '.success // false' 2>/dev/null || echo false)"
  if [ "$ok" != true ]; then
    echo "✗ A Cloudflare recusou o token: $(printf '%s' "$resp" | jq -r '[.errors[]?.message] | join("; ")' 2>/dev/null | head -c 200)"
    echo "  Confira se copiou o token inteiro e se ele ainda está ativo."
    return 1
  fi
  n="$(printf '%s' "$resp" | jq -r '.result | length' 2>/dev/null || echo 0)"
  if [ "${n:-0}" -lt 1 ]; then
    echo "✗ O token é válido, mas não enxerga o domínio ${base}."
    echo "  Ao criar o token, inclua a zona ${base} em \"Zone Resources\" (permissões: Zone › DNS › Edit e Account › Cloudflare Tunnel › Edit)."
    return 1
  fi
  mkdir -p "$ETC" && chmod 700 "$ETC"
  ( umask 077; printf 'CF_API_TOKEN=%q\n' "$token" > "$ETC/cloudflare.env.novo" && mv -f "$ETC/cloudflare.env.novo" "$ETC/cloudflare.env" )
  ( umask 077
    { grep -vE '^DOMINIO_BASE=' "$ETC/painel.env" 2>/dev/null || true; printf 'DOMINIO_BASE=%s\n' "$base"; } > "$ETC/painel.env.novo" && mv -f "$ETC/painel.env.novo" "$ETC/painel.env" )
  echo "✓ Token da Cloudflare verificado e guardado no servidor (domínio ${base})."
}
acao_cloudflare_remover() {
  rm -f "$ETC/cloudflare.env"
  echo "✓ Token da Cloudflare removido do servidor. Os acampamentos já publicados continuam no ar (cada um tem o próprio túnel)."
}

# ---------------------------------------------------------------- VPN (aba Configurações)
# Qual cliente está instalado: FortiClient (preferido) ou strongSwan (plano B)
vpn_backend() {
  if [ -r "$ETC/vpn-forticlient.env" ]; then echo vpn-fortinet.sh
  elif [ -f /etc/swanctl/conf.d/prefichas.conf ]; then echo vpn-ipsec-strongswan.sh; fi
}
acao_vpn_reconectar() {
  local b; b="$(vpn_backend)"
  [ -n "$b" ] || { echo "✗ A VPN ainda não foi configurada neste servidor (use o terminal: vpn-fortinet.sh configurar)."; return 1; }
  "$CODIGO/scripts/$b" reconectar
}
acao_vpn_credenciais() { # arquivo do pedido
  local p="$1" b psk senha
  b="$(vpn_backend)"
  [ -n "$b" ] || { echo "✗ A VPN ainda não foi configurada neste servidor."; return 1; }
  if [ "$b" != vpn-ipsec-strongswan.sh ]; then
    echo "✗ Com o FortiClient, a troca de chave/senha da VPN ainda é feita pelo terminal:"
    echo "  sudo $CODIGO/scripts/vpn-fortinet.sh configurar"
    return 1
  fi
  psk="$(jq -r '.psk // empty' "$p")"; senha="$(jq -r '.senha // empty' "$p")"
  [ -z "$psk" ] || casa "$psk" '^[ -~]{4,128}$' || { echo "✗ Chave (PSK) inválida: use de 4 a 128 caracteres comuns."; return 1; }
  [ -z "$senha" ] || casa "$senha" '^[^[:cntrl:]]{1,256}$' || { echo "✗ Senha inválida."; return 1; }
  [ -n "$psk$senha" ] || { echo "✗ Informe a nova chave e/ou a nova senha."; return 1; }
  # os segredos vão por variável de ambiente (não aparecem na lista de processos nem no log)
  VPN_NOVA_PSK="$psk" VPN_NOVA_SENHA="$senha" "$CODIGO/scripts/$b" trocar-credenciais
}

acao_atualizar_painel() {
  echo "→ Atualizando o painel central…"
  git -C "$CODIGO" pull -q --ff-only || { echo "✗ Não foi possível baixar a versão nova do painel."; return 1; }
  (cd "$BASE" && docker compose up -d --force-recreate >/dev/null) || { echo "✗ Falha ao reiniciar o painel."; return 1; }
  echo "✓ Painel central atualizado para $(git -C "$CODIGO" rev-parse --short HEAD)."
}
acao_backup() { local i="$1"; casa "$i" "$RE_INST" && [ -f "/opt/$i/.env" ] || { echo "✗ Instância inválida: $i"; return 1; }
  echo "→ Backup de $i…"; (cd "/opt/$i" && ./scripts/backup.sh); }

processar() { # arquivo do pedido
  local arq="$1" id acao alvo por inicio log ok=0
  id="$(basename "$arq" .json)"
  if [ -L "$arq" ] || [ ! -f "$arq" ] || ! casa "$id" "$RE_ID" || [ "$(stat -c %s "$arq")" -gt 8192 ] || ! jq -e . "$arq" >/dev/null 2>&1; then
    rm -f "$arq"; return
  fi
  local tmp; tmp="$(mktemp)"; cp "$arq" "$tmp"; rm -f "$arq"   # trabalha numa cópia do root
  acao="$(jq -r '.acao // empty' "$tmp")"; por="$(jq -r '.por // empty' "$tmp" | head -c 200)"
  alvo="$(jq -r '.instancia // .nome // (if (.acao|startswith("cloudflare")) then "Cloudflare" elif (.acao|startswith("vpn")) then "VPN" else "todas" end)' "$tmp" | head -c 120)"
  inicio="$(date -Iseconds)"; log="$TAREFAS/$id.log"; : > "$log"
  estado_tarefa "$id" "$acao" "$alvo" executando "Em andamento" "$por" "$inicio"
  echo "▶ Tarefa $id: $acao · $alvo (por $por) — log: $log"
  case "$acao" in
    nova) acao_nova "$tmp" >> "$log" 2>&1 && ok=1 ;;
    atualizar) acao_atualizar "$(jq -r '.instancia // empty' "$tmp")" >> "$log" 2>&1 && ok=1 ;;
    backup) acao_backup "$(jq -r '.instancia // empty' "$tmp")" >> "$log" 2>&1 && ok=1 ;;
    atualizar-painel) acao_atualizar_painel >> "$log" 2>&1 && ok=1 ;;
    cloudflare) acao_cloudflare "$tmp" >> "$log" 2>&1 && ok=1 ;;
    cloudflare-remover) acao_cloudflare_remover >> "$log" 2>&1 && ok=1 ;;
    vpn-reconectar) acao_vpn_reconectar >> "$log" 2>&1 && ok=1 ;;
    vpn-credenciais) acao_vpn_credenciais "$tmp" >> "$log" 2>&1 && ok=1 ;;
    atualizar-todas)
      ok=1
      for i in $(instancias); do acao_atualizar "$i" >> "$log" 2>&1 || { ok=0; echo "✗ Falhou: $i" >> "$log"; }; done ;;
    *) echo "✗ Ação desconhecida." >> "$log" ;;
  esac
  rm -f "$tmp"
  if [ "$ok" = 1 ]; then estado_tarefa "$id" "$acao" "$alvo" concluida "$(grep -E '^✓' "$log" | tail -1)" "$por" "$inicio"
  else estado_tarefa "$id" "$acao" "$alvo" erro "$(grep -E '^✗' "$log" | tail -1 || echo 'Falhou')" "$por" "$inicio"; fi
  chmod 644 "$TAREFAS/$id.json" "$log"
  echo "■ Tarefa $id terminou: $([ "$ok" = 1 ] && echo concluída || echo ERRO)"
  coletar
}

# ---------------------------------------------------------------- estado publicado
coletar() {
  local itens=() i porta saude mem nome url pub versao proj
  for i in $(instancias); do
    porta="$(valor_env "$i" PORTA_LOCAL)"; porta="${porta:-3000}"
    nome="$(valor_env "$i" NOME_ACAMPAMENTO)"; url="$(valor_env "$i" URL_PUBLICA)"; pub="$(valor_env "$i" PUBLICACAO)"
    [ -z "$pub" ] && case "$(valor_env "$i" COMPOSE_PROFILES)" in *tunel*) pub=cloudflare ;; *caddy*) pub=propria ;; *) pub=proxy-externo ;; esac
    proj="$(valor_env "$i" COMPOSE_PROJECT_NAME)"
    versao="$(git -C "/opt/$i" rev-parse --short HEAD 2>/dev/null || true)"
    saude=fora; curl -fsS -m 3 "http://127.0.0.1:${porta}/api/saude" >/dev/null 2>&1 && saude=ok
    mem="$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | awk -v p="$proj" 'index($1,p"-")==1{split($2,a,"MiB"); s+=a[1]} END{if(s) printf "%.0f MB", s}')"
    itens+=("$(printf '{"pasta":%s,"nome":%s,"url":%s,"publicacao":%s,"porta":%s,"versao":%s,"saude":"%s","memoria":%s}' \
      "$(json_str "$i")" "$(json_str "$nome")" "$(json_str "$url")" "$(json_str "$pub")" "${porta//[^0-9]/}" "$(json_str "$versao")" "$saude" "$(json_str "$mem")")")
  done
  local lista; lista="$(IFS=,; echo "${itens[*]:-}")"
  printf '{"coletado_em":"%s","instancias":[%s]}\n' "$(date -Iseconds)" "$lista" > "$ESTADO/instancias.json.tmp" && mv -f "$ESTADO/instancias.json.tmp" "$ESTADO/instancias.json"
  local mt mu dt du dp sites=0 proxy=false
  read -r mt mu < <(free -m | awk '/^Mem:/{print $2, $3}')
  read -r dt du dp < <(df -h / | awk 'NR==2{print $2, $3, $5}')
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx prefichas-proxy && proxy=true
  sites="$(ls /opt/prefichas-proxy/sites/*.caddy 2>/dev/null | grep -vc '_vazio' || true)"
  local vpainel; vpainel="$(git -C "$CODIGO" rev-parse --short HEAD 2>/dev/null || true)"
  printf '{"versao_painel":"%s","carga":"%s","cpus":%s,"memoria_total_mb":%s,"memoria_usada_mb":%s,"disco_total":"%s","disco_usado":"%s","disco_pct":"%s","proxy":%s,"dominios_diretos":%s}\n' \
    "$vpainel" "$(cut -d' ' -f1 /proc/loadavg)" "$(nproc)" "${mt:-0}" "${mu:-0}" "$dt" "$du" "$dp" "$proxy" "${sites:-0}" > "$ESTADO/servidor.json.tmp" && mv -f "$ESTADO/servidor.json.tmp" "$ESTADO/servidor.json"
  local b vj='{"configurada":false}'; b="$(vpn_backend)"
  [ -n "$b" ] && vj="$(timeout 25 "$CODIGO/scripts/$b" estado-json 2>/dev/null)"
  printf '%s' "$vj" | jq -e . >/dev/null 2>&1 || vj='{"configurada":true,"erro":"não consegui ler a situação da VPN agora"}'
  printf '%s' "$vj" | jq -c --arg em "$(date -Iseconds)" '. + {coletado_em:$em}' > "$ESTADO/vpn.json.tmp" && mv -f "$ESTADO/vpn.json.tmp" "$ESTADO/vpn.json" && chmod 644 "$ESTADO/vpn.json"
  local tk=false; grep -qE '^CF_API_TOKEN=.' "$ETC/cloudflare.env" 2>/dev/null && tk=true
  local dbase; dbase="$(valor_painel DOMINIO_BASE)"; dbase="${dbase:-movimentocampista.com.br}"
  printf '{"cloudflare":{"token_configurado":%s,"dominio_base":%s,"atualizado_em":%s}}\n' "$tk" "$(json_str "$dbase")" \
    "$( [ -f "$ETC/cloudflare.env" ] && json_str "$(date -r "$ETC/cloudflare.env" -Iseconds)" || echo null )" > "$ESTADO/configuracoes.json.tmp" \
    && mv -f "$ESTADO/configuracoes.json.tmp" "$ESTADO/configuracoes.json"
  chmod 644 "$ESTADO/instancias.json" "$ESTADO/servidor.json" "$ESTADO/configuracoes.json"
}

case "${1:-pedidos}" in
  pedidos)
    exec 9>"$ESTADO/.trava"; flock -n 9 || exit 0
    while :; do
      prox="$(ls -1tr "$PEDIDOS"/*.json 2>/dev/null | head -1)"
      [ -n "$prox" ] || break
      processar "$prox"
    done ;;
  coletar) coletar ;;
  *) echo "Uso: $0 pedidos|coletar"; exit 1 ;;
esac
