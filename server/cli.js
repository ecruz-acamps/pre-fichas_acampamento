#!/usr/bin/env node
// Gerenciamento de usuários pelo terminal do servidor.
//   node server/cli.js criar-admin  <email> "<nome>"
//   node server/cli.js criar-equipe <email> "<nome>"
//   node server/cli.js redefinir-senha <email>
//   node server/cli.js desativar <email>   |   ativar <email>
//   node server/cli.js listar
import { lerConfig } from './config.js'
import { criarPool, migrar } from './db.js'
import { gerarHash, gerarSenhaTemporaria } from './senha.js'

const [comando, emailBruto, ...resto] = process.argv.slice(2)
const email = emailBruto?.trim().toLowerCase()
const nome = resto.join(' ').trim()

const AJUDA = `Uso:
  node server/cli.js criar-admin  <email> "<nome>"   cria um administrador
  node server/cli.js criar-equipe <email> "<nome>"   cria um usuário da equipe
  node server/cli.js redefinir-senha <email>         gera nova senha temporária
  node server/cli.js desativar <email>               bloqueia o acesso
  node server/cli.js ativar <email>                  libera o acesso
  node server/cli.js listar                          lista os usuários`

const pool = criarPool(lerConfig().databaseUrl)
const silencioso = { info: () => {} }

try {
  await migrar(pool, silencioso)
  switch (comando) {
    case 'criar-admin':
    case 'criar-equipe': {
      if (!email || !nome) throw new Error(AJUDA)
      const senha = gerarSenhaTemporaria()
      await pool.query(
        'insert into usuarios (email, nome, papel, senha_hash, trocar_senha) values ($1, $2, $3, $4, true)',
        [email, nome, comando === 'criar-admin' ? 'admin' : 'equipe', await gerarHash(senha)])
      console.log(`Usuário criado: ${email}\nSenha temporária: ${senha}\n(será pedida uma nova senha no primeiro acesso)`)
      break
    }
    case 'redefinir-senha': {
      const senha = gerarSenhaTemporaria()
      const r = await pool.query('update usuarios set senha_hash = $1, trocar_senha = true where email = $2 returning id',
        [await gerarHash(senha), email])
      if (!r.rowCount) throw new Error(`Usuário não encontrado: ${email}`)
      await pool.query('delete from sessoes where usuario_id = $1', [r.rows[0].id])
      console.log(`Nova senha temporária de ${email}: ${senha}`)
      break
    }
    case 'desativar':
    case 'ativar': {
      const r = await pool.query('update usuarios set ativo = $1 where email = $2 returning id', [comando === 'ativar', email])
      if (!r.rowCount) throw new Error(`Usuário não encontrado: ${email}`)
      if (comando === 'desativar') await pool.query('delete from sessoes where usuario_id = $1', [r.rows[0].id])
      console.log(`Usuário ${email} ${comando === 'ativar' ? 'ativado' : 'desativado'}.`)
      break
    }
    case 'listar': {
      const { rows } = await pool.query('select email, nome, papel, ativo, ultimo_login from usuarios order by nome')
      console.table(rows)
      break
    }
    default:
      console.log(AJUDA)
  }
} catch (e) {
  console.error(e.code === '23505' ? 'Já existe um usuário com este e-mail.' : e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
