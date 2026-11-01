import { gerarHash, gerarSenhaTemporaria } from '../senha.js'

const PAPEIS = ['admin', 'equipe']
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CAMPOS = 'id, email, nome, papel, ativo, trocar_senha, criado_em, ultimo_login'

export default async function rotasUsuarios(app) {
  const { pool } = app
  const soAdmin = { onRequest: [app.exigirLogin, app.exigirAdmin] }

  async function contarOutrosAdminsAtivos(id) {
    const { rows: [r] } = await pool.query(
      `select count(*)::int as n from usuarios where papel = 'admin' and ativo and id <> $1`, [id])
    return r.n
  }

  app.get('/api/admin/usuarios', soAdmin, async () => {
    const { rows } = await pool.query(`select ${CAMPOS} from usuarios order by nome`)
    return rows
  })

  // Cria usuário com senha temporária (mostrada uma única vez ao admin)
  app.post('/api/admin/usuarios', soAdmin, async (req, reply) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const nome = String(req.body?.nome ?? '').trim()
    const papel = req.body?.papel ?? 'equipe'
    if (!EMAIL.test(email) || email.length > 200) return reply.code(400).send({ mensagem: 'E-mail inválido.' })
    if (!nome || nome.length > 120) return reply.code(400).send({ mensagem: 'Informe o nome.' })
    if (!PAPEIS.includes(papel)) return reply.code(400).send({ mensagem: 'Papel inválido.' })

    const senhaTemporaria = gerarSenhaTemporaria()
    try {
      const { rows: [u] } = await pool.query(
        `insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values ($1, $2, $3, $4, true)
         returning ${CAMPOS}`,
        [email, nome, papel, await gerarHash(senhaTemporaria)])
      req.log.info({ por: req.usuario.email, novo: email }, 'Usuário criado')
      return reply.code(201).send({ usuario: u, senhaTemporaria })
    } catch (e) {
      if (e.code === '23505') return reply.code(409).send({ mensagem: 'Já existe um usuário com este e-mail.' })
      throw e
    }
  })

  app.patch('/api/admin/usuarios/:id', soAdmin, async (req, reply) => {
    const id = Number(req.params.id)
    const { nome, papel, ativo } = req.body ?? {}
    if (papel !== undefined && !PAPEIS.includes(papel)) return reply.code(400).send({ mensagem: 'Papel inválido.' })
    if (ativo !== undefined && typeof ativo !== 'boolean') return reply.code(400).send({ mensagem: 'Valor inválido.' })
    if (nome !== undefined && (typeof nome !== 'string' || !nome.trim() || nome.length > 120))
      return reply.code(400).send({ mensagem: 'Nome inválido.' })

    const perdeAdmin = ativo === false || (papel !== undefined && papel !== 'admin')
    if (perdeAdmin && id === req.usuario.id) {
      return reply.code(400).send({ mensagem: 'Você não pode remover o seu próprio acesso de administrador.' })
    }
    if (perdeAdmin && (await contarOutrosAdminsAtivos(id)) === 0) {
      return reply.code(400).send({ mensagem: 'É preciso manter pelo menos um administrador ativo.' })
    }

    const { rows: [u] } = await pool.query(
      `update usuarios set nome = coalesce($1, nome), papel = coalesce($2, papel), ativo = coalesce($3, ativo)
        where id = $4 returning ${CAMPOS}`,
      [nome?.trim() ?? null, papel ?? null, ativo ?? null, id])
    if (!u) return reply.code(404).send({ mensagem: 'Usuário não encontrado.' })
    if (ativo === false) await pool.query('delete from sessoes where usuario_id = $1', [id])
    return { usuario: u }
  })

  app.post('/api/admin/usuarios/:id/redefinir-senha', soAdmin, async (req, reply) => {
    const id = Number(req.params.id)
    const senhaTemporaria = gerarSenhaTemporaria()
    const { rows: [u] } = await pool.query(
      `update usuarios set senha_hash = $1, trocar_senha = true where id = $2 returning ${CAMPOS}`,
      [await gerarHash(senhaTemporaria), id])
    if (!u) return reply.code(404).send({ mensagem: 'Usuário não encontrado.' })
    await pool.query('delete from sessoes where usuario_id = $1', [id])
    req.log.info({ por: req.usuario.email, alvo: u.email }, 'Senha redefinida')
    return { usuario: u, senhaTemporaria }
  })
}
