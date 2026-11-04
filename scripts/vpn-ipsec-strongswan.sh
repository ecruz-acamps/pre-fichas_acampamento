#!/usr/bin/env bash
# (Plano B: use este script só se o FortiClient — scripts/vpn-fortinet.sh — não funcionar.)
# VPN IPsec com o FortiGate para acessar um servidor REMOTO pela rede da sua empresa.
# O servidor conecta sozinho no túnel IPsec (e reconecta se cair); você acessa o servidor
# pelo IP que ele recebe no túnel — e pode fechar a porta 22 para a internet.
#
# Usa o strongSwan (cliente IPsec padrão do Linux, compatível com o FortiGate), como serviço.
#
#   sudo ./scripts/vpn-ipsec-strongswan.sh configurar   # pergunta os dados e liga o túnel
#   sudo ./scripts/vpn-ipsec-strongswan.sh status       # situação do túnel e IP do servidor na VPN
#   sudo ./scripts/vpn-ipsec-strongswan.sh fechar-ssh   # SSH (22) só pela rede interna da VPN (confere antes)
#   sudo ./scripts/vpn-ipsec-strongswan.sh abrir-ssh    # desfaz o fechar-ssh (emergência)
#   sudo ./scripts/vpn-ipsec-strongswan.sh remover      # desliga e apaga a configuração
#
# Sem perguntas (variáveis de ambiente):
#   VPN_HOST      endereço do FortiGate (IP ou nome)
#   VPN_IKE       2 (padrão) ou 1
#   VPN_PSK       chave pré-compartilhada (pre-shared key)
#   VPN_REDES     redes internas que passam pelo túnel, separadas por vírgula (ex.: 10.0.0.0/8,192.168.10.0/24)
#   VPN_USUARIO   (opcional) usuário: XAuth no IKEv1 ou EAP no IKEv2
#   VPN_SENHA     (opcional) senha desse usuário
#   VPN_ID        (opcional) identificação local/peer ID que o FortiGate espera
#   VPN_IKE_PROP  (opcional) proposta da fase 1 (padrão aes256-sha256-modp2048)
#   VPN_ESP_PROP  (opcional) proposta da fase 2 (padrão aes256-sha256)
#
# Segurança:
#  - chave e senha ficam só em /etc/swanctl/conf.d/prefichas.conf (root, 600), em base64;
#  - só as redes informadas passam pelo túnel (o site público continua saindo pela internet);
#  - o DNS do servidor não é alterado.
set -euo pipefail
cd "$(dirname "$0")/.."
CONF=/etc/swanctl/conf.d/prefichas.conf
REDES_ARQ=/etc/swanctl/conf.d/prefichas.redes
SEM_DNS=/etc/strongswan.d/prefichas-sem-dns.conf
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
b64() { printf '%s' "$1" | base64 -w0; }
servico() { systemctl list-unit-files 2>/dev/null | grep -qE '^strongswan\.service' && echo strongswan || echo strongswan-swanctl; }
estabelecido() { swanctl --list-sas --ike prefichas 2>/dev/null | grep -q ESTABLISHED; }
ip_vpn() { swanctl --list-sas --ike prefichas 2>/dev/null | grep -m1 -oE 'local .*\[[0-9.]+\]$' | grep -oE '[0-9.]+\]$' | tr -d ']' || true; }
rede_valida() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]]; }

