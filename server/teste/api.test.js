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
import { modalidadesCompativeis } from '../../shared/util.js'
import { limparJpeg } from '../foto.js'
import { aplicar, casarTribo, decodificar, desfazer, lerCsv, lerEdicao, lerPlanilha, mapearLinha, planejar, relatorios } from '../importacao.js'
import { crc32, deflateRawSync } from 'node:zlib'

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
      // lista resumida (sem textos longos); completa só no detalhe ou na exportação
      assert.equal(r.json()[0].motivo, undefined)
      assert.equal(r.json()[0].ip_origem, undefined)
      const id = r.json()[0].id
      const det = (await req('coord', 'GET', `/api/admin/pre-fichas/${id}`)).json()
      assert.equal(typeof det.motivo, 'string')
      assert.equal(det.ip_origem, undefined)
      const comp = (await req('coord', 'GET', '/api/admin/pre-fichas?completo=1')).json()
      assert.equal(comp.length, 2)
      assert.equal(typeof comp[0].motivo, 'string')
      assert.equal(comp[0].ip_origem, undefined)
    })

    test('coordenadora não altera nem vê histórico de ficha fora da área', async () => {
      const fora = await idPorNome('Terceiro Juvenil')
      assert.equal((await req('coord', 'PATCH', `/api/admin/pre-fichas/${fora}`, { status: 'em_contato' })).statusCode, 404)
      assert.equal((await req('coord', 'GET', `/api/admin/pre-fichas/${fora}/historico`)).statusCode, 404)
      // ficha completa: mesma regra (fora da área = não encontrada)
      assert.equal((await req('coord', 'GET', `/api/admin/pre-fichas/${fora}`)).statusCode, 404)
      // impressão: mesma regra; dentro da área fica registrada na trilha
      assert.equal((await req('coord', 'POST', `/api/admin/pre-fichas/${fora}/impressao`)).statusCode, 404)
      const naArea = await idPorNome('Segundo Juvenil')
      assert.equal((await req('coord', 'POST', `/api/admin/pre-fichas/${naArea}/impressao`)).statusCode, 200)
      assert.equal((await req('equipe', 'POST', `/api/admin/pre-fichas/${fora}/impressao`)).statusCode, 200)
      const hist = (await req('coord', 'GET', `/api/admin/pre-fichas/${naArea}/historico`)).json()
      assert.ok(hist.some((h) => h.observacao === 'Ficha impressa.' && h.usuario === 'Coordenadora'))
      assert.equal((await req('coord', 'GET', '/api/admin/pre-fichas?completo=1')).json().some((f) => f.id === fora), false)
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

    test('publicação na Cloudflare: o painel liga/desliga gravando um pedido validado', async () => {
      const pasta = mkdtempSync(join(tmpdir(), 'atualizador-'))
      mkdirSync(join(pasta, 'pedido')); mkdirSync(join(pasta, 'estado'))
      const a = await appCom({ versao: '2.0.0', commit: SHA_A }, { pastaControle: pasta })
      const post = (quem, corpo) => a.inject({ method: 'POST', url: '/api/admin/publicacao', headers: como(quem), payload: corpo })
      // atualizador antigo (sem publicação): explica que precisa atualizar
      writeFileSync(join(pasta, 'estado', 'atualizador.json'), JSON.stringify({ instalado_em: 'x' }))
      assert.match((await post('admin', { ativo: true, subdominio: 'sao-pedro' })).json().mensagem, /Atualize o sistema/)
      writeFileSync(join(pasta, 'estado', 'atualizador.json'), JSON.stringify({ instalado_em: 'x', publicacao: true }))
      writeFileSync(join(pasta, 'estado', 'publicacao.json'), JSON.stringify({ ativo: false, token_configurado: false }))
      assert.equal((await post('equipe', { ativo: true, subdominio: 'sao-pedro' })).statusCode, 403)
      assert.match((await post('admin', { ativo: true, subdominio: 'São Pedro!' })).json().mensagem, /Endereço inválido/)
      assert.match((await post('admin', { ativo: true, subdominio: 'sao-pedro' })).json().mensagem, /token/)
      assert.match((await post('admin', { ativo: true, subdominio: 'sao-pedro', token: 'x; rm -rf /' })).json().mensagem, /formato inválido/)
      const ok = await post('admin', { ativo: true, subdominio: 'sao-pedro', token: 'A'.repeat(40) })
      assert.equal(ok.statusCode, 200)
      assert.deepEqual(JSON.parse(readFileSync(join(pasta, 'pedido', 'publicacao.json'), 'utf8')), { ativo: true, subdominio: 'sao-pedro', token: 'A'.repeat(40) })
      assert.ok(existsSync(join(pasta, 'pedido', 'publicar')))
      assert.equal((await post('admin', { ativo: false })).statusCode, 409) // já em andamento
      // consultas de andamento não herdam o limite de outras rotas (o painel consulta a cada 3 s)
      for (let i = 0; i < 12; i++) {
        assert.equal((await a.inject({ method: 'GET', url: '/api/admin/atualizacao/progresso', headers: como('admin') })).statusCode, 200)
      }
      const e = (await a.inject({ method: 'GET', url: '/api/admin/publicacao/estado', headers: como('admin') })).json()
      await a.close()
      assert.equal(e.andamento, true)
      assert.equal(e.dominioBase, 'movimentocampista.com.br')
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

    test('cabeçalho da impressão: textos e logo da esquerda configuráveis (só administrador)', async () => {
      const enviar = (quem, corpo, tipo) => app.inject({ method: 'PUT', url: '/api/admin/marca/logo-impressao',
        headers: { ...como(quem), 'content-type': tipo }, payload: corpo })
      assert.equal((await enviar('equipe', PNG, 'image/png')).statusCode, 403)
      assert.equal((await enviar('admin', Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml')).statusCode, 400)
      assert.equal((await enviar('admin', PNG, 'image/png')).statusCode, 200)
      const atual = (await app.inject({ method: 'GET', url: '/api/marca' })).json()
      assert.match(atual.logoImpressaoUrl, /^\/api\/marca\/logo-impressao\?v=/)
      assert.ok((await app.inject({ method: 'GET', url: atual.logoImpressaoUrl })).rawPayload.equals(PNG))
      assert.equal(atual.impressaoTitulo, 'Ficha de pré-inscrição')
      const r = await req('admin', 'PUT', '/api/admin/marca', { ...atual, impressaoTitulo: 'Ficha de inscrição', impressaoSubtitulo: 'Acampamento Teste' })
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().impressaoTitulo, 'Ficha de inscrição')
      assert.equal((await req('admin', 'PUT', '/api/admin/marca', { ...atual, impressaoTitulo: 'x'.repeat(81) })).statusCode, 400)
      assert.equal((await app.inject({ method: 'DELETE', url: '/api/admin/marca/logo-impressao', headers: como('admin') })).statusCode, 200)
      assert.equal((await app.inject({ method: 'GET', url: '/api/marca' })).json().logoImpressaoUrl, null)
    })
  })


  // ------------------------------------------------------------------ modalidade Casais
  describe('modalidade Casais', () => {
    const gerarCpf = (base) => {
      const d = base.split('').map(Number)
      const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r }
      d.push(dv(9)); d.push(dv(10)); return d.join('')
    }
    const mascara = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`
    const comoConta = (cookie) => (method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } })
    let campSenior, campJuvenil
    const marcaAtual = async () => (await app.inject({ method: 'GET', url: '/api/marca' })).json()
    const exigeSenior = async (valor) => {
      const r = await req('admin', 'PUT', '/api/admin/marca', { ...(await marcaAtual()), casaisExigeSenior: valor })
      assert.equal(r.statusCode, 200)
    }
    // conta + ficha ligada ao CPF; se `camp` for informado, a pessoa passa a ser campista daquela edição
    async function pessoa({ nome, base, camp = null, casado = true }) {
      const cpf = gerarCpf(base), email = `${cpf}@casais.teste`
      const c = await app.inject({ method: 'POST', url: '/api/conta/cadastro', headers: H, payload: { cpf, email, senha: 'senha-casais-1' } })
      assert.equal(c.statusCode, 201, c.body)
      const ck = c.cookies.find((x) => x.name === 'prefichas_conta')
      const cookie = `${ck.name}=${ck.value}`
      let id = null
      if (camp) {
        await enviar({ nome_completo: nome, email, estado_civil: casado ? 'casado' : 'solteiro' })
        id = await idPorNome(nome)
        const { rows: [part] } = await pool.query('select id from participantes where cpf = $1', [cpf])
        await pool.query('update pre_fichas set cpf = $1, participante_id = $2 where id = $3', [cpf, part.id, id])
        const reg = await req('admin', 'PUT', `/api/admin/acampamentos/${camp}/participantes/${id}`, { tribo: 'Azul' })
        assert.ok(reg.statusCode < 300, reg.body)
      }
      return { cpf, email, cookie, id, api: comoConta(cookie) }
    }
    const inscrever = (quem, conjuge, extra = {}) => quem.api('POST', '/api/conta/pre-ficha', {
      ...FICHA, nome_completo: extra.nome ?? 'Casal Inscrito', email: quem.email, estado_civil: 'casado', modalidade: 'casais',
      conjuge_cpf: mascara(conjuge), ...extra.campos,
    })

    before(async () => {
      const a = await req('admin', 'POST', '/api/admin/acampamentos', { numero: 90, modalidade: 'senior' })
      const b = await req('admin', 'POST', '/api/admin/acampamentos', { numero: 91, modalidade: 'juvenil' })
      assert.equal(a.statusCode, 201, a.body)
      campSenior = a.json().id ?? a.json().acampamento?.id
      campJuvenil = b.json().id ?? b.json().acampamento?.id
    })
    after(() => exigeSenior(true))

    test('Casais é compatível só para casado(a)/união estável com 18+; a marca começa exigindo o Sênior', async () => {
      assert.ok(modalidadesCompativeis(35, 'casado').includes('casais'))
      assert.ok(modalidadesCompativeis(25, 'uniao_estavel').includes('casais'))
      assert.ok(!modalidadesCompativeis(35, 'solteiro').includes('casais'))
      assert.ok(!modalidadesCompativeis(17, 'casado').includes('casais'))
      assert.equal((await marcaAtual()).casaisExigeSenior, true)
    })

    test('configuração: o administrador liga e desliga "precisa do Sênior?"; equipe não altera', async () => {
      assert.equal((await req('equipe', 'PUT', '/api/admin/marca', { ...(await marcaAtual()), casaisExigeSenior: false })).statusCode, 403)
      await exigeSenior(false)
      assert.equal((await marcaAtual()).casaisExigeSenior, false)
      await exigeSenior(true)
      assert.equal((await marcaAtual()).casaisExigeSenior, true)
    })

    test('sem conta (formulário público) a inscrição de Casais é recusada', async () => {
      const r = await enviar({ nome_completo: 'Sem Conta Casal', estado_civil: 'casado', modalidade: 'casais', conjuge_cpf: mascara(gerarCpf('111222333')) })
      assert.equal(r.statusCode, 400)
      assert.match(r.json().erros.modalidade, /entre na sua conta/)
    })

    test('exigindo o Sênior: o inscrito precisa ter feito o Sênior; CPF do cônjuge é obrigatório e válido', async () => {
      const conjuge = await pessoa({ nome: 'Cônjuge Sênior Um', base: '200100301', camp: campSenior })
      const sem = await pessoa({ nome: 'Sem Sênior', base: '200100302' })
      const r = await inscrever(sem, conjuge.cpf)
      assert.equal(r.statusCode, 400)
      assert.match(r.json().erros.modalidade, /feito o Sênior/)
      const ok = await pessoa({ nome: 'Inscrito Sênior Um', base: '200100303', camp: campSenior })
      const faltando = await ok.api('POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: 'Casal Faltando', email: ok.email, estado_civil: 'casado', modalidade: 'casais' })
      assert.equal(faltando.statusCode, 400); assert.match(faltando.json().erros.conjuge_cpf, /Informe o CPF/)
      const invalido = await inscrever(ok, '12345678900')
      assert.equal(invalido.statusCode, 400); assert.match(invalido.json().erros.conjuge_cpf, /inválido/)
      const proprio = await inscrever(ok, ok.cpf)
      assert.equal(proprio.statusCode, 400); assert.match(proprio.json().erros.conjuge_cpf, /diferente do seu/)
    })

    test('o cônjuge precisa ser campista (e, se exigido, do Sênior); a recusa não revela quem é campista', async () => {
      const inscrito = await pessoa({ nome: 'Inscrito Sênior Dois', base: '200100304', camp: campSenior })
      const soJuvenil = await pessoa({ nome: 'Cônjuge Só Juvenil', base: '200100305', camp: campJuvenil })
      const naoExiste = gerarCpf('200100399')
      const a = await inscrever(inscrito, soJuvenil.cpf, { nome: 'Casal A' })
      const b = await inscrever(inscrito, naoExiste, { nome: 'Casal B' })
      assert.equal(a.statusCode, 400); assert.equal(b.statusCode, 400)
      // mesma mensagem para "campista de outra modalidade" e "CPF desconhecido"
      assert.equal(a.json().erros.conjuge_cpf, b.json().erros.conjuge_cpf)
      assert.match(a.json().erros.conjuge_cpf, /campista cadastrado/)
      assert.equal((await pool.query(`select count(*)::int n from pre_fichas where modalidade = 'casais' and cpf = $1`, [inscrito.cpf])).rows[0].n, 0)
    })

    test('casal válido: grava o CPF do cônjuge, registra no histórico, impede o cônjuge de duplicar e trava a edição', async () => {
      const marido = await pessoa({ nome: 'Marido Sênior', base: '200100306', camp: campSenior })
      const esposa = await pessoa({ nome: 'Esposa Sênior', base: '200100307', camp: campSenior })
      const r = await inscrever(marido, esposa.cpf, { nome: 'Marido Sênior' })
      assert.equal(r.statusCode, 201, r.body)
      const { rows: [f] } = await pool.query(`select id, modalidade, conjuge_cpf, cpf from pre_fichas where cpf = $1 and modalidade = 'casais'`, [marido.cpf])
      assert.equal(f.conjuge_cpf, esposa.cpf)
      const { rows: hist } = await pool.query(`select observacao from pre_fichas_historico where pre_ficha_id = $1 and observacao like 'Inscrição de casal%'`, [f.id])
      assert.equal(hist.length, 1)
      assert.match(hist[0].observacao, new RegExp(`terminado em ${esposa.cpf.slice(-2)}`)); assert.doesNotMatch(hist[0].observacao, new RegExp(esposa.cpf))
      // o cônjuge não inscreve o mesmo casal de novo
      const dup = await inscrever(esposa, marido.cpf, { nome: 'Esposa Sênior' })
      assert.equal(dup.statusCode, 400); assert.match(dup.json().erros.modalidade, /já fez a inscrição de casais/)
      // a área do participante não troca modalidade nem CPF do cônjuge
      const ed = await marido.api('PUT', '/api/conta/dados', { ...FICHA, nome_completo: 'Marido Sênior', email: marido.email, estado_civil: 'casado', modalidade: 'senior', conjuge_cpf: mascara(gerarCpf('200100398')), logradouro: 'Rua Nova' })
      assert.equal(ed.statusCode, 200, ed.body)
      const { rows: [g] } = await pool.query('select modalidade, conjuge_cpf, logradouro from pre_fichas where id = $1', [f.id])
      assert.equal(g.modalidade, 'casais'); assert.equal(g.conjuge_cpf, esposa.cpf); assert.equal(g.logradouro, 'Rua Nova')
      // o painel mostra o CPF do cônjuge ao admin
      const det = (await req('admin', 'GET', `/api/admin/pre-fichas/${f.id}`)).json()
      assert.equal(det.conjuge_cpf, esposa.cpf); assert.equal(det.modalidade, 'casais')
    })

    test('não exigindo o Sênior: vale qualquer campista como cônjuge e o inscrito não precisa ter feito o Sênior', async () => {
      await exigeSenior(false)
      try {
        const conjuge = await pessoa({ nome: 'Cônjuge Juvenil Dois', base: '200100308', camp: campJuvenil })
        const inscrito = await pessoa({ nome: 'Inscrito Sem Sênior', base: '200100309' })
        const ok = await inscrever(inscrito, conjuge.cpf, { nome: 'Casal Sem Regra' })
        assert.equal(ok.statusCode, 201, ok.body)
        // continua exigindo que o cônjuge seja campista cadastrado
        const outro = await pessoa({ nome: 'Outro Sem Sênior', base: '200100310' })
        const naoCampista = await pessoa({ nome: 'Não Campista', base: '200100311' })
        const recusa = await inscrever(outro, naoCampista.cpf, { nome: 'Casal Recusado' })
        assert.equal(recusa.statusCode, 400); assert.match(recusa.json().erros.conjuge_cpf, /campista cadastrado/)
        assert.doesNotMatch(recusa.json().erros.conjuge_cpf, /Sênior/)
      } finally { await exigeSenior(true) }
    })

    test('conta informa se já fez o Sênior; tentativas erradas de CPF de cônjuge têm limite', async () => {
      const fez = await pessoa({ nome: 'Fez Sênior Limite', base: '200100312', camp: campSenior })
      const nao = await pessoa({ nome: 'Não Fez Limite', base: '200100313' })
      assert.equal((await fez.api('GET', '/api/conta/eu')).json().fezSenior, true)
      assert.equal((await nao.api('GET', '/api/conta/eu')).json().fezSenior, false)
      for (let i = 0; i < 5; i++) {
        const r = await inscrever(fez, gerarCpf(`30010030${i}`), { nome: 'Tentativa Limite' })
        assert.equal(r.statusCode, 400, `tentativa ${i + 1}`)
      }
      const bloqueada = await inscrever(fez, gerarCpf('300100309'), { nome: 'Tentativa Limite' })
      assert.equal(bloqueada.statusCode, 429)
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

      await req('admin', 'PUT', '/api/admin/marca', { ...(await app.inject({ method: 'GET', url: '/api/marca' })).json(), mostrarPosicaoFila: true })
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

    test('preferência do cônjuge pode ser desligada nas configurações', async () => {
      const marca = (await app.inject({ method: 'GET', url: '/api/marca' })).json()
      assert.equal(marca.preferenciaConjuge, true)
      await req('admin', 'PUT', '/api/admin/marca', { ...marca, preferenciaConjuge: false })
      invalidarMarca()
      assert.equal((await app.inject({ method: 'GET', url: '/api/marca' })).json().preferenciaConjuge, false)
      const id = await idPorNome('Carla Antiga')
      const r = await req('equipe', 'POST', `/api/admin/pre-fichas/${id}/preferencias`, { modalidade: 'juvenil', acampamento_numero: 10, conjuge_nome: 'Fulano' })
      assert.equal(r.statusCode, 400)
      assert.match(r.json().mensagem, /desligada/)
      await req('admin', 'PUT', '/api/admin/marca', { ...marca, preferenciaConjuge: true })
      invalidarMarca()
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


  // ------------------------------------------------------------------ esqueci minha senha (painel do acampamento)
  describe('esqueci minha senha do painel', () => {
    const SENHA_NOVA = 'senha-nova-do-painel-1'
    const outraApp = (extra) => construirApp({ pool, logger: false, chavesLicenca: chavesTeste, config: { ...app.config, ...extra } })
    const pedir = (email, ip) => app.inject({ method: 'POST', url: '/api/auth/esqueci', headers: H, payload: { email }, remoteAddress: ip })
    const redefinir = (payload, ip = '10.8.0.1') => app.inject({ method: 'POST', url: '/api/auth/redefinir', headers: H, payload, remoteAddress: ip })
    const entrar = (email, senha, codigo, ip = '10.8.1.1') => app.inject({ method: 'POST', url: '/api/auth/login',
      headers: { ...H, 'x-forwarded-for': ip }, payload: { email, senha, ...(codigo ? { codigo } : {}) } })
    const tokenDoEmail = () => emailsEnviados.at(-1).texto.match(/redefinir=([\w-]+)/)[1]
    const novoUsuario = (email, ativo = true) => pool.query(
      `insert into usuarios (email, nome, papel, senha_hash, trocar_senha, ativo) values ($1, 'Pessoa Teste', 'equipe', $2, false, $3)`,
      [email, '$placeholder', ativo])
    before(async () => {
      const hash = await gerarHash(SENHA)
      for (const [email, ativo] of [['esq1@x.com', true], ['esq2@x.com', true], ['esq-dois@x.com', true], ['esq-inativo@x.com', false], ['esq-limite@x.com', true]]) {
        await novoUsuario(email, ativo)
        await pool.query('update usuarios set senha_hash = $1 where email = $2', [hash, email])
      }
    })

    test('pede o link: mesma resposta para quem existe e para quem não existe; só usuário ativo recebe e-mail', async () => {
      emailsEnviados.length = 0
      const a = await pedir('esq1@x.com', '10.8.2.1')
      const b = await pedir('naoexiste@x.com', '10.8.2.1')
      const c = await pedir('esq-inativo@x.com', '10.8.2.1')
      const d = await pedir('isto-nao-e-email', '10.8.2.1')
      for (const r of [a, b, c, d]) assert.equal(r.statusCode, 200)
      assert.equal(a.json().mensagem, b.json().mensagem); assert.equal(a.json().mensagem, c.json().mensagem)
      assert.equal(emailsEnviados.length, 1)
      assert.equal(emailsEnviados[0].para, 'esq1@x.com')
      assert.match(emailsEnviados[0].texto, /https:\/\/prefichas\.teste\/admin\/\?redefinir=[\w-]{20,}/)
      // novo pedido em menos de 2 minutos não manda outro e-mail (nem mostra isso na tela)
      assert.equal((await pedir('esq1@x.com', '10.8.2.1')).statusCode, 200)
      assert.equal(emailsEnviados.length, 1)
      // o banco guarda só o hash do token
      const { rows } = await pool.query('select id from usuarios_redefinicoes')
      assert.ok(rows.every((r) => r.id !== tokenDoEmail()))
    })

    test('redefine a senha: link vale uma vez, senha fraca é recusada, sessões antigas caem, senha antiga deixa de valer', async () => {
      const { cookie } = await login('esq2@x.com')
      assert.equal((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { ...H, cookie } })).json().usuario.email, 'esq2@x.com')
      emailsEnviados.length = 0
      await pedir('esq2@x.com', '10.8.2.2')
      const token = tokenDoEmail()
      assert.equal((await redefinir({ token, senha: 'curta' })).statusCode, 400)
      assert.equal((await redefinir({ token: 'x'.repeat(43), senha: SENHA_NOVA })).statusCode, 400)
      assert.equal((await redefinir({ token, senha: SENHA_NOVA })).statusCode, 200)
      assert.equal((await redefinir({ token, senha: 'outra-senha-9' })).statusCode, 400, 'o link vale uma vez só')
      assert.equal((await entrar('esq2@x.com', SENHA)).statusCode, 401, 'a senha antiga deixou de valer')
      assert.equal((await entrar('esq2@x.com', SENHA_NOVA)).statusCode, 200)
      assert.equal((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { ...H, cookie } })).json().usuario, null, 'a sessão antiga caiu')
    })

    test('com duas etapas ativas o link sozinho não basta: precisa do código e a verificação continua ligada', async () => {
      const { cookie } = await login('esq-dois@x.com')
      const c = { ...H, cookie }
      const { segredo } = (await app.inject({ method: 'POST', url: '/api/auth/2fa/iniciar', headers: c })).json()
      const ativ = _codigoNoPasso(segredo, passoAtual())
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/2fa/ativar', headers: c, payload: { codigo: ativ } })).statusCode, 200)
      emailsEnviados.length = 0
      await pedir('esq-dois@x.com', '10.8.2.3')
      const token = tokenDoEmail()
      const sem = await redefinir({ token, senha: SENHA_NOVA })
      assert.deepEqual([sem.statusCode, sem.json().precisa2fa], [401, true])
      assert.equal((await redefinir({ token, senha: SENHA_NOVA, codigo: '123456' })).statusCode, 401)
      // tentativas sem o código certo não gastam o link
      const ok = await redefinir({ token, senha: SENHA_NOVA, codigo: _codigoNoPasso(segredo, passoAtual() + 1) })
      assert.equal(ok.statusCode, 200, ok.body)
      const depois = await entrar('esq-dois@x.com', SENHA_NOVA)
      assert.deepEqual([depois.statusCode, depois.json().precisa2fa], [401, true], 'as duas etapas seguem ativas')
      const { rows: [u] } = await pool.query(`select totp_ativo from usuarios where email = 'esq-dois@x.com'`)
      assert.equal(u.totp_ativo, true)
    })

    test('dois pedidos ao mesmo tempo com o mesmo link: só um vale', async () => {
      emailsEnviados.length = 0
      await pedir('esq1@x.com', '10.8.2.5')   // já houve pedido há instantes: força um novo token
      await pool.query(`update usuarios_redefinicoes set criado_em = now() - interval '5 minutes' where usuario_id = (select id from usuarios where email = 'esq1@x.com')`)
      emailsEnviados.length = 0
      await pedir('esq1@x.com', '10.8.2.6')
      const token = tokenDoEmail()
      const r = await Promise.all([redefinir({ token, senha: 'corrida-um-123' }, '10.8.3.1'), redefinir({ token, senha: 'corrida-dois-123' }, '10.8.3.2')])
      assert.deepEqual(r.map((x) => x.statusCode).sort(), [200, 400])
    })

    test('pedidos de link têm limite por origem', async () => {
      const codigos = []
      for (let i = 0; i < 7; i++) codigos.push((await pedir('esq-limite@x.com', '10.8.9.9')).statusCode)
      assert.deepEqual(codigos.slice(0, 5), [200, 200, 200, 200, 200])
      assert.equal(codigos[6], 429)
    })

    test('sem e-mail configurado, o servidor avisa em vez de fingir que enviou', async () => {
      const a = await outraApp({ urlPublica: null })
      try {
        const r = await a.inject({ method: 'POST', url: '/api/auth/esqueci', headers: H, payload: { email: 'esq1@x.com' } })
        assert.equal(r.statusCode, 503)
        assert.match(r.json().mensagem, /administrador/)
      } finally { await a.close() }
    })
  })


  // ------------------------------------------------------------------ foto da conta do participante
  describe('foto da conta', () => {
    const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooor50+2CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//9k=', 'base64')                 // 40x48 px
    const cpfValidoDe = (base) => {
      const d = base.split('').map(Number)
      const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r }
      d.push(dv(9)); d.push(dv(10)); return d.join('')
    }
    // insere um segmento logo depois do SOI (como as câmeras fazem com o EXIF)
    const comSegmento = (buf, marcador, conteudo) => {
      const c = Buffer.from(conteudo, 'latin1'); const seg = Buffer.alloc(4 + c.length)
      seg[0] = 0xff; seg[1] = marcador; seg.writeUInt16BE(2 + c.length, 2); c.copy(seg, 4)
      return Buffer.concat([buf.subarray(0, 2), seg, buf.subarray(2)])
    }
    const novaConta = async (base) => {
      const cpf = cpfValidoDe(base)
      const r = await app.inject({ method: 'POST', url: '/api/conta/cadastro', headers: H, payload: { cpf, email: `${cpf}@foto.teste`, senha: 'senha-foto-123' } })
      assert.equal(r.statusCode, 201, r.body)
      const ck = r.cookies.find((x) => x.name === 'prefichas_conta')
      const headers = { ...H, cookie: `${ck.name}=${ck.value}` }
      return { cpf, email: `${cpf}@foto.teste`, api: (metodo, url, payload, extra = {}) => app.inject({ method: metodo, url, payload, headers: { ...headers, ...extra } }) }
    }
    const enviar = (c, buf, tipo = 'image/jpeg') => c.api('PUT', '/api/conta/foto', buf, { 'content-type': tipo })
    // tamanho (largura x altura) declarado no cabeçalho SOF
    const redimensionar = (buf, w, h) => { const c = Buffer.from(buf); const i = c.indexOf(Buffer.from([0xff, 0xc0])); c.writeUInt16BE(h, i + 5); c.writeUInt16BE(w, i + 7); return c }

    test('sem entrar na conta não se envia, vê nem apaga foto', async () => {
      for (const [m, payload] of [['PUT', JPEG], ['GET'], ['DELETE']]) {
        const r = await app.inject({ method: m, url: '/api/conta/foto', payload, headers: { ...H, 'content-type': 'image/jpeg' } })
        assert.equal(r.statusCode, 401, m)
      }
    })

    test('envia, mostra, troca e remove a própria foto; a conta informa se tem foto', async () => {
      const c = await novaConta('300200101')
      assert.equal((await c.api('GET', '/api/conta/eu')).json().conta.temFoto, false)
      assert.equal((await c.api('GET', '/api/conta/foto')).statusCode, 404)
      const ok = await enviar(c, JPEG)
      assert.equal(ok.statusCode, 200, ok.body)
      const eu = (await c.api('GET', '/api/conta/eu')).json().conta
      assert.equal(eu.temFoto, true); assert.ok(eu.fotoVersao > 0)
      const g = await c.api('GET', '/api/conta/foto')
      assert.equal(g.statusCode, 200)
      assert.equal(g.headers['content-type'], 'image/jpeg')
      assert.equal(g.headers['x-content-type-options'], 'nosniff')
      assert.match(g.headers['cache-control'], /private/)
      assert.equal(limparJpeg(g.rawPayload) !== null, true, 'o que volta é um JPEG válido')
      // trocar
      const outra = Buffer.from(JPEG); outra[outra.length - 5] ^= 0x01
      assert.equal((await enviar(c, outra)).statusCode, 200)
      assert.equal((await pool.query('select count(*)::int n from participantes_fotos where participante_id = (select id from participantes where cpf = $1)', [c.cpf])).rows[0].n, 1, 'uma foto por conta')
      // remover
      assert.equal((await c.api('DELETE', '/api/conta/foto')).statusCode, 200)
      assert.equal((await c.api('GET', '/api/conta/foto')).statusCode, 404)
      assert.equal((await c.api('GET', '/api/conta/eu')).json().conta.temFoto, false)
    })

    test('metadados são removidos (EXIF/GPS, comentário, miniatura) e a imagem continua válida', async () => {
      const c = await novaConta('300200102')
      let suja = comSegmento(JPEG, 0xe1, 'Exif\0\0GPS-LATITUDE=-27.5954;GPS-LONGITUDE=-48.5480;DONO=Fulano')
      suja = comSegmento(suja, 0xfe, 'COMENTARIO-SECRETO')
      suja = comSegmento(suja, 0xed, 'Photoshop 3.0 DADO-PRIVADO')
      assert.ok(suja.includes('GPS-LATITUDE'))
      assert.equal((await enviar(c, suja)).statusCode, 200)
      const salvo = (await c.api('GET', '/api/conta/foto')).rawPayload
      for (const segredo of ['GPS-LATITUDE', 'COMENTARIO-SECRETO', 'DADO-PRIVADO', 'Exif']) assert.equal(salvo.includes(segredo), false, segredo)
      assert.ok(limparJpeg(salvo), 'continua sendo um JPEG completo')
      assert.ok(salvo.length < suja.length)
    })

    test('recusa o que não é uma foto JPG válida (outros formatos, truncado, bytes escondidos, tamanho absurdo)', async () => {
      const c = await novaConta('300200103')
      const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(300, 1)])
      assert.equal((await enviar(c, png, 'image/png')).statusCode, 415, 'PNG: o navegador converte para JPG antes de enviar')
      assert.equal((await enviar(c, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' + ' '.repeat(100)))).statusCode, 400, 'SVG disfarçado de JPG')
      assert.equal((await enviar(c, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]))).statusCode, 400, 'cabeçalho de JPG com lixo')
      assert.equal((await enviar(c, JPEG.subarray(0, JPEG.length - 30))).statusCode, 400, 'truncado')
      assert.equal((await enviar(c, Buffer.concat([JPEG, Buffer.from('<?php system($_GET[0]); ?>')]))).statusCode, 400, 'dados escondidos depois do fim da imagem')
      assert.equal((await enviar(c, redimensionar(JPEG, 16, 16))).statusCode, 400, 'pequena demais')
      assert.equal((await enviar(c, redimensionar(JPEG, 5000, 5000))).statusCode, 400, 'dimensões absurdas')
      assert.equal((await enviar(c, Buffer.concat([JPEG.subarray(0, JPEG.length - 2), Buffer.alloc(400 * 1024), Buffer.from([0xff, 0xd9])]))).statusCode >= 400, true, 'grande demais')
      assert.equal((await c.api('GET', '/api/conta/eu')).json().conta.temFoto, false, 'nada foi gravado')
    })

    test('a equipe vê a foto da conta ligada à ficha (só quem pode ver a ficha); sem foto, 404; listas não carregam a imagem', async () => {
      const c = await novaConta('300200104')
      const sem = await novaConta('300200105')
      for (const [pessoa, nome] of [[c, 'Foto Visivel Teste'], [sem, 'Sem Foto Teste']]) {
        const r = await pessoa.api('POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: nome, email: pessoa.email, telefone: '(48) 99999-3001' })
        assert.equal(r.statusCode, 201, r.body)
      }
      await enviar(c, JPEG)
      const idComFoto = await idPorNome('Foto Visivel Teste'), idSem = await idPorNome('Sem Foto Teste')
      const f = await req('admin', 'GET', `/api/admin/pre-fichas/${idComFoto}/foto`)
      assert.equal(f.statusCode, 200); assert.equal(f.headers['content-type'], 'image/jpeg'); assert.match(f.headers['cache-control'], /private/)
      assert.equal((await req('admin', 'GET', `/api/admin/pre-fichas/${idSem}/foto`)).statusCode, 404)
      assert.equal((await app.inject({ method: 'GET', url: `/api/admin/pre-fichas/${idComFoto}/foto`, headers: H })).statusCode, 401, 'sem login')
      assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas/999999/foto')).statusCode, 404)
      // escopo: a coordenadora do núcleo de Florianópolis vê a foto da sua área, mas não a de outra cidade
      assert.equal((await req('coord', 'GET', `/api/admin/pre-fichas/${idComFoto}/foto`)).statusCode, 200, 'dentro do núcleo')
      const longe = await novaConta('300200107')
      assert.equal((await longe.api('POST', '/api/conta/pre-ficha', { ...FICHA, nome_completo: 'Foto Longe Teste', email: longe.email, telefone: '(41) 99999-3002',
        cep: '80420-000', bairro: 'Batel', cidade: 'Curitiba', uf: 'PR' })).statusCode, 201)
      await enviar(longe, JPEG)
      const idLonge = await idPorNome('Foto Longe Teste')
      assert.equal((await req('admin', 'GET', `/api/admin/pre-fichas/${idLonge}/foto`)).statusCode, 200)
      assert.equal((await req('coord', 'GET', `/api/admin/pre-fichas/${idLonge}/foto`)).statusCode, 404, 'fora do núcleo da coordenadora')
      const det = (await req('admin', 'GET', `/api/admin/pre-fichas/${idComFoto}`)).json()
      assert.ok(det.foto_versao > 0); assert.equal((await req('admin', 'GET', `/api/admin/pre-fichas/${idSem}`)).json().foto_versao, null)
      assert.doesNotMatch(JSON.stringify(det), /\/9j\/4AAQ|dados/, 'a ficha não carrega os bytes da foto')
      const lista = await req('admin', 'GET', '/api/admin/pre-fichas')
      assert.doesNotMatch(lista.body, /\/9j\/4AAQ/, 'a lista não carrega fotos')
    })

    test('ao apagar a conta, a foto vai junto', async () => {
      const c = await novaConta('300200106')
      await enviar(c, JPEG)
      const { rows: [{ id }] } = await pool.query('select id from participantes where cpf = $1', [c.cpf])
      assert.equal((await pool.query('select count(*)::int n from participantes_fotos where participante_id = $1', [id])).rows[0].n, 1)
      await pool.query('delete from participantes where id = $1', [id])
      assert.equal((await pool.query('select count(*)::int n from participantes_fotos where participante_id = $1', [id])).rows[0].n, 0)
    })
  })


  // ------------------------------------------------------------------ cadastro da equipe (coordenadores) feito pela própria pessoa
  describe('cadastro da equipe', () => {
    const SENHA_NOVA = 'senha-do-coordenador-1'
    const cadastrar = (payload, ip = '10.7.0.1') => app.inject({ method: 'POST', url: '/api/auth/cadastro', headers: H, payload, remoteAddress: ip })
    const entrar = (email, senha) => app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...H, 'x-forwarded-for': '10.7.9.9' }, payload: { email, senha } })
    const marcaAtual = async () => (await app.inject({ method: 'GET', url: '/api/marca' })).json()
    const cadastroEquipe = async (v) => assert.equal((await req('admin', 'PUT', '/api/admin/marca', { ...(await marcaAtual()), cadastroEquipe: v })).statusCode, 200)
    const linha = async (email) => (await pool.query('select * from usuarios where email = $1', [email])).rows[0]
    const tokenConfirmacao = () => emailsEnviados.filter((m) => /confirmar=/.test(m.texto)).at(-1).texto.match(/confirmar=([\w-]+)/)[1]
    let nucleoPoa

    before(async () => {
      const r = await req('admin', 'POST', '/api/admin/nucleos', { nome: 'Núcleo Teste Porto Alegre', areas: [{ uf: 'RS', cidade: 'PORTO ALEGRE' }] })
      assert.equal(r.statusCode, 201, r.body); nucleoPoa = r.json().id
    })
    after(() => cadastroEquipe(true))

    test('cadastro nasce SEM acesso: pendente, e-mail de confirmação, e o login explica o motivo só a quem acertou a senha', async () => {
      emailsEnviados.length = 0
      const r = await cadastrar({ nome: 'Marta Coordenadora', email: 'Marta@Coord.TESTE', senha: SENHA_NOVA })
      assert.equal(r.statusCode, 201, r.body)
      const u = await linha('marta@coord.teste')
      assert.deepEqual([u.pendente, u.ativo, u.email_confirmado, u.papel, u.trocar_senha], [true, false, false, 'coordenador', false])
      assert.equal(emailsEnviados.length, 1); assert.equal(emailsEnviados[0].para, 'marta@coord.teste')
      assert.match(emailsEnviados[0].texto, /https:\/\/prefichas\.teste\/admin\/\?confirmar=[\w-]{20,}/)
      const certa = await entrar('marta@coord.teste', SENHA_NOVA)
      assert.equal(certa.statusCode, 403); assert.equal(certa.json().pendente, true); assert.match(certa.json().mensagem, /Confirme o seu e-mail/)
      assert.equal(certa.cookies.length, 0, 'nenhuma sessão é criada')
      assert.equal((await entrar('marta@coord.teste', 'senha-errada-123')).statusCode, 401, 'senha errada: mensagem genérica')
      assert.equal((await entrar('ninguem@coord.teste', SENHA_NOVA)).statusCode, 401)
      // o painel continua fechado: sem sessão não há acesso a nada
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: H })).statusCode, 401)
    })

    test('e-mail que já existe: mesma resposta e NADA muda (não dá para tomar a conta de um administrador)', async () => {
      const antes = await linha('admin@x.com')
      const novo = await cadastrar({ nome: 'Quem Tenta Tomar', email: 'admin@x.com', senha: 'senha-do-invasor-1' }, '10.7.0.2')
      const real = await cadastrar({ nome: 'Marta Repetida', email: 'marta@coord.teste', senha: 'outra-senha-9999' }, '10.7.0.2')
      assert.equal(novo.statusCode, 201); assert.equal(novo.body, real.body)
      const depois = await linha('admin@x.com')
      assert.deepEqual([depois.papel, depois.ativo, depois.pendente, depois.senha_hash], [antes.papel, true, false, antes.senha_hash])
      assert.equal((await entrar('admin@x.com', SENHA)).statusCode, 200, 'a senha do administrador segue valendo')
      assert.equal((await entrar('admin@x.com', 'senha-do-invasor-1')).statusCode, 401)
    })

    test('validações, limite por origem, teto de pendentes e interruptor nas configurações', async () => {
      const ruim = await cadastrar({ nome: 'X', email: 'nao-e-email', senha: 'curta' }, '10.7.0.3')
      assert.equal(ruim.statusCode, 400); assert.ok(ruim.json().erros.nome && ruim.json().erros.email && ruim.json().erros.senha)
      const codigos = []
      for (let i = 0; i < 7; i++) codigos.push((await cadastrar({ nome: `Pessoa Limite ${i}`, email: `limite${i}@coord.teste`, senha: SENHA_NOVA }, '10.7.0.4')).statusCode)
      assert.deepEqual(codigos.slice(0, 5), [201, 201, 201, 201, 201]); assert.equal(codigos[6], 429)
      await pool.query(`delete from usuarios where email like 'limite%@coord.teste'`)
      // teto: com 50 pendentes, não entra mais ninguém
      await pool.query(`insert into usuarios (email, nome, senha_hash, ativo, pendente, solicitado_em) select 'teto' || g || '@coord.teste', 'Teto ' || g, 'x', false, true, now() from generate_series(1, 50) g`)
      assert.equal((await cadastrar({ nome: 'Pessoa Do Teto', email: 'doteto@coord.teste', senha: SENHA_NOVA }, '10.7.0.5')).statusCode, 429)
      await pool.query(`delete from usuarios where email like 'teto%@coord.teste'`)
      // pedido esquecido há mais de 30 dias é descartado
      await pool.query(`update usuarios set solicitado_em = now() - interval '40 days' where email = 'marta@coord.teste'`)
      assert.equal((await cadastrar({ nome: 'Pessoa Nova Limpa', email: 'limpa@coord.teste', senha: SENHA_NOVA }, '10.7.0.6')).statusCode, 201)
      assert.equal(await linha('marta@coord.teste'), undefined)
      await cadastrar({ nome: 'Marta Coordenadora', email: 'marta@coord.teste', senha: SENHA_NOVA }, '10.7.0.7')
      // interruptor (só o administrador mexe)
      assert.equal((await req('equipe', 'PUT', '/api/admin/marca', { ...(await marcaAtual()), cadastroEquipe: false })).statusCode, 403)
      await cadastroEquipe(false)
      const fechado = await cadastrar({ nome: 'Pessoa Fechado', email: 'fechado@coord.teste', senha: SENHA_NOVA }, '10.7.0.8')
      assert.equal(fechado.statusCode, 403); assert.match(fechado.json().mensagem, /fechado/)
      await cadastroEquipe(true)
    })

    test('confirmação do e-mail: link de uso único; os administradores são avisados', async () => {
      await pool.query(`delete from usuarios_confirmacoes`)
      emailsEnviados.length = 0
      await cadastrar({ nome: 'Carlos Confirma', email: 'carlos@coord.teste', senha: SENHA_NOVA }, '10.7.0.9')
      const token = tokenConfirmacao()
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/confirmar-email', headers: H, payload: { token: 'x'.repeat(43) } })).statusCode, 400)
      const ok = await app.inject({ method: 'POST', url: '/api/auth/confirmar-email', headers: H, payload: { token } })
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal((await linha('carlos@coord.teste')).email_confirmado, true)
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/confirmar-email', headers: H, payload: { token } })).statusCode, 400, 'uma vez só')
      assert.ok(emailsEnviados.some((m) => m.para === 'admin@x.com' && /aguardando liberação/.test(m.assunto)), 'o administrador é avisado')
      // confirmou, mas ainda não tem acesso
      const e = await entrar('carlos@coord.teste', SENHA_NOVA)
      assert.equal(e.statusCode, 403); assert.match(e.json().mensagem, /aguardando a liberação/)
    })

    test('o administrador libera escolhendo papel e núcleo: só ele, e o coordenador passa a ver só o que o núcleo permite', async () => {
      const { id } = await linha('carlos@coord.teste')
      emailsEnviados.length = 0
      const lista = (await req('admin', 'GET', '/api/admin/usuarios')).json().find((x) => x.id === id)
      assert.deepEqual([lista.pendente, lista.email_confirmado, lista.ativo], [true, true, false])
      assert.equal((await req('equipe', 'PATCH', `/api/admin/usuarios/${id}`, { ativo: true })).statusCode, 403, 'equipe não libera')
      assert.equal((await req('coord', 'PATCH', `/api/admin/usuarios/${id}`, { ativo: true })).statusCode, 403, 'coordenador não libera')
      assert.equal((await entrar('carlos@coord.teste', SENHA_NOVA)).statusCode, 403, 'ainda sem acesso')

      const lib = await req('admin', 'PATCH', `/api/admin/usuarios/${id}`, { ativo: true, papel: 'coordenador', nucleos: [nucleoPoa] })
      assert.equal(lib.statusCode, 200, lib.body)
      assert.deepEqual([lib.json().usuario.pendente, lib.json().usuario.ativo, lib.json().usuario.nucleos], [false, true, [nucleoPoa]])
      assert.ok(emailsEnviados.some((m) => m.para === 'carlos@coord.teste' && /liberado/.test(m.assunto)), 'a pessoa é avisada')
      const { r, cookie } = await login('carlos@coord.teste', SENHA_NOVA)
      assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().usuario.trocar_senha, false)
      // núcleo de Porto Alegre: não vê as fichas de Florianópolis
      const vendo = await app.inject({ method: 'GET', url: '/api/admin/pre-fichas', headers: { ...H, cookie } })
      assert.equal(vendo.statusCode, 200); assert.equal(vendo.json().length, 0)
      // o administrador amplia a permissão depois, e a lista aparece
      const { rows: [floripa] } = await pool.query(`select id from nucleos limit 1`)
      assert.equal((await req('admin', 'PATCH', `/api/admin/usuarios/${id}`, { nucleos: [nucleoPoa, floripa.id] })).statusCode, 200)
      // quem não é administrador não alcança a administração de usuários
      assert.equal((await app.inject({ method: 'GET', url: '/api/admin/usuarios', headers: { ...H, cookie } })).statusCode, 403)
    })

    test('recusar apaga só cadastro PENDENTE; pendente não ganha "nova senha" nem link de "esqueci minha senha"', async () => {
      await cadastrar({ nome: 'Rita Recusada', email: 'rita@coord.teste', senha: SENHA_NOVA }, '10.7.1.1')
      const { id } = await linha('rita@coord.teste')
      emailsEnviados.length = 0
      const e = await app.inject({ method: 'POST', url: '/api/auth/esqueci', headers: H, payload: { email: 'rita@coord.teste' }, remoteAddress: '10.7.1.2' })
      assert.equal(e.statusCode, 200); assert.equal(emailsEnviados.length, 0, 'pendente não recebe link de redefinição')
      assert.equal((await req('admin', 'POST', `/api/admin/usuarios/${id}/redefinir-senha`)).statusCode, 400)
      assert.equal((await req('equipe', 'DELETE', `/api/admin/usuarios/${id}/pendente`)).statusCode, 403)
      assert.equal((await req('admin', 'DELETE', `/api/admin/usuarios/${id}/pendente`)).statusCode, 200)
      assert.equal(await linha('rita@coord.teste'), undefined)
      // usuário de verdade (liberado) nunca é apagado por esta rota
      const { id: idAdmin } = await linha('admin@x.com'); const { id: idCarlos } = await linha('carlos@coord.teste')
      for (const alvo of [idAdmin, idCarlos, 999999]) assert.equal((await req('admin', 'DELETE', `/api/admin/usuarios/${alvo}/pendente`)).statusCode, 404)
      assert.ok(await linha('admin@x.com') && await linha('carlos@coord.teste'))
    })
  })


  // ------------------------------------------------------------------ importação de pré-fichas de outra planilha (dados FICTÍCIOS)
  describe('importação de fichas', () => {
    const HOJE = new Date('2026-11-09T12:00:00Z')
    const CAB = ['Nome', 'CPF', 'Idade', 'Data de Nascimento', 'Sexo', 'Estado Civil', 'Nome do Cônjuge', 'CPF do Cônjuge', 'Data de Casamento', 'Casado no Religioso',
      'Data da Pré-Ficha', 'Aguardando Acampamento', 'Onde Fui Campista', 'Onde Fui Servo', 'Paróquia', 'Pastoral', 'Telefone', 'Profissão', 'Religião', 'Batizado',
      'Primeira Comunhão', 'Crismado', 'Vícios', 'Restrições Médicas', 'Retiros Frequentados', 'Como você conheceu o acampamento?',
      'Por que você quer participar do acampamento?', 'Campistas conhecidos', 'Email', 'Instagram', 'Facebook', 'Rua', 'Número', 'Complemento', 'Bairro', 'Cidade', 'Estado', 'CEP']
    const cpfDe = (base) => {
      const d = base.split('').map(Number)
      const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r }
      d.push(dv(9)); d.push(dv(10)); return d.join('')
    }
    const linha = (c = {}) => ({
      Nome: 'Fulana de Tal', CPF: cpfDe('111222333'), 'Data de Nascimento': '10/05/1990', Sexo: 'Feminino', 'Estado Civil': 'Solteiro', 'Data da Pré-Ficha': '15/03/2025',
      'Aguardando Acampamento': 'Sênior', Telefone: '(48) 99999-0001', Religião: 'Católica', Batizado: 'Sim', 'Primeira Comunhão': 'Sim', Crismado: 'Não',
      'Como você conheceu o acampamento?': 'Amigos', 'Por que você quer participar do acampamento?': 'Quero viver Deus', Email: 'fulana@exemplo.com',
      Rua: 'Rua A', Número: '10', Bairro: 'Centro', Cidade: 'Florianópolis', Estado: 'SC', CEP: '88015200', ...c })
    const csv = (linhas, sep = ';') => `﻿${[CAB, ...linhas.map((l) => CAB.map((h) => l[h] ?? ''))].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(sep)).join('\r\n')}`
    const mapear = (c) => mapearLinha(lerCsv(csv([linha(c)])).registros[0], { hoje: HOJE, tribos: ['Azul', 'Preto', 'Vermelho', 'Roxo'] })
    const brasilia = (col, id) => pool.query(`select to_char(${col} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as d from pre_fichas where id = $1`, [id]).then((r) => r.rows[0].d)

    test('o CSV é lido com ; ou , aspas, quebra de linha dentro da célula e BOM', () => {
      const a = lerCsv(csv([linha({ Nome: 'Com "Aspas" e; ponto', 'Campistas conhecidos': 'Ana — Irmã\nBia — Prima' })]))
      assert.equal(a.registros.length, 1); assert.equal(a.registros[0].valores.nome, 'Com "Aspas" e; ponto')
      assert.equal(a.registros[0].valores['campistas conhecidos'], 'Ana — Irmã\nBia — Prima')
      assert.ok(a.cabecalho.includes('data da pre-ficha') && a.cabecalho.includes('como voce conheceu o acampamento?'), 'cabeçalhos sem acento e minúsculos')
      const b = lerCsv(csv([linha()], ','))
      assert.equal(b.registros[0].valores.nome, 'Fulana de Tal'); assert.equal(b.registros[0].numero, 2)
    })

    test('CSV do Excel: arquivo em ANSI não quebra os acentos e CPF sem o zero à esquerda é recuperado', () => {
      const utf8 = Buffer.from(csv([linha({ Nome: 'João Conceição', Cidade: 'São José' })]), 'utf8')
      assert.equal(lerCsv(decodificar(utf8)).registros[0].valores.nome, 'João Conceição')
      // "ANSI" (Windows-1252): cada acento é 1 byte; lido como UTF-8 seria inválido
      const ansi = Buffer.from(csv([linha({ Nome: 'João Conceição', Cidade: 'São José' })]).replace(/^\uFEFF/, ''), 'latin1')
      const r = lerCsv(decodificar(ansi)).registros[0].valores
      assert.deepEqual([r.nome, r.cidade, r['aguardando acampamento']], ['João Conceição', 'São José', 'Sênior'])
      // CPF que começa com zero e o Excel transformou em número (perdeu o zero)
      const cpf = cpfDe('012345678'); assert.ok(cpf.startsWith('0'))
      assert.equal(mapear({ CPF: cpf.slice(1) }).ficha.cpf, cpf)
      assert.equal(mapear({ CPF: '12345' }).ficha.cpf, null, 'CPF curto demais e inválido não é "consertado"')
    })


    test('quem é quem: na fila, campista que já participou (fora da fila) e o que não dá para classificar', async () => {
      const campista = mapear({ 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '', 'Onde Fui Campista': '12º Sênior - São Padre Pio (Azul)' })
      assert.deepEqual([campista.tipo, campista.ficha.status, campista.ficha.modalidade, campista.ficha.criado_em, campista.campista.length], ['campista', 'participou', 'senior', null, 1])
      assert.equal(campista.alertas.some((a) => /REVISAR MODALIDADE/.test(a)), false, 'a modalidade do campista é a que ele fez')
      assert.deepEqual([mapear({}).tipo, mapear({}).ficha.status], ['fila', 'aguardando'])
      // campista com 4 anos é erro de digitação, como na fila
      assert.match(mapear({ 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '', 'Onde Fui Campista': '2º Fac - X (Azul)', 'Data de Nascimento': '10/05/2022' }).quarentena, /improvável/)
      // nada a que se agarrar: quarentena com motivo claro (nunca adivinha)
      const nada = mapear({ 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '' })
      assert.match(nada.quarentena, /não dá para saber/)
      assert.match(mapear({ 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '', 'Onde Fui Servo': '3º Mirim (x)' }).quarentena, /só consta como servo/)
      assert.match(mapear({ 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '', 'Onde Fui Campista': 'Sênior Geral (fora)' }).quarentena, /fora do padrão/)

      // de ponta a ponta: o campista vira "Já participou", não entra na fila e a regra do Casais o reconhece
      const cpfCamp = cpfDe('300000001'), cpfFila = cpfDe('300000002')
      const { registros } = lerCsv(csv([
        linha({ Nome: 'Heitor Campista', CPF: cpfCamp, 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '', 'Onde Fui Campista': '12º Sênior - São Padre Pio (Azul)', Sexo: 'Masculino' }),
        linha({ Nome: 'Iara Na Fila', CPF: cpfFila, 'Data da Pré-Ficha': '05/05/2025' }),
        linha({ Nome: 'Joao Sem Nada', CPF: cpfDe('300000003'), 'Data da Pré-Ficha': '', 'Aguardando Acampamento': '' }),
      ]))
      const plano = await planejar(pool, registros, { hoje: HOJE })
      assert.deepEqual([plano.resumo.importar, plano.resumo.naFila, plano.resumo.campistasSemFila, plano.resumo.semClassificacao, plano.resumo.quarentena], [2, 1, 1, 1, 1])
      assert.match(relatorios(plano)['resumo.txt'], /campistas que já participaram \.+ 1/)
      await aplicar(pool, plano, { lote: 'teste-tipos' })
      const { rows } = await pool.query(`select cpf, status, modalidade, (created_at > now() - interval '1 hour') as recente from pre_fichas where importada_lote = 'teste-tipos' order by cpf`)
      assert.deepEqual(rows.map((r) => [r.status, r.modalidade]), [['participou', 'senior'], ['aguardando', 'juvenil'].slice(0, 0).concat(['aguardando', 'senior'])])
      assert.equal(rows.find((r) => r.cpf === cpfCamp).recente, true, 'campista sem data na planilha: data da importação')
      const fila = await pool.query(`select f.nome_completo from fila_espera f join pre_fichas p on p.id = f.id where p.importada_lote = 'teste-tipos'`)
      assert.deepEqual(fila.rows.map((r) => r.nome_completo), ['Iara Na Fila'], 'só quem espera está na fila')
      const { jaFezAcampamento, fezSenior } = await import('../casais.js')
      assert.equal(await jaFezAcampamento(pool, { cpf: cpfCamp }), true); assert.equal(await fezSenior(pool, null, cpfCamp), true)
      assert.equal(await jaFezAcampamento(pool, { cpf: cpfFila }), false)
      await desfazer(pool, 'teste-tipos')
    })

    // monta um .xlsx de verdade (zip + XML) para testar o leitor de Excel
    const zip = (arquivos) => {
      const locais = [], centrais = []; let off = 0
      for (const [nome, conteudo] of Object.entries(arquivos)) {
        const dados = Buffer.from(conteudo, 'utf8'), comp = deflateRawSync(dados), n = Buffer.from(nome), crc = crc32(dados)
        const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dados.length, 22); l.writeUInt16LE(n.length, 26)
        const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42)
        locais.push(l, n, comp); centrais.push(c, n); off += 30 + n.length + comp.length
      }
      const cd = Buffer.concat(centrais), fim = Buffer.alloc(22)
      fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(Object.keys(arquivos).length, 8); fim.writeUInt16LE(Object.keys(arquivos).length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16)
      return Buffer.concat([...locais, cd, fim])
    }
    const xlsx = (linhasXlsx) => {                       // linhasXlsx: matriz de valores; número = célula numérica, texto = célula de texto
      const comuns = []; const idx = (t) => { let i = comuns.indexOf(t); if (i < 0) { i = comuns.length; comuns.push(t) } return i }
      const col = (n) => String.fromCharCode(65 + n)
      const xml = linhasXlsx.map((l, r) => `<row r="${r + 1}">${l.map((x, c) => x === '' ? '' : typeof x === 'number'
        ? `<c r="${col(c)}${r + 1}"><v>${x}</v></c>` : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(x)}</v></c>`).join('')}</row>`).join('')
      return zip({
        'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Lista" sheetId="1" r:id="rId9"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheet7.xml"/></Relationships>',
        'xl/sharedStrings.xml': `<sst>${comuns.map((t) => `<si><t>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`,
        'xl/worksheets/sheet7.xml': `<worksheet><sheetData>${xml}</sheetData></worksheet>`,
      })
    }

    test('Excel (.xlsx): lê a aba, textos, números que perderam o zero e datas guardadas como número; recusa arquivo estragado', () => {
      const cpf = cpfDe('012345678')
      const arq = xlsx([CAB.slice(0, 12), ['Maria & Cia <Teste>', Number(cpf), 36, '10/05/1990', 'Feminino', 'Solteiro', '', '', '', '', 45698, 'Sênior']])
      const r = lerPlanilha(arq)
      assert.equal(r.registros.length, 1)
      assert.equal(r.registros[0].valores.nome, 'Maria & Cia <Teste>')
      assert.equal(r.registros[0].valores.cpf, String(Number(cpf)), 'o número chega sem o zero (o importador recupera)')
      assert.equal(r.registros[0].valores['data da pre-ficha'], '10/02/2025', 'data em número serial do Excel (45698) vira dd/mm/aaaa')
      assert.equal(mapear({ CPF: String(Number(cpf)) }).ficha.cpf, cpf)
      // não é um xlsx, está truncado, ou é "bomba": erro claro
      assert.throws(() => lerPlanilha(Buffer.from('PK\x03\x04lixo-sem-estrutura-nenhuma')), /Excel/)
      assert.throws(() => lerPlanilha(arq.subarray(0, arq.length - 30)), /Excel/)
      const bomba = zip({ 'xl/workbook.xml': '<workbook><sheets><sheet r:id="a"/></sheets></workbook>', 'xl/worksheets/sheet1.xml': `<worksheet>${'<row><c><v>1</v></c></row>'.repeat(61000)}</worksheet>` })
      assert.throws(() => lerPlanilha(bomba), /linhas demais/)
    })

    test('o que não dá para importar com segurança vai para a quarentena, com o motivo', () => {
      const casos = [
        [{ Nome: 'Al' }, /Nome/], [{ 'Data de Nascimento': '15/03/2062' }, /futuro/], [{ 'Data de Nascimento': '01/01/0063' }, /impossível/],
        [{ 'Data de Nascimento': '15/03/2023' }, /improvável/], [{ 'Data de Nascimento': '31/02/1990' }, /ilegível/], [{ 'Aguardando Acampamento': 'Outra' }, /Modalidade desconhecida/],
        [{ Sexo: 'X' }, /Sexo/], [{ 'Estado Civil': 'Complicado' }, /Estado civil/], [{ Telefone: '123' }, /Telefone/], [{ 'Data da Pré-Ficha': '15/03/2031' }, /futuro/],
        [{ Estado: 'Santa Catarina' }, /UF/], [{ Cidade: '' }, /Cidade/],
      ]
      for (const [c, re] of casos) { const m = mapear(c); assert.match(m.quarentena ?? '', re, JSON.stringify(c)) }
      assert.equal(mapear({}).quarentena, undefined)
      // criança de 5 anos só passa no Mirim (e com aviso); 2 anos nunca
      assert.equal(mapear({ 'Data de Nascimento': '10/05/2021', 'Aguardando Acampamento': 'Mirim' }).notas.some((n) => /mínimo do sistema/.test(n)), true)
      assert.match(mapear({ 'Data de Nascimento': '10/05/2025', 'Aguardando Acampamento': 'Mirim' }).quarentena, /improvável/)
    })

    test('ajustes sem inventar dados: FAC II, separado, CPF/e-mail inválidos, textos longos, "não", modalidade a revisar, histórico e tribo', () => {
      const m = mapear({
        'Aguardando Acampamento': 'FAC II', 'Data de Nascimento': '10/05/2011', 'Estado Civil': 'Separado', CPF: '00000000000', Email: 'isso-nao-e-email',
        Vícios: 'Não', 'Restrições Médicas': 'nenhuma', Pastoral: 'Catequese', Religião: 'Sem Religião', CEP: '', Complemento: 'c'.repeat(130),
        'Como você conheceu o acampamento?': 'x'.repeat(250), 'Onde Fui Campista': '16º Sênior - São Padre Pio (Vermelha)\n1º Acampamento de Casais - São Padre Pio (Roxa)\nSênior Geral (fora do sítio) (Azul)',
        'Onde Fui Servo': '3º Mirim Sitio (Evangelização)', 'Data de Casamento': '01/01/2010', 'Campistas conhecidos': 'Ana — Tia\nBia — Prima', 'CPF do Cônjuge': '123',
      })
      const f = m.ficha
      assert.deepEqual([f.modalidade, f.estado_civil, f.cpf, f.email, f.cep, f.possui_vicio, f.restricoes_medicas, f.participa_pastoral, f.pastoral_qual, f.religiao],
        ['fac', 'divorciado', null, null, null, false, null, true, 'Catequese', 'Sem religião'])
      assert.equal(f.complemento.length, 100); assert.equal(f.como_conheceu.length, 200)
      const n = m.notas.join('\n')
      for (const re of [/FAC II/, /Separado/, /CPF da planilha inválido/, /E-mail da planilha inválido/, /Complemento \(texto completo/, /Como conheceu \(texto completo/, /Foi servo: 3º Mirim/,
        /Data de casamento: 01\/01\/2010/, /Campistas conhecidos: Ana — Tia; Bia — Prima/, /CPF do cônjuge inválido/, /fora do padrão/]) assert.match(n, re)
      assert.deepEqual(m.campista.map((e) => [e.numero, e.modalidade, e.triboSistema]), [[16, 'senior', 'Vermelho'], [1, 'casais', 'Roxo']])
      assert.equal(mapearLinha(lerCsv(csv([linha({ 'Onde Fui Campista': '5º Mirim - X (Rosa)' })])).registros[0], { hoje: HOJE, tribos: ['Azul'] }).campista[0].triboSistema, 'Rosa', 'tribo que a marca não tem: o nome vem pronto para ser acrescentado')
      // 15 anos esperando FAC: nenhum aviso de modalidade; 40 anos esperando FAC: avisa e mantém
      assert.equal(mapear({ 'Aguardando Acampamento': 'FAC', 'Data de Nascimento': '10/05/2011' }).alertas.some((x) => /REVISAR/.test(x)), false)
      const rev = mapear({ 'Aguardando Acampamento': 'FAC', 'Data de Nascimento': '10/05/1986' })
      assert.equal(rev.ficha.modalidade, 'fac', 'a modalidade da planilha é mantida'); assert.match(rev.alertas[0], /REVISAR MODALIDADE.*Sênior/)
      // informação (campistas conhecidos, casamento, servo) vai para a ficha, mas NÃO entra na lista de conferência
      assert.equal(m.alertas.some((x) => /Campistas conhecidos|Data de casamento|Foi servo/.test(x)), false)
      assert.equal(m.alertas.some((x) => /CPF da planilha inválido/.test(x)), true)
      assert.equal(casarTribo('Amarela', ['Azul', 'Amarelo']), 'Amarelo'); assert.equal(casarTribo('Cinza', ['Azul']), null)
      assert.deepEqual([lerEdicao('11 Sênior - São Padre Pio (Verde)').numero, lerEdicao('Sênior Geral (x)')], [11, null])
    })

    test('a simulação não grava nada; a importação mantém a DATA DA PRÉ-FICHA da planilha e, com ela, a ordem da fila', async () => {
      const linhas = [
        linha({ Nome: 'Bruna Segunda', CPF: cpfDe('200000001'), 'Data da Pré-Ficha': '20/06/2025', 'Onde Fui Campista': '16º Sênior - São Padre Pio (Vermelha)' }),
        linha({ Nome: 'Ana Primeira', CPF: cpfDe('200000002'), 'Data da Pré-Ficha': '01/02/2024', Email: '', CEP: '', 'Por que você quer participar do acampamento?': '', 'Como você conheceu o acampamento?': '' }),
        linha({ Nome: 'Caio Terceiro', CPF: cpfDe('200000003'), 'Data da Pré-Ficha': '31/12/2025', Sexo: 'Masculino', 'Onde Fui Campista': '16º Sênior - São Padre Pio (Azul)' }),
        linha({ Nome: 'Dani Quarta', CPF: cpfDe('200000004'), 'Data da Pré-Ficha': '20/06/2025' }),                                    // mesmo dia da Bruna: vale a ordem da planilha
        linha({ Nome: 'Eva Errada', CPF: cpfDe('200000005'), 'Data de Nascimento': '15/03/2062' }),                                   // quarentena
        linha({ Nome: 'Fabio Repetido', CPF: cpfDe('200000001') }),                                                                  // CPF repetido na planilha
      ]
      const { registros } = lerCsv(csv(linhas))
      const antes = (await pool.query('select count(*)::int n from pre_fichas')).rows[0].n
      const plano = await planejar(pool, registros, { hoje: HOJE })
      assert.deepEqual([plano.resumo.importar, plano.resumo.quarentena, plano.resumo.semEmail, plano.resumo.semCep, plano.resumo.semMotivo, plano.resumo.participacoes, plano.resumo.edicoesNovas],
        [4, 2, 1, 1, 1, 2, 1])
      assert.equal((await pool.query('select count(*)::int n from pre_fichas')).rows[0].n, antes, 'a simulação não grava nada')
      assert.deepEqual(Object.keys(relatorios(plano)), ['resumo.txt', 'quarentena.csv', 'ignoradas.csv', 'revisar.csv'])
      assert.match(relatorios(plano)['quarentena.csv'], /Data de nascimento no futuro/)

      const r = await aplicar(pool, plano, { lote: 'teste-importacao-1', arquivo: 'fake.csv' })
      assert.deepEqual([r.gravadas, r.participacoesGravadas, r.edicoesCriadas], [4, 2, 1])
      const { rows } = await pool.query(
        `select id, nome_completo, to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as inscricao, entrada_fila_em = created_at as fila_igual,
                status, importada_lote, termos_aceitos, observacoes_internas from pre_fichas where importada_lote = 'teste-importacao-1' order by entrada_fila_em, id`)
      assert.deepEqual(rows.map((x) => [x.nome_completo, x.inscricao]), [['Ana Primeira', '2024-02-01'], ['Bruna Segunda', '2025-06-20'], ['Dani Quarta', '2025-06-20'], ['Caio Terceiro', '2025-12-31']],
        'a data de inscrição é a da planilha e a fila segue essa ordem (no mesmo dia, a ordem da planilha)')
      assert.ok(rows.every((x) => x.fila_igual && x.status === 'aguardando'), 'a entrada na fila é a data original, sem mudança')
      assert.match(rows[0].observacoes_internas, /Data da pré-ficha original: 01\/02\/2024/); assert.match(rows[0].termos_aceitos[0], /importada do sistema anterior/i)
      // a trilha de auditoria registra a inscrição na data ORIGINAL
      const h = await pool.query(`select to_char(criado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') d from pre_fichas_historico where pre_ficha_id = $1 and tipo = 'inscricao'`, [rows[0].id])
      assert.equal(h.rows[0].d, '2024-02-01')
      // a posição na fila (visão do painel) acompanha a data
      const fila = await pool.query(`select f.nome_completo, f.posicao from fila_espera f join pre_fichas p on p.id = f.id where p.importada_lote = 'teste-importacao-1' order by f.posicao`)
      assert.deepEqual(fila.rows.map((x) => x.nome_completo), ['Ana Primeira', 'Bruna Segunda', 'Dani Quarta', 'Caio Terceiro'])
      // o histórico vira participação: a edição foi criada e as duas pessoas estão nela, com a tribo do sistema
      const part = await pool.query(`select a.numero, a.modalidade, p.tribo, f.cpf from participacoes p join acampamentos a on a.id = p.acampamento_id join pre_fichas f on f.id = p.pre_ficha_id where f.importada_lote = 'teste-importacao-1' order by f.cpf`)
      assert.equal(part.rowCount, 2); assert.ok(part.rows.every((x) => x.numero === 16 && x.modalidade === 'senior'))
    })

    test('o banco só aceita a data original (e os campos vazios) em importação autorizada; quem se inscreve agora continua com tudo obrigatório', async () => {
      const base = `insert into pre_fichas (created_at, nome_completo, data_nascimento, estado_civil, sexo, telefone, religiao, batizado, primeira_eucaristia, crismado,
        participa_pastoral, email, cep, cidade, uf, como_conheceu, motivo, modalidade, possui_vicio, termos_aceitos, importada_lote)
        values ($1, 'Teste Gatilho', '1990-01-01', 'solteiro', 'feminino', '(48) 99999-0000', 'Católica', true, true, true, false, $2, $3, 'Palhoça', 'SC', 'x', 'y', 'senior', false, '[]', $4) returning id, created_at`
      const antigo = '2019-05-05 12:00:00-03'
      // sem a autorização da importação, a data é sempre "agora" — mesmo informando outra e mesmo com lote
      const a = await pool.query(base, [antigo, 'a@x.com', '88015200', 'lote-qualquer']); assert.ok(new Date(a.rows[0].created_at) > new Date('2026-01-01'))
      // campos vazios só valem para fichas importadas (com lote)
      await assert.rejects(pool.query(base, [antigo, null, '88015200', null]), /pre_fichas_obrigatorios_check/)
      await assert.rejects(pool.query(base, [antigo, 'a@x.com', null, null]), /pre_fichas_obrigatorios_check/)
      // com a autorização, mas SEM lote, também é "agora"
      const c = await pool.connect()
      try {
        await c.query('begin'); await c.query(`select set_config('app.importacao', 'sim', true)`)
        const semLote = await c.query(base, [antigo, 'a@x.com', '88015200', null]); assert.ok(new Date(semLote.rows[0].created_at) > new Date('2026-01-01'))
        const comLote = await c.query(base, [antigo, null, null, 'lote-autorizado']); assert.equal(new Date(comLote.rows[0].created_at).toISOString(), '2019-05-05T15:00:00.000Z')
        await c.query('rollback')
      } finally { c.release() }
      // a data da ficha continua protegida contra alteração
      const { rows: [x] } = await pool.query(`select id from pre_fichas where importada_lote = 'teste-importacao-1' limit 1`)
      await assert.rejects(pool.query(`update pre_fichas set created_at = now() where id = $1`, [x.id]), /não pode ser alterada/)
      await pool.query(`delete from pre_fichas where nome_completo = 'Teste Gatilho'`)
    })

    test('importar o mesmo arquivo de novo não duplica ninguém e um lote não se repete', async () => {
      const { registros } = lerCsv(csv([linha({ Nome: 'Bruna Segunda', CPF: cpfDe('200000001') }), linha({ Nome: 'Gabi Nova', CPF: cpfDe('200000007'), 'Data da Pré-Ficha': '02/01/2026' })]))
      const plano = await planejar(pool, registros, { hoje: HOJE })
      assert.deepEqual([plano.resumo.importar, plano.resumo.ignoradas], [1, 1]); assert.match(plano.ignoradas[0].motivo, /Já existe ficha ativa/)
      await assert.rejects(aplicar(pool, plano, { lote: 'teste-importacao-1' }), /já existe/)
      await assert.rejects(aplicar(pool, plano, { lote: 'x y' }), /Nome de lote inválido/)
      await aplicar(pool, plano, { lote: 'teste-importacao-2' })
      assert.equal((await pool.query(`select count(*)::int n from pre_fichas where cpf = $1`, [cpfDe('200000001')])).rows[0].n, 1)
    })

    test('o painel abre fichas importadas sem e-mail nem CEP (detalhe, lista e exportação)', async () => {
      const { rows: [sem] } = await pool.query(`select id from pre_fichas where nome_completo = 'Ana Primeira'`)
      const det = await req('admin', 'GET', `/api/admin/pre-fichas/${sem.id}`)
      assert.equal(det.statusCode, 200, det.body); assert.deepEqual([det.json().email, det.json().cep, det.json().motivo], [null, null, null])
      assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas')).statusCode, 200)
      assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas?completo=1')).statusCode, 200)
      assert.equal((await req('admin', 'GET', '/api/admin/pre-fichas/exportar')).statusCode < 500, true)
    })

    test('desfazer: apaga o lote e as edições criadas por ele; se a equipe já mexeu, exige --forcar', async () => {
      const { rows: [f] } = await pool.query(`select id from pre_fichas where nome_completo = 'Gabi Nova'`)
      await pool.query(`update pre_fichas set status = 'em_contato', atualizado_em = now() where id = $1`, [f.id])
      await assert.rejects(desfazer(pool, 'teste-importacao-2'), /já foram alteradas/)
      assert.deepEqual(await desfazer(pool, 'teste-importacao-2', { forcar: true }), { fichas: 1, edicoes: 0 })
      assert.equal((await pool.query(`select count(*)::int n from pre_fichas where nome_completo = 'Gabi Nova'`)).rows[0].n, 0)
      const r = await desfazer(pool, 'teste-importacao-1')
      assert.deepEqual(r, { fichas: 4, edicoes: 1 })
      assert.equal((await pool.query(`select count(*)::int n from acampamentos where numero = 16 and modalidade = 'senior'`)).rows[0].n, 0, 'a edição criada pela importação some')
      await assert.rejects(desfazer(pool, 'nao-existe'), /não encontrado/)
    })
  })


  // ------------------------------------------------------------------ importação pela tela (Configurações)
  describe('importação pela tela', () => {
    const CAB = ['Nome', 'CPF', 'Idade', 'Data de Nascimento', 'Sexo', 'Estado Civil', 'Data da Pré-Ficha', 'Aguardando Acampamento', 'Onde Fui Campista', 'Telefone', 'Religião',
      'Batizado', 'Primeira Comunhão', 'Crismado', 'Cidade', 'Estado']
    const cpfDe = (base) => {
      const d = base.split('').map(Number)
      const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += d[i] * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r }
      d.push(dv(9)); d.push(dv(10)); return d.join('')
    }
    const csvDe = (linhas) => Buffer.from([CAB, ...linhas].map((l) => l.map((x) => `"${x}"`).join(';')).join('\n'), 'utf8')
    const pessoa = (nome, cpf, data = '10/03/2025', camp = '', aguardando = 'Sênior') => [nome, cpf, '40', '10/05/1985', 'Feminino', 'Casado', data, aguardando, camp, '(48) 99999-1111', 'Católica', 'Sim', 'Sim', 'Sim', 'Palhoça', 'SC']
    const enviarArq = (quem, buf, url = '/api/admin/importacao/simular') => app.inject({ method: 'POST', url, headers: { ...como(quem), 'content-type': 'application/octet-stream', 'x-nome-arquivo': 'lista teste.csv' }, payload: buf })
    const arq = csvDe([pessoa('Tela Um', cpfDe('400000001'), '01/02/2025'), pessoa('Tela Dois', cpfDe('400000002'), '15/06/2024', '5º Mirim - X (Azul)'),
      pessoa('Tela Tres', cpfDe('400000003'), '', '7º Fac - X (Roxa)', ''), pessoa('Tela Nada', cpfDe('400000004'), '', '', '')])
    let token

    test('só o administrador importa; sem login, 401; arquivo que não é planilha é recusado com a explicação', async () => {
      assert.equal((await app.inject({ method: 'POST', url: '/api/admin/importacao/simular', headers: { ...H, 'content-type': 'application/octet-stream' }, payload: arq })).statusCode, 401)
      for (const quem of ['equipe', 'coord']) {
        assert.equal((await enviarArq(quem, arq)).statusCode, 403, quem)
        assert.equal((await req(quem, 'GET', '/api/admin/importacao/lotes')).statusCode, 403)
        assert.equal((await req(quem, 'DELETE', '/api/admin/importacao/lotes/qualquer')).statusCode, 403)
      }
      const vazio = await enviarArq('admin', Buffer.from('x')); assert.equal(vazio.statusCode, 400)
      const faltando = await enviarArq('admin', Buffer.from('"Nome";"CPF"\n"A B";"1"', 'utf8'))
      assert.equal(faltando.statusCode, 400); assert.ok(faltando.json().faltam.includes('data de nascimento'))
      const semTipo = await enviarArq('admin', Buffer.from('"Nome";"CPF";"Data de Nascimento";"Sexo";"Estado Civil";"Telefone";"Cidade";"Estado"\n"A B";"1";"1/1/1990";"F";"S";"1";"x";"SC"', 'utf8'))
      assert.equal(semTipo.statusCode, 400); assert.match(semTipo.json().mensagem, /onde fui campista/)
      assert.equal((await enviarArq('admin', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 1)]))).statusCode, 400, 'xlsx estragado')
    })

    test('simular mostra o relatório e NÃO grava nada; o relatório de quarentena pode ser baixado', async () => {
      const antes = (await pool.query('select count(*)::int n from pre_fichas')).rows[0].n
      const r = await enviarArq('admin', arq)
      assert.equal(r.statusCode, 200, r.body)
      const j = r.json(); token = j.token
      assert.deepEqual([j.resumo.linhas, j.resumo.importar, j.resumo.naFila, j.resumo.campistasSemFila, j.resumo.quarentena, j.resumo.semClassificacao, j.arquivo], [4, 3, 2, 1, 1, 1, 'lista teste.csv'])
      assert.equal(j.quarentena.length, 1); assert.match(j.quarentena[0].motivo, /não dá para saber/)
      assert.equal((await pool.query('select count(*)::int n from pre_fichas')).rows[0].n, antes, 'simulação não grava')
      const baixar = (quem, t, nome = 'quarentena.csv') => app.inject({ method: 'GET', url: `/api/admin/importacao/relatorio/${nome}?token=${t}`, headers: como(quem) })
      const q = await baixar('admin', token)
      assert.equal(q.statusCode, 200); assert.match(q.headers['content-disposition'], /attachment/); assert.match(q.headers['content-type'], /text\/csv/); assert.match(q.body, /Tela Nada/)
      assert.equal((await baixar('admin', 'token-errado')).statusCode, 404); assert.equal((await baixar('admin', token, '../../etc/passwd')).statusCode, 404)
      assert.equal((await baixar('equipe', token)).statusCode, 403)
    })

    test('aplicar grava tudo uma vez só, registra quem fez e o lote pode ser listado e desfeito', async () => {
      assert.equal((await req('admin', 'POST', '/api/admin/importacao/aplicar', { token: 'invalido' })).statusCode, 404)
      assert.equal((await req('equipe', 'POST', '/api/admin/importacao/aplicar', { token })).statusCode, 403)
      const r = await req('admin', 'POST', '/api/admin/importacao/aplicar', { token })
      assert.equal(r.statusCode, 200, r.body)
      const { lote, resumo } = r.json()
      assert.deepEqual([resumo.gravadas, resumo.participacoesGravadas], [3, 2])
      assert.equal((await req('admin', 'POST', '/api/admin/importacao/aplicar', { token })).statusCode, 404, 'o mesmo arquivo não é aplicado duas vezes')
      const lotes = (await req('admin', 'GET', '/api/admin/importacao/lotes')).json()
      const meu = lotes.find((x) => x.lote === lote)
      assert.deepEqual([meu.fichas, meu.alteradas, meu.por, meu.arquivo], [3, 0, 'admin@x.com', 'lista teste.csv'])
      const { rows } = await pool.query(`select nome_completo, status, to_char(created_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') d from pre_fichas where importada_lote = $1 order by nome_completo`, [lote])
      assert.deepEqual(rows.map((x) => [x.nome_completo, x.status]), [['Tela Dois', 'aguardando'], ['Tela Tres', 'participou'], ['Tela Um', 'aguardando']])
      assert.deepEqual([rows[0].d, rows[2].d], ['2024-06-15', '2025-02-01'], 'as datas da planilha foram mantidas')
      // desfazer: se a equipe já mexeu, pede confirmação extra
      const { rows: [f] } = await pool.query(`select id from pre_fichas where nome_completo = 'Tela Um'`)
      await pool.query(`update pre_fichas set status = 'em_contato', atualizado_em = now() where id = $1`, [f.id])
      const d1 = await req('admin', 'DELETE', `/api/admin/importacao/lotes/${lote}`)
      assert.equal(d1.statusCode, 409); assert.equal(d1.json().precisaForcar, true)
      const d2 = await req('admin', 'DELETE', `/api/admin/importacao/lotes/${lote}?forcar=1`)
      assert.equal(d2.statusCode, 200); assert.equal(d2.json().fichas, 3)
      assert.equal((await req('admin', 'DELETE', `/api/admin/importacao/lotes/${lote}`)).statusCode, 404)
    })

    test('o mesmo arquivo em Excel (.xlsx) pela tela dá o mesmo resultado', async () => {
      const xl = Buffer.from(arq) // mesmo conteúdo, só que montado como planilha Excel abaixo
      void xl
      const linhasXl = [CAB, pessoa('Excel Um', cpfDe('400000011'), '03/03/2025'), pessoa('Excel Dois', cpfDe('400000012'), '', '9º Sênior - X (Verde)', '')]
      // a matriz vira .xlsx com o mesmo montador usado no teste do leitor
      const montar = (m) => {
        const comuns = []; const idx = (t) => { let i = comuns.indexOf(t); if (i < 0) { i = comuns.length; comuns.push(t) } return i }
        const col = (n) => String.fromCharCode(65 + n)
        const xml = m.map((l, r) => `<row r="${r + 1}">${l.map((x, c) => x === '' ? '' : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(x)}</v></c>`).join('')}</row>`).join('')
        const arquivos = { 'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="L" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
          'xl/sharedStrings.xml': `<sst>${comuns.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${xml}</sheetData></worksheet>` }
        const locais = [], centrais = []; let off = 0
        for (const [nome, conteudo] of Object.entries(arquivos)) {
          const dados = Buffer.from(conteudo), comp = deflateRawSync(dados), n = Buffer.from(nome), crc = crc32(dados)
          const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dados.length, 22); l.writeUInt16LE(n.length, 26)
          const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42)
          locais.push(l, n, comp); centrais.push(c, n); off += 30 + n.length + comp.length
        }
        const cd = Buffer.concat(centrais), fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(3 + 1, 8); fim.writeUInt16LE(3 + 1, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16)
        return Buffer.concat([...locais, cd, fim])
      }
      const r = await enviarArq('admin', montar(linhasXl))
      assert.equal(r.statusCode, 200, r.body)
      assert.deepEqual([r.json().resumo.importar, r.json().resumo.naFila, r.json().resumo.campistasSemFila], [2, 1, 1])
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
