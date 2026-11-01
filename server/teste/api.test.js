// Testes de integração da API contra um PostgreSQL de verdade.
//   DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
// ATENÇÃO: o banco de teste é APAGADO a cada execução. Nunca aponte para produção.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { construirApp } from '../app.js'
import { lerConfig } from '../config.js'
import { criarPool, migrar } from '../db.js'
import { invalidarMarca } from '../marca.js'
import { gerarHash } from '../senha.js'

const URL_TESTE = process.env.DATABASE_URL_TESTE
const pular = !URL_TESTE && 'defina DATABASE_URL_TESTE para rodar os testes de integração'
const SENHA = 'senha-correta-123'

const FICHA = {
  nome_completo: 'Maria Silva', data_nascimento: '2000-05-10', estado_civil: 'solteiro', sexo: 'feminino',
  profissao: 'Professora', telefone: '(48) 99999-0000', religiao: 'Católica',
  batizado: true, primeira_eucaristia: true, crismado: false, paroquia: 'São José',
  participa_pastoral: false, email: 'Maria@X.com', cep: '88015-200', logradouro: 'Rua A', numero: '10',
  bairro: 'Centro', cidade: 'Florianópolis', uf: 'SC', como_conheceu: 'Instagram',
  motivo: 'Quero viver Deus', modalidade: 'juvenil', possui_vicio: false,
  aceites: [true, true, true],
}

