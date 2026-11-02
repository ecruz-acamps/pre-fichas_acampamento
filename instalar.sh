#!/usr/bin/env bash
# ============================================================================
#  Instalador do sistema de pré-fichas — um único comando:
#
#    curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
#
#  Faz tudo: instala o que faltar (git, Docker), baixa o sistema, pergunta o nome
#  do acampamento e os dados do administrador e coloca no ar.
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

# ---- 1. Perguntas (podem vir prontas por variáveis de ambiente) ------------
etapa "Dados do acampamento"
perguntar NOME "Nome do acampamento (ex.: Acampamento Exemplo)"
[ -n "${NOME:-}" ] || erro "Informe o nome do acampamento."
if [ -z "${DOMINIO+x}" ] && [ "$TEM_TTY" = 1 ]; then
  read -r -p "Domínio com HTTPS (ex.: prefichas.seuacampamento.com.br) — deixe vazio para usar pelo IP: " DOMINIO </dev/tty
fi
DOMINIO="${DOMINIO:-}"
perguntar ADMIN_EMAIL "E-mail do administrador"
perguntar ADMIN_NOME "Nome do administrador"
[ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_NOME:-}" ] || erro "Informe e-mail e nome do administrador."
CHAVE="${CHAVE:-}"

SLUG="$(printf '%s' "$NOME" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$NOME")"
SLUG="$(printf '%s' "$SLUG" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
PASTA="${PASTA:-/opt/prefichas-${SLUG:-acampamento}}"
[ -f "$PASTA/.env" ] && erro "Já existe uma instalação em $PASTA. Para reinstalar do zero: cd $PASTA && docker compose down -v && cd / && rm -rf $PASTA"

# ---- 2. Programas necessários ----------------------------------------------
etapa "Verificando programas necessários"
if command -v apt-get >/dev/null; then
  FALTAM=""
  for p in git curl openssl ss iconv; do command -v "$p" >/dev/null || FALTAM="$FALTAM $p"; done
  if [ -n "$FALTAM" ]; then
    echo "Instalando:$FALTAM"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq git curl ca-certificates openssl iproute2 libc-bin >/dev/null
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
./scripts/novo-acampamento.sh "${ARGS[@]}"
