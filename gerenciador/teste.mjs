// Testes do painel central:  node --test gerenciador/teste.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'gerenciador-'))
const base_ = base
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

test('aba Configurações: token da Cloudflare é validado e nunca vaza (auditoria, pendentes, leitura)', async () => {
  const post = (corpo) => fetch(`${url}/api/tarefas`, { method: 'POST', headers: { ...H, cookie: globalThis.cookie }, body: JSON.stringify(corpo) })
  const TOKEN = 'cfut_ABCdef1234567890ABCdef1234567890abcd'
  for (const ruim of ['curto', 'tem espaço no meio 1234567890123456', 'x;rm -rf /;1234567890123456789', '`id`1234567890123456789012']) {
    const r = await post({ acao: 'cloudflare', token: ruim, dominio_base: 'exemplo.com.br' })
    assert.equal(r.status, 400, `token ruim aceito: ${ruim}`)
  }
  assert.equal((await post({ acao: 'cloudflare', token: TOKEN, dominio_base: 'exemplo.com.br;id' })).status, 400)
  // sem sessão não grava nada
  assert.equal((await fetch(`${url}/api/tarefas`, { method: 'POST', headers: H, body: JSON.stringify({ acao: 'cloudflare', token: TOKEN, dominio_base: 'exemplo.com.br' }) })).status, 401)
  const antes = readdirSync(join(base, 'pedidos')).length
  const ok = await post({ acao: 'cloudflare', token: TOKEN, dominio_base: 'Exemplo.com.br' })
  assert.equal(ok.status, 201)
  const arquivos = readdirSync(join(base, 'pedidos'))
  assert.equal(arquivos.length, antes + 1)
  const pedidos = arquivos.map((f) => JSON.parse(readFileSync(join(base, 'pedidos', f), 'utf8'))).filter((x) => x.acao === 'cloudflare')
  assert.equal(pedidos[0].dominio_base, 'exemplo.com.br')
  assert.equal(pedidos[0].token, TOKEN, 'o executor recebe o token')
  // o token não aparece na lista de tarefas pendentes, na auditoria nem na leitura das configurações
  const lista = await (await fetch(`${url}/api/tarefas`, { headers: { cookie: globalThis.cookie } })).text()
  assert.doesNotMatch(lista, new RegExp(TOKEN))
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /pedido-cloudflare/); assert.doesNotMatch(aud, new RegExp(TOKEN))
  writeFileSync(join(base, 'estado', 'configuracoes.json'), JSON.stringify({ cloudflare: { token_configurado: true, dominio_base: 'exemplo.com.br' } }))
  const cfg = await fetch(`${url}/api/configuracoes`, { headers: { cookie: globalThis.cookie } })
  assert.equal(cfg.status, 200); assert.equal((await cfg.json()).cloudflare.token_configurado, true)
  assert.equal((await fetch(`${url}/api/configuracoes`)).status, 401)
  // trocar só o domínio (token vazio) e remover são aceitos
  assert.equal((await post({ acao: 'cloudflare', dominio_base: 'exemplo.com.br' })).status, 201)
  assert.equal((await post({ acao: 'cloudflare-remover' })).status, 201)
})

