#!/usr/bin/env bash
# ============================================================================
#  Instalador do sistema de pré-fichas — um único comando:
#
#    curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
#
#  Ordem de implantação numa VM com vários acampamentos:
#    1) PAINEL CENTRAL  (este comando, opção 1) — prepara a VM (Docker, VPN, Cloudflare,
#       Let's Encrypt, e-mail) e instala o painel que cria os acampamentos;
#    2) ACAMPAMENTOS    — criados pelo painel (ou por este comando, opção 2).
#  Testado em Ubuntu 22.04/24.04 e Debian 12.
# ============================================================================
set -euo pipefail

REPO="${PREFICHAS_REPO:-https://github.com/ecruz-acamps/pre-fichas_acampamento.git}"
BRANCH="${PREFICHAS_BRANCH:-main}"

verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
etapa() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
erro() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || erro "Rode como administrador: curl -fsSL …/instalar.sh | sudo bash"

TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { # variável, pergunta
  local v="${!1:-}"
  if [ -z "$v" ] && [ "$TEM_TTY" = 1 ]; then read -r -p "$2: " v </dev/tty; fi
  printf -v "$1" '%s' "$v"
}

cat <<'BANNER'

  ┌──────────────────────────────────────────────────┐
  │   Pré-fichas e fila de espera do acampamento     │
  │   Instalação                                      │
  └──────────────────────────────────────────────────┘
BANNER

preparar_programas() {
  etapa "Verificando programas necessários"
  if command -v apt-get >/dev/null; then
    FALTAM=""
    for p in git curl openssl ss iconv jq; do command -v "$p" >/dev/null || FALTAM="$FALTAM $p"; done
    if [ -n "$FALTAM" ]; then
      echo "Instalando:$FALTAM"
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq && apt-get install -y -qq git curl ca-certificates openssl iproute2 libc-bin jq >/dev/null
    fi
  else
    for p in git curl; do command -v "$p" >/dev/null || erro "Instale '$p' e rode de novo (sistema sem apt-get)."; done
  fi
  if ! command -v docker >/dev/null; then
    echo "Instalando o Docker (alguns minutos)…"
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || erro "Docker sem o plugin 'compose'. Veja https://docs.docker.com/engine/install/"
  verde "✓ git, curl e Docker prontos"
}


# ============================================================================
#  O QUE INSTALAR
# ============================================================================
if [ -z "${INSTALAR:-}" ]; then
  if [ "$TEM_TTY" = 1 ]; then
    echo
    echo "O que você quer instalar?"
    echo "  1) Painel central da VM — recomendado PRIMEIRO; depois cria os acampamentos pelo navegador"
    echo "  2) Um acampamento (instância) direto por aqui"
    read -r -p "Escolha [1]: " op </dev/tty
    case "${op:-1}" in 2) INSTALAR=acampamento ;; *) INSTALAR=painel ;; esac
  else
    INSTALAR=acampamento
  fi
fi

