// Testes do painel central PUBLICADO na internet (atrás do proxy HTTPS):  node --test gerenciador/teste-publico.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
let segredo, segredoRed
const segMfa = {}
before(async () => {
  segredo = m.novoSegredoTotp(); segredoRed = m.novoSegredoTotp()
  writeFileSync(join(base, 'dados', 'usuarios.json'), JSON.stringify([
    { email: 'adm@x.com', senha: await m.gerarHash(SENHA), totp: segredo, ativo: true },
    { email: 'red@x.com', senha: await m.gerarHash(SENHA), totp: segredoRed, ativo: true },
    { email: 'fora@x.com', senha: await m.gerarHash(SENHA), totp: m.novoSegredoTotp(), ativo: false },
    ...(await Promise.all(['mfa1', 'mfa2', 'mfa3', 'mfa4', 'mfa5'].map(async (n) => {
      segMfa[n] = m.novoSegredoTotp()
      return { email: `${n}@x.com`, senha: await m.gerarHash(SENHA), totp: segMfa[n], ativo: true }
    }))),
  ]))
  writeFileSync(join(base, 'estado', 'configuracoes.json'), JSON.stringify({ email: { configurado: true, host: 'smtp.exemplo.com' } }))
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

// ------------------------------------------------------------------ esqueci minha senha
const pedidosEmail = () => readdirSync(join(base, 'pedidos')).map((f) => JSON.parse(readFileSync(join(base, 'pedidos', f), 'utf8'))).filter((p) => p.acao === 'email-redefinicao')
const limparPedidos = () => { for (const f of readdirSync(join(base, 'pedidos'))) rmSync(join(base, 'pedidos', f)) }
const esqueci = (email, ip) => chamar({ metodo: 'POST', caminho: '/api/esqueci', ip, corpo: { email } })
const tokenDe = (p) => /redefinir=([\w-]+)$/.exec(p.link)[1]

test('esqueci minha senha: mesma resposta para quem existe ou não; só usuário ativo gera pedido de e-mail', async () => {
  limparPedidos()
  const a = await esqueci('red@x.com', '203.0.113.31')
  const b = await esqueci('naoexiste@x.com', '203.0.113.31')
  const c = await esqueci('fora@x.com', '203.0.113.31')
  const d = await esqueci('isto-nao-e-email', '203.0.113.31')
  for (const r of [a, b, c, d]) assert.equal(r.status, 200)
  assert.equal(a.corpo, b.corpo); assert.equal(a.corpo, c.corpo)
  const pedidos = pedidosEmail()
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0].para, 'red@x.com')
  assert.match(pedidos[0].link, /^https:\/\/painel\.teste\.com\.br\/\?redefinir=[\w-]{40,}$/)
  // o disco guarda só o hash do token; o link não aparece na lista de tarefas
  assert.doesNotMatch(readFileSync(join(base, 'dados', 'redefinicoes.json'), 'utf8'), new RegExp(tokenDe(pedidos[0])))
})

