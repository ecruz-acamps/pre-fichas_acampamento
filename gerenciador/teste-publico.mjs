// Testes do painel central PUBLICADO na internet (atrás do proxy HTTPS):  node --test gerenciador/teste-publico.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'gerenciador-pub-'))
for (const d of ['dados', 'pedidos', 'estado']) mkdirSync(join(base, d))
process.env.DADOS = join(base, 'dados'); process.env.PEDIDOS = join(base, 'pedidos'); process.env.ESTADO = join(base, 'estado')
process.env.REDES_PERMITIDAS = '127.0.0.1/32'
process.env.PAINEL_DOMINIO = 'painel.teste.com.br'; process.env.PROXY_CONFIAVEL = 'true'; process.env.COOKIE_SEGURO = 'true'

const m = await import('./servidor.mjs')
let porta
const SENHA = 'senha-forte-do-teste'
let segredo
before(async () => {
  segredo = m.novoSegredoTotp()
  writeFileSync(join(base, 'dados', 'usuarios.json'), JSON.stringify([{ email: 'adm@x.com', senha: await m.gerarHash(SENHA), totp: segredo, ativo: true }]))
  await new Promise((r) => m.servidor.listen(0, '127.0.0.1', r))
  porta = m.servidor.address().port
})
after(() => m.servidor.close())

// como o proxy: chega do próprio servidor, com o Host do domínio e o IP do visitante em X-Forwarded-For
function chamar({ metodo = 'GET', caminho = '/', host = 'painel.teste.com.br', ip = '203.0.113.7', corpo = null, extra = {} }) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho,
      headers: { host, 'x-forwarded-for': ip, 'x-requested-with': 'fetch', ...(dados ? { 'content-type': 'application/json' } : {}), ...extra } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: t }))
    })
    req.on('error', reject); if (dados) req.write(dados); req.end()
  })
}
const login = (corpo, ip) => chamar({ metodo: 'POST', caminho: '/api/login', ip, corpo })

test('o IP do visitante vem do proxy (último X-Forwarded-For) e valores estranhos são ignorados', () => {
  const req = (xff) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': xff } })
  assert.equal(m.ipDoVisitante(req('198.51.100.20')), '198.51.100.20')
  assert.equal(m.ipDoVisitante(req('9.9.9.9, 198.51.100.20')), '198.51.100.20', 'vale o que o proxy acrescentou, não o que o visitante mandou')
  assert.equal(m.ipDoVisitante(req('lixo; drop table')), '127.0.0.1')
  // pedido que NÃO vem do proxy local não pode forjar o IP
  assert.equal(m.ipDoVisitante({ socket: { remoteAddress: '200.1.2.3' }, headers: { 'x-forwarded-for': '1.1.1.1' } }), '200.1.2.3')
})

test('só atende o domínio do painel (e localhost para o túnel SSH)', async () => {
  assert.equal((await chamar({ caminho: '/' })).status, 200)
  assert.equal((await chamar({ caminho: '/', host: 'localhost:9090' })).status, 200)
  assert.equal((await chamar({ caminho: '/', host: 'outro-site.com' })).status, 421)
  assert.equal((await chamar({ caminho: '/', host: '203.0.113.50' })).status, 421)
})

test('HTTPS: cookie Secure, HSTS e sem indexação; login continua exigindo senha E código', async () => {
  const pagina = await chamar({ caminho: '/' })
  assert.match(pagina.headers['strict-transport-security'], /max-age=\d+/)
  assert.match(pagina.headers['x-robots-tag'], /noindex/)
  const semCodigo = await login({ email: 'adm@x.com', senha: SENHA }, '203.0.113.1')
  assert.equal(semCodigo.status, 401)
  const ok = await login({ email: 'adm@x.com', senha: SENHA, codigo: m.codigoTotp(segredo, Math.floor(Date.now() / 30000)) }, '203.0.113.1')
  assert.equal(ok.status, 200)
  const cookie = ok.headers['set-cookie'][0]
  assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/)
  assert.equal((await chamar({ caminho: '/api/instancias' })).status, 401, 'sem login não vê nada')
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /203\.0\.113\.1/, 'a auditoria registra o IP real do visitante, não 127.0.0.1')
})

test('chute de senha: bloqueio por origem após 20 erros (mesmo trocando o e-mail); outra origem não é afetada', async () => {
  for (let i = 0; i < 20; i++) {
    const r = await login({ email: `alvo${i}@x.com`, senha: 'errada', codigo: '000000' }, '198.51.100.99')
    assert.equal(r.status, 401, `tentativa ${i + 1}`)
  }
  assert.equal((await login({ email: 'novo@x.com', senha: 'errada', codigo: '000000' }, '198.51.100.99')).status, 429)
  // mesmo com a senha certa, a origem bloqueada fica barrada
  assert.equal((await login({ email: 'adm@x.com', senha: SENHA, codigo: m.codigoTotp(segredo, Math.floor(Date.now() / 30000) + 1) }, '198.51.100.99')).status, 429)
  // outra origem continua podendo tentar
  assert.equal((await login({ email: 'novo@x.com', senha: 'errada', codigo: '000000' }, '198.51.100.98')).status, 401)
})
