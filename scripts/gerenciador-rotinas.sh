# shellcheck shell=bash
# Rotinas do painel central (carregado pelo gerenciador-executor.sh, roda como root):
#   1) BACKUP NA NUVEM (OneDrive): todo dia, um backup por acampamento, CIFRADO com age antes de sair da VM
#      (na VM fica só a chave PÚBLICA; a chave de recuperação aparece uma vez no painel e fica com o responsável).
#   2) MENSAGENS DE ANIVERSÁRIO (SMS pelo textbee.dev): aniversário de vida e de acampamento dos CAMPISTAS
#      de todos os acampamentos, com dedupe entre acampamentos, lista de quem pediu para não receber e limite diário.
# Nada disso aparece para o administrador do acampamento: tudo é gerido pelo painel da VM.
# Arquivos locais: nenhum dado em claro é gravado em disco (o dump vai do banco direto para o age); o temporário cifrado
# é sempre o mesmo arquivo, sobrescrito a cada uso.

NUVEM_ENV="$ETC/onedrive.env"          # OD_TENANT, OD_CLIENT, OD_REFRESH (token de atualização)
CHAVE_PUB="$ETC/backup-chave.pub"      # chave pública do age
BACKUP_CONF="$ETC/backup.conf"         # BACKUP_LIGADO, BACKUP_HORA, MANTER_DIARIOS, MANTER_MENSAIS
TB_ENV="$ETC/textbee.env"              # TB_KEY, TB_DEVICE
SMS_CONF="$ETC/sms.json"               # ligado, hora, modelos, limite, teste…
SMS_BLOQ="$ETC/sms-bloqueio.txt"       # um telefone (E.164) por linha
SMS_ENVIADOS="$ETC/sms-enviados"       # dedupe por dia (telefones completos ficam só aqui, pasta 700)
GRAPH="${PREFICHAS_GRAPH_URL:-https://graph.microsoft.com/v1.0}"
LOGIN_MS="${PREFICHAS_LOGIN_MS_URL:-https://login.microsoftonline.com}"
TEXTBEE="${PREFICHAS_TEXTBEE_URL:-https://api.textbee.dev/api/v1}"
PASTA_NUVEM="PreFichas-Backups"
TMPD="$BASE/tmp"
FUSO="America/Sao_Paulo"
RE_GUID_R='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
RE_HORA='^([01][0-9]|2[0-3]):[0-5][0-9]$'
RE_AGE_PUB='^age1[0-9a-z]{58}$'
RE_AGE_SEC='^AGE-SECRET-KEY-1[0-9A-Z]{58}$'
RE_ARQ_NUVEM='^prefichas-[a-z0-9-]{1,80}__[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.dump\.age$'

conf_ler() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
conf_gravar() { # arquivo CHAVE valor  (arquivo 600, troca atômica)
  local f="$1" tmp; mkdir -p "$ETC" && chmod 700 "$ETC"; tmp="$(mktemp "$ETC/.conf.XXXXXX")"
  { grep -vE "^$2=" "$f" 2>/dev/null || true; printf '%s=%s\n' "$2" "$3"; } > "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$f"
}
hoje_local() { TZ="$FUSO" date +%F; }
agora_local() { TZ="$FUSO" date +%H:%M; }
garantir_age() { command -v age >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq age >/dev/null 2>&1; command -v age >/dev/null 2>&1; }
db_rodando() { (cd "$OPT/$1" && docker compose ps --status running --services 2>/dev/null | grep -qx db); }