if [ "$INSTALAR" = painel ]; then
  PASTA_PAINEL=/opt/prefichas-gerenciador
  preparar_programas
  etapa "Baixando o sistema para $PASTA_PAINEL"
  if [ -d "$PASTA_PAINEL/.git" ]; then git -C "$PASTA_PAINEL" pull -q --ff-only origin "$BRANCH"
  else git clone -q --branch "$BRANCH" "$REPO" "$PASTA_PAINEL"; fi
  cd "$PASTA_PAINEL"
  mkdir -p /etc/prefichas && chmod 700 /etc/prefichas

  etapa "1/5 · Acesso remoto pela VPN (FortiClient)"
  if [ -z "${VPN_FORTINET+x}" ] && [ "$TEM_TTY" = 1 ]; then
    read -r -p "O painel será acessado pela VPN do FortiGate da sua empresa? [S/n]: " VPN_FORTINET </dev/tty
  fi
  case "${VPN_FORTINET:-s}" in
    [nN]*) echo "Sem VPN: o painel ficará acessível só pelo próprio servidor (túnel SSH)." ;;
    *) ./scripts/vpn-fortinet.sh configurar || echo "⚠ VPN não configurada agora. Depois: sudo $PASTA_PAINEL/scripts/vpn-fortinet.sh configurar" ;;
  esac

  etapa "2/5 · Cloudflare (para acampamentos publicados pelo túnel)"
  DOMINIO_BASE="${DOMINIO_BASE-movimentocampista.com.br}"
  if [ "$TEM_TTY" = 1 ] && [ -z "${CF_API_TOKEN:-}" ] && [ ! -s /etc/prefichas/cloudflare.env ]; then
    read -r -p "Domínio base da Cloudflare [${DOMINIO_BASE}]: " db </dev/tty; DOMINIO_BASE="${db:-$DOMINIO_BASE}"
    echo "Token da API da Cloudflare (Conta › Cloudflare Tunnel › Editar e Zona › DNS › Editar)."
    echo "(Se preferir, deixe em branco e cole o token depois na aba Configurações do painel central.)"
    read -r -s -p "Token — ENTER para configurar depois: " CF_API_TOKEN </dev/tty; echo
  fi
  [[ "$DOMINIO_BASE" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || erro "Domínio base inválido."
  ( umask 077; printf 'DOMINIO_BASE=%s\n' "$DOMINIO_BASE" > /etc/prefichas/painel.env )
  if [ -n "${CF_API_TOKEN:-}" ]; then
    ( umask 077; printf 'CF_API_TOKEN=%q\n' "$CF_API_TOKEN" > /etc/prefichas/cloudflare.env ); verde "✓ Token da Cloudflare guardado"
  fi

  etapa "3/5 · Certificados HTTPS (Let's Encrypt) para acampamentos diretos"
  if [ -z "${LETSENCRYPT_EMAIL+x}" ] && [ "$TEM_TTY" = 1 ]; then
    read -r -p "E-mail para avisos do Let's Encrypt — ENTER para pular: " LETSENCRYPT_EMAIL </dev/tty
  fi
  if [ -n "${LETSENCRYPT_EMAIL:-}" ]; then
    [[ "$LETSENCRYPT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || erro "E-mail inválido."
    ( umask 077; printf 'LETSENCRYPT_EMAIL=%s\n' "$LETSENCRYPT_EMAIL" > /etc/prefichas/proxy.env )
  fi

  etapa "4/5 · E-mail de envio (\"Esqueci minha senha\") para os acampamentos"
  if [ -z "${SMTP_USUARIO+x}" ] && [ "$TEM_TTY" = 1 ]; then
    read -r -p "Gmail que envia os e-mails — ENTER para configurar depois: " SMTP_USUARIO </dev/tty
    [ -n "$SMTP_USUARIO" ] && { echo "Use uma SENHA DE APP do Google (myaccount.google.com → Segurança → Senhas de app)."; read -r -s -p "Senha de app: " SMTP_SENHA </dev/tty; echo; }
  fi
  if [ -n "${SMTP_USUARIO:-}" ]; then
    ( umask 077; printf 'SMTP_HOST=%s\nSMTP_PORTA=%s\nSMTP_USUARIO=%s\nSMTP_SENHA=%s\nSMTP_REMETENTE=%s\n' \
      "${SMTP_HOST:-smtp.gmail.com}" "${SMTP_PORTA:-465}" "$SMTP_USUARIO" "${SMTP_SENHA// /}" "$SMTP_USUARIO" > /etc/prefichas/smtp.env )
    verde "✓ E-mail de envio guardado (usado em cada acampamento novo)"
  fi

  etapa "5/5 · Painel central"
  perguntar ADMIN_EMAIL "Seu e-mail (usuário do painel central)"
  [ -n "${ADMIN_EMAIL:-}" ] || erro "Informe o e-mail do usuário do painel."
  export ADMIN_EMAIL
  if [ -z "${PAINEL_DOMINIO+x}" ] && [ "$TEM_TTY" = 1 ]; then
    echo "O painel pode abrir pela internet em HTTPS (porta 443), sem VPN, protegido por senha + autenticador."
    read -r -p "Domínio do painel (ex.: painel.exemplo.com.br; o DNS deve apontar para esta VM) — ENTER = só rede interna: " PAINEL_DOMINIO </dev/tty
  fi
  export PAINEL_DOMINIO="${PAINEL_DOMINIO:-}"
  if [ -z "$PAINEL_DOMINIO" ] && [ ! -s /etc/prefichas/vpn-forticlient.env ] && [ -z "${REDES_PERMITIDAS:-}" ] && [ "$TEM_TTY" = 1 ]; then
    read -r -p "Redes que podem abrir o painel (ex.: 192.168.10.0/24) — ENTER = só pelo próprio servidor: " rp </dev/tty
    [ -n "$rp" ] && { export REDES_PERMITIDAS="127.0.0.1/32,${rp// /}"; export ESCUTAR=0.0.0.0; }
  fi
  ./scripts/instalar-gerenciador.sh

  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  ✓ Painel central instalado. Próximo passo: criar os acampamentos"
  echo "    pelo painel → aba \"Nova instância\"."
  echo "════════════════════════════════════════════════════════════"
  exit 0
fi

# ---- 1. Perguntas (podem vir prontas por variáveis de ambiente) ------------
etapa "Dados do acampamento"
perguntar NOME "Nome do acampamento (ex.: Acampamento Exemplo)"
[ -n "${NOME:-}" ] || erro "Informe o nome do acampamento."
SLUG="$(printf '%s' "$NOME" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$NOME")"
SLUG="$(printf '%s' "$SLUG" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"

# ---- Como publicar (pode ser diferente para cada acampamento da mesma VM) ----
#   cloudflare : NOME.DOMINIO_BASE pelo túnel da Cloudflare (não abre portas)
#   direta     : domínio próprio apontando para o IP da VM, pelo proxy HTTPS compartilhado (80/443)
#   local      : só na rede local, pelo IP (sem HTTPS)
# Variáveis: PUBLICACAO=cloudflare|direta|local, DOMINIO (direta), SUBDOMINIO e DOMINIO_BASE (cloudflare).
[ -z "${DOMINIO_BASE+x}" ] && [ -r /etc/prefichas/painel.env ] && . /etc/prefichas/painel.env
DOMINIO_BASE="${DOMINIO_BASE-movimentocampista.com.br}"
if [ -z "${PUBLICACAO:-}" ]; then
  if [ -n "${DOMINIO:-}" ]; then PUBLICACAO=direta
  elif [ "${PUBLICAR:-}" = n ] || [ "${PUBLICAR:-}" = N ] || [ -z "$DOMINIO_BASE" ]; then PUBLICACAO=local
  elif [ "$TEM_TTY" = 1 ]; then
    echo
    echo "Como publicar este acampamento?"
    echo "  1) Cloudflare — ${DOMINIO_BASE:+NOME.${DOMINIO_BASE} }(sem abrir portas no servidor)"
    echo "  2) Direto — domínio próprio apontando para o IP desta VM (HTTPS automático, portas 80/443)"
    echo "  3) Só rede local — pelo IP do servidor, sem HTTPS"
    read -r -p "Escolha [1]: " op </dev/tty
    case "${op:-1}" in 2) PUBLICACAO=direta ;; 3) PUBLICACAO=local ;; *) PUBLICACAO=cloudflare ;; esac
  else
    PUBLICACAO=cloudflare
  fi
