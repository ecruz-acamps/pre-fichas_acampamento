#!/usr/bin/env bash
# FortiClient VPN (Fortinet) no servidor REMOTO: o servidor conecta no túnel do FortiGate da
# sua empresa e você acessa o servidor pela VPN — depois dá para fechar a porta 22 para a internet.
#
#   sudo ./scripts/vpn-fortinet.sh configurar   # instala o FortiClient, cria o perfil e conecta
#   sudo ./scripts/vpn-fortinet.sh status       # situação do túnel
#   sudo ./scripts/vpn-fortinet.sh fechar-ssh   # SSH (22) só a partir das redes da VPN (confere antes)
#   sudo ./scripts/vpn-fortinet.sh abrir-ssh    # desfaz o fechar-ssh (emergência)
#   sudo ./scripts/vpn-fortinet.sh remover      # desconecta, apaga o perfil e o vigia
#
# Instala o FortiClient pelo repositório OFICIAL da Fortinet (repo.fortinet.com), conferindo a
# impressão digital da chave de assinatura. O perfil (IPsec, gateway, PSK…) é preenchido no
# assistente do próprio FortiClient (`forticlient vpn edit`). Um vigia (systemd) reconecta se cair.
#
# Variáveis: FORTICLIENT_VERSAO (7.4 padrão), VPN_PERFIL (prefichas), VPN_USUARIO,
#            VPN_REDES (redes internas da empresa, ex.: 192.168.10.0/24,10.0.0.0/8).
# Plano B, se o FortiClient não fizer o túnel IPsec sem tela: scripts/vpn-ipsec-strongswan.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSAO="${FORTICLIENT_VERSAO:-7.4}"
PERFIL="${VPN_PERFIL:-prefichas}"
ESTADO=/etc/prefichas/vpn-forticlient.env
CHAVE_OFICIAL=264E114C6911D08D3BA6CE6C18AC26395E54716D   # repo.fortinet.com (DEB)
VIGIA=prefichas-vpn-vigia

erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { local v="${!1:-}"; if [ -z "$v" ] && [ "$TEM_TTY" = 1 ]; then read -r -p "$2${3:+ [$3]}: " v </dev/tty; fi; printf -v "$1" '%s' "${v:-${3:-}}"; }
rede_valida() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]]; }
# Configuração salva (no "configurar" vale o que for digitado agora)
[ "${1:-configurar}" != configurar ] && [ -r "$ESTADO" ] && . "$ESTADO"

# O túnel está de pé se a rota para a rede interna da empresa NÃO sai pela interface padrão
tunel_ativo() {
  [ -n "${VPN_REDES:-}" ] || return 1
  local alvo padrao via
  alvo="$(printf '%s' "${VPN_REDES%%,*}" | cut -d/ -f1 | awk -F. '{print $1"."$2"."$3"."($4+1)}')"
  padrao="$(ip route show default 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  via="$(ip route get "$alvo" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}')"
  [ -n "$via" ] && [ "$via" != "$padrao" ] && return 0
  # IPsec por política (sem interface própria): confere a política do kernel
  ip xfrm policy 2>/dev/null | grep -q "dst ${VPN_REDES%%,*}"
}

