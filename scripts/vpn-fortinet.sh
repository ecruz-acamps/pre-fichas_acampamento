#!/usr/bin/env bash
# FortiClient VPN (Fortinet) no servidor REMOTO: o servidor conecta no túnel do FortiGate da
# sua empresa e você acessa o servidor pela VPN — depois dá para fechar a porta 22 para a internet.
#
#   sudo ./scripts/vpn-fortinet.sh configurar   # instala o FortiClient, cria o perfil e conecta
#   sudo ./scripts/vpn-fortinet.sh status       # situação do túnel
#   sudo ./scripts/vpn-fortinet.sh fechar-ssh   # SSH (22) só a partir das redes da VPN (confere antes)
#   sudo ./scripts/vpn-fortinet.sh abrir-ssh    # desfaz o fechar-ssh (emergência)
#   sudo ./scripts/vpn-fortinet.sh remover      # desconecta, apaga o perfil e o vigia
#   ./scripts/vpn-fortinet.sh registrar         # (painel) grava perfil/redes/usuário de um perfil já criado e liga o vigia
#
# Instala o FortiClient pelo repositório OFICIAL da Fortinet (repo.fortinet.com), conferindo a
# impressão digital da chave de assinatura. O perfil (IPsec, gateway, PSK…) é preenchido no
# assistente do próprio FortiClient (`forticlient vpn edit`). Um vigia (systemd) reconecta se cair.
#
# Variáveis: FORTICLIENT_VERSAO (7.4 padrão), VPN_PERFIL (prefichas), VPN_USUARIO,
#            VPN_REDES (redes internas da empresa, ex.: 192.168.10.0/24,10.0.0.0/8).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSAO="${FORTICLIENT_VERSAO:-7.4}"   # linha 7.4: a mesma do FortiOS 7.4.x do FortiGate (ex.: 7.4.13)
PERFIL="${VPN_PERFIL:-prefichas}"
ETC_PF="${PREFICHAS_ETC:-/etc/prefichas}"
ESTADO="$ETC_PF/vpn-forticlient.env"
UNIDADES="${PREFICHAS_SYSTEMD:-/etc/systemd/system}"   # os testes usam outra pasta
CHAVE_OFICIAL=264E114C6911D08D3BA6CE6C18AC26395E54716D   # repo.fortinet.com (DEB)
VIGIA=prefichas-vpn-vigia

erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { local v="${!1:-}"; if [ -z "$v" ] && [ "$TEM_TTY" = 1 ]; then read -r -p "$2${3:+ [$3]}: " v </dev/tty; fi; printf -v "$1" '%s' "${v:-${3:-}}"; }
rede_valida() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]]; }
# Configuração salva (no "configurar" e no "registrar" vale o que for informado agora)
case "${1:-configurar}" in configurar|registrar) ;; *) [ -r "$ESTADO" ] && . "$ESTADO" ;; esac

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
# IP deste servidor dentro da VPN: o endereço de origem da rota para a rede interna (vazio se o túnel está fora)
ip_na_vpn() {
  [ -n "${VPN_REDES:-}" ] && tunel_ativo || return 0
  local alvo; alvo="$(printf '%s' "${VPN_REDES%%,*}" | cut -d/ -f1 | awk -F. '{print $1"."$2"."$3"."($4+1)}')"
  ip route get "$alvo" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}'
}
validar_redes() {
  VPN_REDES="$(printf '%s' "$VPN_REDES" | tr -d ' ')"
  [ -n "$VPN_REDES" ] || erro "Informe as redes internas (usadas para conferir o túnel e fechar a 22)."
  local r; IFS=',' read -ra LISTA <<< "$VPN_REDES"
  for r in "${LISTA[@]}"; do
    rede_valida "$r" || erro "Rede inválida: $r"
    [ "$r" != 0.0.0.0/0 ] || erro "0.0.0.0/0 (todo o tráfego pela VPN) derrubaria o site. Peça split tunnel ao analista."
  done
}
gravar_config() {
  mkdir -p "$ETC_PF" && chmod 700 "$ETC_PF"
  ( umask 077; printf 'VPN_PERFIL=%q\nVPN_REDES=%q\nVPN_USUARIO=%q\n' "$PERFIL" "$VPN_REDES" "$VPN_USUARIO" > "$ESTADO" )
}
instalar_vigia() { # a cada 2 minutos, se o túnel caiu, reconecta com a senha salva no FortiClient
  cat > "$UNIDADES/${VIGIA}.service" <<UNIT
[Unit]
Description=Reconecta a VPN FortiClient do servidor de pré-fichas, se cair

[Service]
Type=oneshot
ExecStart=$(pwd)/scripts/vpn-fortinet.sh vigiar
TimeoutStartSec=120
UNIT
  cat > "$UNIDADES/${VIGIA}.timer" <<UNIT
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
}

