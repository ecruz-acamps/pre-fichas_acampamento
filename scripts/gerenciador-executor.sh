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
OPT="${PREFICHAS_OPT:-/opt}"                # onde ficam as instâncias (os testes usam outra pasta)
SCRIPTS_COMP="${PREFICHAS_SCRIPTS:-$CODIGO/scripts}"   # túnel e proxy compartilhados
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
instancias() { for f in "$OPT"/prefichas-*/.env; do [ -f "$f" ] && basename "$(dirname "$f")"; done | grep -vx 'prefichas-gerenciador\|prefichas-proxy' || true; }
valor_env() { { grep -E "^$2=" "$OPT/$1/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }

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
  if ! (cd "$pasta" && ./scripts/novo-acampamento.sh "${args[@]}" </dev/null); then
    # a pasta não existia antes deste pedido (conferido acima): remove o que ficou pela metade para a próxima tentativa
    echo "✗ A criação falhou. Limpando o que ficou pela metade em $pasta (nada de dados de outro acampamento é tocado)…"
    limpar_instancia_incompleta "$pasta"
    return 1
  fi
}
# Remove uma instância que acabou de ser criada e falhou. Só age em /opt/prefichas-<nome> e nunca em atalhos.
limpar_instancia_incompleta() {
  local pasta="$1"
  casa "$pasta" '^/opt/prefichas-[a-z0-9-]{1,80}$' || return 0
  case "$pasta" in /opt/prefichas-gerenciador|/opt/prefichas-proxy) return 0 ;; esac
  [ -d "$pasta" ] && [ ! -L "$pasta" ] || return 0
  [ -f "$pasta/docker-compose.yml" ] && (cd "$pasta" && timeout 120 docker compose down -v >/dev/null 2>&1) || true
  rm -rf --one-file-system -- "$pasta"
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

# ---------------------------------------------------------------- E-mail de envio (aba Configurações)
RE_HOST_SMTP='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
RE_USU_SMTP='^[A-Za-z0-9._%+@-]{3,120}$'
RE_SENHA_SMTP='^[A-Za-z0-9._~+=:@%!*,;?/-]{4,128}$'   # sem aspas, espaços, $, # nem \ (a senha vai para arquivos .env)
RE_LINK_REDEF='^https://[a-z0-9.-]{3,200}/\?redefinir=[A-Za-z0-9_-]{20,100}$'
smtp_ler() { # HOST|PORTA|USUARIO|SENHA|REMETENTE do arquivo guardado
  [ -r "$ETC/smtp.env" ] || return 0
  ( . "$ETC/smtp.env" 2>/dev/null
    case "$1" in HOST) printf '%s' "${SMTP_HOST:-}" ;; PORTA) printf '%s' "${SMTP_PORTA:-}" ;; USUARIO) printf '%s' "${SMTP_USUARIO:-}" ;;
      SENHA) printf '%s' "${SMTP_SENHA:-}" ;; REMETENTE) printf '%s' "${SMTP_REMETENTE:-}" ;; esac )
}
# Envia uma mensagem de texto. A senha vai ao curl pela entrada padrão (não aparece em 'ps' nem em log).
enviar_smtp() { # host porta usuario senha remetente para assunto texto
  local host="$1" porta="$2" usuario="$3" senha="$4" rem="$5" para="$6" assunto="$7" texto="$8" msg url rc saida
  local opcoes=()
  msg="$(mktemp)"; chmod 600 "$msg"
  {
    printf 'From: =?UTF-8?B?%s?= <%s>\r\n' "$(printf 'Painel central Pré-fichas' | base64 -w0)" "$rem"
    printf 'To: <%s>\r\nSubject: =?UTF-8?B?%s?=\r\nDate: %s\r\n' "$para" "$(printf '%s' "$assunto" | base64 -w0)" "$(date -R)"
    printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'
    printf '%s' "$texto" | base64 -w76 | sed 's/$/\r/'
  } > "$msg"
  case "$porta" in 465) url="smtps://${host}:${porta}" ;; *) url="smtp://${host}:${porta}"; opcoes=(--ssl-reqd) ;; esac
  saida="$(printf 'user = "%s:%s"\n' "$usuario" "$senha" | curl -sS -m 40 -K - "${opcoes[@]}" --url "$url" --mail-from "$rem" --mail-rcpt "$para" -T "$msg" 2>&1)"; rc=$?
  rm -f "$msg"
  [ "$rc" = 0 ] || printf '%s' "${saida//"$senha"/***}" | tr -d '\r' | head -c 300
  return "$rc"
}
smtp_configurado() { [ -n "$(smtp_ler HOST)" ] && [ -n "$(smtp_ler USUARIO)" ] && [ -n "$(smtp_ler SENHA)" ]; }
acao_email() { # arquivo do pedido: confere com um envio de teste ANTES de guardar
  local p="$1" host porta usuario senha rem aplicar por erro
  host="$(jq -r '.host // empty' "$p")"; porta="$(jq -r '.porta // empty' "$p")"; usuario="$(jq -r '.usuario // empty' "$p")"
  senha="$(jq -r '.senha // empty' "$p")"; rem="$(jq -r '.remetente // empty' "$p")"; aplicar="$(jq -r '.aplicar // false' "$p")"
  por="$(jq -r '.por // empty' "$p" | head -c 200)"
  casa "$host" "$RE_HOST_SMTP" || { echo "✗ Servidor de e-mail inválido."; return 1; }
  case "$porta" in 25|465|587|2525) ;; *) echo "✗ Porta inválida."; return 1 ;; esac
  casa "$usuario" "$RE_USU_SMTP" || { echo "✗ Usuário inválido."; return 1; }
  casa "$rem" "$RE_EMAIL" || { echo "✗ E-mail do remetente inválido."; return 1; }
  [ -n "$senha" ] || senha="$(smtp_ler SENHA)"          # senha em branco = manter a guardada
  [ -n "$senha" ] || { echo "✗ Informe a senha (ainda não há uma guardada)."; return 1; }
  casa "$senha" "$RE_SENHA_SMTP" || { echo "✗ Senha em formato inválido."; return 1; }
  casa "$por" "$RE_EMAIL" || { echo "✗ O seu usuário do painel precisa ser um e-mail válido para receber a mensagem de teste."; return 1; }
  echo "→ Enviando um e-mail de teste para ${por} pelo servidor ${host}:${porta}…"
  erro="$(enviar_smtp "$host" "$porta" "$usuario" "$senha" "$rem" "$por" "Teste do servidor de e-mail — Painel central" \
    "Este é um e-mail de teste do painel central.