fi
CLOUDFLARE=0 COMPARTILHADO=0
case "$PUBLICACAO" in
  cloudflare)
    [ -n "$DOMINIO_BASE" ] || erro "Defina DOMINIO_BASE para publicar pela Cloudflare."
    SUB_PADRAO="${SLUG#acampamento-}"
    if [ -z "${SUBDOMINIO:-}" ] && [ "$TEM_TTY" = 1 ]; then
      read -r -p "Endereço: ____.${DOMINIO_BASE} [${SUB_PADRAO}]: " SUBDOMINIO </dev/tty
    fi
    SUBDOMINIO="$(printf '%s' "${SUBDOMINIO:-$SUB_PADRAO}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
    DOMINIO="${SUBDOMINIO}.${DOMINIO_BASE}"
    CLOUDFLARE=1
    mkdir -p /etc/prefichas && chmod 700 /etc/prefichas
    [ -z "${CF_API_TOKEN:-}" ] && [ -r /etc/prefichas/cloudflare.env ] && . /etc/prefichas/cloudflare.env
    if [ -z "${CF_API_TOKEN:-}" ]; then
      echo "Token da API da Cloudflare (pedido só na 1ª instalação; fica guardado em /etc/prefichas/cloudflare.env)."
      echo "Permissões: Conta › Cloudflare Tunnel › Editar  e  Zona › DNS › Editar (${DOMINIO_BASE})."
      [ "$TEM_TTY" = 1 ] && read -r -s -p "Token: " CF_API_TOKEN </dev/tty && echo
      [ -n "${CF_API_TOKEN:-}" ] || erro "Sem o token da Cloudflare não dá para publicar ${DOMINIO}."
    fi
    ( umask 077; printf 'CF_API_TOKEN=%q\n' "$CF_API_TOKEN" > /etc/prefichas/cloudflare.env )
    export CF_API_TOKEN
    ;;
  direta)
    if [ -z "${DOMINIO:-}" ] && [ "$TEM_TTY" = 1 ]; then
      echo "O domínio precisa ter um registro A apontando para o IP público desta VM."
      read -r -p "Domínio (ex.: prefichas.seuacampamento.com.br): " DOMINIO </dev/tty
    fi
    DOMINIO="$(printf '%s' "${DOMINIO:-}" | tr 'A-Z' 'a-z')"
    [[ "$DOMINIO" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || erro "Domínio inválido: ${DOMINIO}"
    COMPARTILHADO=1
    ;;
  local) DOMINIO="" ;;
  *) erro "PUBLICACAO deve ser cloudflare, direta ou local." ;;
