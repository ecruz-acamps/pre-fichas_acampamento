// Testes de integração da API contra um PostgreSQL de verdade.
//   DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
// ATENÇÃO: o banco de teste é APAGADO a cada execução. Nunca aponte para produção.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { construirApp } from '../app.js'
import { lerConfig } from '../config.js'
import { criarPool, migrar } from '../db.js'
import { gerarHash } from '../senha.js'

const URL_TESTE = process.env.DATABASE_URL_TESTE
const pular = !URL_TESTE && 'defina DATABASE_URL_TESTE para rodar os testes de integração'

const FICHA = {
  nome_completo: 'Maria Silva', data_nascimento: '2000-05-10', estado_civil: 'solteiro', sexo: 'feminino',
  profissao: 'Professora', telefone: '(48) 99999-0000', religiao: 'Católica',
  batizado: true, primeira_eucaristia: true, crismado: false, paroquia: 'São José',
  participa_pastoral: false, email: 'Maria@X.com', cep: '88015-200', logradouro: 'Rua A', numero: '10',
  bairro: 'Centro', cidade: 'Florianópolis', uf: 'SC', como_conheceu: 'Instagram',
  motivo: 'Quero viver Deus', modalidade: 'juvenil', possui_vicio: false,
  aceite_lgpd: true, aceite_atividades: true, aceite_lista_espera: true,
}

