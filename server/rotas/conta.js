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
import { fezSenior, validarCasais } from '../casais.js'
import { cabecalhosFoto, FOTO_MAX_BYTES, lerFoto, limparJpeg, removerFoto, salvarFoto } from '../foto.js'
import { transacao } from '../db.js'
import {
  COOKIE_CONTA, STATUS_ATIVOS, buscarPorLogin, buscarSessaoConta, criarRedefinicao, criarSessaoConta,
  encerrarSessaoConta, encerrarSessoesConta, importarParticipantes, usarRedefinicao,
} from '../participantes.js'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const STATUS_NA_FILA_CONTA = ['aguardando', 'em_contato']
// Campos da ficha que a pessoa pode alterar depois (a data da inscrição e a fila nunca mudam)
// 'modalidade' e 'conjuge_cpf' não mudam pela área do participante: trocar a modalidade pularia a conferência do
// casal (Casais) e mudaria a fila; quem precisar alterar fala com o acampamento.
const EDITAVEIS = Object.keys(montarRegistro(normalizarEntrada({ data_nascimento: '2000-01-01' })))
  .filter((c) => !['termos_aceitos', 'modalidade', 'conjuge_cpf'].includes(c))
const DADOS_GUARDADOS = (f) => { const { aceites, website, ...resto } = f; return resto } // eslint-disable-line no-unused-vars