test('aba Configurações: VPN (situação, reconectar, trocar credenciais) valida e nunca vaza segredos', async () => {
  const post = (corpo) => fetch(`${url}/api/tarefas`, { method: 'POST', headers: { ...H, cookie: globalThis.cookie }, body: JSON.stringify(corpo) })
  assert.equal((await fetch(`${url}/api/vpn`)).status, 401)
  writeFileSync(join(base, 'estado', 'vpn.json'), JSON.stringify({ tipo: 'strongswan', configurada: true, conectada: true, troca_credenciais: true, redes: ['192.168.10.0/24'] }))
  const v = await (await fetch(`${url}/api/vpn`, { headers: { cookie: globalThis.cookie } })).json()
  assert.equal(v.conectada, true)
  assert.equal((await post({ acao: 'vpn-reconectar' })).status, 201)
  // valores inválidos: vazio, curto, controle/quebra de linha
  assert.equal((await post({ acao: 'vpn-credenciais' })).status, 400)
  assert.equal((await post({ acao: 'vpn-credenciais', psk: 'abc' })).status, 400)
  assert.equal((await post({ acao: 'vpn-credenciais', psk: 'chave-ok-1234\nOUTRA' })).status, 400)
  assert.equal((await post({ acao: 'vpn-credenciais', senha: 'com\nquebra' })).status, 400)
  const PSK = 'chave-secreta-da-vpn-9876', SENHA = 'senha secreta 123 ç'
  const antes = readdirSync(join(base, 'pedidos')).length
  assert.equal((await post({ acao: 'vpn-credenciais', psk: PSK, senha: SENHA })).status, 201)
  const arquivos = readdirSync(join(base, 'pedidos'))
  assert.equal(arquivos.length, antes + 1)
  const p = arquivos.map((f) => JSON.parse(readFileSync(join(base, 'pedidos', f), 'utf8'))).find((x) => x.acao === 'vpn-credenciais')
  assert.equal(p.psk, PSK); assert.equal(p.senha, SENHA)
  const lista = await (await fetch(`${url}/api/tarefas`, { headers: { cookie: globalThis.cookie } })).text()
  assert.doesNotMatch(lista, /chave-secreta-da-vpn/); assert.doesNotMatch(lista, /senha secreta/)
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /pedido-vpn-credenciais/); assert.doesNotMatch(aud, /chave-secreta-da-vpn/); assert.doesNotMatch(aud, /senha secreta/)
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

test('servidor de e-mail pela aba Configurações: valida, não vaza a senha e "esqueci" avisa quando não está pronto', async () => {
  const post = (corpo) => fetch(`${url}/api/tarefas`, { method: 'POST', headers: { ...H, cookie: globalThis.cookie }, body: JSON.stringify(corpo) })
  const base = { acao: 'email', host: 'smtp.gmail.com', porta: 465, usuario: 'inscricoes@gmail.com', senha: 'abcd efgh ijkl mnop', remetente: 'inscricoes@gmail.com' }
  for (const ruim of [
    { host: 'x; rm -rf /' }, { host: 'localhost' }, { porta: 22 }, { porta: '465; id' }, { usuario: 'a b' }, { usuario: '`id`@x.com' },
    { senha: 'tem"aspas1234' }, { senha: 'cifrao$1234' }, { senha: 'barra\\invertida1' }, { senha: 'a'.repeat(200) }, { remetente: 'nao-e-email' },
  ]) {
    const r = await post({ ...base, ...ruim })
    assert.equal(r.status, 400, JSON.stringify(ruim))
  }
  assert.equal((await post({ ...base, usuario: 'sem-arroba', remetente: '' })).status, 400, 'remetente é obrigatório quando o usuário não é e-mail')
  const antes = new Set(readdirSync(join(base_, 'pedidos')))
  const ok = await post(base)
  assert.equal(ok.status, 201)
  const novos = readdirSync(join(base_, 'pedidos')).filter((f) => !antes.has(f))
  assert.equal(novos.length, 1)
  const pedido = JSON.parse(readFileSync(join(base_, 'pedidos', novos[0]), 'utf8'))
  assert.equal(pedido.senha, 'abcdefghijklmnop', 'espaços da senha de app são removidos; o executor recebe a senha')
  assert.equal(pedido.por, 'adm@x.com')
  // senha em branco = manter a guardada; remetente assume o usuário quando ele é um e-mail
  const manter = await post({ ...base, senha: '', remetente: '' })
  assert.equal(manter.status, 201)
  for (const acao of ['email-teste', 'email-aplicar', 'email-remover', 'tunel-unificar']) assert.equal((await post({ acao })).status, 201, acao)
  // a senha não aparece na auditoria nem na lista de pendentes
  const aud = readFileSync(join(base_, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.doesNotMatch(aud, /abcdefghijklmnop|abcd efgh/)
  assert.match(aud, /pedido-email/)
  const lista = JSON.stringify(await (await fetch(`${url}/api/tarefas`, { headers: { cookie: globalThis.cookie } })).json())
  assert.doesNotMatch(lista, /abcdefghijklmnop/)
  // sem login não se mexe no servidor de e-mail
  assert.equal((await fetch(`${url}/api/tarefas`, { method: 'POST', headers: H, body: JSON.stringify(base) })).status, 401)
  // sem domínio publicado / e-mail pronto, o "esqueci minha senha" avisa em vez de fingir que enviou
  const esq = await fetch(`${url}/api/esqueci`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'adm@x.com' }) })
  assert.equal(esq.status, 503)
})

test('login Microsoft por acampamento: valida, não vaza o segredo e só vale para instância que existe', async () => {
  const post = (corpo) => fetch(`${url}/api/tarefas`, { method: 'POST', headers: { ...H, cookie: globalThis.cookie }, body: JSON.stringify(corpo) })
  const G1 = '11111111-2222-3333-4444-555555555555', G2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', SEG = 'abcdefghijklmnopqrst~._-SEGREDO'
  const ok = { acao: 'microsoft', instancia: 'prefichas-sao-pedro', habilitar: true, tenant_id: G1, client_id: G2, segredo: SEG }
  for (const ruim of [
    { instancia: 'prefichas-nao-existe' }, { instancia: '../../etc' }, { tenant_id: 'nao-e-guid' }, { client_id: '' }, { tenant_id: `${G1}; id` },
    { segredo: 'curto' }, { segredo: 'com espaco e $(id) no meio do segredo' }, { segredo: 'aspas"no-meio-do-segredo-1234' },
  ]) assert.equal((await post({ ...ok, ...ruim })).status, 400, JSON.stringify(ruim))
  // desligar não exige IDs; segredo em branco = manter o guardado
  assert.equal((await post({ acao: 'microsoft', instancia: 'prefichas-sao-pedro', habilitar: false })).status, 201)
  const antes = new Set(readdirSync(join(base_, 'pedidos')))
  assert.equal((await post(ok)).status, 201)
  const novo = readdirSync(join(base_, 'pedidos')).find((f) => !antes.has(f))
  const pedido = JSON.parse(readFileSync(join(base_, 'pedidos', novo), 'utf8'))
  assert.equal(pedido.segredo, SEG, 'o executor recebe o segredo')
  assert.equal((await post({ ...ok, segredo: '' })).status, 201)
  const aud = readFileSync(join(base_, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.doesNotMatch(aud, /SEGREDO/); assert.match(aud, /pedido-microsoft/)
  assert.doesNotMatch(JSON.stringify(await (await fetch(`${url}/api/tarefas`, { headers: { cookie: globalThis.cookie } })).json()), /SEGREDO/)
  assert.equal((await fetch(`${url}/api/tarefas`, { method: 'POST', headers: H, body: JSON.stringify(ok) })).status, 401, 'sem login não liga nada')
})
