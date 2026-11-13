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
exe('forticlient', `case "$2" in status) printf 'Status: Connected\\nRemote gateway: vpn.empresa.com.br\\nPassword: segredo-nao-pode-aparecer\\n' ;; list) printf 'prefichas  ipsec  vpn.empresa.com.br\\nPSK: chave-nao-pode-aparecer\\n' ;; esac; exit 0`)
exe('systemctl', 'exit 0')
exe('dpkg-query', "printf '7.4.3.1714'")
exe('ip', `case "$*" in "route show default") echo 'default via 10.0.0.1 dev eth0' ;; "route get "*) echo "$3 dev ppp0 src 192.168.50.10" ;; esac; exit 0`)
exe('docker', 'exit 0'); exe('curl', 'exit 7')

function rodar(modo) {
  return spawnSync('bash', [join(RAIZ, 'scripts/gerenciador-executor.sh'), modo], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${D.bin}:${process.env.PATH}`, GERENCIADOR_DADOS: D.dados, PREFICHAS_OPT: D.opt, PREFICHAS_ETC: D.etc, PREFICHAS_SYSTEMD: D.unidades } })
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