describe('API', { skip: pular }, () => {
  let app, pool
  const H = { 'x-requested-with': 'fetch' }

  async function login(email, senha) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, senha } })
    const cookie = r.cookies.find((c) => c.name === 'prefichas_sessao')
    return { r, cookie: cookie && `${cookie.name}=${cookie.value}` }
  }
  const comSessao = (cookie) => ({ ...H, cookie })

  before(async () => {
    pool = criarPool(URL_TESTE)
    await pool.query('drop schema public cascade; create schema public')
    await migrar(pool, { info: () => {} })
    const config = { ...lerConfig({ DATABASE_URL: URL_TESTE }), cookieSeguro: false, limiteEnviosPorHora: 1000, limiteLoginPorMinuto: 1000 }
    app = await construirApp({ pool, config, logger: false })
    await pool.query(
      `insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values
        ('admin@x.com', 'Admin', 'admin', $1, false),
        ('equipe@x.com', 'Equipe', 'equipe', $1, false),
        ('novo@x.com', 'Novo', 'equipe', $1, true)`,
      [await gerarHash('senha-correta-123')])
  })

  after(async () => {
    await app?.close()
    await pool?.end()
  })

  test('envio público válido entra na fila com data do servidor', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pre-fichas',
      payload: { ...FICHA, created_at: '2000-01-01T00:00:00Z', status: 'confirmado', id: 999 } })
    assert.equal(r.statusCode, 201)
    const { rows: [f] } = await pool.query('select * from pre_fichas order by id desc limit 1')
    assert.equal(f.status, 'aguardando')
    assert.notEqual(f.id, 999)
    assert.ok(Date.now() - new Date(f.created_at).getTime() < 60_000, 'created_at deve ser agora')
    assert.equal(f.email, 'maria@x.com')
    assert.equal(f.cep, '88015200')
  })

  test('envio inválido é recusado com a lista de erros', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pre-fichas',
      payload: { ...FICHA, aceite_lista_espera: false, modalidade: 'mirim', email: 'x', nome_completo: 123 } })
    assert.equal(r.statusCode, 400)
    const { erros } = r.json()
    assert.ok(erros.aceite_lista_espera && erros.modalidade && erros.email && erros.nome_completo)
  })

  test('menor de idade exige responsável', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/pre-fichas',
      payload: { ...FICHA, data_nascimento: '2015-01-01', modalidade: 'mirim' } })
    assert.equal(r.statusCode, 400)
    assert.ok(r.json().erros.responsavel_nome)
  })

  test('honeypot preenchido finge sucesso e não grava', async () => {
    const { rows: [{ n: antes }] } = await pool.query('select count(*)::int n from pre_fichas')
    const r = await app.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, website: 'spam' } })
    assert.equal(r.statusCode, 201)
    const { rows: [{ n: depois }] } = await pool.query('select count(*)::int n from pre_fichas')
    assert.equal(depois, antes)
  })

  test('fila não é acessível sem login', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas' })
    assert.equal(r.statusCode, 401)
  })

  test('login com senha errada é recusado', async () => {
    const { r } = await login('admin@x.com', 'errada')
    assert.equal(r.statusCode, 401)
    const { r: r2 } = await login('naoexiste@x.com', 'errada')
    assert.equal(r2.statusCode, 401)
  })

  test('alteração sem cabeçalho anti-CSRF é recusada', async () => {
    const { cookie } = await login('equipe@x.com', 'senha-correta-123')
    const r = await app.inject({ method: 'PATCH', url: '/api/admin/pre-fichas/1', headers: { cookie }, payload: { status: 'confirmado' } })
    assert.equal(r.statusCode, 403)
  })

  test('equipe vê a fila, altera status e o histórico é registrado', async () => {
    const { cookie } = await login('equipe@x.com', 'senha-correta-123')
    const lista = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: comSessao(cookie) })
    assert.equal(lista.statusCode, 200)
    const [primeira] = lista.json()
    assert.equal(primeira.ip_origem, undefined, 'IP não deve ser exposto')

    const r = await app.inject({ method: 'PATCH', url: `/api/admin/pre-fichas/${primeira.id}`, headers: comSessao(cookie),
      payload: { status: 'em_contato', observacoes_internas: 'Liguei hoje', created_at: '2000-01-01', nome_completo: 'Hacker' } })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().status, 'em_contato')
    assert.equal(r.json().nome_completo, 'Maria Silva')
    assert.equal(r.json().created_at, primeira.created_at)

    const h = await app.inject({ method: 'GET', url: `/api/admin/pre-fichas/${primeira.id}/historico`, headers: comSessao(cookie) })
    assert.equal(h.json().length, 1)
    assert.equal(h.json()[0].status_novo, 'em_contato')
    assert.equal(h.json()[0].usuario, 'Equipe')
  })

  test('status inválido é recusado', async () => {
    const { cookie } = await login('equipe@x.com', 'senha-correta-123')
    const r = await app.inject({ method: 'PATCH', url: '/api/admin/pre-fichas/1', headers: comSessao(cookie), payload: { status: 'vip' } })
    assert.equal(r.statusCode, 400)
  })

  test('banco impede alterar a data de inscrição', async () => {
    await assert.rejects(pool.query(`update pre_fichas set created_at = now() - interval '1 year'`), /não pode ser alterada/)
  })

  test('equipe não gerencia usuários; admin sim', async () => {
    const { cookie: equipe } = await login('equipe@x.com', 'senha-correta-123')
    const r = await app.inject({ method: 'GET', url: '/api/admin/usuarios', headers: comSessao(equipe) })
    assert.equal(r.statusCode, 403)

    const { cookie: admin } = await login('admin@x.com', 'senha-correta-123')
    const c = await app.inject({ method: 'POST', url: '/api/admin/usuarios', headers: comSessao(admin),
      payload: { email: 'Fulano@X.com', nome: 'Fulano', papel: 'equipe' } })
    assert.equal(c.statusCode, 201)
    assert.match(c.json().senhaTemporaria, /^[a-z]{4}-\d{4}-[a-z]{4}$/)

    const dup = await app.inject({ method: 'POST', url: '/api/admin/usuarios', headers: comSessao(admin),
      payload: { email: 'fulano@x.com', nome: 'Fulano 2' } })
    assert.equal(dup.statusCode, 409)

    // novo usuário entra com a senha temporária mas precisa trocá-la antes de ver a fila
    const { cookie: fulano } = await login('fulano@x.com', c.json().senhaTemporaria)
    const bloqueado = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: comSessao(fulano) })
    assert.equal(bloqueado.statusCode, 403)
    assert.equal(bloqueado.json().trocarSenha, true)
    const troca = await app.inject({ method: 'POST', url: '/api/auth/senha', headers: comSessao(fulano),
      payload: { senhaAtual: c.json().senhaTemporaria, novaSenha: 'minha-senha-nova' } })
    assert.equal(troca.statusCode, 200)
    const liberado = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: comSessao(fulano) })
    assert.equal(liberado.statusCode, 200)
  })

  test('admin não pode remover o próprio acesso nem ficar sem admin', async () => {
    const { cookie } = await login('admin@x.com', 'senha-correta-123')
    const { rows: [eu] } = await pool.query(`select id from usuarios where email = 'admin@x.com'`)
    const r = await app.inject({ method: 'PATCH', url: `/api/admin/usuarios/${eu.id}`, headers: comSessao(cookie), payload: { ativo: false } })
    assert.equal(r.statusCode, 400)
  })

  test('usuário desativado perde a sessão na hora', async () => {
    const { cookie: equipe } = await login('equipe@x.com', 'senha-correta-123')
    const { cookie: admin } = await login('admin@x.com', 'senha-correta-123')
    const { rows: [u] } = await pool.query(`select id from usuarios where email = 'equipe@x.com'`)
    await app.inject({ method: 'PATCH', url: `/api/admin/usuarios/${u.id}`, headers: comSessao(admin), payload: { ativo: false } })
    const r = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: comSessao(equipe) })
    assert.equal(r.statusCode, 401)
    const { r: relogin } = await login('equipe@x.com', 'senha-correta-123')
    assert.equal(relogin.statusCode, 401)
  })

  test('logout encerra a sessão', async () => {
    const { cookie } = await login('admin@x.com', 'senha-correta-123')
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: comSessao(cookie) })
    const r = await app.inject({ method: 'GET', url: '/api/auth/eu', headers: comSessao(cookie) })
    assert.equal(r.json().usuario, null)
    const fila = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: comSessao(cookie) })
    assert.equal(fila.statusCode, 401)
  })

  test('posição na fila segue a ordem de chegada por modalidade', async () => {
    for (const nome of ['Segundo Juvenil', 'Terceiro Juvenil']) {
      await app.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: nome } })
    }
    await app.inject({ method: 'POST', url: '/api/pre-fichas',
      payload: { ...FICHA, nome_completo: 'Casal Sênior', data_nascimento: '1985-01-01', estado_civil: 'casado', modalidade: 'senior' } })
    const { rows } = await pool.query('select posicao, nome_completo, modalidade from fila_espera order by modalidade, posicao')
    assert.deepEqual(rows.map((r) => `${r.modalidade}:${r.posicao}:${r.nome_completo}`), [
      'juvenil:1:Maria Silva', 'juvenil:2:Segundo Juvenil', 'juvenil:3:Terceiro Juvenil', 'senior:1:Casal Sênior',
    ])
  })

  test('excesso de tentativas de login é bloqueado', async () => {
    const config = { ...lerConfig({ DATABASE_URL: URL_TESTE }), limiteLoginPorMinuto: 3 }
    const app2 = await construirApp({ pool, config, logger: false })
    const codigos = []
    for (let i = 0; i < 5; i++) {
      const r = await app2.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'admin@x.com', senha: 'chute' } })
      codigos.push(r.statusCode)
    }
    await app2.close()
    assert.deepEqual(codigos, [401, 401, 401, 429, 429])
  })

  test('site e cabeçalhos de segurança', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/saude' })
    assert.equal(r.statusCode, 200)
    assert.match(r.headers['content-security-policy'], /default-src 'self'/)
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN')

    for (const url of ['/', '/admin/']) {
      const pagina = await app.inject({ method: 'GET', url })
      assert.equal(pagina.statusCode, 200, `GET ${url}`)
      assert.match(pagina.body, /<div id="root">/)
      assert.equal(pagina.headers['cache-control'], 'no-cache')
    }
    const redir = await app.inject({ method: 'GET', url: '/admin' })
    assert.equal(redir.statusCode, 301)
    assert.equal((await app.inject({ method: 'GET', url: '/nao-existe' })).statusCode, 404)
  })
})
