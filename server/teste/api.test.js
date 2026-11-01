// Testes de integração da API contra um PostgreSQL de verdade.
//   DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
// ATENÇÃO: o banco de teste é APAGADO a cada execução. Nunca aponte para produção.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { construirApp } from '../app.js'
import { lerConfig } from '../config.js'
import { criarPool, migrar } from '../db.js'
import { invalidarMarca } from '../marca.js'
import { esquecerLicenca, gerarHashChave } from '../licenca.js'
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
  let app, pool, chavesTeste
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
    esquecerLicenca()
    // Chave fictícia só para os testes (as chaves reais nunca aparecem no repositório)
    chavesTeste = [await gerarHashChave('TST-0001', 'teste')]
    const config = {
      ...lerConfig({ DATABASE_URL: URL_TESTE }), cookieSeguro: false, limiteEnviosPorHora: 1000, limiteLoginPorMinuto: 1000,
    }
    app = await construirApp({ pool, config, logger: false, chavesLicenca: chavesTeste })
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


  // ------------------------------------------------------------------ licença
  describe('ativação com chave', () => {
    const ativar = (quem, chave) => req(quem, 'POST', '/api/admin/licenca/ativar', { chave })

    test('antes de ativar: formulário fechado e painel bloqueado (login continua funcionando)', async () => {
      assert.equal((await app.inject({ method: 'GET', url: '/api/licenca' })).json().ativada, false)
      const envio = await enviar({ nome_completo: 'Antes da Ativação' })
      assert.equal(envio.statusCode, 503)
      assert.equal(envio.json().licencaPendente, true)
      const fila = await req('admin', 'GET', '/api/admin/pre-fichas')
      assert.equal(fila.statusCode, 403)
      assert.equal(fila.json().licencaPendente, true)
      assert.equal((await req('admin', 'GET', '/api/auth/eu')).json().licencaAtivada, false)
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/pre-fichas' })).statusCode, 401)
    })

    test('só administrador ativa; formato e chave errados são recusados', async () => {
      assert.equal((await ativar('equipe', 'TST-0001')).statusCode, 403)
      const formato = await ativar('admin', 'AB-12')
      assert.equal(formato.statusCode, 400)
      assert.match(formato.json().mensagem, /XXX-0000/)
      const errada = await ativar('admin', 'TST-0002')
      assert.equal(errada.statusCode, 400)
      assert.match(errada.json().mensagem, /inválida/)
    })

    test('excesso de tentativas de ativação é bloqueado', async () => {
      const app2 = await construirApp({ pool, config: { ...app.config }, logger: false, chavesLicenca: chavesTeste })
      const codigos = []
      for (let i = 0; i < 6; i++) {
        codigos.push((await app2.inject({ method: 'POST', url: '/api/admin/licenca/ativar', headers: como('admin'), payload: { chave: 'ZZZ-9999' } })).statusCode)
      }
      await app2.close()
      assert.deepEqual(codigos, [400, 400, 400, 400, 400, 429])
    })

    test('chave correta (aceita minúsculas e sem traço) ativa o sistema de vez', async () => {
      const r = await ativar('admin', 'tst 0001')
      assert.equal(r.statusCode, 200)
      assert.equal((await app.inject({ method: 'GET', url: '/api/licenca' })).json().ativada, true)
      assert.equal((await req('admin', 'GET', '/api/auth/eu')).json().licencaAtivada, true)
      assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas')).statusCode, 200)
      const s = (await req('admin', 'GET', '/api/admin/licenca')).json()
      assert.deepEqual([s.ativada, s.origem, s.ativada_por], [true, 'painel', 'Admin'])
      assert.equal((await ativar('admin', 'ZZZ-0000')).json().jaAtivada, true)
      const { rows: [l] } = await pool.query('select * from licenca')
      assert.equal(l.chave_id, 'teste')
      assert.ok(!JSON.stringify(l).includes('0001'), 'a chave não é gravada no banco')
    })
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


  // ------------------------------------------------------------------ recusas
  describe('recusas, fim da fila e auditoria', () => {
    const fila = async () => (await pool.query(
      `select nome_completo from fila_espera where modalidade = 'senior' order by posicao`)).rows.map((r) => r.nome_completo)
    const recusar = (quem, id, comentario) => req(quem, 'POST', `/api/admin/pre-fichas/${id}/recusa`, { comentario })
    const senior = { data_nascimento: '1980-01-01', estado_civil: 'casado', modalidade: 'senior', cidade: 'Palhoça', bairro: 'Pagani' }

    before(async () => {
      for (const nome of ['Recusa A', 'Recusa B', 'Recusa C']) await enviar({ ...senior, nome_completo: nome })
    })

    test('a inscrição gera o primeiro registro da trilha', async () => {
      const id = await idPorNome('Recusa A')
      const h = (await req('admin', 'GET', `/api/admin/pre-fichas/${id}/historico`)).json()
      assert.equal(h.at(-1).tipo, 'inscricao')
    })

    test('recusa exige comentário', async () => {
      const id = await idPorNome('Recusa A')
      assert.equal((await recusar('equipe', id, '  ')).statusCode, 400)
    })

    test('1ª recusa: conta, registra e mantém a posição', async () => {
      const id = await idPorNome('Recusa A')
      await req('equipe', 'PATCH', `/api/admin/pre-fichas/${id}`, { status: 'em_contato' })
      const r = await recusar('equipe', id, 'Não pode nesta data, trabalho.')
      assert.equal(r.statusCode, 200)
      assert.deepEqual([r.json().numero, r.json().movida], [1, false])
      assert.equal(r.json().ficha.recusas_seguidas, 1)
      assert.equal(r.json().ficha.status, 'aguardando')
      assert.deepEqual(await fila(), ['Casal Sênior', 'Recusa A', 'Recusa B', 'Recusa C'])
    })

    test('2ª recusa seguida: vai para o fim da fila, com data anterior/nova, autor e motivo na trilha', async () => {
      const id = await idPorNome('Recusa A')
      const { rows: [antes] } = await pool.query('select created_at, entrada_fila_em from pre_fichas where id = $1', [id])
      const r = await recusar('equipe', id, 'Disse que prefere no ano que vem.')
      assert.deepEqual([r.json().numero, r.json().movida], [2, true])
      assert.equal(r.json().ficha.recusas_seguidas, 0)
      assert.deepEqual(await fila(), ['Casal Sênior', 'Recusa B', 'Recusa C', 'Recusa A'])

      const { rows: [depois] } = await pool.query('select created_at, entrada_fila_em from pre_fichas where id = $1', [id])
      assert.equal(depois.created_at.getTime(), antes.created_at.getTime(), 'inscrição original preservada')
      assert.ok(depois.entrada_fila_em > antes.entrada_fila_em)

      const h = (await req('admin', 'GET', `/api/admin/pre-fichas/${id}/historico`)).json()
      const fim = h.find((x) => x.tipo === 'fim_da_fila')
      assert.equal(fim.usuario, 'Equipe')
      assert.match(fim.observacao, /^2ª recusa seguida: Disse que prefere/)
      assert.equal(new Date(fim.detalhes.entrada_anterior).getTime(), antes.entrada_fila_em.getTime())
      assert.equal(new Date(fim.detalhes.entrada_nova).getTime(), depois.entrada_fila_em.getTime())
      assert.equal(h.filter((x) => x.tipo === 'recusa').length, 2)
    })

    test('aceitar (confirmado) zera as recusas seguidas', async () => {
      const id = await idPorNome('Recusa B')
      await recusar('equipe', id, 'Não pode agora.')
      await req('equipe', 'PATCH', `/api/admin/pre-fichas/${id}`, { status: 'confirmado' })
      await req('equipe', 'PATCH', `/api/admin/pre-fichas/${id}`, { status: 'aguardando' })
      const r = await recusar('equipe', id, 'Desistiu de novo.')
      assert.deepEqual([r.json().numero, r.json().movida], [1, false])
    })

    test('mover para o fim manualmente exige motivo e fica na trilha', async () => {
      const id = await idPorNome('Recusa C')
      assert.equal((await req('admin', 'POST', `/api/admin/pre-fichas/${id}/fim-da-fila`, {})).statusCode, 400)
      const r = await req('admin', 'POST', `/api/admin/pre-fichas/${id}/fim-da-fila`, { motivo: 'Pediu para adiar.' })
      assert.equal(r.statusCode, 200)
      assert.equal((await fila()).at(-1), 'Recusa C')
    })

    test('coordenador não move nem registra recusa fora da sua área', async () => {
      const id = await idPorNome('Recusa B') // Palhoça: fora do núcleo da coordenadora
      assert.equal((await recusar('coord', id, 'x')).statusCode, 404)
      assert.equal((await req('coord', 'POST', `/api/admin/pre-fichas/${id}/fim-da-fila`, { motivo: 'x' })).statusCode, 404)
    })

    test('limite configurável: com 3, a 2ª recusa não move; com 0, nunca move', async () => {
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', recusasParaFimDaFila: 3 })
      const id = await idPorNome('Recusa B') // já tem 1 recusa
      assert.equal((await recusar('equipe', id, 'Segunda.')).json().movida, false)
      assert.equal((await recusar('equipe', id, 'Terceira.')).json().movida, true)
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', recusasParaFimDaFila: 0 })
      for (let i = 0; i < 3; i++) assert.equal((await recusar('equipe', id, 'De novo.')).json().movida, false)
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', recusasParaFimDaFila: 2 })
    })

    test('banco: não deixa adiantar a posição, audita mudança direta e a trilha não pode ser editada', async () => {
      const id = await idPorNome('Recusa C')
      await assert.rejects(pool.query(`update pre_fichas set entrada_fila_em = entrada_fila_em - interval '1 day' where id = $1`, [id]),
        /só pode ser movida para o fim/)
      await pool.query(`update pre_fichas set entrada_fila_em = entrada_fila_em + interval '1 minute' where id = $1`, [id])
      const { rows: [ultimo] } = await pool.query(
        `select tipo, observacao, usuario_id from pre_fichas_historico where pre_ficha_id = $1 order by id desc limit 1`, [id])
      assert.deepEqual([ultimo.tipo, ultimo.usuario_id], ['fim_da_fila', null])
      assert.match(ultimo.observacao, /diretamente no banco/)
      await assert.rejects(pool.query(`update pre_fichas_historico set observacao = 'apagado' where pre_ficha_id = $1`, [id]),
        /não pode ser alterado/)
    })

    test('tela de auditoria: filtra por tipo e respeita a área do coordenador', async () => {
      const r = await req('equipe', 'GET', '/api/admin/auditoria?tipo=fim_da_fila')
      assert.equal(r.statusCode, 200)
      assert.ok(r.json().length >= 3)
      assert.ok(r.json().every((e) => e.tipo === 'fim_da_fila' && e.nome_completo))
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      assert.ok((await req('equipe', 'GET', `/api/admin/auditoria?de=${hoje}&ate=${hoje}`)).json().length > 0)
      const coord = (await req('coord', 'GET', '/api/admin/auditoria')).json()
      assert.ok(coord.length > 0)
      assert.ok(coord.every((e) => ['Maria Silva', 'Segundo Juvenil'].includes(e.nome_completo)))
    })
  })


  // ------------------------------------------------------------------ cônjuge
  describe('cônjuge e preferência', () => {
    const casal = { data_nascimento: '1975-01-01', estado_civil: 'casado', modalidade: 'senior', cidade: 'Biguaçu', bairro: 'Centro' }
    const ficha = async (nome) => (await req('equipe', 'GET', '/api/admin/pre-fichas')).json().find((f) => f.nome_completo === nome)
    let acamp50, maridoId, esposaId

    before(async () => {
      await enviar({ ...casal, nome_completo: 'Marido Silva', telefone: '(48) 97777-1111' })
      await enviar({ ...casal, nome_completo: 'Esposa Silva', telefone: '(48) 97777-2222',
        conjuge_nome: 'Marido Silva', conjuge_telefone: '(48) 97777-1111', conjuge_fez_acampamento: false })
      await enviar({ ...casal, nome_completo: 'Viúva Antiga', estado_civil: 'viuvo', conjuge_nome: 'Não deve gravar' })
      maridoId = await idPorNome('Marido Silva')
      esposaId = await idPorNome('Esposa Silva')
    })

    test('formulário grava o que foi declarado sobre o cônjuge (só para casados)', async () => {
      const { rows: [e] } = await pool.query('select conjuge_nome, conjuge_telefone, conjuge_fez_acampamento from pre_fichas where id = $1', [esposaId])
      assert.deepEqual(e, { conjuge_nome: 'Marido Silva', conjuge_telefone: '(48) 97777-1111', conjuge_fez_acampamento: false })
      const { rows: [v] } = await pool.query(`select conjuge_nome from pre_fichas where nome_completo = 'Viúva Antiga'`)
      assert.equal(v.conjuge_nome, null)
      const r = await enviar({ ...casal, nome_completo: 'Numero Errado', conjuge_fez_acampamento: true, conjuge_acampamento_numero: 'vinte' })
      assert.equal(r.statusCode, 400)
    })

    test('vincular cônjuges (mão dupla, na trilha); coordenador não pode', async () => {
      assert.equal((await req('coord', 'PUT', `/api/admin/pre-fichas/${esposaId}/conjuge`, { conjuge_id: maridoId })).statusCode, 403)
      const r = await req('equipe', 'PUT', `/api/admin/pre-fichas/${esposaId}/conjuge`, { conjuge_id: maridoId })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().ficha.conjuge_vinculado_nome, 'Marido Silva')
      assert.equal((await ficha('Marido Silva')).conjuge_id, esposaId)
      const h = (await req('equipe', 'GET', `/api/admin/pre-fichas/${maridoId}/historico`)).json()
      assert.equal(h[0].tipo, 'conjuge')
    })

    test('quando o marido faz o 50º Sênior, a esposa ganha preferência para o 51º e 52º', async () => {
      acamp50 = (await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 50, modalidade: 'senior' })).json().id
      await req('equipe', 'PUT', `/api/admin/acampamentos/${acamp50}/participantes/${maridoId}`, { tribo: 'Azul' })
      const [pref] = (await ficha('Esposa Silva')).preferencias
      assert.deepEqual([pref.situacao, pref.origem, pref.valida_de, pref.valida_ate, pref.conjuge_nome],
        ['ativa', 'automatica', 51, 52, 'Marido Silva'])
      const h = (await req('equipe', 'GET', `/api/admin/pre-fichas/${esposaId}/historico`)).json()
      assert.match(h[0].observacao, /cônjuge Marido Silva fez o 50º Sênior — válida para o 51º e 52º Sênior/)
    })

    test('a preferência vale no 51º e expira quando o 52º é cadastrado', async () => {
      await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 51, modalidade: 'senior' })
      assert.equal((await ficha('Esposa Silva')).preferencias[0].situacao, 'ativa')
      const a52 = (await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 52, modalidade: 'senior' })).json().id
      assert.equal((await ficha('Esposa Silva')).preferencias[0].situacao, 'expirada')
      await req('equipe', 'DELETE', `/api/admin/acampamentos/${a52}`)
      assert.equal((await ficha('Esposa Silva')).preferencias[0].situacao, 'ativa')
    })

    test('se a esposa faz uma das edições cobertas, a preferência fica como "usada"', async () => {
      const a51 = (await req('equipe', 'GET', '/api/admin/acampamentos')).json().find((a) => a.numero === 51 && a.modalidade === 'senior').id
      await req('equipe', 'PUT', `/api/admin/acampamentos/${a51}/participantes/${esposaId}`, { tribo: 'Verde' })
      assert.equal((await ficha('Esposa Silva')).preferencias[0].situacao, 'usada')
      await req('equipe', 'DELETE', `/api/admin/acampamentos/${a51}/participantes/${esposaId}`)
      assert.equal((await ficha('Esposa Silva')).preferencias[0].situacao, 'ativa')
    })

    test('desfazer o registro do marido revoga a preferência automática', async () => {
      await req('equipe', 'DELETE', `/api/admin/acampamentos/${acamp50}/participantes/${maridoId}`)
      const [pref] = (await ficha('Esposa Silva')).preferencias
      assert.equal(pref.situacao, 'revogada')
      assert.match(pref.motivo_revogacao, /registro do cônjuge no 50º Sênior foi removido/)
    })

    test('vincular depois que o cônjuge já fez o acampamento também gera a preferência', async () => {
      await req('equipe', 'PUT', `/api/admin/pre-fichas/${esposaId}/conjuge`, { conjuge_id: null })
      assert.equal((await ficha('Marido Silva')).conjuge_id, null)
      await req('equipe', 'PUT', `/api/admin/acampamentos/${acamp50}/participantes/${maridoId}`, { tribo: 'Azul' })
      assert.equal((await ficha('Esposa Silva')).preferencias.filter((p) => p.situacao === 'ativa').length, 0)
      await req('equipe', 'PUT', `/api/admin/pre-fichas/${esposaId}/conjuge`, { conjuge_id: maridoId })
      assert.equal((await ficha('Esposa Silva')).preferencias.filter((p) => p.situacao === 'ativa').length, 1)
    })

    test('preferência manual (cônjuge fez antes do sistema): validações, expiração e revogação com motivo', async () => {
      const id = await idPorNome('Viúva Antiga')
      const url = `/api/admin/pre-fichas/${id}/preferencias`
      assert.equal((await req('equipe', 'POST', url, { acampamento_numero: 51, modalidade: 'senior' })).statusCode, 400) // sem nome
      assert.equal((await req('coord', 'POST', url, { conjuge_nome: 'X', acampamento_numero: 51, modalidade: 'senior' })).statusCode, 403)
      const expirada = await req('equipe', 'POST', url, { conjuge_nome: 'José', acampamento_numero: 45, modalidade: 'senior' })
      assert.equal(expirada.statusCode, 400)
      assert.match(expirada.json().mensagem, /Já expirou/)
      const r = await req('equipe', 'POST', url, { conjuge_nome: 'José Antigo', acampamento_numero: 51, modalidade: 'senior', observacao: 'Confirmado com a coordenação.' })
      assert.equal(r.statusCode, 201)
      const pref = r.json().ficha.preferencias[0]
      assert.deepEqual([pref.situacao, pref.origem, pref.valida_ate], ['ativa', 'manual', 53])
      assert.equal((await req('equipe', 'POST', url, { conjuge_nome: 'José Antigo', acampamento_numero: 51, modalidade: 'senior' })).statusCode, 400)

      assert.equal((await req('equipe', 'POST', `/api/admin/preferencias/${pref.id}/revogar`, {})).statusCode, 400)
      const rev = await req('admin', 'POST', `/api/admin/preferencias/${pref.id}/revogar`, { motivo: 'Lançada por engano.' })
      assert.equal(rev.json().ficha.preferencias[0].situacao, 'revogada')
      const aud = (await req('admin', 'GET', `/api/admin/auditoria?tipo=preferencia&ficha=${id}`)).json()
      assert.equal(aud.length, 2)
    })

    test('número de edições configurável', async () => {
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', edicoesPreferenciaConjuge: 3 })
      const id = await idPorNome('Viúva Antiga')
      const r = await req('equipe', 'POST', `/api/admin/pre-fichas/${id}/preferencias`, { conjuge_nome: 'José', acampamento_numero: 51, modalidade: 'senior' })
      assert.equal(r.json().ficha.preferencias[0].valida_ate, 54)
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', edicoesPreferenciaConjuge: 0 })
      const off = await req('equipe', 'POST', `/api/admin/pre-fichas/${id}/preferencias`, { conjuge_nome: 'Outro', acampamento_numero: 52, modalidade: 'senior' })
      assert.equal(off.statusCode, 400)
      await req('admin', 'PUT', '/api/admin/marca', { nome: 'Acampamento Teste', edicoesPreferenciaConjuge: 2 })
    })
  })


  // ------------------------------------------------------------------ divisão / campistas
  describe('Palhoça dividida em núcleos por bairro e lista de campistas', () => {
    const palhoca = { cidade: 'Palhoça', data_nascimento: '2001-01-01', modalidade: 'juvenil' }
    const nucleos = {}
    let coordAririu

    before(async () => {
      for (const nome of ['Palhoça Centro', 'Ponte do Imaruim', 'Aririu', 'São Sebastião']) {
        nucleos[nome] = (await req('admin', 'POST', '/api/admin/nucleos', { nome, areas: [] })).json().id
      }
      for (const [nome, bairro] of [['Pessoa Centro', 'Centro'], ['Pessoa Ponte', 'Ponte do Imaruim'],
        ['Pessoa Aririu', 'Aririu'], ['Pessoa Aririu 2', 'ARIRIU'], ['Pessoa Bela Vista', 'Bela Vista'], ['Pessoa Sem Bairro', '']]) {
        await enviar({ ...palhoca, nome_completo: nome, bairro })
      }
      await pool.query(`insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values ('aririu@x.com', 'Coord Aririu', 'coordenador', $1, false)`,
        [await gerarHash(SENHA)])
      sessoes.aririu = (await login('aririu@x.com')).cookie
      const { rows: [u] } = await pool.query(`select id from usuarios where email = 'aririu@x.com'`)
      coordAririu = u.id
    })

    test('a ferramenta lista os bairros de Palhoça com quantidade de fichas (grafias diferentes juntas)', async () => {
      const r = await req('admin', 'GET', '/api/admin/nucleos/divisao?uf=SC&cidade=palhoca')
      assert.equal(r.statusCode, 200)
      const aririu = r.json().bairros.find((b) => b.bairro.toLowerCase() === 'aririu')
      assert.equal(aririu.fichas, 2)
      assert.equal(r.json().sem_bairro, 1)
      assert.ok(r.json().cidade_inteira.some((n) => n.nome === 'Núcleo Sul'), 'mostra o núcleo que tinha a cidade inteira')
      assert.equal((await req('coord', 'GET', '/api/admin/nucleos/divisao?uf=SC&cidade=Palhoça')).statusCode, 403)
    })

    test('salvar a divisão: cada bairro em um núcleo; a "cidade inteira" antiga é substituída', async () => {
      const atribuicoes = [
        { bairro: 'Centro', nucleo_id: nucleos['Palhoça Centro'] },
        { bairro: 'Pagani', nucleo_id: nucleos['Palhoça Centro'] },
        { bairro: 'Ponte do Imaruim', nucleo_id: nucleos['Ponte do Imaruim'] },
        { bairro: 'Aririu', nucleo_id: nucleos.Aririu },
        { bairro: 'Bela Vista', nucleo_id: nucleos['São Sebastião'] },
        { bairro: 'Bairro Sem Núcleo', nucleo_id: null },
      ]
      assert.equal((await req('admin', 'PUT', '/api/admin/nucleos/divisao', { uf: 'SC', cidade: 'Palhoça', atribuicoes: [{ bairro: 'X', nucleo_id: 999999 }] })).statusCode, 400)
      const r = await req('admin', 'PUT', '/api/admin/nucleos/divisao', { uf: 'SC', cidade: 'Palhoça', atribuicoes })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().inseridas, 5)
      const d = (await req('admin', 'GET', '/api/admin/nucleos/divisao?uf=SC&cidade=Palhoça')).json()
      assert.equal(d.cidade_inteira.length, 0)
      assert.equal(d.bairros.find((b) => b.bairro === 'Bela Vista').nucleo_id, nucleos['São Sebastião'])
      const sul = (await req('admin', 'GET', '/api/admin/nucleos')).json().find((n) => n.nome === 'Núcleo Sul')
      assert.equal(sul.areas.length, 0)
    })

    test('o coordenador do Aririu vê só as pré-fichas do Aririu', async () => {
      await req('admin', 'PATCH', `/api/admin/usuarios/${coordAririu}`, { nucleos: [nucleos.Aririu] })
      const fichas = (await req('aririu', 'GET', '/api/admin/pre-fichas')).json().map((f) => f.nome_completo).sort()
      assert.deepEqual(fichas, ['Pessoa Aririu', 'Pessoa Aririu 2'])
    })

    test('campistas: todos os núcleos, com dados completos; alterar só no próprio núcleo', async () => {
      const a = (await req('equipe', 'POST', '/api/admin/acampamentos', { numero: 60, modalidade: 'juvenil' })).json().id
      for (const nome of ['Pessoa Aririu', 'Pessoa Ponte']) {
        await req('equipe', 'PUT', `/api/admin/acampamentos/${a}/participantes/${await idPorNome(nome)}`, { tribo: 'Roxo' })
      }
      const r = await req('aririu', 'GET', '/api/admin/campistas')
      assert.equal(r.statusCode, 200)
      const nomes = r.json().map((c) => c.nome_completo)
      assert.ok(nomes.includes('Pessoa Aririu') && nomes.includes('Pessoa Ponte'))
      assert.ok(nomes.includes('Maria Silva'), 'inclui campistas de outras cidades')
      const ponte = r.json().find((c) => c.nome_completo === 'Pessoa Ponte')
      assert.equal(ponte.da_minha_area, false)
      assert.equal(ponte.participacoes[0].tribo, 'Roxo')
      assert.ok(ponte.telefone && ponte.email && ponte.data_nascimento, 'campistas não são restritos: dados completos')
      assert.equal(ponte.ip_origem, undefined)
      assert.equal(r.json().find((c) => c.nome_completo === 'Pessoa Aririu').da_minha_area, true)

      // ver o histórico de um campista de outro núcleo: pode; alterar: não
      assert.equal((await req('aririu', 'GET', `/api/admin/pre-fichas/${ponte.id}/historico`)).statusCode, 200)
      assert.equal((await req('aririu', 'PATCH', `/api/admin/pre-fichas/${ponte.id}`, { observacoes_internas: 'x' })).statusCode, 404)
      assert.equal((await req('aririu', 'POST', `/api/admin/pre-fichas/${ponte.id}/recusa`, { comentario: 'x' })).statusCode, 404)
      // pré-ficha (não campista) de outro núcleo continua restrita
      const centro = await idPorNome('Pessoa Centro')
      assert.equal((await req('aririu', 'GET', `/api/admin/pre-fichas/${centro}/historico`)).statusCode, 404)
      assert.ok(!(await req('aririu', 'GET', '/api/admin/pre-fichas')).json().some((f) => f.nome_completo === 'Pessoa Ponte'))
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/campistas' })).statusCode, 401)
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
