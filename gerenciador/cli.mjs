// Usuários do painel central.
//   node cli.mjs criar-usuario EMAIL     -> gera senha forte e segredo do autenticador (mostrados UMA vez)
//   node cli.mjs nova-senha EMAIL        -> gera nova senha
//   node cli.mjs novo-autenticador EMAIL -> gera novo segredo do autenticador (celular perdido)
//   node cli.mjs desativar EMAIL | listar
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { gerarHash, novoSegredoTotp } from './servidor.mjs'

const ARQ = join(process.env.DADOS || '/dados', 'usuarios.json')
const ler = () => (existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, 'utf8')) : [])
const gravar = (u) => { writeFileSync(`${ARQ}.tmp`, JSON.stringify(u, null, 2), { mode: 0o600 }); renameSync(`${ARQ}.tmp`, ARQ) }
const senhaForte = () => randomBytes(15).toString('base64url')
const uri = (email, segredo) => `otpauth://totp/${encodeURIComponent(`Painel central:${email}`)}?secret=${segredo}&issuer=${encodeURIComponent('Pré-fichas (servidor)')}`

const [cmd, emailBruto] = process.argv.slice(2)
const email = String(emailBruto ?? '').trim().toLowerCase()
const usuarios = ler()
const u = usuarios.find((x) => x.email === email)

if (cmd === 'listar') {
  console.table(usuarios.map(({ email: e, ativo, ultimo_login: ul }) => ({ email: e, ativo: ativo !== false, ultimo_login: ul ?? '—' })))
  process.exit(0)
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Informe um e-mail válido.'); process.exit(1) }

if (cmd === 'criar-usuario') {
  if (u) { console.error('Usuário já existe.'); process.exit(1) }
  const senha = senhaForte(); const totp = novoSegredoTotp()
  usuarios.push({ email, senha: await gerarHash(senha), totp, ativo: true, criado_em: new Date().toISOString() })
  gravar(usuarios)
  console.log(`\nUsuário criado: ${email}\nSenha: ${senha}\n`)
  console.log('Cadastre no aplicativo autenticador (Google/Microsoft Authenticator):')
  console.log(`  chave: ${totp}\n  ou o link: ${uri(email, totp)}\n`)
  console.log('Guarde a senha num cofre de senhas. Ela não será mostrada de novo.')
} else if (cmd === 'nova-senha' && u) {
  const senha = senhaForte(); u.senha = await gerarHash(senha); gravar(usuarios)
  console.log(`Nova senha de ${email}: ${senha}`)
} else if (cmd === 'novo-autenticador' && u) {
  u.totp = novoSegredoTotp(); u.totp_ultimo = 0; gravar(usuarios)
  console.log(`Nova chave do autenticador de ${email}: ${u.totp}\n  link: ${uri(email, u.totp)}`)
} else if (cmd === 'desativar' && u) {
  u.ativo = false; gravar(usuarios); console.log(`${email} desativado.`)
} else {
  console.error('Comando ou usuário inválido. Veja o início de cli.mjs.'); process.exit(1)
}