case "${1:-configurar}" in
configurar)
  echo "FortiClient VPN — o servidor vai conectar no túnel do FortiGate da sua empresa."
  echo "Tenha em mãos os dados que o analista passou (gateway, IPsec/PSK, usuário…)."
  echo
  perguntar VPN_REDES "Redes internas da empresa que passam pela VPN (ex.: 192.168.10.0/24,10.0.0.0/8)"
  VPN_REDES="$(printf '%s' "$VPN_REDES" | tr -d ' ')"
  [ -n "$VPN_REDES" ] || erro "Informe as redes internas (usadas para conferir o túnel e fechar a 22)."
  IFS=',' read -ra LISTA <<< "$VPN_REDES"
  for r in "${LISTA[@]}"; do
    rede_valida "$r" || erro "Rede inválida: $r"
    [ "$r" != 0.0.0.0/0 ] || erro "0.0.0.0/0 (todo o tráfego pela VPN) derrubaria o site. Peça split tunnel ao analista."
  done
  perguntar VPN_USUARIO "Usuário da VPN (ENTER se o túnel não usa usuário)" ""
  [ -z "$VPN_USUARIO" ] || [[ "$VPN_USUARIO" =~ ^[A-Za-z0-9@._\\-]{1,128}$ ]] || erro "Usuário inválido."

  # 1) Instalar pelo repositório oficial, conferindo a chave de assinatura
  if ! command -v forticlient >/dev/null; then
    command -v apt-get >/dev/null || erro "Este instalador é para Ubuntu/Debian."
    ARQ=amd64; [ "$(dpkg --print-architecture)" = arm64 ] && ARQ=arm64
    echo "→ Baixando a chave da Fortinet…"
    TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
    curl -fsSL "https://repo.fortinet.com/repo/forticlient/${VERSAO}/ubuntu/DEB-GPG-KEY" -o "$TMP"
    IMPRESSAO="$(gpg --show-keys --with-colons "$TMP" 2>/dev/null | awk -F: '$1=="fpr"{print $10; exit}')"
    [ "$IMPRESSAO" = "$CHAVE_OFICIAL" ] || erro "A chave baixada não é a oficial da Fortinet (recebida: ${IMPRESSAO:-nenhuma}). Instalação cancelada."
    gpg --dearmor < "$TMP" > /usr/share/keyrings/repo.fortinet.com.gpg
    echo "deb [arch=${ARQ} signed-by=/usr/share/keyrings/repo.fortinet.com.gpg] https://repo.fortinet.com/repo/forticlient/${VERSAO}/ubuntu/ stable non-free" \
      > /etc/apt/sources.list.d/repo.fortinet.com.list
    echo "→ Instalando o FortiClient ${VERSAO}…"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq forticlient >/dev/null
  fi
  command -v forticlient >/dev/null || erro "FortiClient não foi instalado."

  [ "$TEM_TTY" = 1 ] || erro "A criação do perfil é feita no assistente do FortiClient: rode este comando num terminal."

  # 2) Perfil: assistente do próprio FortiClient (tipo IPsec, gateway, PSK, IKE…)
  echo
  echo "→ Abrindo o assistente do FortiClient para o perfil \"$PERFIL\"."
  echo "  Escolha o tipo IPsec e preencha conforme o analista: gateway, autenticação (PSK),"
  echo "  versão do IKE e, se houver, usuário. NÃO marque 'todo o tráfego pela VPN'."
  forticlient vpn edit "$PERFIL" </dev/tty

  # 3) Conectar: senha salva, sempre ativo e reconexão automática
  echo
  echo "→ Conectando (digite a senha da VPN se for pedida)…"
  CONECTAR=(forticlient vpn connect "$PERFIL" --save-password --always-up)
  [ -n "$VPN_USUARIO" ] && CONECTAR+=(--user="$VPN_USUARIO" --password)
  "${CONECTAR[@]}" </dev/tty || true

  mkdir -p /etc/prefichas && chmod 700 /etc/prefichas
  ( umask 077; printf 'VPN_PERFIL=%q\nVPN_REDES=%q\nVPN_USUARIO=%q\n' "$PERFIL" "$VPN_REDES" "$VPN_USUARIO" > "$ESTADO" )

  # 4) Vigia: a cada 2 minutos, se o túnel caiu, reconecta com a senha salva
  cat > "/etc/systemd/system/${VIGIA}.service" <<UNIT
[Unit]
Description=Reconecta a VPN FortiClient do servidor de pré-fichas, se cair

[Service]
Type=oneshot
ExecStart=$(pwd)/scripts/vpn-fortinet.sh vigiar
TimeoutStartSec=120
UNIT
  cat > "/etc/systemd/system/${VIGIA}.timer" <<UNIT
