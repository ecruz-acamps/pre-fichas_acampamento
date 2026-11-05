#!/usr/bin/env bash
# Instala o PAINEL CENTRAL da VM (gerenciar as instâncias pelo navegador).
#
#   sudo ./scripts/instalar-gerenciador.sh
#
# Variáveis (opcionais):
#   ESCUTAR=127.0.0.1          IP em que o painel escuta. 127.0.0.1 = só pelo próprio servidor/túnel SSH.
#                              Para acessar pela VPN, use o IP da VM na rede da VPN (ou 0.0.0.0).
#   REDES_PERMITIDAS=...       redes que podem abrir o painel (ex.: 127.0.0.1/32,192.168.10.0/24).
#                              Fora delas o painel recusa a conexão, mesmo com a porta aberta.
#   PORTA=9090                 porta do painel
#   ADMIN_EMAIL=voce@exemplo   primeiro usuário (senha e chave do autenticador mostradas uma vez)
#
# NUNCA publique o painel na internet: ele controla o servidor inteiro.
set -euo pipefail
cd "$(dirname "$0")/.."
CODIGO="$(pwd)"
DADOS=/var/lib/prefichas-gerenciador
erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
command -v docker >/dev/null || erro "Docker não encontrado."
command -v jq >/dev/null || { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq >/dev/null; }
TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1

# Redes permitidas: padrão = só o próprio servidor; se a VPN FortiClient estiver configurada, inclui as redes dela
REDES_VPN=""; [ -r /etc/prefichas/vpn-forticlient.env ] && REDES_VPN="$(. /etc/prefichas/vpn-forticlient.env; echo "${VPN_REDES:-}")"
ESCUTAR="${ESCUTAR:-$([ -n "$REDES_VPN" ] && echo 0.0.0.0 || echo 127.0.0.1)}"
REDES_PERMITIDAS="${REDES_PERMITIDAS:-127.0.0.1/32${REDES_VPN:+,$REDES_VPN}}"
PORTA="${PORTA:-9090}"
[[ "$ESCUTAR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || erro "ESCUTAR inválido."
[[ "$PORTA" =~ ^[0-9]{4,5}$ ]] || erro "PORTA inválida."
[[ "$REDES_PERMITIDAS" =~ ^[0-9./,]+$ ]] || erro "REDES_PERMITIDAS inválido."
case ",$REDES_PERMITIDAS," in *,0.0.0.0/0,*) erro "0.0.0.0/0 abriria o painel para a internet. Informe só as redes da VPN.";; esac

# Pastas: pedidos (gravável pelo painel, usuário 1000 do container) e estado (só root escreve)
mkdir -p "$DADOS/dados" "$DADOS/pedidos" "$DADOS/estado/tarefas"
chown 1000:1000 "$DADOS/dados" "$DADOS/pedidos"; chmod 700 "$DADOS/dados"; chmod 755 "$DADOS/pedidos"
chown -R root:root "$DADOS/estado"; chmod 755 "$DADOS/estado" "$DADOS/estado/tarefas"
for d in "$DADOS" "$DADOS/pedidos" "$DADOS/estado"; do [ -L "$d" ] && erro "$d não pode ser atalho."; done

# Container do painel (rede do host: o firewall do servidor vale; escuta só em $ESCUTAR)
cat > "$DADOS/docker-compose.yml" <<YML
name: prefichas-gerenciador
services:
  painel:
    image: node:22-alpine
    container_name: prefichas-gerenciador
    restart: unless-stopped
    network_mode: host
    user: "1000:1000"
    read_only: true
    mem_limit: 256m
    working_dir: /app
    command: ["node", "servidor.mjs"]
    environment:
      ESCUTAR: "${ESCUTAR}"
      PORTA: "${PORTA}"
      REDES_PERMITIDAS: "${REDES_PERMITIDAS}"
    volumes:
      - ${CODIGO}/gerenciador:/app:ro
      - ./dados:/dados
      - ./pedidos:/pedidos
      - ./estado:/estado:ro
    logging:
      driver: local
      options: { max-size: "5m", max-file: "3" }
YML
(cd "$DADOS" && docker compose up -d >/dev/null)

# Executor (root): pedidos imediatos + coleta da situação a cada minuto
cat > /etc/systemd/system/prefichas-gerenciador-executor.service <<UNIT
[Unit]
Description=Executa os pedidos do painel central de pré-fichas

[Service]
Type=oneshot
ExecStart=${CODIGO}/scripts/gerenciador-executor.sh pedidos
Environment=GERENCIADOR_DADOS=${DADOS}
TimeoutStartSec=3600
UNIT
cat > /etc/systemd/system/prefichas-gerenciador-executor.path <<UNIT
[Unit]
Description=Aguarda pedidos do painel central

[Path]
PathExistsGlob=${DADOS}/pedidos/*.json
Unit=prefichas-gerenciador-executor.service

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/prefichas-gerenciador-coleta.service <<UNIT
[Unit]
Description=Publica a situação das instâncias para o painel central

[Service]
Type=oneshot
ExecStart=${CODIGO}/scripts/gerenciador-executor.sh coletar
Environment=GERENCIADOR_DADOS=${DADOS}
UNIT
cat > /etc/systemd/system/prefichas-gerenciador-coleta.timer <<UNIT
[Unit]
Description=Situação das instâncias a cada minuto

[Timer]
OnBootSec=30s
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now prefichas-gerenciador-executor.path prefichas-gerenciador-coleta.timer >/dev/null
GERENCIADOR_DADOS="$DADOS" "$CODIGO/scripts/gerenciador-executor.sh" coletar || true

# Firewall: a porta do painel só a partir das redes permitidas
if command -v ufw >/dev/null && [ "$ESCUTAR" != 127.0.0.1 ]; then
  IFS=',' read -ra L <<< "$REDES_PERMITIDAS"
  for r in "${L[@]}"; do [ "$r" = 127.0.0.1/32 ] || ufw allow from "$r" to any port "$PORTA" proto tcp >/dev/null; done
fi

# Primeiro usuário
if [ ! -s "$DADOS/dados/usuarios.json" ]; then
  [ -z "${ADMIN_EMAIL:-}" ] && [ "$TEM_TTY" = 1 ] && read -r -p "E-mail do primeiro usuário do painel central: " ADMIN_EMAIL </dev/tty
  if [ -n "${ADMIN_EMAIL:-}" ]; then
    docker run --rm -u 1000:1000 -e DADOS=/dados -v "$CODIGO/gerenciador:/app:ro" -v "$DADOS/dados:/dados" -w /app node:22-alpine node cli.mjs criar-usuario "$ADMIN_EMAIL"
  fi
fi

echo
echo "✓ Painel central instalado: http://${ESCUTAR/0.0.0.0/IP-DA-VM-NA-VPN}:${PORTA}"
echo "  Redes permitidas: ${REDES_PERMITIDAS}"
[ "$ESCUTAR" = 127.0.0.1 ] && echo "  Acesso: túnel SSH  →  ssh -L ${PORTA}:127.0.0.1:${PORTA} usuario@servidor  e abra http://localhost:${PORTA}"
echo "  Usuários: docker run --rm -u 1000:1000 -e DADOS=/dados -v $CODIGO/gerenciador:/app:ro -v $DADOS/dados:/dados -w /app node:22-alpine node cli.mjs listar"