describe('API', { skip: pular }, () => {
  let app, pool
  const H = { 'x-requested-with': 'fetch' }
  const sessoes = {}

  async function login(email, senha = SENHA) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email, senha } })
    const cookie = r.cookies.find((c) => c.name === 'prefichas_sessao')
    return { r, cookie: cookie && `${cookie.name}=${cookie.value}` }
  }
  const como = (quem) => ({ ...H, cookie: sessoes[quem] })
  const req = (quem, method, url, payload) => app.inject({ method, url, headers: como(quem), payload })
  const enviar = (dados) => app.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, ...dados } })
  const idPorNome = async (nome) => (await pool.query('select id from pre_fichas where nome_completo = $1', [nome])).rows[0].id

  before(async () => {
    pool = criarPool(URL_TESTE)
    await pool.query('drop schema public cascade; create schema public')
    await migrar(pool, { info: () => {} })
    invalidarMarca()
    const config = {
      ...lerConfig({ DATABASE_URL: URL_TESTE }), cookieSeguro: false, limiteEnviosPorHora: 1000, limiteLoginPorMinuto: 1000,
    }
    app = await construirApp({ pool, config, logger: false })
    await pool.query(
      `insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values
        ('admin@x.com', 'Admin', 'admin', $1, false),
        ('equipe@x.com', 'Equipe', 'equipe', $1, false),
        ('coord@x.com', 'Coordenadora', 'coordenador', $1, false)`,
      [await gerarHash(SENHA)])
    for (const quem of ['admin', 'equipe', 'coord']) sessoes[quem] = (await login(`${quem}@x.com`)).cookie
  })

  after(async () => {
    await app?.close()
    await pool?.end()
  })

  // ------------------------------------------------------------------ envio
  describe('envio da pré-ficha', () => {
    test('válido: entra na fila com data do servidor e grava o texto dos termos', async () => {
      const r = await enviar({ created_at: '2000-01-01T00:00:00Z', status: 'confirmado', id: 999 })
      assert.equal(r.statusCode, 201)
      const { rows: [f] } = await pool.query('select * from pre_fichas order by id desc limit 1')
      assert.equal(f.status, 'aguardando')
      assert.notEqual(f.id, 999)
      assert.ok(Date.now() - new Date(f.created_at).getTime() < 60_000)
      assert.equal(f.email, 'maria@x.com')
      assert.equal(f.cep, '88015200')
      assert.equal(f.termos_aceitos.length, 3)
      assert.match(f.termos_aceitos[2], /lista de espera/)
      assert.doesNotMatch(f.termos_aceitos[2], /\*\*/)
    })

    test('inválido: recusa com a lista de erros (inclusive termo não aceito)', async () => {
      const r = await enviar({ aceites: [true, false], modalidade: 'mirim', email: 'x', nome_completo: 123 })
      assert.equal(r.statusCode, 400)
      const { erros } = r.json()
      assert.ok(erros.aceite_1 && erros.aceite_2 && erros.modalidade && erros.email && erros.nome_completo)
    })

    test('menor de idade exige responsável', async () => {
      const r = await enviar({ data_nascimento: '2015-01-01', modalidade: 'mirim' })
      assert.equal(r.statusCode, 400)
      assert.ok(r.json().erros.responsavel_nome)
    })

    test('honeypot preenchido finge sucesso e não grava', async () => {
      const { rows: [{ n: antes }] } = await pool.query('select count(*)::int n from pre_fichas')
      assert.equal((await enviar({ website: 'spam' })).statusCode, 201)
      const { rows: [{ n: depois }] } = await pool.query('select count(*)::int n from pre_fichas')
      assert.equal(depois, antes)
    })
  })

  // ------------------------------------------------------------------ acesso
  describe('autenticação e permissões', () => {
    test('fila não é acessível sem login', async () => {
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/pre-fichas' })).statusCode, 401)
    })

    test('login com senha errada é recusado', async () => {
      assert.equal((await login('admin@x.com', 'errada')).r.statusCode, 401)
      assert.equal((await login('naoexiste@x.com', 'errada')).r.statusCode, 401)
    })

    test('alteração sem cabeçalho anti-CSRF é recusada', async () => {
      const r = await app.inject({ method: 'PATCH', url: '/api/admin/pre-fichas/1', headers: { cookie: sessoes.equipe }, payload: { status: 'confirmado' } })
      assert.equal(r.statusCode, 403)
    })

    test('coordenador não acessa usuários, localidades, acampamentos nem configurações', async () => {
      for (const [m, url] of [['GET', '/api/admin/usuarios'], ['GET', '/api/admin/localidades'],
        ['GET', '/api/admin/acampamentos'], ['PUT', '/api/admin/marca']]) {
        assert.equal((await req('coord', m, url, {})).statusCode, 403, `${m} ${url}`)
      }
    })

    test('primeiro acesso exige troca de senha', async () => {
      const c = await req('admin', 'POST', '/api/admin/usuarios', { email: 'Novo@X.com', nome: 'Novo', papel: 'equipe' })
      assert.equal(c.statusCode, 201)
      const temp = c.json().senhaTemporaria
      assert.match(temp, /^[a-z]{4}-\d{4}-[a-z]{4}$/)
      const { cookie } = await login('novo@x.com', temp)
      const bloqueado = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: { ...H, cookie } })
      assert.equal(bloqueado.statusCode, 403)
      const troca = await app.inject({ method: 'POST', url: '/api/auth/senha', headers: { ...H, cookie },
        payload: { senhaAtual: temp, novaSenha: 'minha-senha-nova' } })
      assert.equal(troca.statusCode, 200)
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: { ...H, cookie } })).statusCode, 200)
    })

    test('admin não pode remover o próprio acesso', async () => {
      const { rows: [eu] } = await pool.query(`select id from usuarios where email = 'admin@x.com'`)
      assert.equal((await req('admin', 'PATCH', `/api/admin/usuarios/${eu.id}`, { ativo: false })).statusCode, 400)
    })

    test('usuário desativado perde a sessão na hora', async () => {
      const { cookie } = await login('novo@x.com', 'minha-senha-nova')
      const { rows: [u] } = await pool.query(`select id from usuarios where email = 'novo@x.com'`)
      await req('admin', 'PATCH', `/api/admin/usuarios/${u.id}`, { ativo: false })
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: { ...H, cookie } })).statusCode, 401)
    })

    test('excesso de tentativas de login é bloqueado', async () => {
      const config = { ...lerConfig({ DATABASE_URL: URL_TESTE }), limiteLoginPorMinuto: 3 }
      const app2 = await construirApp({ pool, config, logger: false })
      const codigos = []
      for (let i = 0; i < 5; i++) {
        codigos.push((await app2.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { email: 'a@x.com', senha: 'x' } })).statusCode)
      }
      await app2.close()
      assert.deepEqual(codigos, [401, 401, 401, 429, 429])
    })
  })

  // ------------------------------------------------------------------ fila
  describe('fila', () => {
    test('equipe altera status e o histórico é registrado; outros campos são ignorados', async () => {
      const id = await idPorNome('Maria Silva')
      const { rows: [antes] } = await pool.query('select created_at from pre_fichas where id = $1', [id])
      const r = await req('equipe', 'PATCH', `/api/admin/pre-fichas/${id}`,
        { status: 'em_contato', observacoes_internas: 'Liguei hoje', created_at: '2000-01-01', nome_completo: 'Hacker' })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().status, 'em_contato')
      assert.equal(r.json().nome_completo, 'Maria Silva')
      assert.equal(new Date(r.json().created_at).getTime(), antes.created_at.getTime())
      assert.equal(r.json().ip_origem, undefined)
      const h = await req('equipe', 'GET', `/api/admin/pre-fichas/${id}/historico`)
      assert.equal(h.json()[0].status_novo, 'em_contato')
      assert.equal(h.json()[0].usuario, 'Equipe')
    })

    test('status inválido é recusado', async () => {
      assert.equal((await req('equipe', 'PATCH', '/api/admin/pre-fichas/1', { status: 'vip' })).statusCode, 400)
    })

    test('banco impede alterar a data de inscrição', async () => {
      await assert.rejects(pool.query(`update pre_fichas set created_at = now() - interval '1 year'`), /não pode ser alterada/)
    })

    test('posição na fila segue a ordem de chegada por modalidade', async () => {
      await enviar({ nome_completo: 'Segundo Juvenil', cidade: 'São José', bairro: 'Kobrasol' })
      await enviar({ nome_completo: 'Terceiro Juvenil', bairro: 'Trindade' })
      await enviar({ nome_completo: 'Casal Sênior', data_nascimento: '1985-01-01', estado_civil: 'casado', modalidade: 'senior', cidade: 'Palhoça', bairro: 'Pagani' })
      const { rows } = await pool.query('select posicao, nome_completo, modalidade from fila_espera order by modalidade, posicao')
      assert.deepEqual(rows.map((r) => `${r.modalidade}:${r.posicao}:${r.nome_completo}`), [
        'juvenil:1:Maria Silva', 'juvenil:2:Segundo Juvenil', 'juvenil:3:Terceiro Juvenil', 'senior:1:Casal Sênior',
      ])
    })
  })

  // ------------------------------------------------------------------ núcleos
  describe('núcleos e coordenadores', () => {
    let nucleoId

    test('coordenador sem núcleo não vê nenhuma ficha', async () => {
      const r = await req('coord', 'GET', '/api/admin/pre-fichas')
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().length, 0)
    })

    test('admin cria núcleo (cidade inteira + bairro específico) e associa a coordenadora', async () => {
      const r = await req('admin', 'POST', '/api/admin/nucleos', {
        nome: 'Núcleo Grande Floripa',
        areas: [{ uf: 'SC', cidade: 'SAO JOSE' }, { uf: 'sc', cidade: 'florianopolis', bairro: 'centro' }],
      })
      assert.equal(r.statusCode, 201)
      nucleoId = r.json().id
      assert.equal((await req('admin', 'POST', '/api/admin/nucleos', { nome: 'núcleo grande floripa', areas: [] })).statusCode, 409)
      assert.equal((await req('admin', 'POST', '/api/admin/nucleos', { nome: 'X', areas: [{ uf: 'ZZ', cidade: 'A' }] })).statusCode, 400)

      const { rows: [c] } = await pool.query(`select id from usuarios where email = 'coord@x.com'`)
      const u = await req('admin', 'PATCH', `/api/admin/usuarios/${c.id}`, { nucleos: [nucleoId] })
      assert.deepEqual(u.json().usuario.nucleos, [nucleoId])
    })

    test('coordenadora vê só as fichas da sua área (comparação sem acento/maiúsculas)', async () => {
      const r = await req('coord', 'GET', '/api/admin/pre-fichas')
      assert.deepEqual(r.json().map((f) => f.nome_completo).sort(), ['Maria Silva', 'Segundo Juvenil'])
      assert.deepEqual(r.json()[0].nucleos, [nucleoId])
      assert.equal(r.json()[0].cidade_chave, undefined)
    })

    test('coordenadora não altera nem vê histórico de ficha fora da área', async () => {
      const fora = await idPorNome('Terceiro Juvenil')
      assert.equal((await req('coord', 'PATCH', `/api/admin/pre-fichas/${fora}`, { status: 'em_contato' })).statusCode, 404)
      assert.equal((await req('coord', 'GET', `/api/admin/pre-fichas/${fora}/historico`)).statusCode, 404)
      const dentro = await idPorNome('Segundo Juvenil')
      assert.equal((await req('coord', 'PATCH', `/api/admin/pre-fichas/${dentro}`, { observacoes_internas: 'ok' })).statusCode, 200)
    })

    test('listagem de núcleos: coordenadora vê o seu, com contagem da fila', async () => {
      await req('admin', 'POST', '/api/admin/nucleos', { nome: 'Núcleo Sul', areas: [{ uf: 'SC', cidade: 'Palhoça' }] })
      const r = await req('coord', 'GET', '/api/admin/nucleos')
      assert.equal(r.json().length, 1)
      assert.equal(r.json()[0].na_fila, 2)
      assert.equal(r.json()[0].coordenadores[0].nome, 'Coordenadora')
      assert.equal((await req('admin', 'GET', '/api/admin/nucleos')).json().length, 2)
    })

    test('localidades mostram quais cidades/bairros ainda não têm núcleo', async () => {
      const r = await req('admin', 'GET', '/api/admin/localidades')
      const trindade = r.json().find((l) => l.bairro === 'Trindade')
      const kobrasol = r.json().find((l) => l.bairro === 'Kobrasol')
      assert.equal(trindade.coberto, false)
      assert.equal(kobrasol.coberto, true)
    })
  })

  // ------------------------------------------------------------------ acampamentos
  describe('acampamentos e tribos', () => {
    let acampId

    test('equipe cadastra a edição; número repetido na mesma modalidade é recusado', async () => {
      const r = await req('equipe', 'POST', '/api/admin/acampamentos',
        { numero: 45, modalidade: 'juvenil', data_inicio: '2026-10-10', data_fim: '2026-10-12' })
      assert.equal(r.statusCode, 201)
      acampId = r.json().id
      assert.equal((await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 45, modalidade: 'juvenil' })).statusCode, 409)
      assert.equal((await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 45, modalidade: 'senior' })).statusCode, 201)
      assert.equal((await req('equipe', 'POST', '/api/admin/acampamentos',
        { numero: 1, modalidade: 'fac', data_inicio: '2026-10-10', data_fim: '2026-10-01' })).statusCode, 400)
    })

    test('registrar quem fez o acampamento, com a tribo: a ficha sai da fila', async () => {
      const id = await idPorNome('Maria Silva')
      assert.equal((await req('equipe', 'PUT', `/api/admin/acampamentos/${acampId}/participantes/${id}`, { tribo: 'Rosa' })).statusCode, 400)
      const r = await req('equipe', 'PUT', `/api/admin/acampamentos/${acampId}/participantes/${id}`, { tribo: 'Azul' })
      assert.equal(r.statusCode, 200)
      const { rows: [f] } = await pool.query('select status from pre_fichas where id = $1', [id])
      assert.equal(f.status, 'participou')
      const { rows: fila } = await pool.query(`select nome_completo from fila_espera where modalidade = 'juvenil' order by posicao`)
      assert.deepEqual(fila.map((x) => x.nome_completo), ['Segundo Juvenil', 'Terceiro Juvenil'])
      const h = await req('equipe', 'GET', `/api/admin/pre-fichas/${id}/historico`)
      assert.match(h.json()[0].observacao, /Fez o 45º Juvenil — tribo Azul/)

      // trocar a tribo
      await req('equipe', 'PUT', `/api/admin/acampamentos/${acampId}/participantes/${id}`, { tribo: 'Verde' })
      const terceiro = await idPorNome('Terceiro Juvenil')
      await req('admin', 'PUT', `/api/admin/acampamentos/${acampId}/participantes/${terceiro}`, { tribo: 'Verde' })
    })

    test('a edição lista participantes e contagem por tribo; a ficha mostra os acampamentos', async () => {
      const det = await req('equipe', 'GET', `/api/admin/acampamentos/${acampId}`)
      assert.equal(det.json().participantes.length, 2)
      const lista = await req('equipe', 'GET', '/api/admin/acampamentos')
      const ed = lista.json().find((a) => a.id === acampId)
      assert.deepEqual(ed.por_tribo, { Verde: 2 })
      const fichas = await req('equipe', 'GET', '/api/admin/pre-fichas')
      const maria = fichas.json().find((f) => f.nome_completo === 'Maria Silva')
      assert.equal(maria.participacoes[0].numero, 45)
      assert.equal(maria.participacoes[0].tribo, 'Verde')
    })

    test('não exclui edição com participantes; desfazer registro devolve a ficha como confirmada', async () => {
      assert.equal((await req('equipe', 'DELETE', `/api/admin/acampamentos/${acampId}`)).statusCode, 400)
      const terceiro = await idPorNome('Terceiro Juvenil')
      assert.equal((await req('equipe', 'DELETE', `/api/admin/acampamentos/${acampId}/participantes/${terceiro}`)).statusCode, 200)
      const { rows: [f] } = await pool.query('select status from pre_fichas where id = $1', [terceiro])
      assert.equal(f.status, 'confirmado')
    })
  })

  // ------------------------------------------------------------------ marca
  describe('marca (identidade do acampamento)', () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c90000000049454e44ae426082', 'hex')

    test('padrão: termos e tribos padrão, sem logo', async () => {
      const m = (await app.inject({ method: 'GET', url: '/api/marca' })).json()
      assert.equal(m.termos.length, 3)
      assert.equal(m.tribos.length, 7)
      assert.equal(m.logoUrl, null)
    })

    test('admin altera nome, cor, termos e tribos; a página e o tema refletem na hora', async () => {
      const r = await req('admin', 'PUT', '/api/admin/marca', {
        nome: 'Acampamento Beata Albertina', nomeCurto: 'Beata Albertina', corPrimaria: '#1F4F8B',
        whatsapp: '(48) 98888-7777', termos: ['Aceito os termos.', 'Autorizo contato.'],
        tribos: [{ nome: 'Azul', cor: '#0000ff' }, { nome: 'Branca', cor: '#ffffff' }],
      })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().whatsapp, '5548988887777')
      assert.equal(r.json().corPrimaria, '#1f4f8b')

      const html = await app.inject({ method: 'GET', url: '/' })
      assert.match(html.body, /<title>Pré-ficha de inscrição · Acampamento Beata Albertina<\/title>/)
      assert.match(html.body, /og:site_name" content="Acampamento Beata Albertina"/)
      const admin = await app.inject({ method: 'GET', url: '/admin/' })
      assert.match(admin.body, /Fila de espera · Beata Albertina/)
      const css = await app.inject({ method: 'GET', url: '/api/marca/tema.css' })
      assert.match(css.body, /--cor:#1f4f8b/)

      // agora o formulário exige só 2 declarações e grava os textos novos
      assert.equal((await enviar({ nome_completo: 'Nova Pessoa', aceites: [true] })).statusCode, 400)
      assert.equal((await enviar({ nome_completo: 'Nova Pessoa', aceites: [true, true] })).statusCode, 201)
      const { rows: [f] } = await pool.query(`select termos_aceitos from pre_fichas where nome_completo = 'Nova Pessoa'`)
      assert.deepEqual(f.termos_aceitos, ['Aceito os termos.', 'Autorizo contato.'])
    })

    test('dados inválidos de marca são recusados; equipe não altera', async () => {
      const r = await req('admin', 'PUT', '/api/admin/marca', { nome: 'X', corPrimaria: 'azul', tribos: [{ nome: 'A', cor: '#fff' }] })
      assert.equal(r.statusCode, 400)
      assert.ok(r.json().erros.corPrimaria && r.json().erros.tribos)
      assert.equal((await req('equipe', 'PUT', '/api/admin/marca', { nome: 'Y' })).statusCode, 403)
    })

    test('logo: aceita imagem real, recusa arquivo falso e SVG com script', async () => {
      const enviarLogo = (corpo, tipo) => app.inject({ method: 'PUT', url: '/api/admin/marca/logo',
        headers: { ...como('admin'), 'content-type': tipo }, payload: corpo })
      assert.equal((await enviarLogo(Buffer.from('não sou png'), 'image/png')).statusCode, 400)
      assert.equal((await enviarLogo(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml')).statusCode, 400)
      assert.equal((await enviarLogo(PNG, 'image/png')).statusCode, 200)

      const m = (await app.inject({ method: 'GET', url: '/api/marca' })).json()
      assert.match(m.logoUrl, /^\/api\/marca\/logo\?v=/)
      const logo = await app.inject({ method: 'GET', url: m.logoUrl })
      assert.equal(logo.headers['content-type'], 'image/png')
      assert.ok(logo.rawPayload.equals(PNG))
      assert.match((await app.inject({ method: 'GET', url: '/' })).body, /<link rel="icon" href="\/api\/marca\/logo\?v=/)
    })
  })

  // ------------------------------------------------------------------ site
  test('site, cabeçalhos de segurança e logout', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/saude' })
    assert.equal(r.statusCode, 200)
    assert.match(r.headers['content-security-policy'], /default-src 'self'/)
    for (const url of ['/', '/admin/']) {
      const pagina = await app.inject({ method: 'GET', url })
      assert.equal(pagina.statusCode, 200, `GET ${url}`)
      assert.match(pagina.body, /<div id="root">/)
      assert.equal(pagina.headers['cache-control'], 'no-cache')
    }
    assert.equal((await app.inject({ method: 'GET', url: '/admin' })).statusCode, 301)
    assert.equal((await app.inject({ method: 'GET', url: '/index.html' })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: '/nao-existe' })).statusCode, 404)

    await req('admin', 'POST', '/api/auth/logout')
    assert.equal((await req('admin', 'GET', '/api/auth/eu')).json().usuario, null)
    assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas')).statusCode, 401)
  })
})
