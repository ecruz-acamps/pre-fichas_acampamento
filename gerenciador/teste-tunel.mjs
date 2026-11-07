// Túnel único da Cloudflare (scripts/tunel-compartilhado.sh) contra uma Cloudflare SIMULADA, com docker falso:
//   node --test gerenciador/teste-tunel.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'tunel-'))
const ETC = join(tmp, 'etc'), PASTA = join(tmp, 'tunel'), INST = join(tmp, 'opt'), BIN = join(tmp, 'bin'), LOG = join(tmp, 'docker.log')
for (const d of [ETC, INST, BIN]) mkdirSync(d)
const TOKEN_CF = 'token-cf-secreto-0123456789abcdef'
writeFileSync(join(ETC, 'cloudflare.env'), `CF_API_TOKEN=${TOKEN_CF}\n`)

// ---------------------------------------------------------------- Cloudflare simulada
const est = { tuneis: [], config: {}, dns: [], seq: 0, modo: 'ok', saude: true, chamadas: [] }
const ZONA = { id: 'Z1', name: 'movimentocampista.com.br', account: { id: 'A1' } }
const ok = (res, result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, errors: [], result })) }
const nega = (res) => { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] })) }
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; let corpo = ''
  req.on('data', (c) => (corpo += c))
  req.on('end', () => {
    est.chamadas.push(`${req.method} ${p}${u.search}`)
    if (p === '/api/saude') { res.writeHead(est.saude ? 200 : 502); return res.end('{}') }
    if (req.headers.authorization !== `Bearer ${TOKEN_CF}`) return nega(res)
    const j = corpo ? JSON.parse(corpo) : null
    if (p === '/zones') return ok(res, est.modo === 'sem-zona' ? [] : (u.searchParams.get('name') === ZONA.name ? [ZONA] : []))
    if (p.startsWith('/accounts/A1/cfd_tunnel') && est.modo === 'sem-tunel') return nega(res)
    let m
    if (p === '/accounts/A1/cfd_tunnel' && req.method === 'GET') {
      const nome = u.searchParams.get('name'); return ok(res, est.tuneis.filter((t) => !t.deleted_at && (!nome || t.name === nome)))
    }
    if (p === '/accounts/A1/cfd_tunnel' && req.method === 'POST') { const t = { id: `T${++est.seq}`, name: j.name, deleted_at: null }; est.tuneis.push(t); return ok(res, t) }
    if ((m = /^\/accounts\/A1\/cfd_tunnel\/(\w+)$/.exec(p))) {
      const t = est.tuneis.find((x) => x.id === m[1])
      if (req.method === 'DELETE') { if (t) t.deleted_at = 'agora'; return ok(res, t) }
      return t ? ok(res, t) : nega(res)
    }
    if ((m = /^\/accounts\/A1\/cfd_tunnel\/(\w+)\/token$/.exec(p))) return ok(res, `TOKEN-DO-TUNEL-${m[1]}`)
    if ((m = /^\/accounts\/A1\/cfd_tunnel\/(\w+)\/connections$/.exec(p))) return ok(res, null)
    if ((m = /^\/accounts\/A1\/cfd_tunnel\/(\w+)\/configurations$/.exec(p))) {
      if (req.method === 'PUT') { est.config[m[1]] = j.config; return ok(res, { config: j.config }) }
      return ok(res, { config: est.config[m[1]] ?? { ingress: [{ service: 'http_status:404' }] } })
    }
    if (p === '/zones/Z1/dns_records' && req.method === 'GET') return ok(res, est.dns.filter((d) => d.name === u.searchParams.get('name')))
    if (p === '/zones/Z1/dns_records' && req.method === 'POST') { est.dns.push({ id: `D${++est.seq}`, ...j }); return ok(res, j) }
    if ((m = /^\/zones\/Z1\/dns_records\/(\w+)$/.exec(p))) {
      const i = est.dns.findIndex((d) => d.id === m[1])
      if (req.method === 'DELETE') { est.dns.splice(i, 1); return ok(res, {}) }
      est.dns[i] = { id: m[1], ...j }; return ok(res, j)
    }
    res.writeHead(404); res.end('{}')
  })
})
let url
before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${servidor.address().port}`
  // docker falso: registra as chamadas; "ps" mostra o container do túnel quando o compose foi levantado
  writeFileSync(join(BIN, 'docker'), `#!/usr/bin/env bash
echo "docker $* (em $PWD)" >> "${LOG}"
case "$1" in
  ps) [ -e "${tmp}/tunel-no-ar" ] && echo prefichas-tunel ;;
  compose) case "$*" in *"up -d"*) case "$PWD" in "${PASTA}") touch "${tmp}/tunel-no-ar" ;; esac ;; esac ;;
