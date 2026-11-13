// VPN só com FortiClient (sem strongSwan): registrar perfil/redes/usuário pelo painel e situação publicada,
// com forticlient, systemctl, ip e dpkg-query FALSOS:   node --test gerenciador/teste-vpn.mjs   (precisa rodar como root)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const RAIZ = new URL('..', import.meta.url).pathname
const root = process.getuid?.() === 0
const T = mkdtempSync(join(tmpdir(), 'vpn-'))
const D = { opt: join(T, 'opt'), dados: join(T, 'dados'), etc: join(T, 'etc'), bin: join(T, 'bin'), unidades: join(T, 'systemd') }
for (const d of Object.values(D)) mkdirSync(d, { recursive: true })
for (const d of ['pedidos', 'estado']) mkdirSync(join(D.dados, d), { recursive: true })
const LOG = join(T, 'chamadas.log')
const exe = (n, corpo) => { writeFileSync(join(D.bin, n), `#!/bin/sh\necho "${n} $*" >> ${LOG}\n${corpo}\n`); chmodSync(join(D.bin, n), 0o755) }
// binário da CLI do FortiClient: só os textos que o script procura (edição gratuita = --user; completa = --username + EMS)
const CLI_VPN = join(T, 'cli-vpn'), CLI_EMS = join(T, 'cli-ems')
writeFileSync(CLI_VPN, 'VPN CLI interface\nvpn connect <vpn_name> --user=username --password\n')
writeFileSync(CLI_EMS, 'VPN CLI interface\nEndpoint Control CLI interface\nvpn connect <vpn_name> --username=username\n')
const SO_HOME = join(T, 'home-vpn')
// como o FortiClient 7.4 de verdade: recusa root. Aqui "não é root" = rodou pelo runuser (HOME do usuário da VPN) numa sessão D-Bus
exe('forticlient', `[ -n "$XDG_RUNTIME_DIR" ] && [ -d "$XDG_RUNTIME_DIR" ] || { echo "Error: failed to find runtime user dir" >&2; exit 1; }
[ "$HOME" = "${SO_HOME}" ] && { [ -n "$DBUS_FAKE" ] || [ -n "$DBUS_SESSION_BUS_ADDRESS" ]; } && [ "$CHAVEIRO_FAKE" = destravado ] || { echo 'Error: please run this command under non-root user.' >&2; exit 1; }
case "$2" in
  connect) if [ -n "$PTY_FAKE" ]; then case "$*" in *--password*) printf 'Password:'; IFS= read -r pw; [ -n "$FAKE_ECO" ] && printf '%s\\n' "$pw"; printf '%s' "$pw" > "${T}/senha-recebida" ;; esac; fi
    # como o real: o que foi digitado ANTES da pergunta do certificado se perde (por isso só se responde depois dela)
    if [ -e "${T}/cert-ruim" ]; then sleep 0.3; while IFS= read -r -t 0.2 descarta; do :; done; printf 'Reason: X509 verify certificate failed\nConfirm (y/n) [default=n]:'; IFS= read -r y || y=; [ "$y" = y ] || { echo 'Notification: Login canceled'; exit 0; }; fi
    [ -e "${T}/recusa" ] || touch "${T}/tunel"; echo 'Status: Connected' ;;
  disconnect) rm -f "${T}/tunel" ;;
  edit) if [ -n "$PTY_FAKE" ]; then printf 'Remote Gateway: '; IFS= read -r g; printf 'Port [default=443]: '; IFS= read -r p; printf 'Authentication (1.prompt / 2.save / 3.disable) [default=1]: '; IFS= read -r a; u=-; if [ "$a" = 2 ]; then printf 'Username: '; IFS= read -r u; fi; printf 'Certificate Type (1.local (pkcs12) / 2.smartcard (pkcs11) / 3.disable) [current=disable]: '; IFS= read -r c; printf '%s|%s|%s|%s|%s' "$g" "$p" "$a" "$u" "$c" > "${T}/edit-respostas"; echo 'DONE.'; fi ;;
esac
case "$2" in status) printf 'Status: Connected\\nRemote gateway: vpn.empresa.com.br\\nPassword: segredo-nao-pode-aparecer\\n' ;; list) printf 'prefichas  ipsec  vpn.empresa.com.br\\nPSK: chave-nao-pode-aparecer\\n' ;; esac; exit 0`)
exe('systemctl', 'exit 0'); exe('loginctl', 'exit 0'); exe('logger', 'exit 0')
// certificado do FortiGate: confiável por padrão; com "cert-ruim", autoassinado com a impressão digital de "fp"
exe('openssl', `case "$1" in
  s_client) cat >/dev/null; if [ -e "${T}/cert-ruim" ]; then case "$*" in *-verify_return_error*) exit 1 ;; esac; fi; echo CERT ;;
  x509) cat >/dev/null; echo "sha1 Fingerprint=$(cat "${T}/fp" 2>/dev/null)" ;;
esac; exit 0`)
exe('runuser', '[ "$1" = -u ] && [ "$2" = prefichas-vpn ] && [ "$3" = -- ] || exit 9; shift 3; exec "$@"')
exe('dbus-run-session', '[ "$1" = -- ] && shift; DBUS_FAKE=1 exec "$@"')
exe('gnome-keyring-daemon', `case "$*" in *--unlock*) s=$(cat); [ \${#s} -ge 32 ] && echo "CHAVEIRO_FAKE=destravado; export CHAVEIRO_FAKE" ;; esac; exit 0`)
// como um terminal de verdade, ecoa o que é digitado (o pior caso: antes do FortiClient desligar o eco)
exe('script', '[ "$1" = -qec ] && [ "$3" = /dev/null ] || exit 9; PTY_FAKE=1 FAKE_ECO=1 exec bash -c "$2"'); exe('dbus-launch', 'exit 0'); exe('id', 'case "$*" in "-u prefichas-vpn"|"-g prefichas-vpn") echo 0 ;; prefichas-vpn) exit 0 ;; *) exec /usr/bin/id "$@" ;; esac'); exe('install', 'shift 7; mkdir -p "$1"'); exe('useradd', 'exit 0'); exe('chown', 'exit 0')
exe('dpkg-query', "printf '7.4.3.1714'")
// túnel no ar = arquivo "tunel"; "full" = o FortiGate empurra a rota da internet (split tunnel desligado)
writeFileSync(join(T, 'tunel'), '')
exe('ip', `case "$*" in
  "route show default") echo 'default via 10.0.0.1 dev eth0' ;;
  "route get 1.1.1.1") if [ -e "${T}/tunel" ] && [ -e "${T}/full" ]; then echo '1.1.1.1 dev ppp0 src 192.168.50.10'; else echo '1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.5'; fi ;;
  "route get "*) if [ -e "${T}/tunel" ]; then echo "$3 dev ppp0 src 192.168.50.10"; else echo "$3 via 10.0.0.1 dev eth0 src 10.0.0.5"; fi ;;
esac; exit 0`)
exe('docker', 'exit 0'); exe('curl', 'exit 7')

