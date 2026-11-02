// Testes de integração da API contra um PostgreSQL de verdade.
//   DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/prefichas_teste npm test
// ATENÇÃO: o banco de teste é APAGADO a cada execução. Nunca aponte para produção.
import { after, before, describe, test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { construirApp } from '../app.js'
import { lerConfig } from '../config.js'
import { criarPool, migrar } from '../db.js'
import { invalidarMarca } from '../marca.js'
import { esquecerLicenca, gerarHashChave } from '../licenca.js'
import { _codigoNoPasso, passoAtual } from '../totp.js'
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
  const emailsEnviados = []
  const emailTeste = { enviar: async (m) => { emailsEnviados.push(m); return true } }
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
      limiteEnviosPorContatoDia: 100000, limiteEnviosGlobalHora: 100000,
      contaObrigatoria: false, urlPublica: 'https://prefichas.teste',
    }
    app = await construirApp({ pool, config, logger: false, chavesLicenca: chavesTeste, email: emailTeste })
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


  // ------------------------------------------------------------------ atualização
  describe('aviso de atualização (GitHub)', () => {
    const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40)
    let falso, url, ultimoCommit = SHA_A, fora = false
    const appCom = (instalada, extra = {}) => construirApp({
      pool, logger: false, chavesLicenca: chavesTeste, versaoInstalada: instalada,
      config: { ...app.config, atualizacao: { ativo: true, repo: 'dono/repo', branch: 'main', token: null, apiUrl: url, horas: 6, ...extra } },
    })

    before(async () => {
      // GitHub falso: último commit da main e comparação entre commits
      falso = createServer((rq, rs) => {
        const json = (code, obj) => { rs.writeHead(code, { 'content-type': 'application/json' }); rs.end(JSON.stringify(obj)) }
        if (fora) return json(500, {})
        if (rq.url === '/repos/dono/repo/commits/main') {
          return json(200, { sha: ultimoCommit, commit: { message: 'Melhorias na fila\n\ndetalhes', committer: { date: '2026-11-10T12:00:00Z' } } })
        }
        if (rq.url === `/repos/dono/repo/compare/${SHA_A}...${SHA_C}`) {
          return json(200, { status: 'ahead', ahead_by: 2, commits: [
            { sha: SHA_B, commit: { message: 'Corrige filtro de bairro', committer: { date: '2026-11-09T10:00:00Z' } } },
            { sha: SHA_C, commit: { message: 'Melhorias na fila', committer: { date: '2026-11-10T12:00:00Z' } } }] })
        }
        return json(404, {})
      })
      await new Promise((r) => falso.listen(0, '127.0.0.1', r))
      url = `http://127.0.0.1:${falso.address().port}`
    })
    after(() => falso.close())

    test('em dia: sem aviso', async () => {
      const a = await appCom({ versao: '2.0.0', commit: SHA_A })
      const r = (await a.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('admin') })).json()
      await a.close()
      assert.deepEqual([r.desatualizado, r.commits_atras, r.instalada.commit], [false, 0, SHA_A])
    })

    test('nova versão no GitHub: avisa com a quantidade e a lista de novidades (mais nova primeiro)', async () => {
      ultimoCommit = SHA_C
      const a = await appCom({ versao: '2.0.0', commit: SHA_A })
      const r = (await a.inject({ method: 'POST', url: '/api/admin/atualizacao/verificar', headers: como('admin') })).json()
      await a.close()
      assert.equal(r.desatualizado, true)
      assert.equal(r.commits_atras, 2)
      assert.deepEqual(r.novidades.map((n) => n.mensagem), ['Melhorias na fila', 'Corrige filtro de bairro'])
      assert.equal(r.disponivel.mensagem, 'Melhorias na fila')
    })

    test('versão instalada desconhecida ou GitHub fora do ar: explica sem quebrar', async () => {
      const a = await appCom({ versao: '2.0.0', commit: null })
      const r = (await a.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('admin') })).json()
      await a.close()
      assert.equal(r.desatualizado, null)
      assert.match(r.erro, /atualizar\.sh/)
      fora = true
      const b = await appCom({ versao: '2.0.0', commit: SHA_A })
      const r2 = (await b.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('admin') })).json()
      await b.close()
      fora = false
      assert.match(r2.erro, /api\.github\.com/)
      const c = await appCom({ versao: '2.0.0', commit: SHA_A }, { repo: 'dono/inexistente' })
      const r3 = (await c.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('admin') })).json()
      await c.close()
      assert.match(r3.erro, /ATUALIZACAO_TOKEN/)
    })

    test('botão "Atualizar agora": sem atualizador instalado explica como ativar', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'atualizador-'))
      mkdirSync(join(pasta, 'pedido')); mkdirSync(join(pasta, 'estado'))
      const a = await appCom({ versao: '2.0.0', commit: SHA_A }, { pastaControle: pasta })
      const r = await a.inject({ method: 'POST', url: '/api/admin/atualizacao/executar', headers: como('admin') })
      const info = (await a.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('admin') })).json()
      await a.close()
      assert.equal(r.statusCode, 409)
      assert.match(r.json().mensagem, /instalar-atualizador\.sh/)
      assert.equal(info.atualizador.instalado, false)
      assert.equal(existsSync(join(pasta, 'pedido', 'solicitar')), false)
    })

    test('botão "Atualizar agora": grava o pedido, mostra o andamento e não deixa pedir duas vezes', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'atualizador-'))
      mkdirSync(join(pasta, 'pedido')); mkdirSync(join(pasta, 'estado'))
      writeFileSync(join(pasta, 'estado', 'atualizador.json'), JSON.stringify({ instalado_em: 'x', modo: 'docker' }))
      const a = await appCom({ versao: '2.0.0', commit: SHA_A }, { pastaControle: pasta })
      assert.equal((await a.inject({ method: 'POST', url: '/api/admin/atualizacao/executar', headers: como('equipe') })).statusCode, 403)
      const r = await a.inject({ method: 'POST', url: '/api/admin/atualizacao/executar', headers: como('admin') })
      assert.equal(r.statusCode, 200)
      assert.ok(existsSync(join(pasta, 'pedido', 'solicitar')), 'pedido gravado para o atualizador do servidor')
      assert.equal(JSON.parse(readFileSync(join(pasta, 'pedido', 'pedido.json'), 'utf8')).usuario, 'Admin')
      assert.equal(existsSync(join(pasta, 'estado', 'estado.json')), false, 'o site não escreve na pasta de estado')
      const sol = (await a.inject({ method: 'GET', url: '/api/admin/atualizacao/progresso', headers: como('admin') })).json()
      assert.equal(sol.estado.etapa, 'solicitado')
      const dup = await a.inject({ method: 'POST', url: '/api/admin/atualizacao/executar', headers: como('admin') })
      assert.equal(dup.statusCode, 409)
      assert.equal(dup.json().emAndamento, true)

      // o atualizador do servidor escreve o andamento; o painel lê
      writeFileSync(join(pasta, 'estado', 'estado.json'), JSON.stringify({ etapa: 'executando', sucesso: null }))
      writeFileSync(join(pasta, 'estado', 'log.txt'), '→ Fazendo backup antes de atualizar…\n→ Baixando o código novo…\n')
      const p = (await a.inject({ method: 'GET', url: '/api/admin/atualizacao/progresso', headers: como('admin') })).json()
      await a.close()
      assert.equal(p.estado.etapa, 'executando')
      assert.deepEqual(p.log, ['→ Fazendo backup antes de atualizar…', '→ Baixando o código novo…'])
    })

    test('só o administrador vê o aviso', async () => {
      const a = await appCom({ versao: '2.0.0', commit: SHA_A })
      assert.equal((await a.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('equipe') })).statusCode, 403)
      assert.equal((await a.inject({ method: 'GET', url: '/api/admin/atualizacao', headers: como('coord') })).statusCode, 403)
      assert.equal((await a.inject({ method: 'GET', url: '/api/admin/atualizacao' })).statusCode, 401)
      await a.close()
    })
  })


  // ------------------------------------------------------------------ segurança (itens 4, 7, 8 e 9)
  describe('segurança: login, duas etapas e proteção do formulário', () => {
    const outraApp = (extra) => construirApp({ pool, logger: false, chavesLicenca: chavesTeste, config: { ...app.config, ...extra } })
    const loginEm = (a, email, senha, ip, codigo) => a.inject({ method: 'POST', url: '/api/auth/login',
      headers: { ...H, 'x-forwarded-for': ip }, payload: { email, senha, ...(codigo !== undefined ? { codigo } : {}) } })

    before(async () => {
      await pool.query(`insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values
        ('alvo@x.com', 'Alvo', 'admin', $1, false), ('dois@x.com', 'Dois', 'admin', $1, false)`, [await gerarHash(SENHA)])
    })

    test('item 8: erros de senha vindos de vários IPs bloqueiam a conta (e só ela)', async () => {
      const a = await outraApp({ protecaoLogin: { maxFalhas: 3, janelaMin: 15, bloqueioMin: 15, simultaneas: 2, fila: 20 } })
      for (let i = 1; i <= 3; i++) assert.equal((await loginEm(a, 'alvo@x.com', 'errada', `10.0.0.${i}`)).statusCode, 401)
      const bloqueado = await loginEm(a, 'alvo@x.com', SENHA, '10.0.0.9')
      assert.equal(bloqueado.statusCode, 429)
      assert.match(bloqueado.json().mensagem, /conta/)
      assert.equal((await loginEm(a, 'dois@x.com', SENHA, '10.0.0.9')).statusCode, 200, 'outra conta segue liberada')
      await a.close()
    })

    test('item 8: verificação em duas etapas — ativar, exigir código, recusar reuso, desativar', async () => {
      const { cookie } = await login('dois@x.com')
      const c = { ...H, cookie }
      const ini = await app.inject({ method: 'POST', url: '/api/auth/2fa/iniciar', headers: c })
      const { segredo, uri } = ini.json()
      assert.match(uri, /^otpauth:\/\/totp\//)
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/ativar', headers: c, payload: { codigo: '000000' } })).statusCode, 400)
      const atual = _codigoNoPasso(segredo, passoAtual())
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/ativar', headers: c, payload: { codigo: atual } })).statusCode, 200)

      const sem = await loginEm(app, 'dois@x.com', SENHA, '10.1.0.1')
      assert.deepEqual([sem.statusCode, sem.json().precisa2fa], [401, true])
      assert.equal(sem.cookies.length, 0, 'sem código não cria sessão')
      assert.equal((await loginEm(app, 'dois@x.com', SENHA, '10.1.0.1', '123456')).statusCode, 401)
      // o código usado na ativação não pode ser reutilizado; o do próximo período funciona
      assert.equal((await loginEm(app, 'dois@x.com', SENHA, '10.1.0.1', atual)).statusCode, 401)
      const proximo = _codigoNoPasso(segredo, passoAtual() + 1)
      const ok = await loginEm(app, 'dois@x.com', SENHA, '10.1.0.1', proximo)
      assert.equal(ok.statusCode, 200)
      assert.equal(ok.json().usuario.totp_ativo, true)

      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/desativar', headers: c, payload: { senha: 'errada' } })).statusCode, 400)
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/desativar', headers: c, payload: { senha: SENHA } })).statusCode, 200)
      assert.equal((await loginEm(app, 'dois@x.com', SENHA, '10.1.0.2')).statusCode, 200)
    })

    test('item 8: "Nova senha" pelo admin desliga as duas etapas (recuperação)', async () => {
      await pool.query(`update usuarios set totp_ativo = true, totp_segredo = 'JBSWY3DPEHPK3PXP' where email = 'alvo@x.com'`)
      const { rows: [u] } = await pool.query(`select id from usuarios where email = 'alvo@x.com'`)
      const r = await req('admin', 'POST', `/api/admin/usuarios/${u.id}/redefinir-senha`)
      assert.equal(r.json().usuario.totp_ativo, false)
    })

    test('item 4: e-mail gigante na criação de usuário é recusado na hora', async () => {
      const t0 = Date.now()
      const r = await req('admin', 'POST', '/api/admin/usuarios', { email: 'a@' + '.'.repeat(30000) + 'x', nome: 'X' })
      assert.equal(r.statusCode, 400)
      assert.ok(Date.now() - t0 < 1000, 'resposta rápida')
    })

    test('item 9: mesma pessoa de novo é descartada sem revelar e fica no histórico', async () => {
      const dados = { nome_completo: 'Pessoa Repetida', data_nascimento: '1999-09-09', telefone: '(48) 91234-0001', email: 'rep@x.com' }
      assert.equal((await enviar(dados)).statusCode, 201)
      const { rows: [{ n: antes }] } = await pool.query('select count(*)::int n from pre_fichas')
      const r = await enviar({ ...dados, nome_completo: 'PESSOA  repetida', telefone: '(48) 95555-0002' })
      assert.equal(r.statusCode, 201, 'resposta igual à de sucesso')
      const { rows: [{ n: depois }] } = await pool.query('select count(*)::int n from pre_fichas')
      assert.equal(depois, antes)
      const id = await idPorNome('Pessoa Repetida')
      const h = (await req('admin', 'GET', `/api/admin/pre-fichas/${id}/historico`)).json()
      assert.match(h[0].observacao, /duplicada/)
    })

    test('item 9: limite por telefone/e-mail no dia e limite geral por hora', async () => {
      const a = await outraApp({ limiteEnviosPorContatoDia: 2, limiteEnviosGlobalHora: 100000 })
      const env = (nome) => a.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: nome, telefone: '(48) 97777-4321', email: 'familia@x.com' } })
      assert.equal((await env('Irmão Um')).statusCode, 201)
      assert.equal((await env('Irmão Dois')).statusCode, 201)
      const terceiro = await env('Irmão Três')
      assert.equal(terceiro.statusCode, 429)
      assert.match(terceiro.json().mensagem, /telefone ou e-mail/)
      await a.close()
      const g = await outraApp({ limiteEnviosGlobalHora: 1, limiteEnviosPorContatoDia: 100000 })
      const e2 = (nome) => g.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: nome, email: `${nome.split(' ')[1]}@x.com` } })
      assert.equal((await e2('Global Um')).statusCode, 201)
      assert.equal((await e2('Global Dois')).statusCode, 429)
      await g.close()
    })

    test('item 9: CAPTCHA opcional (Turnstile) — exigido quando configurado', async () => {
      const falso = createServer((rq, rs) => {
        let corpo = ''
        rq.on('data', (d) => { corpo += d }); rq.on('end', () => {
          rs.writeHead(200, { 'content-type': 'application/json' })
          rs.end(JSON.stringify({ success: new URLSearchParams(corpo).get('response') === 'token-bom' }))
        })
      })
      await new Promise((r) => falso.listen(0, '127.0.0.1', r))
      const a = await outraApp({ captcha: { siteKey: 'chave-publica', secret: 's', verificarUrl: `http://127.0.0.1:${falso.address().port}` }, limiteEnviosPorContatoDia: 100000, limiteEnviosGlobalHora: 100000 })
      const marca = (await a.inject({ method: 'GET', url: '/api/marca' }))
      assert.deepEqual(marca.json().captcha, { provedor: 'turnstile', siteKey: 'chave-publica' })
      assert.match(marca.headers['content-security-policy'], /challenges\.cloudflare\.com/)
      const sem = await a.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: 'Com Captcha' } })
      assert.equal(sem.statusCode, 400); assert.ok(sem.json().erros.captcha)
      assert.equal((await a.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: 'Com Captcha', captcha: 'token-ruim' } })).statusCode, 400)
      assert.equal((await a.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: 'Com Captcha', captcha: 'token-bom' } })).statusCode, 201)
      await a.close(); falso.close()
      assert.equal((await app.inject({ method: 'GET', url: '/api/marca' })).json().captcha, null, 'desligado por padrão')
    })

    test('item 7: o endereço da prévia (og:image) não vem do cabeçalho Host', async () => {
      const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5c90000000049454e44ae426082', 'hex')
      await app.inject({ method: 'PUT', url: '/api/admin/marca/logo', headers: { ...como('admin'), 'content-type': 'image/png' }, payload: PNG })
      const r = await app.inject({ method: 'GET', url: '/', headers: { host: 'site-do-atacante.com', 'x-forwarded-host': 'site-do-atacante.com' } })
      assert.doesNotMatch(r.body, /site-do-atacante/)
      const a = await outraApp({ urlPublica: 'https://prefichas.exemplo.com.br' })
      const r2 = await a.inject({ method: 'GET', url: '/', headers: { host: 'site-do-atacante.com' } })
      await a.close()
      assert.match(r2.body, /og:image" content="https:\/\/prefichas\.exemplo\.com\.br\/api\/marca\/logo/)
      await app.inject({ method: 'DELETE', url: '/api/admin/marca/logo', headers: como('admin') })
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

  // ------------------------------------------------------------------ contas dos participantes
  describe('contas dos participantes', () => {
    const CPF = '529.982.247-25'
    const jar = {}
    const conta = (quem, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, ...(jar[quem] ? { cookie: jar[quem] } : {}) } })
    const guardar = (quem, r) => { const c = r.cookies.find((k) => k.name === 'prefichas_conta'); if (c) jar[quem] = `${c.name}=${c.value}` }

    test('formulário sem conta é recusado quando a conta é obrigatória', async () => {
      const a = await construirApp({ pool, logger: false, chavesLicenca: chavesTeste, config: { ...app.config, contaObrigatoria: true } })
      const r = await a.inject({ method: 'POST', url: '/api/pre-fichas', payload: { ...FICHA, nome_completo: 'Sem Conta' } })
      assert.equal(r.statusCode, 401)
      assert.equal(r.json().precisaConta, true)
      await a.close()
    })

    test('cadastro valida CPF, e-mail e senha; não duplica CPF/e-mail', async () => {
      assert.equal((await conta('x', 'POST', '/api/conta/cadastro', { cpf: '111.111.111-11', email: 'a@a.com', senha: '12345678' })).statusCode, 400)
      assert.equal((await conta('x', 'POST', '/api/conta/cadastro', { cpf: CPF, email: 'ruim', senha: '123' })).json().erros.email, 'E-mail inválido.')
      const ok = await conta('ana', 'POST', '/api/conta/cadastro', { cpf: CPF, email: 'Ana@Conta.com', senha: 'senha-da-ana' })
      assert.equal(ok.statusCode, 201)
      guardar('ana', ok)
      assert.equal((await conta('x', 'POST', '/api/conta/cadastro', { cpf: CPF, email: 'outra@conta.com', senha: 'senha-da-ana' })).statusCode, 409)
      const eu = (await conta('ana', 'GET', '/api/conta/eu')).json()
      assert.equal(eu.conta.cpf, '52998224725')
      assert.equal(eu.ficha, null)
    })

    test('login com CPF ou e-mail; senha errada é recusada; sair encerra', async () => {
      assert.equal((await conta('x', 'POST', '/api/conta/login', { login: CPF, senha: 'errada-123' })).statusCode, 401)
      const porCpf = await conta('x', 'POST', '/api/conta/login', { login: '52998224725', senha: 'senha-da-ana' })
      assert.equal(porCpf.statusCode, 200)
      const porEmail = await conta('ana2', 'POST', '/api/conta/login', { login: 'ANA@conta.com', senha: 'senha-da-ana' })
      assert.equal(porEmail.statusCode, 200)
      guardar('ana2', porEmail)
      await conta('ana2', 'POST', '/api/conta/sair')
      assert.equal((await conta('ana2', 'GET', '/api/conta/eu')).json().conta, null)
      // sem o cabeçalho anti-CSRF
      const semCabecalho = await app.inject({ method: 'POST', url: '/api/conta/login', payload: { login: CPF, senha: 'senha-da-ana' } })
      assert.equal(semCabecalho.statusCode, 403)
    })

    test('inscrição pela conta, edição auditada sem mudar a fila, posição opcional e desistência', async () => {
      const nova = await conta('ana', 'POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: 'Ana Conta', email: 'ana@conta.com' })
      assert.equal(nova.statusCode, 201)
      assert.equal((await conta('ana', 'POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: 'Ana Conta' })).statusCode, 409)
      const { rows: [f] } = await pool.query('select * from pre_fichas where nome_completo = $1', ['Ana Conta'])
      assert.equal(f.cpf, '52998224725')
      let eu = (await conta('ana', 'GET', '/api/conta/eu')).json()
      assert.equal(eu.ficha.status, 'aguardando')
      assert.equal(eu.ficha.posicao, null) // desligado por padrão
      assert.equal(eu.dados.nome_completo, 'Ana Conta')

      const ed = await conta('ana', 'PUT', '/api/conta/dados', { ...eu.dados, logradouro: 'Rua Nova', numero: '99' })
      assert.equal(ed.statusCode, 200)
      const { rows: [g] } = await pool.query('select logradouro, numero, entrada_fila_em, created_at from pre_fichas where id = $1', [f.id])
      assert.equal(g.logradouro, 'Rua Nova')
      assert.equal(g.entrada_fila_em.getTime(), f.entrada_fila_em.getTime())
      const { rows: [h] } = await pool.query(`select detalhes from pre_fichas_historico where pre_ficha_id = $1 and tipo = 'edicao'`, [f.id])
      assert.deepEqual(h.detalhes.campos.sort(), ['logradouro', 'numero'])
      assert.equal(h.detalhes.antes.logradouro, 'Rua A')

      await req('admin', 'PUT', '/api/admin/marca', { ...(await req('admin', 'GET', '/api/admin/marca')).json(), mostrarPosicaoFila: true })
      invalidarMarca()
      eu = (await conta('ana', 'GET', '/api/conta/eu')).json()
      assert.equal(typeof eu.ficha.posicao, 'number')

      assert.equal((await conta('ana', 'POST', '/api/conta/desistir')).statusCode, 200)
      eu = (await conta('ana', 'GET', '/api/conta/eu')).json()
      assert.equal(eu.ficha.status, 'desistiu')
      assert.equal(eu.ficha.ativa, false)
      // pode se inscrever de novo
      assert.equal((await conta('ana', 'POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: 'Ana Conta', email: 'ana@conta.com' })).statusCode, 201)
      // outra pessoa não vê nada sem login
      assert.equal((await conta('ninguem', 'PUT', '/api/conta/dados', eu.dados)).statusCode, 401)
    })

    test('quem fez o Juvenil pode entrar na fila do Sênior com os requisitos, mas não repetir o Juvenil', async () => {
      const r = await conta('bia', 'POST', '/api/conta/cadastro', { cpf: '111.444.777-35', email: 'bia@conta.com', senha: 'senha-da-bia' })
      guardar('bia', r)
      const jovem = { ...FICHA, nome_completo: 'Bia Jovem', email: 'bia@conta.com', data_nascimento: '1999-03-01', modalidade: 'juvenil' }
      assert.equal((await conta('bia', 'POST', '/api/conta/pre-ficha', jovem)).statusCode, 201)
      await pool.query(`update pre_fichas set status = 'participou' where nome_completo = 'Bia Jovem'`)
      assert.deepEqual((await conta('bia', 'GET', '/api/conta/eu')).json().modalidadesFeitas, ['juvenil'])
      // repetir o Juvenil: recusado
      const repetir = await conta('bia', 'POST', '/api/conta/pre-ficha', jovem)
      assert.equal(repetir.statusCode, 400)
      assert.match(repetir.json().erros.modalidade, /já fez/)
      // Sênior solteira com menos de 30: sem requisito
      assert.equal((await conta('bia', 'POST', '/api/conta/pre-ficha', { ...jovem, modalidade: 'senior' })).statusCode, 400)
      // casou: pode entrar na fila do Sênior
      const casada = { ...jovem, modalidade: 'senior', estado_civil: 'casado' }
      assert.equal((await conta('bia', 'POST', '/api/conta/pre-ficha', casada)).statusCode, 201)
    })

    test('painel mostra CPF e conta; equipe vincula ficha antiga à conta pelo CPF', async () => {
      await enviar({ nome_completo: 'Carla Antiga', email: 'carla@x.com', telefone: '(48) 98888-1111' })
      const id = await idPorNome('Carla Antiga')
      let f = (await req('admin', 'GET', '/api/admin/pre-fichas')).json().find((x) => x.id === id)
      assert.equal(f.tem_conta, false)
      assert.equal((await req('coord', 'PUT', `/api/admin/pre-fichas/${id}/conta`, { cpf: CPF })).statusCode, 403)
      assert.equal((await req('equipe', 'PUT', `/api/admin/pre-fichas/${id}/conta`, { cpf: '390.533.447-05' })).statusCode, 404)
      const r = await req('equipe', 'PUT', `/api/admin/pre-fichas/${id}/conta`, { cpf: CPF })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().ficha.tem_conta, true)
      assert.equal(r.json().ficha.cpf, '52998224725')
      assert.equal(r.json().ficha.conta_email, 'ana@conta.com')
      const des = await req('admin', 'PUT', `/api/admin/pre-fichas/${id}/conta`, { cpf: null })
      assert.equal(des.json().ficha.tem_conta, false)
      f = (await req('admin', 'GET', `/api/admin/pre-fichas/${id}/historico`)).json()
      assert.ok(f.some((h) => /vinculada à conta ana@conta.com/.test(h.observacao ?? '')))
    })

    test('contas antigas importadas criam a senha pelo link do e-mail (uso único)', async () => {
      const csv = 'nome;cpf;email;data_nascimento\nJoão Antigo;390.533.447-05;joao@antigo.com;10/02/1990\nRuim;123;x@y.com;\n'
      const imp = await req('admin', 'POST', '/api/admin/participantes/importar', { csv })
      assert.equal(imp.json().importados, 1)
      assert.equal(imp.json().erros[0].motivo, 'CPF inválido')
      assert.equal((await req('equipe', 'POST', '/api/admin/participantes/importar', { csv })).statusCode, 403)
      // sem senha ainda: login não entra
      assert.equal((await conta('j', 'POST', '/api/conta/login', { login: '39053344705', senha: '39053344705' })).statusCode, 401)

      emailsEnviados.length = 0
      const r = await conta('j', 'POST', '/api/conta/esqueci', { login: '390.533.447-05' })
      assert.equal(r.statusCode, 200)
      // conta inexistente: mesma resposta, nenhum e-mail
      assert.equal((await conta('j', 'POST', '/api/conta/esqueci', { login: 'naoexiste@x.com' })).json().mensagem, r.json().mensagem)
      assert.equal(emailsEnviados.length, 1)
      assert.equal(emailsEnviados[0].para, 'joao@antigo.com')
      const token = emailsEnviados[0].texto.match(/redefinir=([\w-]+)/)[1]
      assert.match(emailsEnviados[0].texto, /https:\/\/prefichas\.teste\/\?redefinir=/)

      const def = await conta('j', 'POST', '/api/conta/redefinir', { token, senha: 'nova-senha-joao' })
      assert.equal(def.statusCode, 200)
      assert.equal((await conta('j', 'POST', '/api/conta/redefinir', { token, senha: 'outra-senha-1' })).statusCode, 400)
      assert.equal((await conta('j', 'POST', '/api/conta/login', { login: 'joao@antigo.com', senha: 'nova-senha-joao' })).statusCode, 200)
    })
  })

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