Se você está lendo, o servidor de e-mail foi configurado corretamente e já pode ser usado para o \"Esqueci minha senha\".")" \
    || { echo "✗ O servidor de e-mail recusou: ${erro:-sem detalhes}"
         echo "  Confira o servidor, a porta (465 SSL ou 587 STARTTLS), o usuário e a senha. No Gmail, use uma SENHA DE APP (não a senha normal)."
         return 1; }
  mkdir -p "$ETC" && chmod 700 "$ETC"
  ( umask 077
    printf 'SMTP_HOST=%q\nSMTP_PORTA=%q\nSMTP_USUARIO=%q\nSMTP_SENHA=%q\nSMTP_REMETENTE=%q\n' "$host" "$porta" "$usuario" "$senha" "$rem" > "$ETC/smtp.env.novo" \
      && mv -f "$ETC/smtp.env.novo" "$ETC/smtp.env" )
  echo "✓ Servidor de e-mail verificado (teste enviado para ${por}) e guardado no servidor."
  if [ "$aplicar" = true ]; then acao_email_aplicar; fi
}
acao_email_teste() { # arquivo do pedido
  local p="$1" por erro
  por="$(jq -r '.por // empty' "$p" | head -c 200)"
  smtp_configurado || { echo "✗ O servidor de e-mail ainda não foi configurado."; return 1; }
  casa "$por" "$RE_EMAIL" || { echo "✗ O seu usuário do painel precisa ser um e-mail válido para receber o teste."; return 1; }
  erro="$(enviar_smtp "$(smtp_ler HOST)" "$(smtp_ler PORTA)" "$(smtp_ler USUARIO)" "$(smtp_ler SENHA)" "$(smtp_ler REMETENTE)" "$por" \
    "Teste do servidor de e-mail — Painel central" "Este é um e-mail de teste do painel central. Se você está lendo, o envio está funcionando.")" \
    || { echo "✗ O servidor de e-mail recusou: ${erro:-sem detalhes}"; return 1; }
  echo "✓ E-mail de teste enviado para ${por}."
}
acao_email_remover() {
  rm -f "$ETC/smtp.env"
  echo "✓ Servidor de e-mail removido do servidor. Os acampamentos já criados continuam com a configuração que têm."
}
# Grava o servidor de e-mail em cada acampamento já criado e reinicia só o necessário.
acao_email_aplicar() {
  smtp_configurado || { echo "✗ O servidor de e-mail ainda não foi configurado."; return 1; }
  local i f tmp falhou=0 n=0
  for i in $(instancias); do
    f="/opt/$i/.env"; [ -f "$f" ] && [ ! -L "$f" ] || continue
    tmp="$(mktemp "/opt/$i/.env.XXXXXX")"
    { grep -vE '^SMTP_(HOST|PORTA|USUARIO|SENHA|REMETENTE)=' "$f" || true
      printf 'SMTP_HOST=%s\nSMTP_PORTA=%s\nSMTP_USUARIO=%s\nSMTP_SENHA=%s\nSMTP_REMETENTE=%s\n' \
        "$(smtp_ler HOST)" "$(smtp_ler PORTA)" "$(smtp_ler USUARIO)" "$(smtp_ler SENHA)" "$(smtp_ler REMETENTE)"
    } > "$tmp"
    chmod --reference="$f" "$tmp" && mv -f "$tmp" "$f"
    echo "→ $i: e-mail gravado; reiniciando o sistema…"
    if (cd "/opt/$i" && timeout 300 docker compose up -d >/dev/null 2>&1); then n=$((n+1)); else echo "✗ Falhou ao reiniciar $i"; falhou=1; fi
  done
  [ "$falhou" = 0 ] || return 1
  echo "✓ Servidor de e-mail aplicado em ${n} acampamento(s)."
}
# ---------------------------------------------------------------- Login com a Microsoft (por acampamento)
RE_GUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
RE_SEGREDO_MS='^[A-Za-z0-9._~-]{20,128}$'      # valor do segredo do aplicativo no Entra (vai para o .env, sem aspas)
# Liga/desliga o login Microsoft de UM acampamento: grava as variáveis no .env dele e reinicia só esse sistema.
# Pedido: {instancia, habilitar, tenant_id, client_id, segredo?}  — segredo em branco = manter o guardado.
acao_microsoft() { # arquivo do pedido
  local p="$1" i hab tenant cli seg f tmp
  i="$(jq -r '.instancia // empty' "$p")"; hab="$(jq -r '.habilitar // false' "$p")"
  tenant="$(jq -r '.tenant_id // empty' "$p")"; cli="$(jq -r '.client_id // empty' "$p")"; seg="$(jq -r '.segredo // empty' "$p")"
  f="/opt/$i/.env"
  casa "$i" "$RE_INST" && [ -f "$f" ] && [ ! -L "$f" ] || { echo "✗ Instância inválida."; return 1; }
  if [ "$hab" = true ]; then
    casa "$tenant" "$RE_GUID" || { echo "✗ ID do diretório (locatário) inválido."; return 1; }
    casa "$cli" "$RE_GUID" || { echo "✗ ID do aplicativo (cliente) inválido."; return 1; }
    [ -n "$seg" ] || seg="$(valor_env "$i" MICROSOFT_CLIENT_SECRET)"
    [ -n "$seg" ] || { echo "✗ Informe o segredo do aplicativo (ainda não há um guardado)."; return 1; }
    casa "$seg" "$RE_SEGREDO_MS" || { echo "✗ Segredo em formato inválido (copie o VALOR do segredo, não o ID)."; return 1; }
  else
    # desligar: mantém IDs e segredo guardados (para religar sem digitar tudo de novo)
    tenant="$(valor_env "$i" MICROSOFT_TENANT_ID)"; cli="$(valor_env "$i" MICROSOFT_CLIENT_ID)"; seg="$(valor_env "$i" MICROSOFT_CLIENT_SECRET)"
  fi
  tmp="$(mktemp "/opt/$i/.env.XXXXXX")"
  { grep -vE '^MICROSOFT_(HABILITADO|TENANT_ID|CLIENT_ID|CLIENT_SECRET)=' "$f" || true
    printf 'MICROSOFT_HABILITADO=%s\n' "$([ "$hab" = true ] && echo true || echo false)"
    [ -z "$tenant" ] || printf 'MICROSOFT_TENANT_ID=%s\n' "$tenant"
    [ -z "$cli" ] || printf 'MICROSOFT_CLIENT_ID=%s\n' "$cli"
    [ -z "$seg" ] || printf 'MICROSOFT_CLIENT_SECRET=%s\n' "$seg"
  } > "$tmp"
  chmod --reference="$f" "$tmp" && mv -f "$tmp" "$f"
  echo "→ $i: reiniciando o sistema para aplicar…"
  (cd "/opt/$i" && timeout 300 docker compose up -d >/dev/null 2>&1) || { echo "✗ Gravado, mas falhou ao reiniciar $i."; return 1; }
  if [ "$hab" = true ]; then echo "✓ Login Microsoft ligado em $i."; else echo "✓ Login Microsoft desligado em $i."; fi
}
# ---------------------------------------------------------------- Apagar instância e trocar o link de acesso
# Grava/atualiza uma variável no .env da instância (arquivo novo + mv, sem perder as permissões)
env_definir() { # instancia CHAVE valor
  local f="$OPT/$1/.env" tmp; tmp="$(mktemp "$OPT/$1/.env.XXXXXX")"
  { grep -vE "^$2=" "$f" || true; printf '%s=%s\n' "$2" "$3"; } > "$tmp" && chmod --reference="$f" "$tmp" && mv -f "$tmp" "$f"
}
# endereço público (sem https://) da instância
host_da_instancia() { local u; u="$(valor_env "$1" URL_PUBLICA)"; u="${u#https://}"; u="${u#http://}"; printf '%s' "${u%%/*}"; }
despublicar() { # tipo host   (falha só avisa: o endereço some de qualquer forma quando o sistema sai do ar)
  case "$1" in
    cloudflare) "$SCRIPTS_COMP/tunel-compartilhado.sh" remover "$2" 2>&1 || echo "⚠ Não consegui tirar $2 do túnel da Cloudflare (confira o token). Apague o registro DNS dele no painel da Cloudflare, se sobrar." ;;
    direta) "$SCRIPTS_COMP/proxy-compartilhado.sh" remover "$2" 2>&1 || echo "⚠ Não consegui tirar $2 do proxy compartilhado." ;;
  esac
}