function rodar(modo) {
  return spawnSync('bash', [join(RAIZ, 'scripts/gerenciador-executor.sh'), modo], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${D.bin}:${process.env.PATH}`, GERENCIADOR_DADOS: D.dados, PREFICHAS_OPT: D.opt, PREFICHAS_ETC: D.etc, PREFICHAS_SYSTEMD: D.unidades, PREFICHAS_VPN_SO_HOME: SO_HOME, PREFICHAS_VPN_RUNTIME_BASE: join(T, 'run-user'), FORTICLIENT_CLI: CLI_VPN, VPN_ESPERA_PTY: '0', VPN_ESPERA_PASSO: '0', PREFICHAS_VPN_PATH: `${D.bin}:${process.env.PATH}` } })
}
function pedir(corpo) {
  const id = randomUUID(); writeFileSync(join(D.dados, 'pedidos', `${id}.json`), JSON.stringify({ por: 'adm@x.com', ...corpo })); rodar('pedidos')
  return { tarefa: JSON.parse(readFileSync(join(D.dados, 'estado/tarefas', `${id}.json`), 'utf8')), log: readFileSync(join(D.dados, 'estado/tarefas', `${id}.log`), 'utf8') }
}

test('o strongSwan saiu do sistema: nenhum script ou ação o usa mais', () => {
  assert.equal(existsSync(join(RAIZ, 'scripts/vpn-ipsec-strongswan.sh')), false)
  const r = spawnSync('grep', ['-rniE', 'swanctl|strongswan|ipsec-strongswan', join(RAIZ, 'scripts'), join(RAIZ, 'gerenciador/servidor.mjs'), join(RAIZ, 'gerenciador/publico'), join(RAIZ, 'instalar.sh')], { encoding: 'utf8' })
  assert.equal(r.stdout, '', `referências restantes:\n${r.stdout}`)
})

test('registrar a configuração do FortiClient pelo painel: valida, grava sem segredos e liga o vigia', { skip: !root && 'precisa de root' }, () => {
  assert.equal(pedir({ acao: 'vpn-config', perfil: 'prefichas', redes: '0.0.0.0/0', usuario: '' }).tarefa.situacao, 'erro', 'todo o tráfego pela VPN é recusado')
  assert.equal(pedir({ acao: 'vpn-config', perfil: 'x;id', redes: '192.168.15.0/24', usuario: '' }).tarefa.situacao, 'erro')
  const r = pedir({ acao: 'vpn-config', perfil: 'prefichas', redes: '192.168.15.0/24,192.168.16.0/24', usuario: 'servidor' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const env = readFileSync(join(D.etc, 'vpn-forticlient.env'), 'utf8')
  assert.match(env, /VPN_PERFIL=prefichas/); assert.equal(spawnSync('bash', ['-c', `. '${join(D.etc, 'vpn-forticlient.env')}'; printf %s "$VPN_REDES"`], { encoding: 'utf8' }).stdout, '192.168.15.0/24,192.168.16.0/24', 'o arquivo é lido pelo shell'); assert.match(env, /VPN_USUARIO=servidor/)
  assert.equal((statSync(join(D.etc, 'vpn-forticlient.env')).mode & 0o777).toString(8), '600')
  assert.ok(existsSync(join(D.unidades, 'prefichas-vpn-vigia.timer')), 'vigia de reconexão instalado')
  assert.match(readFileSync(LOG, 'utf8'), /systemctl enable --now prefichas-vpn-vigia.timer/)
})

test('situação publicada para o painel: perfil, redes, usuário, IP na VPN, versão 7.4 — sem senha nem PSK', { skip: !root && 'precisa de root' }, () => {
  rodar('coletar')
  const v = JSON.parse(readFileSync(join(D.dados, 'estado/vpn.json'), 'utf8'))
  assert.equal(v.tipo, 'forticlient'); assert.equal(v.instalado, true); assert.equal(v.configurada, true); assert.equal(v.conectada, true)
  assert.deepEqual([v.perfil, v.usuario, v.ip_na_vpn], ['prefichas', 'servidor', '192.168.50.10'])
  assert.deepEqual(v.redes, ['192.168.15.0/24', '192.168.16.0/24'])
  assert.deepEqual([v.versao, v.linha_esperada, v.versao_ok], ['7.4.3.1714', '7.4', true])
  assert.match(v.detalhe, /vpn\.empresa\.com\.br/)
  assert.doesNotMatch(JSON.stringify(v), /segredo-nao-pode-aparecer|chave-nao-pode-aparecer/)
})

test('versão fora da linha 7.4 é sinalizada', { skip: !root && 'precisa de root' }, () => {
  exe('dpkg-query', "printf '7.2.8.0959'")
  rodar('coletar')
  const v = JSON.parse(readFileSync(join(D.dados, 'estado/vpn.json'), 'utf8'))
  assert.equal(v.versao_ok, false)
})

test('o FortiClient roda como usuário comum (o 7.4 recusa root) numa sessão D-Bus com chaveiro, e a senha do chaveiro é só do root', { skip: !root && 'precisa de root' }, () => {
  const ch = join(D.etc, 'vpn-chaveiro')
  assert.equal((statSync(ch).mode & 0o777).toString(8), '600'); assert.ok(readFileSync(ch, 'utf8').length >= 32)
  const r = pedir({ acao: 'vpn-reconectar' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const log = readFileSync(LOG, 'utf8')
  assert.match(log, /runuser -u prefichas-vpn -- env -i HOME=\S+ PATH=\S+ LANG=C.UTF-8 XDG_RUNTIME_DIR=\S+run-user\/0 /); assert.match(log, /forticlient vpn connect prefichas --user=servidor(\s|$)/)
  assert.doesNotMatch(log, new RegExp(readFileSync(ch, 'utf8')), 'a senha do chaveiro não vai na linha de comando')
  assert.doesNotMatch(r.log, /non-root/)
})

test('trocar a senha pelo painel: vai pelo prompt do FortiClient (pseudo-terminal), nunca em argumento, log, tarefa ou auditoria', { skip: !root && 'precisa de root' }, () => {
  const SENHA = 'S3nh@-Nova "com" espaço $(id)'
  const r = pedir({ acao: 'vpn-senha', senha: SENHA })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  assert.equal(readFileSync(join(T, 'senha-recebida'), 'utf8'), SENHA, 'o FortiClient recebeu a senha exata no prompt')
  const log = readFileSync(LOG, 'utf8')
  assert.match(log, /forticlient vpn connect prefichas --user=servidor --password --save-password/)
  assert.doesNotMatch(log + r.log + JSON.stringify(r.tarefa), /S3nh@/, 'a senha não aparece em comandos, no log da tarefa nem na tarefa')
  const r2 = spawnSync('grep', ['-rl', 'S3nh@', D.dados, D.etc], { encoding: 'utf8' })
  assert.equal(r2.stdout, '', 'nem em nenhum arquivo do painel ou de /etc/prefichas')
})

const direto = (args, env = {}, input) => spawnSync('bash', [join(RAIZ, 'scripts/vpn-fortinet.sh'), ...args], { encoding: 'utf8', timeout: 60000, input,
  env: { ...process.env, PATH: `${D.bin}:${process.env.PATH}`, PREFICHAS_ETC: D.etc, PREFICHAS_SYSTEMD: D.unidades, PREFICHAS_VPN_SO_HOME: SO_HOME,
    PREFICHAS_VPN_RUNTIME_BASE: join(T, 'run-user'), PREFICHAS_VPN_PATH: `${D.bin}:${process.env.PATH}`, FORTICLIENT_CLI: CLI_VPN, VPN_ESPERA_PTY: '0', VPN_ESPERA_PASSO: '0', ...env } })

test('edição completa (EMS) é detectada: o painel avisa, e os argumentos de usuário seguem a edição instalada', { skip: !root && 'precisa de root' }, () => {
  const ems = JSON.parse(direto(['estado-json'], { FORTICLIENT_CLI: CLI_EMS }).stdout)
  assert.equal(ems.edicao_ems, true)
  assert.equal(JSON.parse(direto(['estado-json']).stdout).edicao_ems, false)
  writeFileSync(LOG, '')
  direto(['reconectar'], { FORTICLIENT_CLI: CLI_EMS })
  assert.match(readFileSync(LOG, 'utf8'), /forticlient vpn connect prefichas --username=servidor(\s|$)/, 'a completa usa --username')
})

test('instalador: troca a edição completa pela gratuita só se o SHA-256 do .deb conferir; tira o repositório e segura a versão', { skip: !root && 'precisa de root' }, () => {
  exe('curl', 'while [ $# -gt 0 ]; do [ "$1" = -o ] && { printf "deb-de-teste" > "$2"; }; shift; done; exit 0')
  exe('apt-get', 'exit 0'); exe('apt-mark', 'exit 0')
  const base = { FORTICLIENT_CLI: CLI_EMS, VPN_REDES: '192.168.15.0/24', VPN_USUARIO: 'servidor' }
  writeFileSync(LOG, '')
  let r = direto(['configurar'], { ...base, FORTICLIENT_VPN_SHA256: '0'.repeat(64) })
  assert.notEqual(r.status, 0); assert.match(r.stderr, /não confere com o SHA-256/)
  assert.doesNotMatch(readFileSync(LOG, 'utf8'), /apt-get (purge|install)/, 'nada é removido nem instalado se o arquivo não confere')
  const sha = spawnSync('bash', ['-c', 'printf deb-de-teste | sha256sum | cut -d" " -f1'], { encoding: 'utf8' }).stdout.trim()
  writeFileSync(LOG, '')
  r = direto(['configurar'], { ...base, FORTICLIENT_VPN_SHA256: sha })
  const log = readFileSync(LOG, 'utf8')
  assert.match(log, /apt-get purge -y -qq forticlient[\s\S]*apt-get install -y -qq \S+forticlient-vpn\.deb[\s\S]*apt-mark hold forticlient/, log)
  assert.match(r.stdout, /FortiClient VPN \(gratuito/)
  exe('curl', 'exit 7')
})

const SSL = { acao: 'vpn-ssl', perfil: 'prefichas', gateway: 'ecruz.exemplo.com.br', porta: '10443', usuario: 'vpn_acampamento', redes: '192.168.1.0/24,192.168.50.0/24', senha: 'Senha-SSL-#1 "x" $(id)' }

test('SSL-VPN pelo painel: responde o assistente (gateway, porta, usuário), conecta com a senha e só então liga a reconexão', { skip: !root && 'precisa de root' }, () => {
  writeFileSync(LOG, '')
  const r = pedir(SSL)
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  assert.equal(readFileSync(join(T, 'edit-respostas'), 'utf8'), 'ecruz.exemplo.com.br|10443|2|vpn_acampamento|3')
  assert.equal(readFileSync(join(T, 'senha-recebida'), 'utf8'), SSL.senha)
  assert.match(r.log, /Remote Gateway/, 'o log mostra as perguntas do assistente (para ajustar se a Fortinet mudar)')
  assert.doesNotMatch(r.log, /Pipe quebrado|Broken pipe/)
  assert.match(r.log, /VPN conectada/)
  const env = spawnSync('bash', ['-c', `. '${join(D.etc, 'vpn-forticlient.env')}'; printf '%s|%s|%s|%s' "$VPN_GATEWAY" "$VPN_PORTA" "$VPN_USUARIO" "$VPN_REDES"`], { encoding: 'utf8' }).stdout
  assert.equal(env, 'ecruz.exemplo.com.br|10443|vpn_acampamento|192.168.1.0/24,192.168.50.0/24')
  assert.equal(readFileSync(join(D.etc, 'vpn-saida'), 'utf8').trim(), 'eth0', 'saída da internet guardada com a VPN desligada')
  const log = readFileSync(LOG, 'utf8')
  assert.ok(log.lastIndexOf('systemctl enable --now prefichas-vpn-vigia.timer') > log.lastIndexOf('forticlient vpn connect'), 'reconexão ligada só depois de conectar')
  assert.doesNotMatch(log + r.log + JSON.stringify(r.tarefa), /Senha-SSL/)
  assert.equal(spawnSync('grep', ['-rl', 'Senha-SSL', D.dados, D.etc], { encoding: 'utf8' }).stdout, '')
})

test('split tunnel desligado no FortiGate: a VPN é derrubada na hora e a reconexão fica desligada (o site e o SSH não caem)', { skip: !root && 'precisa de root' }, () => {
  writeFileSync(join(T, 'full'), ''); writeFileSync(LOG, '')
  const r = pedir(SSL)
  assert.equal(r.tarefa.situacao, 'erro', r.log)
  assert.match(r.log, /TODO o tráfego pela VPN/)
  assert.equal(existsSync(join(T, 'tunel')), false, 'desconectou')
  const log = readFileSync(LOG, 'utf8')
  assert.match(log, /systemctl disable --now prefichas-vpn-vigia.timer/)
  assert.ok(log.lastIndexOf('systemctl disable --now prefichas-vpn-vigia.timer') > log.lastIndexOf('systemctl enable --now prefichas-vpn-vigia.timer'), 'não ficou religada')
  // o vigia também se protege
  writeFileSync(LOG, '')
  direto(['vigiar'])
  assert.equal(existsSync(join(T, 'tunel')), false); assert.match(readFileSync(LOG, 'utf8'), /disable --now prefichas-vpn-vigia/)
  spawnSync('rm', ['-f', join(T, 'full')])
})

test('emergência pelo painel: desligar a VPN e liberar o SSH', { skip: !root && 'precisa de root' }, () => {
  writeFileSync(join(T, 'tunel'), ''); writeFileSync(LOG, '')
  const r = pedir({ acao: 'vpn-desligar' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log); assert.equal(existsSync(join(T, 'tunel')), false)
  assert.match(readFileSync(LOG, 'utf8'), /systemctl disable --now prefichas-vpn-vigia.timer/)
  exe('ufw', 'exit 0')
  const s2 = pedir({ acao: 'ssh-abrir' })
  assert.equal(s2.tarefa.situacao, 'concluida', s2.log); assert.match(readFileSync(LOG, 'utf8'), /ufw allow 22\/tcp/)
})

test('certificado autoassinado: sem a impressão digital confirmada não conecta (e mostra a impressão); com ela, responde "y" sozinho', { skip: !root && 'precisa de root' }, () => {
  const FP = '40:A5:0D:0D:6C:4A:24:F1:F7:A9:2F:2E:3B:8C:4F:35:80:A2:EE:3D'
  writeFileSync(join(T, 'cert-ruim'), ''); writeFileSync(join(T, 'fp'), FP); spawnSync('rm', ['-f', join(T, 'tunel')])
  let r = pedir(SSL)
  assert.equal(r.tarefa.situacao, 'erro', r.log); assert.match(r.log, new RegExp(FP)); assert.match(r.log, /Impressão digital do certificado/)
  assert.equal(existsSync(join(T, 'tunel')), false)
  r = pedir({ ...SSL, cert_sha1: '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:00:11:22:33' })
  assert.equal(r.tarefa.situacao, 'erro', 'impressão diferente (outro servidor no meio): recusa'); assert.equal(existsSync(join(T, 'tunel')), false)
  r = pedir({ ...SSL, cert_sha1: FP })
  assert.equal(r.tarefa.situacao, 'concluida', r.log); assert.match(r.log, /VPN conectada/)
  // a reconexão automática também responde, porque a impressão ficou gravada
  spawnSync('rm', ['-f', join(T, 'tunel')]); direto(['vigiar'])
  assert.ok(existsSync(join(T, 'tunel')), 'o vigia reconectou respondendo "y"')
  // se o certificado mudar, o vigia NÃO reconecta
  writeFileSync(join(T, 'fp'), '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:00:11:22:33'); spawnSync('rm', ['-f', join(T, 'tunel')]); direto(['vigiar'])
  assert.equal(existsSync(join(T, 'tunel')), false)
  spawnSync('rm', ['-f', join(T, 'cert-ruim')])
})

test('sessão permanente do usuário da VPN: com /run/user/<uid>/bus, o FortiClient usa esse barramento (o serviço de conexão só acha ele)', { skip: !root && 'precisa de root' }, () => {
  mkdirSync(join(T, 'run-user/0'), { recursive: true }); writeFileSync(join(T, 'run-user/0/bus'), ''); writeFileSync(LOG, '')
  direto(['status'])
  const log = readFileSync(LOG, 'utf8')
  assert.match(log, /DBUS_SESSION_BUS_ADDRESS=unix:path=\S+run-user\/0\/bus/); assert.doesNotMatch(log, /dbus-run-session/)
  spawnSync('rm', ['-f', join(T, 'run-user/0/bus')])
})

test('reconectar termina assim que o FortiClient termina (não espera a folga de 40 s da entrada)', { skip: !root && 'precisa de root' }, () => {
  spawnSync('rm', ['-f', join(T, 'tunel'), join(T, 'cert-ruim'), join(T, 'full')])
  const inicio = Date.now()
  const r = direto(['reconectar'], { VPN_ESPERA_PTY: '40' })
  const s = (Date.now() - inicio) / 1000
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /VPN reconectada/)
  assert.ok(s < 15, `levou ${s.toFixed(1)} s`)
  assert.equal(spawnSync('pgrep', ['-f', 'sleep 40'], { encoding: 'utf8' }).stdout, '', 'a espera de folga não fica para trás')
})
