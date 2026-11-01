#!/usr/bin/env bash
# Instala um acampamento nesta pasta: gera o .env, sobe banco + aplicação (+ HTTPS),
# aplica a identidade (marca) e cria o primeiro administrador.
#
# Uso (as perguntas que faltarem são feitas no terminal):
#   ./scripts/novo-acampamento.sh \
#       --marca marcas/beata-albertina.json \
#       --dominio prefichas.beataalbertina.com.br \
#       --admin coordenacao@beataalbertina.com.br --nome-admin "Maria Souza"
#
# Opções:
#   --marca ARQ        arquivo de marca (pasta marcas/)
#   --dominio DOM      domínio público (HTTPS automático). Use ":80" para rede interna sem HTTPS
#   --admin EMAIL      e-mail do primeiro administrador
#   --nome-admin NOME  nome do primeiro administrador
#   --porta N          porta local da aplicação (padrão 3000; use 3001, 3002... para vários acampamentos)
#   --multi            vários acampamentos no mesmo servidor: não sobe Caddy próprio
#                      (mostra o trecho para o proxy compartilhado, deploy/Caddyfile.multi)
#   --forcar           sobrescreve um .env existente (CUIDADO: troca a senha do banco gerada antes)
set -euo pipefail
cd "$(dirname "$0")/.."

MARCA="" DOMINIO="" ADMIN="" NOME_ADMIN="" PORTA="3000" MULTI=0 FORCAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --marca) MARCA="$2"; shift 2 ;;
    --dominio) DOMINIO="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --nome-admin) NOME_ADMIN="$2"; shift 2 ;;
    --porta) PORTA="$2"; shift 2 ;;
    --multi) MULTI=1; shift ;;
    --forcar) FORCAR=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

perguntar() { # variável, pergunta, padrão
  local atual="${!1}"
  if [ -z "$atual" ]; then
    if [ -t 0 ]; then read -r -p "$2${3:+ [$3]}: " atual; fi
    atual="${atual:-$3}"
  fi
  printf -v "$1" '%s' "$atual"
}

command -v docker >/dev/null || { echo "Docker não encontrado. Instale: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' não encontrado."; exit 1; }

if [ -f .env ] && [ "$FORCAR" = 0 ]; then
  echo "Já existe um .env nesta pasta (instalação existente). Use --forcar para recriar."
  exit 1
fi

echo "Marcas disponíveis:"; ls -1 marcas/*.json | sed 's/^/  /'
perguntar MARCA "Arquivo de marca" "marcas/sao-padre-pio.json"
[ -f "$MARCA" ] || { echo "Arquivo de marca não encontrado: $MARCA"; exit 1; }
perguntar DOMINIO "Domínio (ex.: prefichas.seuacampamento.com.br, ou :80 sem HTTPS)" ":80"
perguntar ADMIN "E-mail do primeiro administrador" ""
perguntar NOME_ADMIN "Nome do primeiro administrador" ""
[ -n "$ADMIN" ] && [ -n "$NOME_ADMIN" ] || { echo "Informe e-mail e nome do administrador."; exit 1; }

SLUG="$(basename "$MARCA" .json | tr -c 'a-zA-Z0-9\n' '-' | tr 'A-Z' 'a-z')"
PROJETO="prefichas-${SLUG}"
if command -v openssl >/dev/null; then SENHA_DB="$(openssl rand -hex 24)"
else SENHA_DB="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi

PERFIS="caddy" COOKIE="true"
[ "$MULTI" = 1 ] && PERFIS=""
[ "$DOMINIO" = ":80" ] && COOKIE="false"

umask 077
cat > .env <<ENV
# Gerado por scripts/novo-acampamento.sh em $(date '+%F %T')
COMPOSE_PROJECT_NAME=${PROJETO}
MARCA_INICIAL=${MARCA}
COMPOSE_PROFILES=${PERFIS}
DOMINIO=${DOMINIO}
PORTA_LOCAL=${PORTA}
POSTGRES_DB=prefichas
POSTGRES_USER=prefichas
POSTGRES_PASSWORD=${SENHA_DB}
COOKIE_SEGURO=${COOKIE}
SESSAO_HORAS=12
LIMITE_ENVIOS_POR_HORA=30
ENV
echo "✓ .env criado (projeto ${PROJETO}, porta local ${PORTA})"

if [ "${SEM_BUILD:-0}" = 1 ]; then docker compose up -d; else docker compose up -d --build; fi

echo -n "Aguardando a aplicação iniciar"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORTA}/api/saude" >/dev/null 2>&1; then echo " ✓"; break; fi
  echo -n "."; sleep 2
done
curl -fsS "http://127.0.0.1:${PORTA}/api/saude" >/dev/null || { echo; echo "A aplicação não respondeu. Veja: docker compose logs app"; exit 1; }

echo
docker compose exec -T app node server/cli.js criar-admin "$ADMIN" "$NOME_ADMIN"
echo
NOME_ACAMP="$(curl -fsS "http://127.0.0.1:${PORTA}/api/marca" | grep -o '"nome":"[^"]*"' | head -1 | cut -d'"' -f4)"
echo "✓ ${NOME_ACAMP:-Acampamento} instalado."
if [ "$DOMINIO" = ":80" ]; then
  echo "  Formulário: http://IP-DO-SERVIDOR/    Painel: http://IP-DO-SERVIDOR/admin/"
else
  echo "  Formulário: https://${DOMINIO}/    Painel: https://${DOMINIO}/admin/"
fi
if [ "$MULTI" = 1 ]; then
  echo
  echo "Acrescente ao Caddyfile do proxy compartilhado (deploy/Caddyfile.multi) e recarregue o Caddy:"
  echo
  echo "${DOMINIO} {"
  echo "	encode zstd gzip"
  echo "	reverse_proxy 127.0.0.1:${PORTA}"
  echo "}"
fi
echo
echo "Próximos passos: entre no painel, troque a senha, envie a logo em Configurações,"
echo "cadastre os núcleos e os coordenadores. Agende o backup: ./scripts/backup.sh (veja o README)."
