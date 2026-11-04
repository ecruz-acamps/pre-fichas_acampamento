#!/usr/bin/env bash
# VPN Fortinet (FortiGate SSL-VPN) para acessar um servidor REMOTO pela sua rede.
# O servidor conecta sozinho na VPN da sua empresa (e reconecta se cair); você acessa
# o servidor pelo IP que ele recebe na VPN — e pode fechar a porta 22 para a internet.
#
# Usa o openfortivpn (cliente de código aberto compatível com o SSL-VPN do FortiGate,
# feito para servidor: sem tela, serviço do systemd, reconexão automática).
#
#   sudo ./scripts/vpn-fortinet.sh configurar        # pergunta os dados e liga a VPN
#   sudo ./scripts/vpn-fortinet.sh status            # situação do túnel e IP na VPN
#   sudo ./scripts/vpn-fortinet.sh fechar-ssh        # SSH (22) só pela VPN (confere antes)
#   sudo ./scripts/vpn-fortinet.sh abrir-ssh         # desfaz o fechar-ssh
#   sudo ./scripts/vpn-fortinet.sh remover           # desliga e apaga a configuração
#
# Sem perguntas: VPN_HOST, VPN_PORTA (443), VPN_USUARIO, VPN_SENHA, VPN_CERT (opcional).
#
# Segurança:
#  - a senha fica só em /etc/openfortivpn/prefichas.conf (dono root, permissão 600);
#  - o certificado do FortiGate é FIXADO (trusted-cert): outro servidor fingindo ser a VPN é recusado;
#  - o DNS do servidor não é alterado e as rotas são só as que o FortiGate enviar (use split tunnel
#    no FortiGate: se ele mandar "todo o tráfego pela VPN", o site público pode parar de responder).
set -euo pipefail
cd "$(dirname "$0")/.."
CONF=/etc/openfortivpn/prefichas.conf
UNIDADE=prefichas-vpn
ACAO="${1:-configurar}"

erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { # variável, pergunta, padrão, oculto
  local v="${!1:-}"
  if [ -z "$v" ] && [ "$TEM_TTY" = 1 ]; then
    if [ "${4:-}" = oculto ]; then read -r -s -p "$2: " v </dev/tty; echo
    else read -r -p "$2${3:+ [$3]}: " v </dev/tty; fi
  fi
  printf -v "$1" '%s' "${v:-${3:-}}"
}
ip_vpn() { ip -4 -o addr show dev ppp0 2>/dev/null | awk '{print $4}' | cut -d/ -f1; }

case "$ACAO" in
configurar)
  echo "VPN Fortinet (SSL-VPN) — o servidor vai conectar na VPN da sua empresa."
  echo "Peça ao analista: endereço e porta do SSL-VPN, um usuário de serviço SEM token/2FA"
  echo "(o servidor conecta sozinho) e, de preferência, split tunnel (só a rede interna pela VPN)."
  echo
  perguntar VPN_HOST "Endereço da VPN (ex.: vpn.suaempresa.com.br)"
  perguntar VPN_PORTA "Porta" 443
  perguntar VPN_USUARIO "Usuário da VPN"
  perguntar VPN_SENHA "Senha da VPN" "" oculto
  [[ "$VPN_HOST" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || erro "Endereço inválido."
  [[ "$VPN_PORTA" =~ ^[0-9]{1,5}$ ]] || erro "Porta inválida."
  [ -n "$VPN_USUARIO" ] && [ -n "$VPN_SENHA" ] || erro "Informe usuário e senha."
  case "$VPN_USUARIO$VPN_SENHA" in *$'\n'*) erro "Usuário/senha não podem ter quebra de linha.";; esac

  if ! command -v openfortivpn >/dev/null; then
    command -v apt-get >/dev/null || erro "Instale o openfortivpn pelo gerenciador de pacotes e rode de novo."
    echo "→ Instalando o openfortivpn…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openfortivpn ppp >/dev/null
  fi

  # Certificado do FortiGate: mostra a "impressão digital" para conferir com o analista e fixa
  if [ -z "${VPN_CERT:-}" ]; then
    VPN_CERT="$(echo | timeout 15 openssl s_client -connect "${VPN_HOST}:${VPN_PORTA}" -servername "$VPN_HOST" 2>/dev/null \
      | openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
    [ -n "$VPN_CERT" ] || erro "Não consegui falar com ${VPN_HOST}:${VPN_PORTA} (firewall de saída liberado?)."
    echo "Impressão digital (SHA-256) do certificado da VPN:"
    echo "  $VPN_CERT"
    if [ "$TEM_TTY" = 1 ]; then
      read -r -p "Confere com a informada pelo analista? [s/N]: " ok </dev/tty
      case "$ok" in [sS]*) ;; *) erro "Cancelado: confirme a impressão digital com o analista.";; esac
    fi
  fi
  [[ "$VPN_CERT" =~ ^[0-9a-f]{64}$ ]] || erro "Impressão digital do certificado inválida."

  mkdir -p /etc/openfortivpn && chmod 700 /etc/openfortivpn
  ( umask 077; cat > "$CONF" <<CFG
# Gerado por scripts/vpn-fortinet.sh — contém a senha da VPN (somente root)
host = ${VPN_HOST}
port = ${VPN_PORTA}
username = ${VPN_USUARIO}
password = ${VPN_SENHA}
trusted-cert = ${VPN_CERT}
# Não mexer no DNS do servidor (o site continua usando o DNS normal)
set-dns = 0
pppd-use-peerdns = 0
# Rotas: só as enviadas pelo FortiGate (configure split tunnel lá)
set-routes = 1
CFG
  )

  cat > "/etc/systemd/system/${UNIDADE}.service" <<UNIT