esac
exit 0
`); chmodSync(join(BIN, 'docker'), 0o755)
})
after(() => servidor.close())

const rodar = (...args) => new Promise((resolve) => {
  const p = spawn('bash', [join(RAIZ, 'scripts/tunel-compartilhado.sh'), ...args], {
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, PREFICHAS_ETC: ETC, TUNEL_PASTA: PASTA, INSTANCIAS_RAIZ: INST, CF_API_URL: url,
      CF_API_TOKEN: '', TUNEL_VERIFICAR_BASE: url, TUNEL_ESPERA: '0' } })
  let saida = ''; p.stdout.on('data', (c) => (saida += c)); p.stderr.on('data', (c) => (saida += c))
  p.on('close', (codigo) => resolve({ codigo, saida }))
})
const instancia = (nome, env) => { const d = join(INST, nome); mkdirSync(d, { recursive: true }); writeFileSync(join(d, '.env'), env); return d }
const regras = (id) => (est.config[id]?.ingress ?? [])

test('verificar: diz o que falta no token (zona não visível, sem permissão de túnel) e confere quando está certo', async () => {
  est.modo = 'sem-zona'
  let r = await rodar('verificar', 'a.movimentocampista.com.br')
  assert.notEqual(r.codigo, 0); assert.match(r.saida, /Nenhuma zona|não enxerga o domínio/)
  est.modo = 'sem-tunel'
  r = await rodar('verificar', 'a.movimentocampista.com.br')
  assert.notEqual(r.codigo, 0); assert.match(r.saida, /Cloudflare Tunnel › Editar/)
  est.modo = 'ok'
  r = await rodar('verificar', 'a.movimentocampista.com.br')
  assert.equal(r.codigo, 0, r.saida); assert.match(r.saida, /Cloudflare conferida/)
  assert.equal(est.tuneis.length, 0, 'verificar não cria nada')
  assert.notEqual((await rodar('verificar', 'x;rm -rf /')).codigo, 0)
})

test('adicionar: o primeiro cria UM túnel e sobe UM cloudflared; os seguintes só acrescentam endereços', async () => {
  let r = await rodar('adicionar', 'sao-pedro.movimentocampista.com.br', '3001')
  assert.equal(r.codigo, 0, r.saida)
  r = await rodar('adicionar', 'beata.movimentocampista.com.br', '3002')
  assert.equal(r.codigo, 0, r.saida)
  r = await rodar('adicionar', 'santa-rita.movimentocampista.com.br', '3003')
  assert.equal(r.codigo, 0, r.saida)
  assert.equal(est.tuneis.length, 1, 'um túnel só para os três acampamentos')
  const id = est.tuneis[0].id
  assert.deepEqual(regras(id).map((x) => [x.hostname ?? null, x.service]), [
    ['sao-pedro.movimentocampista.com.br', 'http://127.0.0.1:3001'], ['beata.movimentocampista.com.br', 'http://127.0.0.1:3002'],
    ['santa-rita.movimentocampista.com.br', 'http://127.0.0.1:3003'], [null, 'http_status:404'],
  ])
  assert.equal(est.dns.length, 3)
  assert.ok(est.dns.every((d) => d.type === 'CNAME' && d.content === `${id}.cfargotunnel.com` && d.proxied === true))
  const log = readFileSync(LOG, 'utf8')
  assert.equal((log.match(/compose up -d/g) ?? []).length, 1, 'o cloudflared sobe uma vez só')
  assert.match(readFileSync(join(PASTA, 'docker-compose.yml'), 'utf8'), /network_mode: host/)
  assert.match(readFileSync(join(PASTA, '.env'), 'utf8'), new RegExp(`TUNNEL_TOKEN=TOKEN-DO-TUNEL-${id}`))
  assert.ok(existsSync(join(PASTA, '.env')))
})

test('adicionar de novo o mesmo endereço troca a porta (sem duplicar) e a lista local é atualizada', async () => {
  const id = est.tuneis[0].id
  assert.equal((await rodar('adicionar', 'beata.movimentocampista.com.br', '3010')).codigo, 0)
  const hosts = regras(id).filter((x) => x.hostname)
  assert.equal(hosts.length, 3)
  assert.equal(hosts.find((x) => x.hostname.startsWith('beata')).service, 'http://127.0.0.1:3010')
  assert.match(readFileSync(join(ETC, 'tunel-hosts'), 'utf8'), /beata\.movimentocampista\.com\.br http:\/\/127\.0\.0\.1:3010/)
  assert.equal(est.dns.length, 3, 'o DNS também não duplica')
})

test('remover: tira só aquele endereço e apaga o DNS dele; o túnel e os outros ficam', async () => {
  const id = est.tuneis[0].id
  assert.equal((await rodar('remover', 'santa-rita.movimentocampista.com.br')).codigo, 0)
  assert.deepEqual(regras(id).filter((x) => x.hostname).map((x) => x.hostname).sort(), ['beata.movimentocampista.com.br', 'sao-pedro.movimentocampista.com.br'])
  assert.equal(est.dns.some((d) => d.name.startsWith('santa-rita')), false)
  assert.equal(est.dns.length, 2); assert.equal(est.tuneis.filter((t) => !t.deleted_at).length, 1)
  // DNS que NÃO aponta para o túnel único é preservado
  est.dns.push({ id: 'Dx', type: 'A', name: 'outro.movimentocampista.com.br', content: '1.2.3.4' })
  assert.equal((await rodar('remover', 'outro.movimentocampista.com.br')).codigo, 0)
  assert.ok(est.dns.some((d) => d.id === 'Dx'), 'registro de outro serviço não é apagado')
})

test('token da Cloudflare nunca aparece na linha de comando, nos logs do script nem no .env do túnel', async () => {
  const r = await rodar('adicionar', 'nova.movimentocampista.com.br', '3020')
  assert.equal(r.codigo, 0)
  assert.doesNotMatch(r.saida, new RegExp(TOKEN_CF))
  assert.doesNotMatch(readFileSync(LOG, 'utf8'), new RegExp(TOKEN_CF))
  assert.doesNotMatch(readFileSync(join(PASTA, '.env'), 'utf8'), new RegExp(TOKEN_CF))
})

test('unificar: move os acampamentos com túnel próprio, confere o site e só depois desliga e apaga o túnel antigo', async () => {
  // dois acampamentos antigos, cada um com o PRÓPRIO túnel (como era antes)
  const velhoA = { id: 'TA', name: 'prefichas-antigo-a.movimentocampista.com.br', deleted_at: null }
  const velhoB = { id: 'TB', name: 'prefichas-antigo-b.movimentocampista.com.br', deleted_at: null }
  est.tuneis.push(velhoA, velhoB)
  for (const [n, t, porta] of [['a', velhoA, 3031], ['b', velhoB, 3032]]) {
    est.dns.push({ id: `Dv${n}`, type: 'CNAME', name: `antigo-${n}.movimentocampista.com.br`, content: `${t.id}.cfargotunnel.com`, proxied: true })
    instancia(`prefichas-antigo-${n}`, `COMPOSE_PROFILES=tunel\nTUNEL_TOKEN=segredo-antigo-${n}\nENDERECO_PUBLICO=antigo-${n}.movimentocampista.com.br\nPORTA_LOCAL=${porta}\n`)
  }
  instancia('prefichas-direta', 'COMPOSE_PROFILES=\nPUBLICACAO=direta\nPORTA_LOCAL=3040\n')            // não tem túnel: não é tocada
  const unico = est.tuneis[0].id
  const r = await rodar('unificar')
  assert.equal(r.codigo, 0, r.saida)
  const hosts = regras(unico).filter((x) => x.hostname).map((x) => x.hostname)
  assert.ok(hosts.includes('antigo-a.movimentocampista.com.br') && hosts.includes('antigo-b.movimentocampista.com.br'))
  for (const n of ['a', 'b']) {
    assert.equal(est.dns.find((d) => d.name === `antigo-${n}.movimentocampista.com.br`).content, `${unico}.cfargotunnel.com`)
    const env = readFileSync(join(INST, `prefichas-antigo-${n}`, '.env'), 'utf8')
    assert.doesNotMatch(env, /COMPOSE_PROFILES=.*tunel/); assert.match(env, /TUNEL_TOKEN=\n/)
  }
  assert.equal(est.tuneis.find((t) => t.id === 'TA').deleted_at, 'agora'); assert.equal(est.tuneis.find((t) => t.id === 'TB').deleted_at, 'agora')
  assert.equal(readFileSync(join(INST, 'prefichas-direta', '.env'), 'utf8'), 'COMPOSE_PROFILES=\nPUBLICACAO=direta\nPORTA_LOCAL=3040\n')
  assert.match(readFileSync(LOG, 'utf8'), /compose stop tunel \(em .*prefichas-antigo-a\)/)
})

test('unificar: se o site NÃO responde pelo túnel único, o DNS volta ao túnel antigo e o túnel próprio continua', async () => {
  const velho = { id: 'TC', name: 'prefichas-antigo-c.movimentocampista.com.br', deleted_at: null }
  est.tuneis.push(velho)
  est.dns.push({ id: 'Dvc', type: 'CNAME', name: 'antigo-c.movimentocampista.com.br', content: 'TC.cfargotunnel.com', proxied: true })
  const pasta = instancia('prefichas-antigo-c', 'COMPOSE_PROFILES=tunel\nTUNEL_TOKEN=segredo-c\nENDERECO_PUBLICO=antigo-c.movimentocampista.com.br\nPORTA_LOCAL=3033\n')
  est.saude = false
  try {
    const r = await rodar('unificar')
    assert.notEqual(r.codigo, 0); assert.match(r.saida, /voltando ao túnel antigo/)
  } finally { est.saude = true }
  assert.equal(est.dns.find((d) => d.name === 'antigo-c.movimentocampista.com.br').content, 'TC.cfargotunnel.com', 'DNS restaurado')
  assert.match(readFileSync(join(pasta, '.env'), 'utf8'), /COMPOSE_PROFILES=tunel/); assert.match(readFileSync(join(pasta, '.env'), 'utf8'), /TUNEL_TOKEN=segredo-c/)
  assert.equal(est.tuneis.find((t) => t.id === 'TC').deleted_at, null, 'o túnel antigo não é apagado')
})