test('redefinir: precisa do código do autenticador, o link vale uma vez, sessões antigas caem e a senha nova vale', async () => {
  limparPedidos()
  await esqueci('red@x.com', '203.0.113.32')
  const token = tokenDe(pedidosEmail()[0])
  const passo = Math.floor(Date.now() / 30000)
  const red = (corpo, ip = '203.0.113.33') => chamar({ metodo: 'POST', caminho: '/api/redefinir', ip, corpo })
  assert.equal((await red({ token, senha: 'curta', codigo: m.codigoTotp(segredoRed, passo) })).status, 400)
  assert.equal((await red({ token: 'x'.repeat(43), senha: 'senha-nova-bem-longa-1', codigo: m.codigoTotp(segredoRed, passo) })).status, 400)
  assert.equal((await red({ token, senha: 'senha-nova-bem-longa-1' })).status, 401, 'sem o código do autenticador não redefine')
  assert.equal((await red({ token, senha: 'senha-nova-bem-longa-1', codigo: '000000' })).status, 401)
  // uma sessão aberta antes da troca
  const antigo = await login({ email: 'red@x.com', senha: SENHA, codigo: m.codigoTotp(segredoRed, passo - 1) }, '203.0.113.34')
  assert.equal(antigo.status, 200)
  const cookieAntigo = antigo.headers['set-cookie'][0].split(';')[0]
  assert.equal(JSON.parse((await chamar({ caminho: '/api/eu', extra: { cookie: cookieAntigo } })).corpo).email, 'red@x.com')

  const ok = await red({ token, senha: 'senha-nova-bem-longa-1', codigo: m.codigoTotp(segredoRed, passo) })
  assert.equal(ok.status, 200, ok.corpo)
  assert.equal((await red({ token, senha: 'outra-senha-bem-longa-1', codigo: m.codigoTotp(segredoRed, passo + 1) })).status, 400, 'o link vale uma vez só')
  assert.equal(JSON.parse((await chamar({ caminho: '/api/eu', extra: { cookie: cookieAntigo } })).corpo).email, null, 'a sessão antiga caiu')
  assert.equal((await login({ email: 'red@x.com', senha: SENHA, codigo: m.codigoTotp(segredoRed, passo + 1) }, '203.0.113.35')).status, 401, 'a senha antiga deixou de valer')
  assert.equal((await login({ email: 'red@x.com', senha: 'senha-nova-bem-longa-1', codigo: m.codigoTotp(segredoRed, passo + 1) }, '203.0.113.36')).status, 200, 'a senha nova vale')
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /senha-redefinida/); assert.doesNotMatch(aud, /senha-nova-bem-longa/)
})

test('esqueci minha senha: limite por origem e aviso quando o e-mail do servidor não está configurado', async () => {
  const codigos = []
  for (let i = 0; i < 7; i++) codigos.push((await esqueci('red@x.com', '203.0.113.99')).status)
  assert.deepEqual(codigos.slice(0, 5), [200, 200, 200, 200, 200]); assert.equal(codigos[6], 429)
  writeFileSync(join(base, 'estado', 'configuracoes.json'), JSON.stringify({ email: { configurado: false } }))
  const sem = await esqueci('red@x.com', '203.0.113.40')
  assert.equal(sem.status, 503)
  assert.match(JSON.parse(sem.corpo).mensagem, /não está configurada/)
  writeFileSync(join(base, 'estado', 'configuracoes.json'), JSON.stringify({ email: { configurado: true } }))
})

// ------------------------------------------------------------------ esqueci minha senha só com o código do autenticador
const rmfa = (corpo, ip = '203.0.113.50') => chamar({ metodo: 'POST', caminho: '/api/redefinir-mfa', ip, corpo })
const passoAgora = () => Math.floor(Date.now() / 30000)

test('redefinir só com o código: senha nova, código de uso único, sessões antigas caem, senha antiga deixa de valer', async () => {
  const n = 'mfa1'; const email = `${n}@x.com`; const passo = passoAgora()
  const antigo = await login({ email, senha: SENHA, codigo: m.codigoTotp(segMfa[n], passo - 1) }, '203.0.113.51')
  assert.equal(antigo.status, 200)
  const cookie = antigo.headers['set-cookie'][0].split(';')[0]
  assert.equal(JSON.parse((await chamar({ caminho: '/api/eu', extra: { cookie } })).corpo).email, email)

  assert.equal((await rmfa({ email, codigo: m.codigoTotp(segMfa[n], passo), senha: 'curta' })).status, 400, 'senha fraca')
  const ok = await rmfa({ email, codigo: m.codigoTotp(segMfa[n], passo), senha: 'senha-nova-so-mfa-123' })
  assert.equal(ok.status, 200, ok.corpo)
  assert.equal((await rmfa({ email, codigo: m.codigoTotp(segMfa[n], passo), senha: 'outra-senha-so-mfa-123' })).status, 401, 'o mesmo código não vale duas vezes')
  assert.equal(JSON.parse((await chamar({ caminho: '/api/eu', extra: { cookie } })).corpo).email, null, 'a sessão antiga caiu')
  assert.equal((await login({ email, senha: SENHA, codigo: m.codigoTotp(segMfa[n], passo + 1) }, '203.0.113.52')).status, 401, 'a senha antiga deixou de valer')
  assert.equal((await login({ email, senha: 'senha-nova-so-mfa-123', codigo: m.codigoTotp(segMfa[n], passo + 1) }, '203.0.113.53')).status, 200, 'a senha nova vale')
  const aud = readFileSync(join(base, 'dados', 'auditoria.jsonl'), 'utf8')
  assert.match(aud, /senha-redefinida-mfa/); assert.doesNotMatch(aud, /senha-nova-so-mfa/)
})

