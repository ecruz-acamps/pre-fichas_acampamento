// Testes do painel central:  node --test gerenciador/teste.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'gerenciador-'))
for (const d of ['dados', 'pedidos', 'estado']) mkdirSync(join(base, d))
process.env.DADOS = join(base, 'dados'); process.env.PEDIDOS = join(base, 'pedidos'); process.env.ESTADO = join(base, 'estado')
process.env.REDES_PERMITIDAS = '127.0.0.1/32,10.20.0.0/16'
writeFileSync(join(base, 'estado', 'instancias.json'), JSON.stringify({ instancias: [{ pasta: 'prefichas-sao-pedro', nome: 'Acampamento São Pedro' }] }))

const m = await import('./servidor.mjs')
let url
const SENHA = 'senha-forte-do-teste'
let segredo
before(async () => {
  segredo = m.novoSegredoTotp()
  writeFileSync(join(base, 'dados', 'usuarios.json'), JSON.stringify([{ email: 'adm@x.com', senha: await m.gerarHash(SENHA), totp: segredo, ativo: true }]))
  await new Promise((r) => m.servidor.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${m.servidor.address().port}`
})
after(() => m.servidor.close())
const H = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' }
const codigoAgora = () => m.codigoTotp(segredo, Math.floor(Date.now() / 30000))

test('redes permitidas (VPN/local) e o resto recusado', () => {
  assert.equal(m.permitido('127.0.0.1'), true)
  assert.equal(m.permitido('::ffff:10.20.5.9'), true)
  assert.equal(m.permitido('10.21.0.1'), false)
  assert.equal(m.permitido('200.1.2.3'), false)
})

test('login exige senha E código do autenticador; código não pode ser reutilizado', async () => {
  const sem = await fetch(`${url}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com', senha: SENHA }) })
  assert.equal(sem.status, 401)
  const semCsrf = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(semCsrf.status, 403)
  const codigo = codigoAgora()
  const ok = await fetch(`${url}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com', senha: SENHA, codigo }) })
  assert.equal(ok.status, 200)
  const cookie = ok.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/)
  const repetido = await fetch(`${url}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com', senha: SENHA, codigo }) })
  assert.equal(repetido.status, 401, 'mesmo código não vale duas vezes')
  globalThis.cookie = cookie.split(';')[0]
})

test('sem login não vê nada; com login lista instâncias', async () => {
  assert.equal((await fetch(`${url}/api/instancias`)).status, 401)
  const r = await fetch(`${url}/api/instancias`, { headers: { cookie: globalThis.cookie } })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).instancias[0].pasta, 'prefichas-sao-pedro')
})

test('pedidos validados (injeção recusada) e gravados para o executor', async () => {
  const post = (corpo) => fetch(`${url}/api/tarefas`, { method: 'POST', headers: { ...H, cookie: globalThis.cookie }, body: JSON.stringify(corpo) })
  const ruim = await post({ acao: 'nova', nome: 'X; rm -rf /', publicacao: 'cloudflare', subdominio: 'a$(id)', admin_email: 'x', admin_nome: '' })
  assert.equal(ruim.status, 400)
  const erros = (await ruim.json()).erros
  assert.ok(erros.nome && erros.subdominio && erros.admin_email && erros.admin_nome)
  assert.equal((await post({ acao: 'atualizar', instancia: '../../etc' })).status, 400)
  assert.equal((await post({ acao: 'atualizar', instancia: 'prefichas-nao-existe' })).status, 400)
  assert.equal((await post({ acao: 'apagar-tudo' })).status, 400)
  const ok = await post({ acao: 'nova', nome: 'Acampamento São Paulo', publicacao: 'cloudflare', subdominio: 'sao-paulo', admin_email: 'a@b.com', admin_nome: 'Ana Souza', chave: 'ABC-1234' })
  assert.equal(ok.status, 201)
  const arquivos = readdirSync(join(base, 'pedidos'))
  assert.equal(arquivos.length, 1)
  const p = JSON.parse(readFileSync(join(base, 'pedidos', arquivos[0]), 'utf8'))
  assert.equal(p.acao, 'nova'); assert.equal(p.por, 'adm@x.com')
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /pedido-nova/)
  assert.doesNotMatch(aud, /ABC-1234/, 'a chave de ativação não vai para a auditoria')
})

test('bloqueio após 5 tentativas erradas', async () => {
  for (let i = 0; i < 5; i++) await fetch(`${url}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com', senha: 'errada', codigo: '000000' }) })
  const r = await fetch(`${url}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com', senha: SENHA, codigo: codigoAgora() }) })
  assert.equal(r.status, 429)
})

test('arquivos do painel: só nomes simples (sem ../)', async () => {
  assert.equal((await fetch(`${url}/`)).status, 200)
  assert.equal((await fetch(`${url}/..%2fservidor.mjs`)).status, 404)
  assert.equal((await fetch(`${url}/servidor.mjs`)).status, 404)
})