# ================================================================ OneDrive (Microsoft Graph, permissão delegada Files.ReadWrite)
od_carregar() { OD_TENANT="$(conf_ler "$NUVEM_ENV" OD_TENANT)"; OD_CLIENT="$(conf_ler "$NUVEM_ENV" OD_CLIENT)"; OD_REFRESH="$(conf_ler "$NUVEM_ENV" OD_REFRESH)"; }
# troca o refresh token por um access token (e guarda o refresh novo, que a Microsoft gira)
od_token() {
  od_carregar
  [ -n "$OD_REFRESH" ] || { echo "✗ O OneDrive não está conectado (Backups → Conectar)."; return 1; }
  local r; r="$(printf 'client_id=%s&grant_type=refresh_token&scope=%s&refresh_token=%s' "$OD_CLIENT" 'Files.ReadWrite%20offline_access' "$OD_REFRESH" \
    | curl -sS -m 30 -X POST "$LOGIN_MS/$OD_TENANT/oauth2/v2.0/token" -H 'Content-Type: application/x-www-form-urlencoded' --data-binary @- 2>/dev/null)" || { echo "✗ Sem acesso ao login da Microsoft."; return 1; }
  OD_ACCESS="$(printf '%s' "$r" | jq -r '.access_token // empty' 2>/dev/null)"
  [ -n "$OD_ACCESS" ] || { echo "✗ A Microsoft recusou a conexão do OneDrive ($(printf '%s' "$r" | jq -r '.error // "erro"' 2>/dev/null)). Conecte de novo em Backups."; return 1; }
  local novo; novo="$(printf '%s' "$r" | jq -r '.refresh_token // empty')"; [ -n "$novo" ] && conf_gravar "$NUVEM_ENV" OD_REFRESH "$novo"
  return 0
}
# chamada ao Graph com o token pela entrada (não aparece em 'ps'): od_req MÉTODO URL [args extras do curl…]
od_req() { local m="$1" u="$2"; shift 2; printf 'header = "Authorization: Bearer %s"\n' "$OD_ACCESS" | curl -sS -m 120 -K - -X "$m" "$@" "$u"; }
od_url_caminho() { printf '%s/me/drive/root:/%s' "$GRAPH" "$(printf '%s' "$1" | jq -sRr @uri | sed 's/%2F/\//g')"; }
od_garantir_pasta() { # nome da subpasta (instância) ou vazio
  local corpo
  corpo="$(jq -nc --arg n "$PASTA_NUVEM" '{name:$n, folder:{}, "@microsoft.graph.conflictBehavior":"fail"}')"
  od_req POST "$GRAPH/me/drive/root/children" -H 'Content-Type: application/json' --data-binary "$corpo" >/dev/null 2>&1 || true
  [ -z "${1:-}" ] && return 0
  corpo="$(jq -nc --arg n "$1" '{name:$n, folder:{}, "@microsoft.graph.conflictBehavior":"fail"}')"
  od_req POST "$(od_url_caminho "$PASTA_NUVEM"):/children" -H 'Content-Type: application/json' --data-binary "$corpo" >/dev/null 2>&1 || true
}
od_enviar() { # arquivo_local pasta nome  → envia em partes de 10 MiB (múltiplo de 320 KiB, como o Graph exige)
  local f="$1" pasta="$2" nome="$3" sess url total pos=0 n r parte=$((10 * 1024 * 1024))
  sess="$(od_req POST "$(od_url_caminho "$PASTA_NUVEM/$pasta/$nome"):/createUploadSession" -H 'Content-Type: application/json' \
    --data-binary '{"item":{"@microsoft.graph.conflictBehavior":"replace"}}')" || return 1
  url="$(printf '%s' "$sess" | jq -r '.uploadUrl // empty' 2>/dev/null)"; [ -n "$url" ] || { echo "✗ OneDrive recusou o envio: $(printf '%s' "$sess" | jq -r '.error.message // "erro"' 2>/dev/null | head -c 200)"; return 1; }
  total="$(stat -c %s "$f")"
  while [ "$pos" -lt "$total" ]; do
    n=$(( total - pos < parte ? total - pos : parte ))
    r="$(tail -c +"$((pos + 1))" "$f" | head -c "$n" | curl -sS -m 600 -X PUT -H "Content-Range: bytes $pos-$((pos + n - 1))/$total" --data-binary @- "$url")" || { echo "✗ Falha no envio (parte em $pos)."; return 1; }
    pos=$((pos + n))
  done
  printf '%s' "$r" | jq -e '.id' >/dev/null 2>&1 || { echo "✗ O OneDrive não confirmou o arquivo enviado."; return 1; }
}
od_listar() { # pasta → JSON [{id,name,size,createdDateTime}] (vazio se não existe)
  local r; r="$(od_req GET "$(od_url_caminho "$PASTA_NUVEM/$1"):/children?\$select=id,name,size,createdDateTime&\$top=500")" || { echo '[]'; return; }
  printf '%s' "$r" | jq -c '[.value[]? | {id, name, size, createdDateTime}]' 2>/dev/null || echo '[]'
}

# --- pedidos do painel: configurar / conectar / desconectar
acao_backup_config() { # {ligado, hora, tenant_id, client_id, manter_diarios, manter_mensais}
  local p="$1" lig hora t c md mm
  lig="$(jq -r '.ligado // false' "$p")"; hora="$(jq -r '.hora // "02:30"' "$p")"
  t="$(jq -r '.tenant_id // empty' "$p")"; c="$(jq -r '.client_id // empty' "$p")"
  md="$(jq -r '.manter_diarios // 14' "$p")"; mm="$(jq -r '.manter_mensais // 6' "$p")"
  casa "$hora" "$RE_HORA" || { echo "✗ Horário inválido (use HH:MM)."; return 1; }
  casa "$md" '^[0-9]{1,3}$' && [ "$md" -ge 3 ] && [ "$md" -le 90 ] || { echo "✗ Dias de backups diários: de 3 a 90."; return 1; }
  casa "$mm" '^[0-9]{1,2}$' && [ "$mm" -le 24 ] || { echo "✗ Meses de backups mensais: de 0 a 24."; return 1; }
  if [ -n "$t$c" ]; then
    casa "$t" "$RE_GUID_R" && casa "$c" "$RE_GUID_R" || { echo "✗ ID do diretório e ID do aplicativo precisam estar no formato 00000000-0000-0000-0000-000000000000."; return 1; }
    od_carregar
    if [ "$t" != "$OD_TENANT" ] || [ "$c" != "$OD_CLIENT" ]; then conf_gravar "$NUVEM_ENV" OD_REFRESH ""; echo "→ Aplicativo trocado: conecte o OneDrive de novo."; fi
    conf_gravar "$NUVEM_ENV" OD_TENANT "$t"; conf_gravar "$NUVEM_ENV" OD_CLIENT "$c"
  fi
  if [ "$lig" = true ]; then
    [ -n "$(conf_ler "$NUVEM_ENV" OD_REFRESH)" ] || { echo "✗ Conecte o OneDrive antes de ligar o backup diário."; return 1; }
    [ -s "$CHAVE_PUB" ] || { echo "✗ Gere a chave de recuperação antes de ligar o backup diário."; return 1; }
  fi
  conf_gravar "$BACKUP_CONF" BACKUP_LIGADO "$lig"; conf_gravar "$BACKUP_CONF" BACKUP_HORA "$hora"
  conf_gravar "$BACKUP_CONF" MANTER_DIARIOS "$md"; conf_gravar "$BACKUP_CONF" MANTER_MENSAIS "$mm"
  echo "✓ Backup na nuvem $([ "$lig" = true ] && echo "ligado, todo dia às $hora" || echo desligado). Mantém $md diários e $mm mensais por acampamento."
}

