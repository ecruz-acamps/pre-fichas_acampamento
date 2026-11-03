#!/usr/bin/env bash
# Atualiza esta instalação para a versão mais recente do GitHub.
#   ./scripts/atualizar.sh            # Docker (padrão)
#   MODO=local ./scripts/atualizar.sh # instalação sem Docker (systemd)
#
# Passos: backup → baixa o código novo → reconstrói/reinicia → confere se voltou.
# As mudanças no banco (migrações) são aplicadas sozinhas quando a aplicação sobe.
set -euo pipefail
cd "$(dirname "$0")/.."
MODO="${MODO:-docker}"
# Sem Docker: as configurações (DATABASE_URL, PORTA) ficam em /etc/pre-fichas.env
if [ "$MODO" = "local" ] && [ -z "${DATABASE_URL:-}" ] && [ -r /etc/pre-fichas.env ]; then
  set -a; . /etc/pre-fichas.env; set +a
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$MODO" = "docker" ] && [ ! -f .env ]; then
  echo "Esta pasta não tem .env: o acampamento ainda não foi instalado aqui (use scripts/novo-acampamento.sh)."
  exit 1
fi

echo "→ Procurando atualizações (branch $BRANCH)…"
git fetch --quiet origin "$BRANCH"
ATUAL="$(git rev-parse HEAD)"
NOVA="$(git rev-parse "origin/$BRANCH")"
if [ "$ATUAL" = "$NOVA" ] && [ "${1:-}" != "--forcar" ]; then
  echo "✓ Já está na versão mais recente (${ATUAL:0:7})."
  exit 0
fi
if [ "$ATUAL" != "$NOVA" ]; then
  echo "Novidades:"
  git log --format='  • %s' "$ATUAL..$NOVA" | head -30
fi

echo "→ Fazendo backup antes de atualizar…"
./scripts/backup.sh

echo "→ Baixando o código novo…"
if ! git pull --ff-only --quiet origin "$BRANCH"; then
  echo "✗ Não foi possível atualizar o código: há alterações locais nesta pasta."
  echo "  Veja com 'git status'. Nada foi alterado na aplicação."
  exit 1
fi

VERSAO_COMMIT="$(git rev-parse HEAD)"
VERSAO_DATA="$(git log -1 --format=%cI)"
VERSAO_BRANCH="$BRANCH"
export VERSAO_COMMIT VERSAO_DATA VERSAO_BRANCH

if [ "$MODO" = "docker" ]; then
  echo "→ Atualizando os containers…"
  ./scripts/subir-app.sh
  PORTA="$(grep -E '^PORTA_LOCAL=' .env | cut -d= -f2 || true)"
  PORTA="${PORTA:-3000}"
else
  echo "→ Instalando dependências e gerando o site…"
  npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev
  printf '{"commit":"%s","data":"%s","branch":"%s"}\n' "$VERSAO_COMMIT" "$VERSAO_DATA" "$VERSAO_BRANCH" > versao.json
  systemctl restart pre-fichas
  PORTA="${PORTA:-3000}"
fi

echo -n "→ Aguardando a aplicação voltar"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORTA}/api/saude" >/dev/null 2>&1; then
    echo " ✓"
    # Mantém o serviço do servidor em dia (novas funções do painel, ex.: publicação)
    [ "$(id -u)" = 0 ] && ./scripts/instalar-atualizador.sh >/dev/null 2>&1 || true
    echo "✓ Atualizado para ${VERSAO_COMMIT:0:7} ($(git log -1 --format=%s))."
    exit 0
  fi
  echo -n "."; sleep 2
done
echo
echo "✗ A aplicação não respondeu depois da atualização. Veja o motivo com: docker compose logs app"
echo "  O backup feito antes da atualização está na pasta backups/ (versão anterior: ${ATUAL:0:7})."
exit 1