esac
perguntar ADMIN_EMAIL "E-mail do administrador"
perguntar ADMIN_NOME "Nome do administrador"
[ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_NOME:-}" ] || erro "Informe e-mail e nome do administrador."
CHAVE="${CHAVE:-}"

# E-mail que envia o link de "Esqueci minha senha" (Gmail com senha de app)
[ -z "${SMTP_USUARIO+x}" ] && [ -r /etc/prefichas/smtp.env ] && { set -a; . /etc/prefichas/smtp.env; set +a; }
if [ -z "${SMTP_USUARIO+x}" ] && [ "$TEM_TTY" = 1 ]; then
  echo
  echo "E-mail para enviar o link de 'Esqueci minha senha' (recomendado: um Gmail do acampamento)."
  read -r -p "E-mail (Gmail) — ENTER para configurar depois: " SMTP_USUARIO </dev/tty
  if [ -n "$SMTP_USUARIO" ]; then
    echo "Use uma SENHA DE APP do Google (myaccount.google.com → Segurança → Senhas de app), não a senha normal."
    read -r -s -p "Senha de app: " SMTP_SENHA </dev/tty; echo
  fi
fi
SMTP_USUARIO="${SMTP_USUARIO:-}" SMTP_SENHA="${SMTP_SENHA:-}"
if [ -z "${PORTA_HTTP:-}" ] && [ -z "$DOMINIO" ] && [ "$TEM_TTY" = 1 ]; then
  read -r -p "Porta do site (ENTER = automática: 80, ou 8180 se a 80 estiver ocupada): " PORTA_HTTP </dev/tty
fi
PORTA_HTTP="${PORTA_HTTP:-}"

PASTA="${PASTA:-/opt/prefichas-${SLUG:-acampamento}}"
[ -f "$PASTA/.env" ] && erro "Já existe uma instalação em $PASTA. Para reinstalar do zero: cd $PASTA && docker compose down -v && cd / && rm -rf $PASTA"

# ---- 2. Programas necessários
preparar_programas

# ---- 3. Baixar o sistema -----------------------------------------------------
etapa "Baixando o sistema para $PASTA"
if [ -d "$PASTA/.git" ]; then
  git -C "$PASTA" pull -q --ff-only origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$PASTA"
fi
verde "✓ Sistema baixado"

# ---- 4. Instalar -------------------------------------------------------------
etapa "Instalando o acampamento"
cd "$PASTA"
ARGS=(--nome "$NOME" --dominio "$DOMINIO" --admin "$ADMIN_EMAIL" --nome-admin "$ADMIN_NOME")
[ -n "$CHAVE" ] && ARGS+=(--chave "$CHAVE")
[ -n "$PORTA_HTTP" ] && ARGS+=(--porta-http "$PORTA_HTTP")
[ "$CLOUDFLARE" = 1 ] && ARGS+=(--cloudflare)
[ "$COMPARTILHADO" = 1 ] && ARGS+=(--compartilhado)
export SMTP_USUARIO SMTP_SENHA SMTP_HOST="${SMTP_HOST:-smtp.gmail.com}" SMTP_PORTA="${SMTP_PORTA:-465}"
./scripts/novo-acampamento.sh "${ARGS[@]}"

# ---- 5. (Opcional) VPN Fortinet para acessar este servidor remoto -------------
if [ -z "${VPN_FORTINET+x}" ] && [ "$TEM_TTY" = 1 ]; then
  echo
  read -r -p "Este servidor é remoto e você quer acessá-lo pela VPN (FortiClient) do FortiGate da sua empresa? [s/N]: " VPN_FORTINET </dev/tty
fi
case "${VPN_FORTINET:-n}" in
  [sS]*) ./scripts/vpn-fortinet.sh configurar || echo "⚠ VPN não configurada. Tente depois: sudo ./scripts/vpn-fortinet.sh configurar" ;;
esac