case "$ACAO" in
configurar)
  echo "VPN IPsec com o FortiGate — o servidor vai conectar no túnel da sua empresa."
  echo "Peça ao analista os dados da fase 1/fase 2 (veja o manual, seção 11d)."
  echo
  perguntar VPN_HOST "Endereço do FortiGate (IP ou nome)"
  perguntar VPN_IKE "Versão do IKE (2 ou 1)" 2
  perguntar VPN_PSK "Chave pré-compartilhada (PSK)" "" oculto
  perguntar VPN_REDES "Redes internas pelo túnel (ex.: 192.168.10.0/24,10.0.0.0/8)"
  perguntar VPN_USUARIO "Usuário (XAuth/EAP) — ENTER se não houver" ""
  [ -n "$VPN_USUARIO" ] && perguntar VPN_SENHA "Senha desse usuário" "" oculto
  perguntar VPN_ID "Identificação local / peer ID — ENTER se não houver" ""
  VPN_IKE_PROP="${VPN_IKE_PROP:-aes256-sha256-modp2048}"
  VPN_ESP_PROP="${VPN_ESP_PROP:-aes256-sha256}"

  [[ "$VPN_HOST" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || erro "Endereço inválido."
  [[ "$VPN_IKE" =~ ^[12]$ ]] || erro "Versão do IKE deve ser 1 ou 2."
  [ -n "$VPN_PSK" ] || erro "Informe a chave pré-compartilhada."
  [[ "$VPN_IKE_PROP$VPN_ESP_PROP" =~ ^[a-z0-9_,-]+$ ]] || erro "Proposta inválida."
  [ -z "$VPN_ID" ] || [[ "$VPN_ID" =~ ^[A-Za-z0-9@._:-]{1,128}$ ]] || erro "Identificação inválida."
  [ -z "$VPN_USUARIO" ] || [[ "$VPN_USUARIO" =~ ^[A-Za-z0-9@._\\-]{1,128}$ ]] || erro "Usuário inválido."
  [ -z "$VPN_USUARIO" ] || [ -n "${VPN_SENHA:-}" ] || erro "Informe a senha do usuário."
  REDES="$(printf '%s' "$VPN_REDES" | tr -d ' ')"
  [ -n "$REDES" ] || erro "Informe as redes internas (split tunnel)."
  IFS=',' read -ra LISTA <<< "$REDES"
  for r in "${LISTA[@]}"; do
    rede_valida "$r" || erro "Rede inválida: $r (use o formato 192.168.10.0/24)."
    [ "$r" != "0.0.0.0/0" ] || erro "0.0.0.0/0 mandaria todo o tráfego pelo túnel e derrubaria o site. Informe só as redes internas."
  done

  if ! command -v swanctl >/dev/null; then
    command -v apt-get >/dev/null || erro "Instale o strongSwan (swanctl) pelo gerenciador de pacotes e rode de novo."
    echo "→ Instalando o strongSwan…"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq strongswan-swanctl charon-systemd libcharon-extra-plugins >/dev/null
  fi

  # Autenticação local: PSK (+ XAuth no IKEv1 ou EAP no IKEv2, se houver usuário)
  ID_LINHA=""; [ -n "$VPN_ID" ] && ID_LINHA="id = ${VPN_ID}"
  if [ -z "$VPN_USUARIO" ]; then
    LOCAL="local-1 { auth = psk
        ${ID_LINHA} }"
  elif [ "$VPN_IKE" = 1 ]; then
    LOCAL="local-1 { auth = psk
        ${ID_LINHA} }
      local-2 { auth = xauth
        xauth_id = ${VPN_USUARIO} }"
  else
    LOCAL="local-1 { auth = eap-mschapv2
        eap_id = ${VPN_USUARIO}
        ${ID_LINHA} }"
  fi
  SEGREDO_USUARIO=""
  if [ -n "$VPN_USUARIO" ]; then
    TIPO=$([ "$VPN_IKE" = 1 ] && echo xauth || echo eap)
    SEGREDO_USUARIO="${TIPO}-prefichas { id = ${VPN_USUARIO}
    secret = 0s$(b64 "$VPN_SENHA") }"
  fi

  mkdir -p /etc/swanctl/conf.d
  ( umask 077
    cat > "$CONF" <<CFG
# Gerado por scripts/vpn-ipsec-strongswan.sh — contém a chave da VPN (somente root)
connections {
  prefichas {
    version = ${VPN_IKE}
    remote_addrs = ${VPN_HOST}
    vips = 0.0.0.0
    proposals = ${VPN_IKE_PROP},default
    $( [ "$VPN_IKE" = 1 ] && echo "aggressive = yes" )
    dpd_delay = 30s
    keyingtries = 0
    ${LOCAL}
    remote-1 { auth = psk }
    children {
      prefichas {
        remote_ts = ${REDES}
        esp_proposals = ${VPN_ESP_PROP},default
        start_action = start
        dpd_action = restart
        close_action = start
      }
    }
  }
}
secrets {
  ike-prefichas { secret = 0s$(b64 "$VPN_PSK") }
  ${SEGREDO_USUARIO}
}
CFG
    printf '%s\n' "$REDES" > "$REDES_ARQ"
  )
  # Não deixar o túnel trocar o DNS do servidor
  mkdir -p /etc/strongswan.d
  printf 'charon-systemd {\n  plugins {\n    resolve {\n      load = no\n    }\n  }\n}\n' > "$SEM_DNS"

  SVC="$(servico)"
  systemctl enable "$SVC" >/dev/null 2>&1 || true
  systemctl restart "$SVC"
  sleep 2
  swanctl --load-all >/dev/null
  echo -n "→ Conectando"
  for _ in $(seq 1 30); do estabelecido && break; echo -n "."; sleep 2; done; echo
  if estabelecido; then
    echo "✓ Túnel IPsec conectado."
    [ -n "$(ip_vpn)" ] && echo "  IP do servidor na VPN: $(ip_vpn)"
    echo "  Teste a partir da rede da empresa: ssh SEU_USUARIO@$(ip_vpn || echo IP_NA_VPN)"
    echo "  Depois de testar, feche a porta 22 da internet: sudo ./scripts/vpn-ipsec-strongswan.sh fechar-ssh"
  else
    echo "✗ O túnel não conectou. Veja o motivo: journalctl -u ${SVC} -n 80"
    echo "  Confira com o analista: versão do IKE, PSK, propostas (fase 1/2), peer ID, redes e se a"
    echo "  saída UDP 500/4500 está liberada no firewall do local do servidor."
    exit 1
  fi
  ;;