# Apaga uma instância: backup do banco (guardado fora da pasta), tira o endereço do túnel/proxy, para os containers e os dados
# e MOVE a pasta para a lixeira (recuperável por 30 dias; depois é limpa sozinha). Nada é apagado com "rm -rf" aqui.
# Pedido: {instancia, confirmar (= nome da pasta), sem_backup?}
LIXEIRA="${PREFICHAS_LIXEIRA:-/var/lib/prefichas-gerenciador/lixeira}"
acao_apagar() { # arquivo do pedido
  local p="$1" i conf sem pub host dir real dest unidade proj lixo
  i="$(jq -r '.instancia // empty' "$p")"; conf="$(jq -r '.confirmar // empty' "$p")"; sem="$(jq -r '.sem_backup // false' "$p")"
  dir="$OPT/$i"
  casa "$i" "$RE_INST" && [ "$i" != prefichas-gerenciador ] && [ "$i" != prefichas-proxy ] && [ -d "$dir" ] && [ ! -L "$dir" ] && [ -f "$dir/.env" ] || { echo "✗ Instância inválida: $i"; return 1; }
  [ "$conf" = "$i" ] || { echo "✗ Confirmação não confere: digite exatamente o nome da pasta ($i)."; return 1; }
  real="$(readlink -f "$dir")"; [ "$real" = "$OPT/$i" ] || { echo "✗ Pasta fora do lugar esperado."; return 1; }
  proj="$(valor_env "$i" COMPOSE_PROJECT_NAME)"
  pub="$(valor_env "$i" PUBLICACAO)"; host="$(host_da_instancia "$i")"
  [ "$pub" = cloudflare ] && [ -n "$(valor_env "$i" ENDERECO_PUBLICO)" ] && host="$(valor_env "$i" ENDERECO_PUBLICO)"

  dest="${PREFICHAS_BACKUPS_APAGADOS:-/var/backups/prefichas-apagados}/${i}-$(date +%Y%m%d-%H%M%S)"
  if [ "$sem" = true ]; then
    echo "⚠ Apagando SEM backup (pedido explícito)."
  else
    echo "→ Backup do banco de $i antes de apagar…"
    mkdir -p "$dest" && chmod 700 "$dest"
    if ! (cd "$dir" && PASTA_BACKUP="$dest" MANTER_DIAS=36500 ./scripts/backup.sh) || ! ls "$dest"/*.dump >/dev/null 2>&1 || [ ! -s "$(ls "$dest"/*.dump | head -1)" ]; then
      echo "✗ Não consegui fazer o backup, então NÃO apaguei nada. Se o sistema está quebrado e você quer apagar mesmo assim, marque \"apagar mesmo sem backup\"."
      return 1
    fi
    printf 'Instância: %s\nNome: %s\nEndereço: %s\nApagada em: %s\nRestauração: docker compose exec -T db pg_restore -U prefichas -d prefichas --clean < arquivo.dump\n' \
      "$i" "$(valor_env "$i" NOME_ACAMPAMENTO)" "${host:-—}" "$(date -Iseconds)" > "$dest/LEIA-ME.txt"
    echo "✓ Backup guardado em $dest"
  fi

  if [ -n "$host" ] && { [ "$pub" = cloudflare ] || [ "$pub" = direta ]; }; then echo "→ Tirando $host do ar…"; despublicar "$pub" "$host"; fi
  unidade="prefichas-atualizador-${proj}"
  if [ -n "$proj" ] && command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/${unidade}.path" ]; then
    systemctl disable --now "${unidade}.path" "${unidade}.service" >/dev/null 2>&1 || true
    mv -f "/etc/systemd/system/${unidade}.path" "/etc/systemd/system/${unidade}.service" "$LIXEIRA/" 2>/dev/null || true
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  echo "→ Parando e removendo containers e dados…"
  (cd "$dir" && timeout 300 docker compose down -v --remove-orphans >/dev/null 2>&1) || { echo "✗ Falhou ao parar os containers: a pasta foi mantida para você conferir."; return 1; }
  case ",$(valor_env "$i" COMPOSE_PROFILES)," in *,tunel,*) echo "⚠ Esta instância tinha túnel próprio da Cloudflare (versão antiga): apague esse túnel no painel da Cloudflare." ;; esac
  mkdir -p "$LIXEIRA" && chmod 700 "$LIXEIRA"
  lixo="$LIXEIRA/${i}-$(date +%Y%m%d-%H%M%S)"
  mv -- "$dir" "$lixo" || { echo "✗ Não consegui mover a pasta para a lixeira."; return 1; }
  echo "  A pasta (código e configurações, sem o banco) ficou em $lixo por 30 dias, para o caso de arrependimento."
  # a lixeira se limpa sozinha: o que passou de 30 dias é removido a cada apagamento (caminho fixo, só itens diretos da lixeira)
  find /var/lib/prefichas-gerenciador/lixeira -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} + 2>/dev/null || true
  if [ "$sem" = true ]; then echo "✓ Instância $i apagada (sem backup)."; else echo "✓ Instância $i apagada. Backup do banco em $dest"; fi
}

# Troca o endereço de acesso sem recriar a instância (Cloudflare ↔ domínio próprio, ou outro subdomínio/domínio).
# O endereço NOVO é publicado e conferido ANTES de o antigo sair: se não responder, nada muda.
# Pedido: {instancia, publicacao: cloudflare|direta, subdominio?, dominio?}
acao_trocar_link() { # arquivo do pedido
  local p="$1" i pub novo_tipo sub dom base novo antigo porta tentativas ok=0 url o pj
  i="$(jq -r '.instancia // empty' "$p")"; novo_tipo="$(jq -r '.publicacao // empty' "$p")"
  sub="$(jq -r '.subdominio // empty' "$p")"; dom="$(jq -r '.dominio // empty' "$p" | tr 'A-Z' 'a-z')"
  casa "$i" "$RE_INST" && [ "$i" != prefichas-gerenciador ] && [ "$i" != prefichas-proxy ] && [ -f "$OPT/$i/.env" ] && [ ! -L "$OPT/$i/.env" ] || { echo "✗ Instância inválida: $i"; return 1; }
  pub="$(valor_env "$i" PUBLICACAO)"
  case "$pub" in cloudflare|direta) ;; *) echo "✗ Só dá para trocar o link de instâncias publicadas pela Cloudflare ou por domínio direto (esta está como: ${pub:-desconhecida})."; return 1 ;; esac
  antigo="$(host_da_instancia "$i")"; [ "$pub" = cloudflare ] && [ -n "$(valor_env "$i" ENDERECO_PUBLICO)" ] && antigo="$(valor_env "$i" ENDERECO_PUBLICO)"
  case "$novo_tipo" in
    cloudflare)
      casa "$sub" "$RE_SUB" || { echo "✗ Endereço inválido (letras minúsculas, números e hífen)."; return 1; }
      base="$(valor_painel DOMINIO_BASE)"; casa "$base" "$RE_DOM" || base="$(valor_env "$i" DOMINIO_BASE)"; base="${base:-movimentocampista.com.br}"
      novo="${sub}.${base}" ;;
    direta) casa "$dom" "$RE_DOM" || { echo "✗ Domínio inválido."; return 1; }; novo="$dom" ;;
    *) echo "✗ Publicação inválida."; return 1 ;;
  esac
  casa "$novo" "$RE_DOM" || { echo "✗ Endereço inválido."; return 1; }
  [ "$novo" != "$antigo" ] || { echo "✗ O endereço novo é igual ao atual ($antigo)."; return 1; }
  for o in $(instancias); do
    [ "$o" = "$i" ] && continue
    [ "$(host_da_instancia "$o")" = "$novo" ] && { echo "✗ O endereço $novo já é usado por outra instância ($o)."; return 1; }
  done
  porta="$(valor_env "$i" PORTA_LOCAL)"; porta="${porta//[^0-9]/}"; [ -n "$porta" ] || { echo "✗ Porta local da instância não encontrada."; return 1; }
  curl -fsS -m 3 "http://127.0.0.1:${porta}/api/saude" >/dev/null 2>&1 || { echo "✗ A instância está fora do ar: deixe-a funcionando antes de trocar o link."; return 1; }

  echo "→ Publicando o endereço novo ($novo)…"
  if [ "$novo_tipo" = cloudflare ]; then
    "$SCRIPTS_COMP/tunel-compartilhado.sh" verificar "$novo" && "$SCRIPTS_COMP/tunel-compartilhado.sh" adicionar "$novo" "$porta" || { echo "✗ Não consegui publicar $novo na Cloudflare. Nada foi alterado."; return 1; }
  else
    "$SCRIPTS_COMP/proxy-compartilhado.sh" adicionar "$novo" "$porta" || { echo "✗ Não consegui publicar $novo no proxy. Nada foi alterado."; return 1; }
  fi
  echo "→ Conferindo se $novo responde (o DNS e o certificado podem levar um pouco)…"
  url="https://${novo}/api/saude"; [ -n "${PREFICHAS_SAUDE_URL:-}" ] && url="${PREFICHAS_SAUDE_URL//\{host\}/$novo}"
  for tentativas in $(seq 1 "${PREFICHAS_ESPERA_TENTATIVAS:-24}"); do
    if curl -fsS -m 8 "$url" >/dev/null 2>&1; then ok=1; break; fi
    sleep "${PREFICHAS_ESPERA_SEGUNDOS:-5}"
  done
  if [ "$ok" != 1 ]; then
    echo "✗ $novo ainda não responde. Desfazendo: o endereço antigo ($antigo) continua valendo e nada foi alterado."
    [ "$novo_tipo" = direta ] && echo "  Para domínio próprio, confira se o registro DNS (A) já aponta para o IP da VM e se as portas 80/443 chegam nela."
    despublicar "$novo_tipo" "$novo" >/dev/null 2>&1
    return 1
  fi

  echo "→ Atualizando a instância para usar o endereço novo…"
  cp -p "$OPT/$i/.env" "$OPT/$i/.env.antes-do-link" 2>/dev/null || true
  env_definir "$i" URL_PUBLICA "https://${novo}"; env_definir "$i" DOMINIO "$novo"; env_definir "$i" PUBLICACAO "$novo_tipo"
  env_definir "$i" ENDERECO_PUBLICO "$([ "$novo_tipo" = cloudflare ] && echo "$novo")"
  pj="$OPT/$i/atualizacao/estado/publicacao.json"
  if [ -f "$pj" ]; then
    jq -c --arg e "$novo" --argjson a "$([ "$novo_tipo" = cloudflare ] && echo true || echo false)" '.endereco = (if $a then $e else "" end) | .ativo = $a' "$pj" > "$pj.tmp" 2>/dev/null && mv -f "$pj.tmp" "$pj" || true
  fi
  (cd "$OPT/$i" && timeout 300 docker compose up -d >/dev/null 2>&1) || { echo "✗ O endereço novo já está publicado, mas falhou ao reiniciar a instância. Confira: docker compose up -d em $OPT/$i."; return 1; }

  echo "→ Tirando o endereço antigo ($antigo)…"
  despublicar "$pub" "$antigo"
  echo "✓ Link trocado: $antigo → $novo. Os links antigos deixam de funcionar."
  echo "  Se o login Microsoft estiver ligado, troque o URI de redirecionamento no Entra para https://${novo}/api/auth/microsoft/callback."
}

# "Esqueci minha senha" do painel central: manda o link. Só envia para um usuário ATIVO do painel e só com
# link do formato esperado (o pedido vem de uma página sem login; o painel pode estar comprometido).
acao_email_redefinicao() { # arquivo do pedido
  local p="$1" para link
  para="$(jq -r '.para // empty' "$p")"; link="$(jq -r '.link // empty' "$p")"
  casa "$para" "$RE_EMAIL" && casa "$link" "$RE_LINK_REDEF" || { echo "✗ email-redefinicao: pedido inválido."; return 1; }
  jq -e --arg e "$para" 'any(.[]; .email == $e and .ativo != false)' "$BASE/dados/usuarios.json" >/dev/null 2>&1 \
    || { echo "✗ email-redefinicao: destinatário não é usuário ativo do painel."; return 1; }
  smtp_configurado || { echo "✗ email-redefinicao: servidor de e-mail não configurado."; return 1; }
  enviar_smtp "$(smtp_ler HOST)" "$(smtp_ler PORTA)" "$(smtp_ler USUARIO)" "$(smtp_ler SENHA)" "$(smtp_ler REMETENTE)" "$para" \
    "Redefinir senha do painel central" \
    "Para criar uma senha nova no painel central, abra o link abaixo (vale por 1 hora, uma única vez):

${link}

Você vai precisar do código do aplicativo autenticador.
Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma." >/dev/null \
    || { echo "✗ email-redefinicao: falha ao enviar."; return 1; }
  echo "✓ email-redefinicao: link enviado."
}

# ---------------------------------------------------------------- VPN (aba Configurações): só FortiClient
# Situação lida pelo vpn-fortinet.sh (instalado, configuração registrada, túnel, vigia). Sem FortiClient: nada a mostrar.
vpn_backend() { if [ -r "$ETC/vpn-forticlient.env" ] || command -v forticlient >/dev/null 2>&1; then echo vpn-fortinet.sh; fi; }
acao_vpn_reconectar() {
  [ -r "$ETC/vpn-forticlient.env" ] || { echo "✗ A VPN ainda não foi configurada neste servidor (Configurações → VPN, ou no terminal: vpn-fortinet.sh configurar)."; return 1; }
  "$CODIGO/scripts/vpn-fortinet.sh" reconectar
}
# Grava pelo painel qual perfil do FortiClient usar, as redes internas e o usuário (a senha e a PSK ficam no FortiClient)
acao_vpn_config() { # {perfil, redes, usuario}
  local p="$1" perfil redes usuario
  perfil="$(jq -r '.perfil // empty' "$p")"; redes="$(jq -r '.redes // empty' "$p")"; usuario="$(jq -r '.usuario // empty' "$p")"
  casa "$perfil" '^[A-Za-z0-9._-]{1,64}$' || { echo "✗ Nome do perfil inválido."; return 1; }
  casa "$redes" '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}(,([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}){0,15}$' || { echo "✗ Redes inválidas (ex.: 192.168.10.0/24,192.168.16.0/24)."; return 1; }
  [ -z "$usuario" ] || casa "$usuario" '^[A-Za-z0-9@._-]{1,128}$' || { echo "✗ Usuário inválido."; return 1; }
  VPN_PERFIL="$perfil" VPN_REDES="$redes" VPN_USUARIO="$usuario" "$CODIGO/scripts/vpn-fortinet.sh" registrar
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
  alvo="$(jq -r '.instancia // .nome // (if (.acao|startswith("cloudflare")) then "Cloudflare" elif (.acao|startswith("vpn")) then "VPN" elif (.acao|startswith("email")) then "E-mail" elif (.acao|startswith("tunel")) then "Túnel da Cloudflare" elif (.acao|startswith("backup-")) then "Backup na nuvem" elif (.acao|startswith("sms")) then "Mensagens" else "todas" end)' "$tmp" | head -c 120)"
  # "Esqueci minha senha" é pedido por uma página sem login: não vira tarefa (não enche a lista) e o link nunca é registrado
  if [ "$acao" = email-redefinicao ]; then acao_email_redefinicao "$tmp" 2>&1 | head -c 300; rm -f "$tmp"; return; fi
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
    tunel-unificar) "$CODIGO/scripts/tunel-compartilhado.sh" unificar >> "$log" 2>&1 && ok=1 ;;
    email) acao_email "$tmp" >> "$log" 2>&1 && ok=1 ;;
    email-teste) acao_email_teste "$tmp" >> "$log" 2>&1 && ok=1 ;;
    email-remover) acao_email_remover >> "$log" 2>&1 && ok=1 ;;
    email-aplicar) acao_email_aplicar >> "$log" 2>&1 && ok=1 ;;
    microsoft) acao_microsoft "$tmp" >> "$log" 2>&1 && ok=1 ;;
    apagar) acao_apagar "$tmp" >> "$log" 2>&1 && ok=1 ;;
    backup-config) acao_backup_config "$tmp" >> "$log" 2>&1 && ok=1 ;;
    backup-conectar) acao_backup_conectar >> "$log" 2>&1 && ok=1 ;;
    backup-desconectar) acao_backup_desconectar >> "$log" 2>&1 && ok=1 ;;
    backup-chave-gerar) acao_backup_chave_gerar "$tmp" >> "$log" 2>&1 && ok=1 ;;
    backup-chave-guardada) acao_backup_chave_guardada >> "$log" 2>&1 && ok=1 ;;
    backup-nuvem) acao_backup_nuvem "$tmp" >> "$log" 2>&1 && ok=1 ;;
    backup-listar) acao_backup_listar >> "$log" 2>&1 && ok=1 ;;
    backup-restaurar) acao_backup_restaurar "$tmp" >> "$log" 2>&1 && ok=1 ;;
    sms-config) acao_sms_config "$tmp" >> "$log" 2>&1 && ok=1 ;;
    sms-enviar) acao_sms_enviar "$tmp" >> "$log" 2>&1 && ok=1 ;;
    sms-teste) acao_sms_teste "$tmp" >> "$log" 2>&1 && ok=1 ;;
    sms-bloqueio) acao_sms_bloqueio "$tmp" >> "$log" 2>&1 && ok=1 ;;
    trocar-link) acao_trocar_link "$tmp" >> "$log" 2>&1 && ok=1 ;;
    vpn-reconectar) acao_vpn_reconectar >> "$log" 2>&1 && ok=1 ;;
    vpn-config) acao_vpn_config "$tmp" >> "$log" 2>&1 && ok=1 ;;
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
    local msh=false mst msc msseg=false
    case "$(valor_env "$i" MICROSOFT_HABILITADO)" in true|1|sim) msh=true ;; esac
    mst="$(valor_env "$i" MICROSOFT_TENANT_ID)"; msc="$(valor_env "$i" MICROSOFT_CLIENT_ID)"; [ -n "$(valor_env "$i" MICROSOFT_CLIENT_SECRET)" ] && msseg=true
    itens+=("$(printf '{"pasta":%s,"nome":%s,"url":%s,"publicacao":%s,"porta":%s,"versao":%s,"saude":"%s","memoria":%s,"microsoft":{"habilitado":%s,"tenant_id":%s,"client_id":%s,"segredo":%s}}' \
      "$(json_str "$i")" "$(json_str "$nome")" "$(json_str "$url")" "$(json_str "$pub")" "${porta//[^0-9]/}" "$(json_str "$versao")" "$saude" "$(json_str "$mem")" \
      "$msh" "$(json_str "$mst")" "$(json_str "$msc")" "$msseg")")
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
  # só a situação do e-mail (servidor, porta, usuário, remetente): a senha nunca sai do arquivo do administrador
  local ej='{"configurado":false}'
  if smtp_configurado; then
    ej="$(jq -nc --arg h "$(smtp_ler HOST)" --arg p "$(smtp_ler PORTA)" --arg u "$(smtp_ler USUARIO)" --arg r "$(smtp_ler REMETENTE)" --arg a "$(date -r "$ETC/smtp.env" -Iseconds)" \
      '{configurado:true, host:$h, porta:($p|tonumber? // 0), usuario:$u, remetente:$r, atualizado_em:$a}')"
  fi
  # túnel único da Cloudflare: existe? o cloudflared está no ar? quais endereços? quantos acampamentos ainda têm túnel próprio?
  local rod=false ender='[]' prop=0 existe=false
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx prefichas-tunel && rod=true
  [ -r "$ETC/tunel-hosts" ] && ender="$(awk 'NF{print $1}' "$ETC/tunel-hosts" | jq -R . | jq -sc . 2>/dev/null || echo '[]')"
  [ -r "$ETC/tunel.env" ] && existe=true
  for i in $(instancias); do case ",$(valor_env "$i" COMPOSE_PROFILES)," in *,tunel,*) prop=$((prop + 1)) ;; esac; done
  local tj; tj="$(jq -nc --argjson r "$rod" --argjson e "$ender" --argjson p "$prop" --argjson x "$existe" '{existe:$x, rodando:$r, enderecos:$e, proprios:$p}')"
  printf '{"cloudflare":{"token_configurado":%s,"dominio_base":%s,"atualizado_em":%s}}\n' "$tk" "$(json_str "$dbase")" \
    "$( [ -f "$ETC/cloudflare.env" ] && json_str "$(date -r "$ETC/cloudflare.env" -Iseconds)" || echo null )" \
    | jq -c --argjson e "$ej" --argjson t "$tj" '. + {email:$e, tunel:$t}' > "$ESTADO/configuracoes.json.tmp" \
    && mv -f "$ESTADO/configuracoes.json.tmp" "$ESTADO/configuracoes.json"
  # backup na nuvem e mensagens (sem segredos)
  local rot; rot="$(estado_rotinas_json 2>/dev/null || echo '{}')"
  jq -c --argjson r "$rot" '. + $r' "$ESTADO/configuracoes.json" > "$ESTADO/configuracoes.json.tmp" 2>/dev/null && mv -f "$ESTADO/configuracoes.json.tmp" "$ESTADO/configuracoes.json"
  chmod 644 "$ESTADO/instancias.json" "$ESTADO/servidor.json" "$ESTADO/configuracoes.json"
}

# backup na nuvem e mensagens de aniversário
# shellcheck source=gerenciador-rotinas.sh
. "$CODIGO/scripts/gerenciador-rotinas.sh"

case "${1:-pedidos}" in
  pedidos)
    exec 9>"$ESTADO/.trava"; flock -n 9 || exit 0
    while :; do
      prox="$(ls -1tr "$PEDIDOS"/*.json 2>/dev/null | head -1)"
      [ -n "$prox" ] || break
      processar "$prox"
    done ;;
  coletar) coletar; rotina_diaria ;;
  *) echo "Uso: $0 pedidos|coletar"; exit 1 ;;
esac
