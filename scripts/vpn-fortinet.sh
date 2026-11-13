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
# Instala o FortiClient VPN (edição GRATUITA, só VPN, sem EMS) baixado da Fortinet (filestore.fortinet.com),
# conferindo o SHA-256 fixado abaixo. A edição completa do repositório (repo.fortinet.com) se registra num EMS e,
# sem EMS, recusa o IPsec ("IPsec VPN is disabled while registered to EMS"): se estiver instalada, é trocada. Antes:
# impressão digital da chave de assinatura. O perfil SSL-VPN (gateway, porta, usuário) é preenchido no
# assistente do próprio FortiClient (`fc vpn edit`). Um vigia (systemd) reconecta se cair.
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
# FortiClient VPN gratuito (Linux, amd64). Para atualizar: baixe o .deb novo, confira e troque URL e SHA-256 juntos.
VPN_DEB_URL="${FORTICLIENT_VPN_URL:-https://filestore.fortinet.com/forticlient/downloads/forticlient_vpn_7.4.3.5411_amd64.deb}"
VPN_DEB_SHA256="${FORTICLIENT_VPN_SHA256:-d2c0366decbf0b907fbf0d9306b8ac0b705d2d9cb4eb7b946ae06ce5388d4e5a}"
FC_CLI="${FORTICLIENT_CLI:-/opt/forticlient/forticlient-cli}"
VIGIA=prefichas-vpn-vigia

erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { local v="${!1:-}"; if [ -z "$v" ] && [ "$TEM_TTY" = 1 ]; then read -r -p "$2${3:+ [$3]}: " v </dev/tty; fi; printf -v "$1" '%s' "${v:-${3:-}}"; }
rede_valida() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]]; }
# O CLI do FortiClient 7.4 recusa root ("please run this command under non-root user") e guarda a senha num
# chaveiro (Secret Service), que precisa de uma sessão D-Bus. Num servidor sem tela: roda como um usuário de
# sistema próprio, numa sessão D-Bus com o gnome-keyring destravado por uma senha aleatória só do root.
SO_USUARIO="${PREFICHAS_VPN_SO_USUARIO-prefichas-vpn}"   # vazio = roda direto (testes)
SO_HOME="${PREFICHAS_VPN_SO_HOME:-/var/lib/prefichas-vpn}"
CHAVEIRO="$ETC_PF/vpn-chaveiro"
fc() {
  local t=(); [ -n "${FC_TIMEOUT:-}" ] && t=(timeout "$FC_TIMEOUT")
  if [ -z "$SO_USUARIO" ]; then "${t[@]}" forticlient "$@"; return; fi
  [ -r "$CHAVEIRO" ] || erro "Usuário da VPN não preparado: rode sudo ./scripts/vpn-fortinet.sh configurar."
  # o FortiClient exige a pasta de execução do usuário (XDG_RUNTIME_DIR, /run/user/<uid>), que só existe com
  # login; o usuário da VPN nunca faz login, então ela é criada aqui (só dele, 700)
  local uid rt; uid="$(id -u "$SO_USUARIO" 2>/dev/null)" || erro "Usuário $SO_USUARIO não existe: rode sudo ./scripts/vpn-fortinet.sh configurar."
  rt="${PREFICHAS_VPN_RUNTIME_BASE:-/run/user}/$uid"
  [ -d "$rt" ] && [ ! -L "$rt" ] || install -d -m 700 -o "$SO_USUARIO" -g "$(id -g "$SO_USUARIO")" "$rt"
  # a senha do chaveiro vai pelo descritor 3 (aberto pelo root); o usuário da VPN não consegue ler o arquivo
  "${t[@]}" runuser -u "$SO_USUARIO" -- env -i HOME="$SO_HOME" PATH="${PREFICHAS_VPN_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" LANG=C.UTF-8 XDG_RUNTIME_DIR="$rt" ${TERM:+TERM="$TERM"} FC_PTY="${FC_PTY:-}" \
    dbus-run-session -- bash -c 'eval "$(gnome-keyring-daemon --unlock --components=secrets <&3 2>/dev/null)" >/dev/null; exec 3<&-; gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1 || true; if [ -n "$FC_PTY" ]; then exec script -qec "$(printf "%q " forticlient "$@")" /dev/null; fi; exec forticlient "$@"' fc "$@" 3< "$CHAVEIRO"
}
preparar_usuario() { # usuário de sistema sem login + D-Bus + chaveiro
  [ -n "$SO_USUARIO" ] || return 0
  local falta=()
  command -v dbus-run-session >/dev/null || falta+=(dbus)
  command -v dbus-launch >/dev/null || falta+=(dbus-x11)
  command -v gnome-keyring-daemon >/dev/null || falta+=(gnome-keyring)
  if [ "${#falta[@]}" -gt 0 ]; then
    echo "→ Instalando ${falta[*]} (sessão e chaveiro para o FortiClient sem tela)…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${falta[@]}" >/dev/null
  fi
  id "$SO_USUARIO" >/dev/null 2>&1 || useradd --system --home-dir "$SO_HOME" --create-home --shell /usr/sbin/nologin "$SO_USUARIO"
  mkdir -p "$SO_HOME"; chown "$SO_USUARIO": "$SO_HOME"; chmod 700 "$SO_HOME"
  mkdir -p "$ETC_PF" && chmod 700 "$ETC_PF"
  [ -s "$CHAVEIRO" ] || ( umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$CHAVEIRO" )
}
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
# A edição completa (EMS) tem o módulo "Endpoint Control"; a gratuita só tem VPN
edicao_completa() { [ -r "$FC_CLI" ] && grep -aq "Endpoint Control CLI interface" "$FC_CLI"; }
# A edição completa 7.4.8 usa --username; a gratuita 7.4.3 usa --user (e -p para pedir a senha)
flag_usuario() { if [ -r "$FC_CLI" ] && grep -aq -- "--username" "$FC_CLI"; then echo --username; else echo --user; fi; }
args_usuario() { # USUARIO [pedir-senha] → argumentos de usuário para o "vpn connect" desta edição
  [ -n "$1" ] || return 0
  local f; f="$(flag_usuario)"; printf '%s\n' "$f=$1"
  [ "${2:-}" = pedir-senha ] && [ "$f" = --user ] && printf '%s\n' --password
  return 0
}
instalar_vpn_gratuito() {
  command -v apt-get >/dev/null || erro "Este instalador é para Ubuntu/Debian."
  [ "$(dpkg --print-architecture)" = amd64 ] || erro "O FortiClient VPN gratuito para Linux é só amd64."
  local d; d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
  echo "→ Baixando o FortiClient VPN (gratuito, só VPN)…"
  curl -fsSL --retry 4 --retry-all-errors -o "$d/forticlient-vpn.deb" "$VPN_DEB_URL" || erro "Não consegui baixar o FortiClient VPN."
  [ "$(sha256sum "$d/forticlient-vpn.deb" | cut -d' ' -f1)" = "$VPN_DEB_SHA256" ] || erro "O arquivo baixado não confere com o SHA-256 esperado. Instalação cancelada."
  if dpkg -s forticlient >/dev/null 2>&1; then
    echo "→ Removendo o FortiClient completo (EMS)…"
    ( FC_TIMEOUT=30 fc vpn disconnect ) >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq forticlient >/dev/null
  fi
  # sem o repositório da edição completa, o apt nunca "atualiza" de volta para ela
  rm -f /etc/apt/sources.list.d/repo.fortinet.com.list /usr/share/keyrings/repo.fortinet.com.gpg
  echo "→ Instalando o FortiClient VPN…"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$d/forticlient-vpn.deb" >/dev/null
  apt-mark hold forticlient >/dev/null 2>&1 || true
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
  echo "Tenha em mãos os dados do SSL-VPN do FortiGate (gateway, porta, usuário)."
  echo
  perguntar VPN_REDES "Redes internas da empresa que passam pela VPN (ex.: 192.168.10.0/24,10.0.0.0/8)"
  validar_redes
  perguntar VPN_USUARIO "Usuário da VPN (ENTER se o túnel não usa usuário)" ""
  [ -z "$VPN_USUARIO" ] || [[ "$VPN_USUARIO" =~ ^[A-Za-z0-9@._\\-]{1,128}$ ]] || erro "Usuário inválido."

  # 1) Instalar o FortiClient VPN gratuito (troca a edição completa/EMS, se for ela)
  if ! command -v forticlient >/dev/null || edicao_completa; then instalar_vpn_gratuito; fi
  command -v forticlient >/dev/null || erro "FortiClient não foi instalado."

  preparar_usuario

  [ "$TEM_TTY" = 1 ] || erro "A criação do perfil é feita no assistente do FortiClient: rode este comando num terminal."

  # 2) Perfil: assistente do próprio FortiClient (SSL-VPN: gateway, porta, usuário)
  echo
  echo "→ Abrindo o assistente do FortiClient para o perfil \"$PERFIL\"."
  echo "  SSL-VPN: informe o gateway do FortiGate, a porta do SSL-VPN (a configurada no FortiGate),"
  echo "  o usuário e, se perguntar, salve a senha. O split tunnel é definido no FortiGate."
  fc vpn edit "$PERFIL" </dev/tty

  # 3) Conectar: senha salva, sempre ativo e reconexão automática
  echo
  echo "→ Conectando (digite a senha da VPN se for pedida)…"
  CONECTAR=(fc vpn connect "$PERFIL" --save-password --always-up --auto-connect)
  mapfile -t U < <(args_usuario "$VPN_USUARIO" pedir-senha); CONECTAR+=("${U[@]}")
  "${CONECTAR[@]}" </dev/tty || true

  gravar_config

  # 4) Vigia: reconecta sozinho se cair
  instalar_vigia

  echo -n "→ Conferindo o túnel"
  for _ in $(seq 1 20); do tunel_ativo && break; echo -n "."; sleep 3; done; echo
  if tunel_ativo; then
    echo "✓ VPN conectada (a rede ${VPN_REDES%%,*} passa pelo túnel)."
    fc vpn status 2>/dev/null | sed 's/^/  /' || true
    echo "  Descubra o IP do servidor na VPN com o analista (ou em 'ip -4 addr') e teste o SSH a partir da empresa."
    echo "  Depois de testar: sudo ./scripts/vpn-fortinet.sh fechar-ssh"
  else
    echo "✗ Não consegui confirmar o túnel. Veja: fc vpn status"
    exit 1
  fi
  ;;
vigiar)
  # Chamado pelo systemd: reconecta se o túnel caiu (usa a senha salva no FortiClient)
  tunel_ativo && exit 0
  logger -t prefichas-vpn "Túnel FortiClient fora do ar: reconectando o perfil ${VPN_PERFIL:-$PERFIL}"
  FC_TIMEOUT=90 fc vpn connect "${VPN_PERFIL:-$PERFIL}" $(args_usuario "${VPN_USUARIO:-}") --always-up </dev/null >/dev/null 2>&1 || true
  ;;
estado-json)
  # usado pelo painel central: situação e configuração em JSON (sem segredos: senha e PSK ficam só no FortiClient)
  inst=false; command -v forticlient >/dev/null 2>&1 && inst=true
  conf=false; [ -r "$ESTADO" ] && conf=true
  con=false; tunel_ativo && con=true
  vig=false; systemctl is-active "${VIGIA}.timer" >/dev/null 2>&1 && vig=true
  det=""; perfis=""
  if [ "$inst" = true ]; then
    det="$(FC_TIMEOUT=10 fc vpn status 2>/dev/null | grep -viE 'pass|psk|secret|senha|key' | head -c 600 || true)"
    perfis="$(FC_TIMEOUT=10 fc vpn list 2>/dev/null | grep -viE 'pass|psk|secret|senha|key' | head -c 600 || true)"
  fi
  versao=""; [ "$inst" = true ] && versao="$(dpkg-query -W -f='${Version}' forticlient 2>/dev/null || true)"
  ems=false; [ "$inst" = true ] && edicao_completa && ems=true
  jq -n --argjson ems "$ems" --argjson i "$inst" --argjson c "$conf" --argjson k "$con" --argjson v "$vig" --arg r "${VPN_REDES:-}" --arg d "$det" --arg l "$perfis" \
    --arg perfil "${VPN_PERFIL:-$PERFIL}" --arg u "${VPN_USUARIO:-}" --arg ip "$(ip_na_vpn || true)" --arg ver "$versao" --arg linha "$VERSAO" \
    '{tipo:"forticlient", instalado:$i, configurada:$c, conectada:$k, vigia:$v, redes:($r|split(",")|map(select(length>0))), perfil:$perfil,
      usuario:$u, ip_na_vpn:$ip, detalhe:$d, perfis:$l, versao:$ver, linha_esperada:$linha, edicao_ems:$ems,
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
  preparar_usuario
  gravar_config
  instalar_vigia
  echo "✓ Configuração da VPN gravada: perfil $PERFIL, redes $VPN_REDES${VPN_USUARIO:+, usuário $VPN_USUARIO}. Vigia de reconexão ligado."
  if tunel_ativo; then echo "✓ Túnel ativo (a rede ${VPN_REDES%%,*} passa pela VPN)."; else echo "⚠ O túnel não está ativo agora: use Reconectar no painel ou confira o perfil no FortiClient."; fi
  ;;