[Unit]
Description=Confere a VPN FortiClient a cada 2 minutos

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now "${VIGIA}.timer" >/dev/null

  echo -n "→ Conferindo o túnel"
  for _ in $(seq 1 20); do tunel_ativo && break; echo -n "."; sleep 3; done; echo
  if tunel_ativo; then
    echo "✓ VPN conectada (a rede ${VPN_REDES%%,*} passa pelo túnel)."
    forticlient vpn status 2>/dev/null | sed 's/^/  /' || true
    echo "  Descubra o IP do servidor na VPN com o analista (ou em 'ip -4 addr') e teste o SSH a partir da empresa."
    echo "  Depois de testar: sudo ./scripts/vpn-fortinet.sh fechar-ssh"
  else
    echo "✗ Não consegui confirmar o túnel. Veja: forticlient vpn status"
    echo "  Se o FortiClient não fizer o túnel IPsec neste servidor, use o plano B:"
    echo "  sudo ./scripts/vpn-ipsec-strongswan.sh configurar"
    exit 1
  fi
  ;;
vigiar)
  # Chamado pelo systemd: reconecta se o túnel caiu (usa a senha salva no FortiClient)
  tunel_ativo && exit 0
  logger -t prefichas-vpn "Túnel FortiClient fora do ar: reconectando o perfil ${VPN_PERFIL:-$PERFIL}"
  timeout 90 forticlient vpn connect "${VPN_PERFIL:-$PERFIL}" --always-up </dev/null >/dev/null 2>&1 || true
  ;;
status)
  forticlient vpn status 2>/dev/null || echo "FortiClient não instalado ou sem perfil."
  if tunel_ativo; then echo "Túnel: ativo (rede ${VPN_REDES%%,*} pela VPN)"; else echo "Túnel: inativo"; fi
  systemctl is-active "${VIGIA}.timer" >/dev/null 2>&1 && echo "Vigia de reconexão: ligado" || echo "Vigia de reconexão: desligado"
  command -v ufw >/dev/null && ufw status | grep -E '(^| )22(/tcp)?( |$)' || true
  ;;
fechar-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado (apt-get install ufw)."
  tunel_ativo || erro "A VPN não está conectada: não vou fechar o SSH (você ficaria sem acesso)."
  if [ "$TEM_TTY" = 1 ]; then
    echo "Você já testou o SSH a partir da rede da empresa, pela VPN, e funcionou?"
    read -r -p "Digite FECHAR para continuar: " ok </dev/tty
    [ "$ok" = FECHAR ] || erro "Cancelado."
  fi
  IFS=',' read -ra LISTA <<< "$VPN_REDES"
  for r in "${LISTA[@]}"; do rede_valida "$r" && ufw allow from "$r" to any port 22 proto tcp >/dev/null; done
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  for regra in 22 22/tcp OpenSSH; do ufw --force delete allow "$regra" >/dev/null 2>&1 || true; done
  ufw default deny incoming >/dev/null
  ufw --force enable >/dev/null
  echo "✓ SSH (22) agora só a partir das redes da VPN (${VPN_REDES}). Site (80/443) aberto."
  echo "  Peça também ao analista para bloquear a 22 no NAT 1:1."
  echo "  Emergência: console da VM → sudo ./scripts/vpn-fortinet.sh abrir-ssh"
  ;;
abrir-ssh)
  command -v ufw >/dev/null || erro "ufw não instalado."
  ufw allow 22/tcp >/dev/null && echo "✓ SSH (22) liberado de novo para qualquer origem."
  ;;
remover)
  systemctl disable --now "${VIGIA}.timer" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${VIGIA}.service" "/etc/systemd/system/${VIGIA}.timer"; systemctl daemon-reload
  forticlient vpn disconnect >/dev/null 2>&1 || true
  forticlient vpn remove "${VPN_PERFIL:-$PERFIL}" >/dev/null 2>&1 || true
  rm -f "$ESTADO"
  echo "✓ VPN removida (o pacote forticlient continua instalado: apt remove forticlient para tirar)."
  echo "  Se tinha fechado o SSH, confira: sudo ufw status"
  ;;
*) sed -n '2,18p' "$0"; exit 1 ;;
esac
