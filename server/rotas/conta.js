// Área do participante: criar conta, entrar (CPF ou e-mail), recuperar a senha,
// fazer a inscrição, acompanhar, editar os dados e desistir da vaga.
import { montarRegistro, normalizarEntrada, validar } from '../../shared/validacao.js'
import { STATUS, rotuloDe } from '../../shared/opcoes.js'
import { cpfValido, somenteDigitos } from '../../shared/util.js'
import { gerarHash, senhaForte, verificarSenha, verificarSenhaFicticia } from '../senha.js'
import { criarProtecaoLogin } from '../protecao.js'
import { carregarMarca } from '../marca.js'
import { licencaAtivada } from '../licenca.js'
import { registrarPreFicha } from './publico.js'
import {
  COOKIE_CONTA, STATUS_ATIVOS, buscarPorLogin, buscarSessaoConta, criarRedefinicao, criarSessaoConta,
  encerrarSessaoConta, encerrarSessoesConta, importarParticipantes, usarRedefinicao,
} from '../participantes.js'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Campos da ficha que a pessoa pode alterar depois (a data da inscrição e a fila nunca mudam)
const EDITAVEIS = Object.keys(montarRegistro(normalizarEntrada({ data_nascimento: '2000-01-01' }))).filter((c) => c !== 'termos_aceitos')
const DADOS_GUARDADOS = (f) => { const { aceites, website, ...resto } = f; return resto } // eslint-disable-line no-unused-vars