reconectar)
  [ -r "$ESTADO" ] || erro "A VPN ainda não foi configurada neste servidor (use: vpn-fortinet.sh configurar)."
  echo "→ Reconectando a VPN (perfil ${VPN_PERFIL:-$PERFIL})…"
  FC_TIMEOUT=30 fc vpn disconnect >/dev/null 2>&1 || true
  sleep 2
  FC_TIMEOUT=90 fc vpn connect "${VPN_PERFIL:-$PERFIL}" $(args_usuario "${VPN_USUARIO:-}") --always-up </dev/null >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do tunel_ativo && break; sleep 3; done
  if tunel_ativo; then echo "✓ VPN reconectada."; else erro "A VPN não voltou. Veja: fc vpn status — a senha salva pode ter expirado: rode vpn-fortinet.sh configurar."; fi
  ;;
senha)
  # pelo painel: a senha chega pela entrada padrão (nunca em argumento nem variável de ambiente), é digitada no
  # pedido de senha do FortiClient por um pseudo-terminal e fica salva no chaveiro (--save-password)
  [ -r "$ESTADO" ] || erro "Registre a configuração da VPN antes (perfil, redes e usuário)."
  [ -n "${VPN_USUARIO:-}" ] || erro "Este perfil não tem usuário registrado: informe o usuário da VPN na configuração antes de trocar a senha."
  IFS= read -r SENHA || true
  [ -n "$SENHA" ] || erro "Senha vazia."
  echo "→ Gravando a nova senha e reconectando (perfil ${VPN_PERFIL:-$PERFIL}, usuário $VPN_USUARIO)…"
  FC_TIMEOUT=30 fc vpn disconnect >/dev/null 2>&1 || true
  sleep 2
  { printf '%s\n' "$SENHA"; sleep 40; } | FC_PTY=1 FC_TIMEOUT=60 fc vpn connect "${VPN_PERFIL:-$PERFIL}" $(args_usuario "$VPN_USUARIO" pedir-senha) --save-password --always-up --auto-connect >/dev/null 2>&1 || true
  SENHA=""
  for _ in $(seq 1 20); do tunel_ativo && break; sleep 3; done
  if tunel_ativo; then echo "✓ Senha salva e VPN conectada."; else erro "A VPN não conectou com essa senha. Confira a senha e o usuário (ou se o usuário tem FortiToken/MFA, que impede a conexão automática)."; fi
  ;;
status)
  fc vpn status 2>/dev/null || echo "FortiClient não instalado ou sem perfil."
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
  fc vpn disconnect >/dev/null 2>&1 || true
  fc vpn remove "${VPN_PERFIL:-$PERFIL}" >/dev/null 2>&1 || true
  rm -f "$ESTADO"
  echo "✓ VPN removida (o pacote forticlient continua instalado: apt remove forticlient para tirar)."
  echo "  Se tinha fechado o SSH, confira: sudo ufw status"
  ;;
*) sed -n '2,18p' "$0"; exit 1 ;;
esac