acao_backup_conectar() { # login por código (device code): mostra o código no log da tarefa e no painel
  od_carregar
  casa "$OD_TENANT" "$RE_GUID_R" && casa "$OD_CLIENT" "$RE_GUID_R" || { echo "✗ Informe antes o ID do diretório e o ID do aplicativo (Backups → Configurar)."; return 1; }
  local r cod url dev intervalo expira fim t
  r="$(curl -sS -m 30 -X POST "$LOGIN_MS/$OD_TENANT/oauth2/v2.0/devicecode" --data-urlencode "client_id=$OD_CLIENT" --data-urlencode 'scope=Files.ReadWrite offline_access' 2>/dev/null)" || { echo "✗ Sem acesso ao login da Microsoft."; return 1; }
  cod="$(printf '%s' "$r" | jq -r '.user_code // empty')"; url="$(printf '%s' "$r" | jq -r '.verification_uri // empty')"
  dev="$(printf '%s' "$r" | jq -r '.device_code // empty')"; intervalo="$(printf '%s' "$r" | jq -r '.interval // 5')"; expira="$(printf '%s' "$r" | jq -r '.expires_in // 900')"
  [ -n "$cod" ] && [ -n "$dev" ] || { echo "✗ A Microsoft recusou: $(printf '%s' "$r" | jq -r '.error_description // .error // "erro"' | head -c 240)"; echo "  Confira se o aplicativo tem \"Permitir fluxos de cliente público\" = Sim."; return 1; }
  casa "$cod" '^[A-Z0-9-]{4,16}$' || { echo "✗ Resposta inesperada da Microsoft."; return 1; }
  jq -nc --arg c "$cod" --arg u "$url" --arg e "$(date -Iseconds -d "+${expira} seconds")" '{codigo:$c, url:$u, expira:$e}' > "$ESTADO/nuvem-codigo.json"; chmod 644 "$ESTADO/nuvem-codigo.json"
  echo "→ Abra $url, entre com a conta Microsoft que vai guardar os backups e digite o código: $cod"
  echo "  (o código vale $((expira / 60)) minutos; esta tarefa espera você terminar)"
  fim=$(( $(date +%s) + expira ))
  while [ "$(date +%s)" -lt "$fim" ]; do
    sleep "${PREFICHAS_ESPERA_LOGIN:-$intervalo}"
    t="$(curl -sS -m 30 -X POST "$LOGIN_MS/$OD_TENANT/oauth2/v2.0/token" --data-urlencode "client_id=$OD_CLIENT" \
      --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:device_code' --data-binary @<(printf 'device_code=%s' "$dev") 2>/dev/null)" || continue
    case "$(printf '%s' "$t" | jq -r '.error // "ok"')" in
      ok) break ;;
      authorization_pending) continue ;;
      slow_down) intervalo=$((intervalo + 5)); continue ;;
      *) : > "$ESTADO/nuvem-codigo.json"; echo "✗ Login não concluído: $(printf '%s' "$t" | jq -r '.error_description // .error' | head -c 200)"; return 1 ;;
    esac
  done
  : > "$ESTADO/nuvem-codigo.json"
  [ -n "$(printf '%s' "$t" | jq -r '.refresh_token // empty' 2>/dev/null)" ] || { echo "✗ O código expirou sem login. Tente de novo."; return 1; }
  conf_gravar "$NUVEM_ENV" OD_REFRESH "$(printf '%s' "$t" | jq -r '.refresh_token')"
  OD_ACCESS="$(printf '%s' "$t" | jq -r '.access_token')"
  local dono; dono="$(od_req GET "$GRAPH/me/drive?\$select=owner,quota" 2>/dev/null | jq -r '[.owner.user.displayName // "", ((.quota.remaining // 0) / 1073741824 | floor | tostring) + " GB livres"] | join(" · ")' 2>/dev/null)"
  conf_gravar "$NUVEM_ENV" OD_CONTA "${dono:-conectado}"
  od_garantir_pasta ""
  echo "✓ OneDrive conectado (${dono:-conta Microsoft}). Os backups vão para a pasta $PASTA_NUVEM, uma subpasta por acampamento."
}

acao_backup_desconectar() { conf_gravar "$NUVEM_ENV" OD_REFRESH ""; conf_gravar "$NUVEM_ENV" OD_CONTA ""; conf_gravar "$BACKUP_CONF" BACKUP_LIGADO false
  echo "✓ OneDrive desconectado e backup diário desligado. Os arquivos que já estão no OneDrive continuam lá."; }

# --- chave de recuperação (age): a pública fica na VM; a secreta aparece UMA vez no painel
acao_backup_chave_gerar() { # {substituir}
  local p="$1" sub par pub sec
  sub="$(jq -r '.substituir // false' "$p")"
  garantir_age || { echo "✗ Não consegui instalar o programa de cifragem (age)."; return 1; }
  if [ -s "$CHAVE_PUB" ] && [ "$sub" != true ]; then echo "✗ Já existe uma chave. Para trocar, confirme a substituição (os backups antigos continuam abrindo só com a chave antiga)."; return 1; fi
  par="$(age-keygen 2>/dev/null)"; pub="$(printf '%s\n' "$par" | sed -n 's/^# public key: //p')"; sec="$(printf '%s\n' "$par" | grep -E '^AGE-SECRET-KEY-1')"
  casa "$pub" "$RE_AGE_PUB" && casa "$sec" "$RE_AGE_SEC" || { echo "✗ Falha ao gerar a chave."; return 1; }
  mkdir -p "$ETC" && chmod 700 "$ETC"; ( umask 077; printf '%s\n' "$pub" > "$CHAVE_PUB" )
  # mostrada uma vez: o painel lê, a pessoa confirma que guardou e o arquivo é zerado (e some sozinho em 30 min)
  jq -nc --arg k "$sec" --arg e "$(date -Iseconds -d '+30 minutes')" '{chave:$k, expira:$e}' > "$ESTADO/backup-chave.json"; chmod 644 "$ESTADO/backup-chave.json"
  echo "✓ Chave de recuperação gerada. Abra Backups no painel para copiá-la — ela aparece só uma vez, por 30 minutos."
}
acao_backup_chave_guardada() { : > "$ESTADO/backup-chave.json"; echo "✓ Chave retirada do painel."; }
chave_expirar() { local f="$ESTADO/backup-chave.json" e; [ -s "$f" ] || return 0; e="$(jq -r '.expira // empty' "$f" 2>/dev/null)"
  [ -n "$e" ] && [ "$(date +%s)" -lt "$(date -d "$e" +%s 2>/dev/null || echo 0)" ] || : > "$f"; }