export default async function rotasConta(app) {
  const { pool, config } = app
  const protecao = criarProtecaoLogin(config.protecaoLogin)
  const email = app.email
  const limite = { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } }
  const ocupado = (reply) => reply.code(503).send({ mensagem: 'Servidor ocupado. Tente novamente em alguns segundos.' })
  const conferir = (senha, h) => protecao.limitar(() => (h ? verificarSenha(senha, h) : verificarSenhaFicticia(senha)))
  const opcoesCookie = () => ({ path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSeguro, maxAge: config.sessaoHoras * 3600 })

  app.decorateRequest('participante', null)
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/conta')) req.participante = await buscarSessaoConta(pool, req.cookies[COOKIE_CONTA], config.sessaoHoras)
  })
  const logado = async (req, reply) => {
    if (!req.participante) return reply.code(401).send({ mensagem: 'Entre na sua conta para continuar.' })
  }
  const entrar = async (reply, id) => {
    await pool.query('update participantes set ultimo_login = now() where id = $1', [id])
    reply.setCookie(COOKIE_CONTA, await criarSessaoConta(pool, id, config.sessaoHoras), opcoesCookie())
  }
  const fichaAtiva = async (id) => (await pool.query(
    `select * from pre_fichas where participante_id = $1 and status = any($2) order by id desc limit 1`, [id, STATUS_ATIVOS])).rows[0]

  // ------------------------------------------------------------ situação da conta
  app.get('/api/conta/eu', async (req) => {
    const recuperacao = Boolean(email && config.urlPublica)
    if (!req.participante) return { conta: null, recuperacao, contaObrigatoria: config.contaObrigatoria }
    const id = req.participante.id
    const marca = await carregarMarca(pool)
    const { rows: [p] } = await pool.query('select cpf, email, nome, dados from participantes where id = $1', [id])
    const { rows: [ultima] } = await pool.query(
      `select id, status, created_at, modalidade from pre_fichas where participante_id = $1 order by id desc limit 1`, [id])
    let ficha = null
    if (ultima) {
      ficha = { ...ultima, rotulo: rotuloDe(STATUS, ultima.status), ativa: STATUS_ATIVOS.includes(ultima.status), posicao: null }
      if (marca.mostrarPosicaoFila) {
        const { rows: [f] } = await pool.query('select posicao from fila_espera where id = $1', [ultima.id])
        ficha.posicao = f ? Number(f.posicao) : null
      }
    }
    return { conta: { cpf: p.cpf, email: p.email, nome: p.nome }, dados: p.dados, ficha, mostrarPosicao: marca.mostrarPosicaoFila, recuperacao, contaObrigatoria: config.contaObrigatoria }
  })

  // ------------------------------------------------------------ criar conta
  app.post('/api/conta/cadastro', { config: limite }, async (req, reply) => {
    if (!(await licencaAtivada(pool))) return reply.code(503).send({ mensagem: 'As inscrições ainda não estão disponíveis.' })
    const cpf = somenteDigitos(req.body?.cpf)
    const mail = String(req.body?.email ?? '').trim().toLowerCase()
    const senha = String(req.body?.senha ?? '')
    const erros = {}
    if (!cpfValido(cpf)) erros.cpf = 'CPF inválido.'
    if (mail.length > 200 || !EMAIL.test(mail)) erros.email = 'E-mail inválido.'
    const fraca = senhaForte(senha)
    if (fraca) erros.senha = fraca
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Confira os campos destacados.', erros })

    const { rows: [existe] } = await pool.query('select cpf, email from participantes where cpf = $1 or email = $2 limit 1', [cpf, mail])
    if (existe) {
      return reply.code(409).send({
        mensagem: 'Já existe uma conta com este CPF ou e-mail. Entre com sua senha ou use "Esqueci minha senha".',
      })
    }
    const { rows: [nova] } = await pool.query(
      'insert into participantes (cpf, email, senha_hash) values ($1, $2, $3) returning id', [cpf, mail, await gerarHash(senha)])
    await entrar(reply, nova.id)
    return reply.code(201).send({ ok: true })
  })

  // ------------------------------------------------------------ entrar / sair
  app.post('/api/conta/login', { config: limite }, async (req, reply) => {
    const login = String(req.body?.login ?? '').trim().toLowerCase().slice(0, 200)
    const senha = String(req.body?.senha ?? '')
    if (!login || !senha || senha.length > 200) return reply.code(400).send({ mensagem: 'Informe CPF ou e-mail e a senha.' })
    const chave = login.includes('@') ? login : somenteDigitos(login)
    const minutos = protecao.bloqueio(chave)
    if (minutos) return reply.code(429).send({ mensagem: `Muitas tentativas erradas. Tente novamente em ${minutos} min.` })

    const p = await buscarPorLogin(pool, login)
    let ok
    try { ok = await conferir(senha, p?.senha_hash) } catch (e) { if (e.code === 'OCUPADO') return ocupado(reply); throw e }
    if (!ok) {
      protecao.falhou(chave)
      return reply.code(401).send({ mensagem: 'CPF/e-mail ou senha incorretos.' })
    }
    protecao.acertou(chave)
    await entrar(reply, p.id)
    return { ok: true }
  })

  app.post('/api/conta/sair', async (req, reply) => {
    await encerrarSessaoConta(pool, req.cookies[COOKIE_CONTA])
    reply.clearCookie(COOKIE_CONTA, { path: '/' })
    return { ok: true }
  })

  // ------------------------------------------------------------ esqueci minha senha
  app.post('/api/conta/esqueci', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    if (!email || !config.urlPublica) {
      return reply.code(503).send({ mensagem: 'A recuperação de senha por e-mail ainda não foi configurada. Fale com o acampamento.' })
    }
    const resposta = { ok: true, mensagem: 'Se houver uma conta com esses dados, enviamos um link para o e-mail cadastrado. Confira também a caixa de spam.' }
    const p = await buscarPorLogin(pool, req.body?.login)
    if (!p) return resposta
    const token = await criarRedefinicao(pool, p.id)
    if (!token) return resposta
    const marca = await carregarMarca(pool)
    const link = `${config.urlPublica}/?redefinir=${token}`
    const novo = !p.senha_hash
    await email.enviar({
      para: p.email,
      nomeRemetente: marca.nome,
      assunto: novo ? `Crie sua senha — ${marca.nome}` : `Redefinir senha — ${marca.nome}`,
      texto: `Olá${p.nome ? `, ${p.nome.split(' ')[0]}` : ''}!\n\n` +
        `Para ${novo ? 'criar' : 'redefinir'} a senha da sua conta em ${marca.nome}, abra o link abaixo (vale por 1 hora):\n\n${link}\n\n` +
        'Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.',
    })
    req.log.info({ participante: p.id }, 'Link de redefinição de senha enviado')
    return resposta
  })

  app.post('/api/conta/redefinir', { config: limite }, async (req, reply) => {
    const senha = String(req.body?.senha ?? '')
    const fraca = senhaForte(senha)
    if (fraca) return reply.code(400).send({ mensagem: fraca })
    const id = await usarRedefinicao(pool, req.body?.token)
    if (!id) return reply.code(400).send({ mensagem: 'Link inválido ou vencido. Peça um novo em "Esqueci minha senha".' })
    await pool.query('update participantes set senha_hash = $1 where id = $2', [await gerarHash(senha), id])
    await encerrarSessoesConta(pool, id)
    await entrar(reply, id)
    return { ok: true }
  })

  app.post('/api/conta/senha', { onRequest: [logado], config: limite }, async (req, reply) => {
    const nova = String(req.body?.novaSenha ?? '')
    const fraca = senhaForte(nova)
    if (fraca) return reply.code(400).send({ mensagem: fraca })
    const { rows: [p] } = await pool.query('select senha_hash from participantes where id = $1', [req.participante.id])
    let ok
    try { ok = await conferir(String(req.body?.senhaAtual ?? ''), p.senha_hash) } catch (e) { if (e.code === 'OCUPADO') return ocupado(reply); throw e }
    if (!ok) return reply.code(400).send({ mensagem: 'A senha atual está incorreta.' })
    await pool.query('update participantes set senha_hash = $1 where id = $2', [await gerarHash(nova), req.participante.id])
    return { ok: true }
  })

  // ------------------------------------------------------------ inscrição
  app.post('/api/conta/pre-ficha', {
    onRequest: [logado],
    config: { rateLimit: { max: config.limiteEnviosPorHora, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    if (!(await licencaAtivada(pool))) return reply.code(503).send({ mensagem: 'As inscrições ainda não estão disponíveis.' })
    const id = req.participante.id
    if (await fichaAtiva(id)) return reply.code(409).send({ mensagem: 'Você já tem uma pré-ficha na fila.' })
    const f = normalizarEntrada(req.body)
    const marca = await carregarMarca(pool)
    const erros = validar(f, marca.termos.length)
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Dados inválidos.', erros })
    const registro = montarRegistro(f, marca.termos)
    const r = await registrarPreFicha(pool, config, registro, { ip: req.ip, log: req.log, participanteId: id, cpf: req.participante.cpf })
    if (r.id) {
      await pool.query('update participantes set dados = $1, nome = $2, data_nascimento = $3 where id = $4',
        [JSON.stringify(DADOS_GUARDADOS(f)), registro.nome_completo, registro.data_nascimento, id])
    }
    return reply.code(r.codigo).send(r.corpo)
  })

  // Editar os próprios dados (e a pré-ficha da fila, se houver). A posição na fila não muda.
  app.put('/api/conta/dados', { onRequest: [logado], config: limite }, async (req, reply) => {
    const id = req.participante.id
    const f = normalizarEntrada(req.body)
    const erros = validar(f, 0)
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Dados inválidos.', erros })
    const registro = montarRegistro(f, [])
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('update participantes set dados = $1, nome = $2, data_nascimento = $3 where id = $4',
        [JSON.stringify(DADOS_GUARDADOS(f)), registro.nome_completo, registro.data_nascimento, id])
      const { rows: [ficha] } = await client.query(
        `select * from pre_fichas where participante_id = $1 and status = any($2) order by id desc limit 1 for update`, [id, STATUS_ATIVOS])
      if (ficha) {
        const iguais = (a, b) => String(a ?? '') === String(b ?? '') ||
          (a instanceof Date && String(b) === a.toISOString().slice(0, 10))
        const mudou = EDITAVEIS.filter((c) => !iguais(ficha[c], registro[c]))
        if (mudou.length) {
          await client.query(
            `update pre_fichas set ${mudou.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = now() where id = $1`,
            [ficha.id, ...mudou.map((c) => registro[c])])
          const antes = Object.fromEntries(mudou.map((c) => [c, ficha[c] instanceof Date ? ficha[c].toISOString().slice(0, 10) : ficha[c]]))
          const depois = Object.fromEntries(mudou.map((c) => [c, registro[c]]))
          await client.query(
            `insert into pre_fichas_historico (pre_ficha_id, tipo, observacao, detalhes) values ($1, 'edicao', $2, $3)`,
            [ficha.id, 'Dados alterados pela própria pessoa (área do participante).', JSON.stringify({ campos: mudou, antes, depois })])
        }
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
    return { ok: true }
  })

  // Desistir da vaga
  app.post('/api/conta/desistir', { onRequest: [logado], config: limite }, async (req, reply) => {
    const ficha = await fichaAtiva(req.participante.id)
    if (!ficha) return reply.code(400).send({ mensagem: 'Você não tem pré-ficha na fila.' })
    await pool.query(`update pre_fichas set status = 'desistiu', atualizado_em = now() where id = $1`, [ficha.id])
    await pool.query(
      `insert into pre_fichas_historico (pre_ficha_id, tipo, status_anterior, status_novo, observacao) values ($1, 'status', $2, 'desistiu', $3)`,
      [ficha.id, ficha.status, 'Desistência registrada pela própria pessoa (área do participante).'])
    return { ok: true }
  })

  // ------------------------------------------------------------ painel: contas antigas
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }
  app.get('/api/admin/participantes/resumo', soAdmin, async () => {
    const { rows: [r] } = await pool.query(
      `select count(*)::int total, count(*) filter (where senha_hash is null)::int sem_senha,
              count(*) filter (where importado)::int importados from participantes`)
    return { ...r, recuperacao: Boolean(email && config.urlPublica) }
  })
  app.post('/api/admin/participantes/importar', { ...soAdmin, bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const csv = req.body?.csv
    if (typeof csv !== 'string' || !csv.trim()) return reply.code(400).send({ mensagem: 'Envie o conteúdo da planilha (CSV).' })
    const r = await importarParticipantes(pool, csv)
    req.log.info({ por: req.usuario.email, importados: r.importados }, 'Contas antigas importadas')
    return r
  })
}
