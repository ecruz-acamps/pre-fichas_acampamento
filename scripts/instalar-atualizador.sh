#!/usr/bin/env bash
# Instala no servidor o "atualizador": um serviço do systemd que executa a
# atualização quando o administrador clica em "Atualizar agora" no painel.
#   sudo ./scripts/instalar-atualizador.sh            # Docker (padrão)
#   sudo MODO=local ./scripts/instalar-atualizador.sh # instalação sem Docker
# (O scripts/novo-acampamento.sh já chama este script.)
set -euo pipefail
cd "$(dirname "$0")/.."
PASTA="$(pwd)"
MODO="${MODO:-docker}"

if ! command -v systemctl >/dev/null || [ ! -d /run/systemd/system ]; then
  echo "⚠ systemd não encontrado: a atualização pelo painel não ficará disponível."
  echo "  Atualize pelo terminal com ./scripts/atualizar.sh."
  exit 0
fi

if [ "$MODO" = "docker" ]; then
  NOME="$(grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null | cut -d= -f2)"
  DONO="1000:1000"   # usuário "node" do container
else
  NOME="pre-fichas"
  DONO="$(id -u prefichas 2>/dev/null || echo 0):$(id -g prefichas 2>/dev/null || echo 0)"
fi
NOME="${NOME:-pre-fichas}"
UNIDADE="prefichas-atualizador-${NOME}"

mkdir -p atualizacao
chown "$DONO" atualizacao
chmod 755 atualizacao

cat > "/etc/systemd/system/${UNIDADE}.service" <<UNIT
[Unit]
Description=Atualiza o sistema de pré-fichas (${NOME}) a pedido do painel

[Service]
Type=oneshot
WorkingDirectory=${PASTA}
Environment=MODO=${MODO}
ExecStart=${PASTA}/scripts/atualizador-servico.sh
TimeoutStartSec=1800
UNIT

cat > "/etc/systemd/system/${UNIDADE}.path" <<UNIT
[Unit]
Description=Aguarda pedidos de atualização do painel (${NOME})

[Path]
PathExists=${PASTA}/atualizacao/solicitar
Unit=${UNIDADE}.service

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${UNIDADE}.path" >/dev/null
printf '{"instalado_em":"%s","modo":"%s","unidade":"%s"}\n' "$(date -Iseconds)" "$MODO" "$UNIDADE" > atualizacao/atualizador.json
chown "$DONO" atualizacao/atualizador.json
echo "✓ Atualização pelo painel ativada (${UNIDADE})."