export default async function rotasConta(app) {
  const { pool, config } = app
  const falhasCasais = new Map() // participante -> { n, desde }
  const protecao = criarProtecaoLogin(config.protecaoLogin)
  const email = app.email
  const limite = { rateLimit: { max: config.limiteLoginPorMinuto, timeWindow: '1 minute' } }
  const ocupado = (reply) => reply.code(503).send({ mensagem: 'Servidor ocupado. Tente novamente em alguns segundos.' })
  const hashLimitado = (senha) => protecao.limitar(() => gerarHash(senha))
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

  // Modalidades que a pessoa já fez (pela conta ou pelo CPF em fichas antigas)
  const modalidadesFeitas = async (id, cpf) => (await pool.query(
    `select distinct modalidade from pre_fichas where status = 'participou' and (participante_id = $1 or cpf = $2)`,
    [id, cpf])).rows.map((r) => r.modalidade)

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
        const { rows: [f] } = await pool.query(
          `select count(*) + 1 as posicao from pre_fichas q, pre_fichas f
            where f.id = $1 and f.status in ('aguardando', 'em_contato')
              and q.modalidade = f.modalidade and q.status in ('aguardando', 'em_contato')
              and (q.entrada_fila_em, q.id) < (f.entrada_fila_em, f.id)`, [ultima.id])
        ficha.posicao = STATUS_NA_FILA_CONTA.includes(ultima.status) && f ? Number(f.posicao) : null
      }
    }
    const { rows: [pf] } = await pool.query('select atualizado_em from participantes_fotos where participante_id = $1', [id])
    return { conta: { cpf: p.cpf, email: p.email, nome: p.nome, temFoto: !!pf, fotoVersao: pf ? new Date(pf.atualizado_em).getTime() : null }, dados: p.dados, ficha, modalidadesFeitas: await modalidadesFeitas(id, p.cpf), fezSenior: await fezSenior(pool, id, p.cpf), mostrarPosicao: marca.mostrarPosicaoFila, recuperacao, contaObrigatoria: config.contaObrigatoria }
  })

  // ------------------------------------------------------------ foto da conta (opcional)
  // Corpo = o próprio JPEG. Só JPEG: o navegador converte e reduz antes de enviar; aqui o arquivo é conferido de novo e
  // os metadados (EXIF/GPS) são removidos.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: FOTO_MAX_BYTES }, (req, corpo, feito) => feito(null, corpo))
  app.put('/api/conta/foto', { onRequest: [logado], config: limite, bodyLimit: FOTO_MAX_BYTES }, async (req, reply) => {
    const limpo = limparJpeg(req.body)
    if (!limpo) return reply.code(400).send({ mensagem: 'Envie uma foto em JPG de até 300 KB (mínimo 32 px, máximo 2000 px).' })
    await salvarFoto(pool, req.participante.id, limpo)
    return { ok: true }
  })
  app.get('/api/conta/foto', { onRequest: [logado] }, async (req, reply) => {
    const f = await lerFoto(pool, req.participante.id)
    if (!f) return reply.code(404).send({ mensagem: 'Sem foto.' })
    return cabecalhosFoto(reply, f.atualizado_em).send(f.dados)
  })
  app.delete('/api/conta/foto', { onRequest: [logado], config: limite }, async (req) => {
    await removerFoto(pool, req.participante.id)
    return { ok: true }
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
      'insert into participantes (cpf, email, senha_hash) values ($1, $2, $3) returning id', [cpf, mail, await hashLimitado(senha)])
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
    await pool.query('update participantes set senha_hash = $1 where id = $2', [await hashLimitado(senha), id])
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
    await pool.query('update participantes set senha_hash = $1 where id = $2', [await hashLimitado(nova), req.participante.id])
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
    if (!erros.modalidade && (await modalidadesFeitas(id, req.participante.cpf)).includes(f.modalidade)) {
      erros.modalidade = 'Você já fez esta modalidade. Escolha outra para a qual tenha os requisitos.'
    }
    let casal = false
    if (!Object.keys(erros).length && f.modalidade === 'casais') {
      // limite de tentativas erradas de CPF de cônjuge por conta (evita descobrir quem é campista)
      const lim = falhasCasais.get(id)
      if (lim && lim.n >= 5 && Date.now() - lim.desde < 3_600_000) {
        return reply.code(429).send({ mensagem: 'Muitas tentativas de confirmar o cônjuge. Tente de novo mais tarde ou fale com a coordenação do acampamento.' })
      }
      const v = await validarCasais(pool, { marca, participanteId: id, cpf: req.participante.cpf, conjugeCpf: somenteDigitos(f.conjuge_cpf) })
      if (v.falhaConjuge) {
        const atual = lim && Date.now() - lim.desde < 3_600_000 ? lim : { n: 0, desde: Date.now() }
        falhasCasais.set(id, { n: atual.n + 1, desde: atual.desde })
        req.log.warn({ participante: id }, 'Casais: cônjuge não confirmado')
      }
      Object.assign(erros, v.erros)
      casal = true
    }
    if (Object.keys(erros).length) return reply.code(400).send({ mensagem: 'Dados inválidos.', erros })
    const registro = montarRegistro(f, marca.termos)
    const r = await registrarPreFicha(pool, config, registro, { ip: req.ip, log: req.log, participanteId: id, cpf: req.participante.cpf })
    if (r.id) {
      await pool.query('update participantes set dados = $1, nome = $2, data_nascimento = $3 where id = $4',
        [JSON.stringify(DADOS_GUARDADOS(f)), registro.nome_completo, registro.data_nascimento, id])
      if (casal) {
        falhasCasais.delete(id)
        await pool.query(
          `insert into pre_fichas_historico (pre_ficha_id, tipo, observacao) values ($1, 'observacao', $2)`,
          [r.id, `Inscrição de casal: cônjuge (CPF terminado em ${registro.conjuge_cpf.slice(-2)}) confirmado como campista no sistema${marca.casaisExigeSenior !== false ? ', com o Sênior feito pelos dois' : ''}.`])
      }
    }
    return reply.code(r.codigo).send(r.corpo)
  })

  // Editar os próprios dados (e a pré-ficha da fila, se houver). A posição na fila não muda.
  app.put('/api/conta/dados', { onRequest: [logado], config: limite }, async (req, reply) => {
    const id = req.participante.id
    const f = normalizarEntrada(req.body)
    const atual = await fichaAtiva(id)
    if (atual) { f.modalidade = atual.modalidade; f.conjuge_cpf = atual.conjuge_cpf ?? '' } // não mudam por aqui
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
    await transacao(pool, async (db) => {
      await db.query(`update pre_fichas set status = 'desistiu', atualizado_em = now() where id = $1`, [ficha.id])
      await db.query(
        `insert into pre_fichas_historico (pre_ficha_id, tipo, status_anterior, status_novo, observacao) values ($1, 'status', $2, 'desistiu', $3)`,
        [ficha.id, ficha.status, 'Desistência registrada pela própria pessoa (área do participante).'])
    })
    return { ok: true }
  })

  // ------------------------------------------------------------ painel: contas antigas
  const soAdmin = () => ({ onRequest: [app.exigirLogin, app.exigirAdmin] })
  app.get('/api/admin/participantes/resumo', soAdmin(), async () => {
    const { rows: [r] } = await pool.query(
      `select count(*)::int total, count(*) filter (where senha_hash is null)::int sem_senha,
              count(*) filter (where importado)::int importados from participantes`)
    return { ...r, recuperacao: Boolean(email && config.urlPublica) }
  })
  app.post('/api/admin/participantes/importar', { ...soAdmin(), bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const csv = req.body?.csv
    if (typeof csv !== 'string' || !csv.trim()) return reply.code(400).send({ mensagem: 'Envie o conteúdo da planilha (CSV).' })
    const r = await importarParticipantes(pool, csv)
    req.log.info({ por: req.usuario.email, importados: r.importados }, 'Contas antigas importadas')
    return r
  })
}