status)
  swanctl --list-sas --ike prefichas 2>/dev/null || echo "Túnel: desconectado"
  [ -n "$(ip_vpn)" ] && echo "IP do servidor na VPN: $(ip_vpn)"
  command -v ufw >/dev/null && ufw status | grep -E '(^| )22(/tcp)?( |$)' || true
  ;;
fechar-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado (apt-get install ufw)."
  estabelecido || erro "O túnel não está conectado: não vou fechar o SSH (você ficaria sem acesso)."
  [ -s "$REDES_ARQ" ] || erro "Redes da VPN não encontradas. Rode 'configurar' de novo."
  if [ "$TEM_TTY" = 1 ]; then
    echo "Você já testou o SSH pelo túnel (ssh SEU_USUARIO@$(ip_vpn || echo IP_NA_VPN)) e funcionou?"
    read -r -p "Digite FECHAR para continuar: " ok </dev/tty
    [ "$ok" = FECHAR ] || erro "Cancelado."
  fi
  IFS=',' read -ra LISTA < "$REDES_ARQ"
  for r in "${LISTA[@]}"; do rede_valida "$r" && ufw allow from "$r" to any port 22 proto tcp >/dev/null; done
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  for regra in 22 22/tcp OpenSSH; do ufw --force delete allow "$regra" >/dev/null 2>&1 || true; done
  ufw default deny incoming >/dev/null
  ufw --force enable >/dev/null
  echo "✓ SSH (22) agora só a partir das redes da VPN ($(tr -d '\n' < "$REDES_ARQ")). Site (80/443) aberto."
  echo "  Peça também ao analista para bloquear a 22 no NAT 1:1."
  echo "  Emergência: console da VM → sudo ./scripts/vpn-ipsec-strongswan.sh abrir-ssh"
  ;;
abrir-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado."
  ufw allow 22/tcp >/dev/null && echo "✓ SSH (22) liberado de novo para qualquer origem."
  ;;
remover)
  swanctl --terminate --ike prefichas >/dev/null 2>&1 || true
  rm -f "$CONF" "$REDES_ARQ" "$SEM_DNS"
  swanctl --load-all >/dev/null 2>&1 || true
  echo "✓ VPN removida. Se tinha fechado o SSH, confira: sudo ufw status"
  ;;
*) sed -n '2,25p' "$0"; exit 1 ;;
esac