# --- fazer o backup de uma instância: banco → pg_dump → age (só chave pública) → OneDrive. Nada em claro no disco.
backup_nuvem_instancia() { # instância
  local i="$1" nome arq tam
  casa "$i" "$RE_INST" && [ -f "$OPT/$i/.env" ] || { echo "✗ $i: instância inválida."; return 1; }
  db_rodando "$i" || { echo "✗ $i: banco parado; backup não feito."; return 1; }
  mkdir -p "$TMPD" && chmod 700 "$TMPD"; arq="$TMPD/envio.dump.age"
  if ! (cd "$OPT/$i" && nice -n 10 docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc') | age -R "$CHAVE_PUB" > "$arq"; then
    : > "$arq"; echo "✗ $i: falha ao gerar o backup."; return 1
  fi
  tam="$(stat -c %s "$arq")"; [ "$tam" -gt 200 ] || { : > "$arq"; echo "✗ $i: backup vazio."; return 1; }
  nome="${i}__$(TZ="$FUSO" date +%Y-%m-%d_%H%M).dump.age"
  od_garantir_pasta "$i"
  od_enviar "$arq" "$i" "$nome" || { : > "$arq"; return 1; }
  : > "$arq"
  echo "✓ $i: backup enviado ($(numfmt --to=iec "$tam" 2>/dev/null || echo "$tam bytes"))."
  backup_retencao "$i"
}
# mantém os N diários mais recentes e o primeiro backup de cada um dos M últimos meses; apaga o resto (só arquivos do padrão do sistema)
backup_retencao() {
  local i="$1" md mm lista apagar id
  md="$(conf_ler "$BACKUP_CONF" MANTER_DIARIOS)"; md="${md:-14}"; mm="$(conf_ler "$BACKUP_CONF" MANTER_MENSAIS)"; mm="${mm:-6}"
  lista="$(od_listar "$i")"
  apagar="$(printf '%s' "$lista" | jq -r --argjson md "$md" --argjson mm "$mm" --arg re "$RE_ARQ_NUVEM" '
    [ .[] | select(.name | test($re)) ] | sort_by(.name) | reverse as $todos
    | ($todos[:$md] | map(.id)) as $diarios
    | ($todos | group_by(.name | capture("__(?<m>[0-9]{4}-[0-9]{2})").m) | map(sort_by(.name) | .[0]) | sort_by(.name) | reverse | .[:$mm] | map(.id)) as $mensais
    | $todos[] | select((.id as $x | ($diarios + $mensais) | index($x)) | not) | .id')"
  for id in $apagar; do casa "$id" '^[A-Za-z0-9!_.-]{4,200}$' && od_req DELETE "$GRAPH/me/drive/items/$id" >/dev/null 2>&1; done
  [ -n "$apagar" ] && echo "  $i: $(printf '%s\n' "$apagar" | grep -c .) backup(s) antigo(s) removido(s) do OneDrive."
  return 0
}
acao_backup_nuvem() { # {instancia?}  — sem instância: todas, em sequência
  local p="$1" alvo i falhas=0 n=0
  alvo="$(jq -r '.instancia // empty' "$p")"
  [ -s "$CHAVE_PUB" ] || { echo "✗ Gere a chave de recuperação antes (Backups)."; return 1; }
  garantir_age || { echo "✗ Programa de cifragem (age) indisponível."; return 1; }
  od_token || return 1
  for i in $( [ -n "$alvo" ] && echo "$alvo" || instancias ); do
    n=$((n + 1)); backup_nuvem_instancia "$i" || falhas=$((falhas + 1))
  done
  atualizar_lista_nuvem >/dev/null 2>&1 || true
  jq -nc --arg em "$(date -Iseconds)" --argjson n "$n" --argjson f "$falhas" '{em:$em, instancias:$n, falhas:$f}' > "$ESTADO/backup-ultimo.json"; chmod 644 "$ESTADO/backup-ultimo.json"
  [ "$falhas" = 0 ] || { echo "✗ Backup concluído com $falhas falha(s) em $n acampamento(s)."; return 1; }
  echo "✓ Backup na nuvem concluído: $n acampamento(s)."
}
# lista do OneDrive, por acampamento, para o painel (sem nada sensível: nomes, datas, tamanhos)
atualizar_lista_nuvem() {
  local i pastas saida="{}"
  od_token >/dev/null || return 1
  pastas="$(od_req GET "$(od_url_caminho "$PASTA_NUVEM"):/children?\$select=name,folder&\$top=500" | jq -r '.value[]? | select(.folder) | .name' 2>/dev/null)"
  for i in $pastas; do
    casa "$i" "$RE_INST" || continue
    saida="$(printf '%s' "$saida" | jq -c --arg i "$i" --argjson l "$(od_listar "$i" | jq -c --arg re "$RE_ARQ_NUVEM" '[.[] | select(.name | test($re))] | sort_by(.name) | reverse')" '. + {($i): $l}')"
  done
  jq -nc --arg em "$(date -Iseconds)" --argjson b "$saida" '{lido_em:$em, acampamentos:$b}' > "$ESTADO/backups-nuvem.json"; chmod 644 "$ESTADO/backups-nuvem.json"
}
acao_backup_listar() { atualizar_lista_nuvem || { echo "✗ Não consegui ler o OneDrive."; return 1; }; echo "✓ Lista de backups do OneDrive atualizada."; }

# --- restaurar: baixa do OneDrive, decifra com a chave informada (só em memória/pipe) e grava no banco do acampamento
acao_backup_restaurar() { # {instancia, arquivo (id), nome, chave, confirmar}
  local p="$1" i id nome conf arq porta ok=0
  i="$(jq -r '.instancia // empty' "$p")"; id="$(jq -r '.arquivo // empty' "$p")"; nome="$(jq -r '.nome // empty' "$p")"; conf="$(jq -r '.confirmar // empty' "$p")"
  casa "$i" "$RE_INST" && [ -f "$OPT/$i/.env" ] && [ ! -L "$OPT/$i" ] || { echo "✗ Instância inválida (crie a instância antes de restaurar nela)."; return 1; }
  [ "$conf" = "$i" ] || { echo "✗ Confirmação não confere: digite o nome da pasta ($i)."; return 1; }
  casa "$id" '^[A-Za-z0-9!_.-]{4,200}$' && casa "$nome" "$RE_ARQ_NUVEM" || { echo "✗ Backup inválido."; return 1; }
  casa "$(jq -r '.chave // empty' "$p")" "$RE_AGE_SEC" || { echo "✗ Chave de recuperação inválida (começa com AGE-SECRET-KEY-1)."; return 1; }
  garantir_age || { echo "✗ Programa de cifragem (age) indisponível."; return 1; }
  db_rodando "$i" || { echo "✗ O banco de $i está parado."; return 1; }
  od_token || return 1
  mkdir -p "$TMPD" && chmod 700 "$TMPD"; arq="$TMPD/restaurar.dump.age"
  echo "→ Baixando $nome…"
  od_req GET "$GRAPH/me/drive/items/$id/content" -L -o "$arq" || { : > "$arq"; echo "✗ Falha ao baixar o backup."; return 1; }
  # confere a chave ANTES de mexer no banco
  local cab; cab="$(age -d -i <(jq -r '.chave' "$p") "$arq" 2>/dev/null | head -c 5 || true)"
  [ "$cab" = PGDMP ] || { : > "$arq"; echo "✗ A chave não abre este backup (ou o arquivo está corrompido). Nada foi alterado."; return 1; }
  echo "→ Backup de segurança local do banco atual (antes de restaurar)…"
  (cd "$OPT/$i" && ./scripts/backup.sh) || { : > "$arq"; echo "✗ Não consegui fazer o backup de segurança; nada foi alterado."; return 1; }
  echo "→ Parando o sistema de $i e restaurando o banco…"
  (cd "$OPT/$i" && docker compose stop app >/dev/null 2>&1)
  if age -d -i <(jq -r '.chave' "$p") "$arq" | (cd "$OPT/$i" && docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction'); then ok=1; fi
  : > "$arq"
  (cd "$OPT/$i" && docker compose start app >/dev/null 2>&1)
  porta="$(valor_env "$i" PORTA_LOCAL)"; porta="${porta//[^0-9]/}"
  for _ in $(seq 1 60); do curl -fsS -m 3 "http://127.0.0.1:${porta:-3000}/api/saude" >/dev/null 2>&1 && break; sleep 2; done
  [ "$ok" = 1 ] || { echo "✗ A restauração falhou e foi desfeita (o banco continua como estava). O backup de segurança local está em $OPT/$i/backups."; return 1; }
  echo "✓ $i restaurado a partir de $nome. O backup de segurança do banco anterior ficou em $OPT/$i/backups."
}

# ================================================================ Mensagens de aniversário (textbee.dev)
sms_conf() { jq -r "$1" "$SMS_CONF" 2>/dev/null; }
tb_req() { local m="$1" u="$2"; shift 2; printf 'header = "x-api-key: %s"\n' "$(conf_ler "$TB_ENV" TB_KEY)" | curl -sS -m 30 -K - -X "$m" "$@" "$u"; }
# "(48) 99999-0000" → +5548999990000 ; vazio se não parecer celular brasileiro
fone_e164() { local d; d="$(printf '%s' "$1" | tr -cd '0-9')"; d="${d#0}"
  case "${#d}" in 10|11) printf '+55%s' "$d" ;; 12|13) [ "${d#55}" != "$d" ] && printf '+%s' "$d" ;; esac; }