[Unit]
Description=VPN Fortinet do servidor de pré-fichas (acesso remoto)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v openfortivpn) -c ${CONF}
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "${UNIDADE}.service" >/dev/null
  echo -n "→ Conectando"
  for _ in $(seq 1 30); do [ -n "$(ip_vpn)" ] && break; echo -n "."; sleep 2; done; echo
  if [ -n "$(ip_vpn)" ]; then
    echo "✓ VPN conectada. IP do servidor na VPN: $(ip_vpn)"
    echo "  Teste do seu computador (conectado à VPN): ssh SEU_USUARIO@$(ip_vpn)"
    echo "  Depois de testar, feche a porta 22 da internet: sudo ./scripts/vpn-fortinet.sh fechar-ssh"
    # O site precisa continuar saindo pela internet normal
    if ip route show default | grep -q ppp0; then
      echo "⚠ A VPN virou a rota padrão (o FortiGate mandou 'todo o tráfego pela VPN')."
      echo "  Peça split tunnel ao analista, senão o site público pode parar de responder."
    fi
  else
    echo "✗ A VPN não conectou. Veja o motivo: journalctl -u ${UNIDADE} -n 50"
    echo "  (usuário/senha, token 2FA exigido, porta bloqueada na saída ou SSL-VPN desativado no FortiGate)"
    exit 1
  fi
  ;;
status)
  systemctl is-active "${UNIDADE}" >/dev/null 2>&1 && echo "Serviço: ativo" || echo "Serviço: parado"
  [ -n "$(ip_vpn)" ] && echo "IP na VPN: $(ip_vpn)" || echo "Túnel: desconectado"
  command -v ufw >/dev/null && ufw status | grep -E '(^| )22(/tcp)?( |$)' || true
  ;;
fechar-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado (apt-get install ufw)."
  [ -n "$(ip_vpn)" ] || erro "A VPN não está conectada: não vou fechar o SSH (você ficaria sem acesso)."
  if [ "$TEM_TTY" = 1 ]; then
    echo "Você já testou 'ssh SEU_USUARIO@$(ip_vpn)' estando conectado à VPN e funcionou?"
    read -r -p "Digite FECHAR para continuar: " ok </dev/tty
    [ "$ok" = FECHAR ] || erro "Cancelado."
  fi
  ufw allow in on ppp0 to any port 22 proto tcp >/dev/null
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  # remove liberações gerais da 22 (de qualquer origem)
  for regra in 22 22/tcp OpenSSH; do ufw --force delete allow "$regra" >/dev/null 2>&1 || true; done
  ufw default deny incoming >/dev/null
  ufw --force enable >/dev/null
  echo "✓ SSH (22) agora só pela VPN (interface ppp0). Site (80/443) continua aberto."
  echo "  Peça também ao analista para bloquear a 22 no NAT 1:1."
  echo "  Emergência: use o console da VM e rode: sudo ./scripts/vpn-fortinet.sh abrir-ssh"
  ;;
abrir-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado."
  ufw allow 22/tcp >/dev/null && echo "✓ SSH (22) liberado de novo para qualquer origem."
  ;;
remover)
  systemctl disable --now "${UNIDADE}.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${UNIDADE}.service" "$CONF"
  systemctl daemon-reload
  echo "✓ VPN removida. Se tinha fechado o SSH, confira: sudo ufw status"
  ;;
*) sed -n '2,20p' "$0"; exit 1 ;;
esac