test('redefinir só com o código: erro igual para usuário inexistente e código errado; só vale o código atual ou o anterior', async () => {
  const passo = passoAgora()
  const a = await rmfa({ email: 'mfa2@x.com', codigo: '000000', senha: 'senha-nova-so-mfa-123' }, '203.0.113.54')
  const b = await rmfa({ email: 'naoexiste@x.com', codigo: '000000', senha: 'senha-nova-so-mfa-123' }, '203.0.113.54')
  const c = await rmfa({ email: 'fora@x.com', codigo: '000000', senha: 'senha-nova-so-mfa-123' }, '203.0.113.54')
  assert.deepEqual([a.status, b.status, c.status], [401, 401, 401]); assert.equal(a.corpo, b.corpo); assert.equal(a.corpo, c.corpo)
  // o código do PRÓXIMO período (aceito no login) não vale aqui
  assert.equal((await rmfa({ email: 'mfa3@x.com', codigo: m.codigoTotp(segMfa.mfa3, passo + 1), senha: 'senha-nova-so-mfa-123' }, '203.0.113.55')).status, 401)
  // o do período anterior vale (quem digitou na virada do relógio)
  assert.equal((await rmfa({ email: 'mfa3@x.com', codigo: m.codigoTotp(segMfa.mfa3, passo - 1), senha: 'senha-nova-so-mfa-123' }, '203.0.113.55')).status, 200)
})

test('redefinir só com o código: 3 erros travam a redefinição daquele usuário (até com o código certo), sem travar o login', async () => {
  const n = 'mfa4'; const email = `${n}@x.com`; const passo = passoAgora()
  for (let i = 0; i < 3; i++) assert.equal((await rmfa({ email, codigo: '111111', senha: 'senha-nova-so-mfa-123' }, `203.0.113.6${i}`)).status, 401)
  const travado = await rmfa({ email, codigo: m.codigoTotp(segMfa[n], passo), senha: 'senha-nova-so-mfa-123' }, '203.0.113.69')
  assert.equal(travado.status, 429)
  // o login normal do mesmo usuário continua funcionando (contadores separados)
  assert.equal((await login({ email, senha: SENHA, codigo: m.codigoTotp(segMfa[n], passo) }, '203.0.113.70')).status, 200)
})

test('redefinir só com o código: dois pedidos ao mesmo tempo com o mesmo código, só um vale; pode ser desligado', async () => {
  const n = 'mfa5'; const email = `${n}@x.com`; const codigo = m.codigoTotp(segMfa[n], passoAgora())
  const r = await Promise.all([rmfa({ email, codigo, senha: 'corrida-mfa-um-123' }, '203.0.113.71'), rmfa({ email, codigo, senha: 'corrida-mfa-dois-123' }, '203.0.113.72')])
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 401])
  process.env.REDEFINIR_POR_MFA = 'false'
  try { assert.equal((await rmfa({ email, codigo, senha: 'qualquer-senha-123456' }, '203.0.113.73')).status, 404) } finally { delete process.env.REDEFINIR_POR_MFA }
})