mascara() { local f="$1"; printf '%s••••%s' "${f:0:5}" "${f: -4}"; }
primeiro_nome() { printf '%s' "$1" | awk '{print $1}' | LC_ALL=C.UTF-8 sed 's/.*/\L&/; s/^./\u&/'; }   # "MARIA" → "Maria" (UTF-8: acentos preservados)

acao_sms_config() { # {ligado, hora, modelo_aniversario, modelo_acampamento, rodape_sair, limite_dia, telefone_teste, device_id, token?}
  local p="$1" hora lim dev tok lig teste
  hora="$(jq -r '.hora // "09:00"' "$p")"; lim="$(jq -r '.limite_dia // 200' "$p")"; dev="$(jq -r '.device_id // empty' "$p")"
  tok="$(jq -r '.token // empty' "$p")"; lig="$(jq -r '.ligado // false' "$p")"; teste="$(jq -r '.telefone_teste // empty' "$p")"
  casa "$hora" "$RE_HORA" || { echo "✗ Horário inválido (HH:MM)."; return 1; }
  casa "$lim" '^[0-9]{1,5}$' && [ "$lim" -ge 1 ] || { echo "✗ Limite diário inválido."; return 1; }
  [ -z "$dev" ] || casa "$dev" '^[A-Za-z0-9_-]{6,64}$' || { echo "✗ ID do aparelho inválido."; return 1; }
  [ -z "$tok" ] || casa "$tok" '^[A-Za-z0-9._-]{16,200}$' || { echo "✗ Chave da API do textbee inválida."; return 1; }
  [ -z "$teste" ] || [ -n "$(fone_e164 "$teste")" ] || { echo "✗ Telefone de teste inválido."; return 1; }
  for c in modelo_aniversario modelo_acampamento; do
    [ "$(jq -r ".$c // \"\" | length" "$p")" -le 480 ] || { echo "✗ Mensagem longa demais (máx. 480 letras)."; return 1; }
  done
  [ -n "$tok" ] && conf_gravar "$TB_ENV" TB_KEY "$tok"
  conf_gravar "$TB_ENV" TB_DEVICE "$dev"
  if [ "$lig" = true ] && [ -z "$(conf_ler "$TB_ENV" TB_KEY)" ]; then echo "✗ Informe a chave da API do textbee antes de ligar."; return 1; fi
  ( umask 077; jq -c '{ligado: (.ligado == true), hora: (.hora // "09:00"), modelo_aniversario: (.modelo_aniversario // ""), modelo_acampamento: (.modelo_acampamento // ""),
      rodape_sair: (.rodape_sair != false), limite_dia: ((.limite_dia // 200) | tonumber), telefone_teste: (.telefone_teste // "")}' "$p" > "$SMS_CONF.novo" ) && mv -f "$SMS_CONF.novo" "$SMS_CONF"
  echo "✓ Mensagens de aniversário $([ "$lig" = true ] && echo "ligadas, todo dia às $hora" || echo desligadas)."
}

# destinatários de hoje: CAMPISTAS de todos os acampamentos (separados por \037: tipo, instância, nome, telefone, anos, edição, comunidade)
sms_destinatarios() {
  local i com tem_mod sql
  for i in $(instancias); do
    db_rodando "$i" || continue
    com="$(valor_env "$i" NOME_ACAMPAMENTO)"
    tem_mod="$(cd "$OPT/$i" && docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select to_regclass('"'"'public.modalidades'"'"') is not null"' 2>/dev/null | tr -d '[:space:]')"
    sql="with hoje as (select (now() at time zone '$FUSO')::date d),
      campistas as (select p.* from pre_fichas p where p.status = 'participou' or exists (select 1 from participacoes x where x.pre_ficha_id = p.id))
      select 'aniversario', nome_completo, telefone, extract(year from age(d, data_nascimento))::int, '' from campistas, hoje
       where data_nascimento is not null and telefone is not null and (to_char(data_nascimento, 'MM-DD') = to_char(d, 'MM-DD')
         or (to_char(data_nascimento, 'MM-DD') = '02-29' and to_char(d, 'MM-DD') = '02-28' and extract(day from (date_trunc('year', d) + interval '1 month 28 days'))::int <> 29))
      union all
      select 'acampamento', p.nome_completo, p.telefone, (extract(year from d) - extract(year from a.data_inicio))::int,
             a.numero || 'º ' || $([ "$tem_mod" = t ] && echo "coalesce((select m.rotulo from modalidades m where m.valor = a.modalidade), a.modalidade)" || echo "initcap(a.modalidade)")
        from participacoes pa join pre_fichas p on p.id = pa.pre_ficha_id join acampamentos a on a.id = pa.acampamento_id, hoje
       where a.data_inicio is not null and p.telefone is not null and to_char(a.data_inicio, 'MM-DD') = to_char(d, 'MM-DD') and a.data_inicio < d"
    (cd "$OPT/$i" && printf '%s' "$sql" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "	" -v ON_ERROR_STOP=1') 2>/dev/null \
      | awk -F'\t' -v i="$i" -v c="$com" 'NF>=4 {print $1"\037"i"\037"$2"\037"$3"\037"$4"\037"$5"\037"c}'   # separador \037: campos vazios não se juntam (TAB juntaria)
  done
}
sms_texto() { # tipo nome anos edicao comunidade → mensagem final
  local tipo="$1" nome anos="$3" ed="$4" com="$5" m
  nome="$(primeiro_nome "$2")"
  if [ "$tipo" = aniversario ]; then m="$(sms_conf '.modelo_aniversario // ""')"
    [ -n "$m" ] || m='Olá, {nome}! Hoje é o seu aniversário. Que Deus abençoe a sua vida e Nossa Senhora interceda por você. Parabéns! {comunidade}'
  else m="$(sms_conf '.modelo_acampamento // ""')"
    [ -n "$m" ] || m='Olá, {nome}! Hoje faz {anos} ano(s) que você viveu o {acampamento}. Que o fogo do Espírito Santo continue aceso em você! Deus te abençoe. {comunidade}'
  fi
  m="${m//\{nome\}/$nome}"; m="${m//\{anos\}/$anos}"; m="${m//\{acampamento\}/$ed}"; m="${m//\{comunidade\}/$com}"
  [ "$(sms_conf '.rodape_sair')" = false ] || m="$m Para não receber, responda SAIR."
  printf '%s' "$m"
}
sms_enviar_um() { # e164 mensagem → 0 se aceito; 2 se limite (429)
  local corpo r dev; dev="$(conf_ler "$TB_ENV" TB_DEVICE)"
  corpo="$(jq -nc --arg f "$1" --arg m "$2" --arg d "$dev" '{recipients:[$f], message:$m} + (if $d == "" then {} else {deviceId:$d} end)')"
  r="$(tb_req POST "$TEXTBEE/gateway/send-sms" -H 'Content-Type: application/json' --data-binary "$corpo" -w '\n%{http_code}')" || return 1
  case "$(printf '%s' "$r" | tail -1)" in 2??) return 0 ;; 429) return 2 ;; *) SMS_ERRO="$(printf '%s' "$r" | head -1 | jq -r '.error // .message // empty' 2>/dev/null | head -c 120)"; return 1 ;; esac
}
# respostas "SAIR" recebidas no aparelho entram na lista de bloqueio
sms_ler_sair() {
  local desde f r
  desde="$(conf_ler "$TB_ENV" TB_LIDO_ATE)"; desde="${desde:-$(date -u -Iseconds -d '-2 days')}"
  r="$(tb_req GET "$TEXTBEE/gateway/messages?direction=received&order=asc&limit=100&from=$(printf '%s' "$desde" | jq -sRr @uri)")" || return 0
  printf '%s' "$r" | jq -r '.data[]? | select((.message // "") | ascii_downcase | test("^\\s*(sair|parar|pare|stop|cancelar|remover)\\b")) | .sender // empty' 2>/dev/null \
    | while read -r f; do f="$(fone_e164 "$f")"; [ -n "$f" ] && ! grep -qx "$f" "$SMS_BLOQ" 2>/dev/null && { ( umask 077; echo "$f" >> "$SMS_BLOQ" ); echo "  $(mascara "$f") pediu para não receber (SAIR)."; }; done
  conf_gravar "$TB_ENV" TB_LIDO_ATE "$(date -u -Iseconds)"
}
acao_sms_enviar() { # {previa?} — envia as mensagens de hoje (ou só gera a prévia)
  local p="$1" previa hoje lim n=0 env=0 pul=0 tipo i nome fone anos ed com e164 chave msg hist prev="[]" rc
  previa="$(jq -r '.previa // false' "$p")"; hoje="$(hoje_local)"; lim="$(sms_conf '.limite_dia // 200')"
  [ "$previa" = true ] || [ -n "$(conf_ler "$TB_ENV" TB_KEY)" ] || { echo "✗ Configure a chave da API do textbee (Mensagens)."; return 1; }
  mkdir -p "$SMS_ENVIADOS" && chmod 700 "$SMS_ENVIADOS"; mkdir -p "$ESTADO/sms"; hist="$ESTADO/sms/$hoje.jsonl"
  [ "$previa" = true ] || sms_ler_sair
  while IFS=$'\037' read -r tipo i nome fone anos ed com; do
    [ -n "$tipo" ] || continue
    e164="$(fone_e164 "$fone")"; [ -n "$e164" ] || { pul=$((pul + 1)); continue; }
    chave="$e164|$tipo|$ed"
    grep -qxF "$e164" "$SMS_BLOQ" 2>/dev/null && { pul=$((pul + 1)); continue; }
    grep -qxF "$chave" "$SMS_ENVIADOS/$hoje" "$SMS_ENVIADOS/.previa-$hoje" 2>/dev/null && continue   # já enviada hoje (ou mesmo telefone em outro acampamento)
    n=$((n + 1)); msg="$(sms_texto "$tipo" "$nome" "$anos" "$ed" "$com")"
    if [ "$previa" = true ]; then
      prev="$(printf '%s' "$prev" | jq -c --arg t "$tipo" --arg i "$i" --arg n "$(primeiro_nome "$nome")" --arg f "$(mascara "$e164")" --arg m "$msg" '. + [{tipo:$t, instancia:$i, nome:$n, telefone:$f, mensagem:$m}]')"
      ( umask 077; echo "$chave" >> "$SMS_ENVIADOS/.previa-$hoje" )   # dedupe da própria prévia
      continue
    fi
    [ "$env" -lt "$lim" ] || { echo "⚠ Limite diário ($lim) atingido; o restante fica para amanhã."; break; }
    sms_enviar_um "$e164" "$msg"; rc=$?
    if [ "$rc" = 0 ]; then env=$((env + 1)); ( umask 077; echo "$chave" >> "$SMS_ENVIADOS/$hoje" )
      jq -nc --arg h "$(date +%H:%M)" --arg t "$tipo" --arg i "$i" --arg n "$(primeiro_nome "$nome")" --arg f "$(mascara "$e164")" '{hora:$h, tipo:$t, instancia:$i, nome:$n, telefone:$f, ok:true}' >> "$hist"
    elif [ "$rc" = 2 ]; then echo "⚠ O textbee recusou por limite do plano (429). O restante fica para amanhã."; break
    else jq -nc --arg h "$(date +%H:%M)" --arg t "$tipo" --arg i "$i" --arg f "$(mascara "$e164")" --arg e "${SMS_ERRO:-falhou}" '{hora:$h, tipo:$t, instancia:$i, telefone:$f, ok:false, erro:$e}' >> "$hist"
    fi
    sleep "${PREFICHAS_SMS_INTERVALO:-2}"
  done < <(sms_destinatarios)
  chmod 644 "$hist" 2>/dev/null || true
  if [ "$previa" = true ]; then
    : > "$SMS_ENVIADOS/.previa-$hoje"
    jq -nc --arg em "$(date -Iseconds)" --arg d "$hoje" --argjson l "$prev" '{gerada_em:$em, dia:$d, mensagens:$l}' > "$ESTADO/sms-previa.json"; chmod 644 "$ESTADO/sms-previa.json"
    echo "✓ Prévia de hoje: $n mensagem(ns) ($pul sem celular válido ou que pediram para não receber). Nada foi enviado."; return 0
  fi
  conf_gravar "$TB_ENV" TB_ULTIMO_DIA "$hoje"
  echo "✓ Mensagens de hoje: $env enviada(s) ao textbee; $pul pulada(s) (sem celular válido ou pediram para não receber)."
}
acao_sms_teste() { # {telefone}
  local f; f="$(fone_e164 "$(jq -r '.telefone // empty' "$1")")"; [ -n "$f" ] || { echo "✗ Telefone inválido."; return 1; }
  [ -n "$(conf_ler "$TB_ENV" TB_KEY)" ] || { echo "✗ Configure a chave da API do textbee antes."; return 1; }
  sms_enviar_um "$f" "[TESTE] $(sms_texto aniversario 'Maria' 30 '' 'Acampamento')" || { echo "✗ O textbee recusou: ${SMS_ERRO:-erro}."; return 1; }
  echo "✓ Mensagem de teste enviada para $(mascara "$f") (confira no celular em alguns instantes)."
}
acao_sms_bloqueio() { # {telefone, bloquear}
  local f b; f="$(fone_e164 "$(jq -r '.telefone // empty' "$1")")"; b="$(jq -r '.bloquear // true' "$1")"
  [ -n "$f" ] || { echo "✗ Telefone inválido."; return 1; }
  mkdir -p "$ETC" && chmod 700 "$ETC"; touch "$SMS_BLOQ" && chmod 600 "$SMS_BLOQ"
  if [ "$b" = true ]; then grep -qxF "$f" "$SMS_BLOQ" || echo "$f" >> "$SMS_BLOQ"; echo "✓ $(mascara "$f") não recebe mais mensagens."
  else grep -vxF "$f" "$SMS_BLOQ" > "$SMS_BLOQ.novo"; chmod 600 "$SMS_BLOQ.novo"; mv -f "$SMS_BLOQ.novo" "$SMS_BLOQ"; echo "✓ $(mascara "$f") voltou a receber."; fi
}

# ================================================================ situação para o painel e agendamento
estado_rotinas_json() { # → {backup:{…}, sms:{…}} (sem segredos)
  od_carregar
  jq -nc \
    --arg bl "$(conf_ler "$BACKUP_CONF" BACKUP_LIGADO)" --arg bh "$(conf_ler "$BACKUP_CONF" BACKUP_HORA)" \
    --arg md "$(conf_ler "$BACKUP_CONF" MANTER_DIARIOS)" --arg mm "$(conf_ler "$BACKUP_CONF" MANTER_MENSAIS)" \
    --arg t "$OD_TENANT" --arg c "$OD_CLIENT" --arg conta "$(conf_ler "$NUVEM_ENV" OD_CONTA)" \
    --argjson con "$([ -n "$OD_REFRESH" ] && echo true || echo false)" --argjson ch "$([ -s "$CHAVE_PUB" ] && echo true || echo false)" \
    --argjson ult "$(jq -c . "$ESTADO/backup-ultimo.json" 2>/dev/null || echo null)" \
    --argjson sc "$(jq -c '. ' "$SMS_CONF" 2>/dev/null || echo '{}')" \
    --argjson tk "$([ -n "$(conf_ler "$TB_ENV" TB_KEY)" ] && echo true || echo false)" --arg dev "$(conf_ler "$TB_ENV" TB_DEVICE)" \
    --argjson bq "$(grep -c . "$SMS_BLOQ" 2>/dev/null || echo 0)" --arg ud "$(conf_ler "$TB_ENV" TB_ULTIMO_DIA)" \
    '{backup: {ligado: ($bl == "true"), hora: (if $bh == "" then "02:30" else $bh end), manter_diarios: (($md | tonumber?) // 14), manter_mensais: (($mm | tonumber?) // 6),
               tenant_id: $t, client_id: $c, conectado: $con, conta: $conta, chave_definida: $ch, ultimo: $ult},
      sms: ($sc + {token_configurado: $tk, device_id: $dev, bloqueados: $bq, ultimo_dia: $ud})}'
}
# chamada pelo "coletar" (a cada minuto): no horário configurado, enfileira o pedido do dia (aparece em Tarefas)
rotina_diaria() {
  exec 8>"$ESTADO/.trava-rotina"; flock -n 8 || return 0
  chave_expirar
  local hoje agora pedir
  hoje="$(hoje_local)"; agora="$(agora_local)"
  pedir() { local id; id="$(cat /proc/sys/kernel/random/uuid)"; jq -nc --arg a "$1" --arg em "$(date -Iseconds)" '{acao:$a, por:"agendamento", pedido_em:$em}' > "$PEDIDOS/$id.json"; }
  if [ "$(conf_ler "$BACKUP_CONF" BACKUP_LIGADO)" = true ] && [ ! "$agora" \< "$(conf_ler "$BACKUP_CONF" BACKUP_HORA)" ] && [ "$(cat "$ESTADO/.backup-dia" 2>/dev/null)" != "$hoje" ]; then
    echo "$hoje" > "$ESTADO/.backup-dia"; pedir backup-nuvem
  fi
  if [ "$(sms_conf '.ligado')" = true ] && [ ! "$agora" \< "$(sms_conf '.hora // "09:00"')" ] && [ "$(cat "$ESTADO/.sms-dia" 2>/dev/null)" != "$hoje" ]; then
    echo "$hoje" > "$ESTADO/.sms-dia"; pedir sms-enviar
  fi
}