case "${1:-configurar}" in
configurar)
  echo "FortiClient VPN — o servidor vai conectar no túnel do FortiGate da sua empresa."
  echo "Tenha em mãos os dados que o analista passou (gateway, IPsec/PSK, usuário…)."
  echo
  perguntar VPN_REDES "Redes internas da empresa que passam pela VPN (ex.: 192.168.10.0/24,10.0.0.0/8)"
  validar_redes
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

  gravar_config

  # 4) Vigia: reconecta sozinho se cair
  instalar_vigia

  echo -n "→ Conferindo o túnel"
  for _ in $(seq 1 20); do tunel_ativo && break; echo -n "."; sleep 3; done; echo
  if tunel_ativo; then
    echo "✓ VPN conectada (a rede ${VPN_REDES%%,*} passa pelo túnel)."
    forticlient vpn status 2>/dev/null | sed 's/^/  /' || true
    echo "  Descubra o IP do servidor na VPN com o analista (ou em 'ip -4 addr') e teste o SSH a partir da empresa."
    echo "  Depois de testar: sudo ./scripts/vpn-fortinet.sh fechar-ssh"
  else
    echo "✗ Não consegui confirmar o túnel. Veja: forticlient vpn status"
    exit 1
  fi
  ;;
vigiar)
  # Chamado pelo systemd: reconecta se o túnel caiu (usa a senha salva no FortiClient)
  tunel_ativo && exit 0
  logger -t prefichas-vpn "Túnel FortiClient fora do ar: reconectando o perfil ${VPN_PERFIL:-$PERFIL}"
  timeout 90 forticlient vpn connect "${VPN_PERFIL:-$PERFIL}" --always-up </dev/null >/dev/null 2>&1 || true
  ;;
estado-json)
  # usado pelo painel central: situação e configuração em JSON (sem segredos: senha e PSK ficam só no FortiClient)
  inst=false; command -v forticlient >/dev/null 2>&1 && inst=true
  conf=false; [ -r "$ESTADO" ] && conf=true
  con=false; tunel_ativo && con=true
  vig=false; systemctl is-active "${VIGIA}.timer" >/dev/null 2>&1 && vig=true
  det=""; perfis=""
  if [ "$inst" = true ]; then
    det="$(timeout 10 forticlient vpn status 2>/dev/null | grep -viE 'pass|psk|secret|senha|key' | head -c 600 || true)"
    perfis="$(timeout 10 forticlient vpn list 2>/dev/null | grep -viE 'pass|psk|secret|senha|key' | head -c 600 || true)"
  fi
  versao=""; [ "$inst" = true ] && versao="$(dpkg-query -W -f='${Version}' forticlient 2>/dev/null || true)"
  jq -n --argjson i "$inst" --argjson c "$conf" --argjson k "$con" --argjson v "$vig" --arg r "${VPN_REDES:-}" --arg d "$det" --arg l "$perfis" \
    --arg perfil "${VPN_PERFIL:-$PERFIL}" --arg u "${VPN_USUARIO:-}" --arg ip "$(ip_na_vpn || true)" --arg ver "$versao" --arg linha "$VERSAO" \
    '{tipo:"forticlient", instalado:$i, configurada:$c, conectada:$k, vigia:$v, redes:($r|split(",")|map(select(length>0))), perfil:$perfil,
      usuario:$u, ip_na_vpn:$ip, detalhe:$d, perfis:$l, versao:$ver, linha_esperada:$linha,
      versao_ok:($ver == "" or ($ver | startswith($linha + ".")))}'
  ;;
registrar)
  # pelo painel central (sem terminal): o perfil já foi criado no FortiClient; aqui só se informa qual é,
  # as redes internas e o usuário, e o vigia de reconexão é ligado. VPN_PERFIL/VPN_REDES/VPN_USUARIO vêm do ambiente.
  command -v forticlient >/dev/null || erro "O FortiClient não está instalado neste servidor (rode no terminal: sudo ./scripts/vpn-fortinet.sh configurar)."
  PERFIL="${VPN_PERFIL:-prefichas}"
  [[ "$PERFIL" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || erro "Nome do perfil inválido."
  validar_redes
  VPN_USUARIO="${VPN_USUARIO:-}"
  [ -z "$VPN_USUARIO" ] || [[ "$VPN_USUARIO" =~ ^[A-Za-z0-9@._\\-]{1,128}$ ]] || erro "Usuário inválido."
  gravar_config
  instalar_vigia
  echo "✓ Configuração da VPN gravada: perfil $PERFIL, redes $VPN_REDES${VPN_USUARIO:+, usuário $VPN_USUARIO}. Vigia de reconexão ligado."
  if tunel_ativo; then echo "✓ Túnel ativo (a rede ${VPN_REDES%%,*} passa pela VPN)."; else echo "⚠ O túnel não está ativo agora: use Reconectar no painel ou confira o perfil no FortiClient."; fi
  ;;
reconectar)
  [ -r "$ESTADO" ] || erro "A VPN ainda não foi configurada neste servidor (use: vpn-fortinet.sh configurar)."
  echo "→ Reconectando a VPN (perfil ${VPN_PERFIL:-$PERFIL})…"
  timeout 30 forticlient vpn disconnect >/dev/null 2>&1 || true
  sleep 2
  timeout 90 forticlient vpn connect "${VPN_PERFIL:-$PERFIL}" --always-up </dev/null >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do tunel_ativo && break; sleep 3; done
  if tunel_ativo; then echo "✓ VPN reconectada."; else erro "A VPN não voltou. Veja: forticlient vpn status — a senha salva pode ter expirado: rode vpn-fortinet.sh configurar."; fi
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
