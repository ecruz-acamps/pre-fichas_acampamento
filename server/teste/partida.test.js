// Partida de verdade: um servidor novo contra um banco VAZIO (instalação nova) precisa responder.
//   Regressão da 2.20: carregar as modalidades antes das migrações derrubava o app ao iniciar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'

const URL_TESTE = process.env.DATABASE_URL_TESTE
const RAIZ = new URL('../..', import.meta.url).pathname

test('servidor novo sobe e responde com banco vazio (migrações antes de usar as tabelas)', { skip: !URL_TESTE && 'defina DATABASE_URL_TESTE' }, async () => {
  const nome = `prefichas_partida_${randomBytes(4).toString('hex')}`
  const admin = new pg.Client({ connectionString: URL_TESTE }); await admin.connect()
  await admin.query(`create database ${nome}`)
  const u = new URL(URL_TESTE); u.pathname = `/${nome}`
  const porta = 39000 + Math.floor(Math.random() * 900)
  let saida = ''
  const filho = spawn('node', ['server/index.js'], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: u.toString(), PORTA: String(porta), HOST: '127.0.0.1', NODE_ENV: 'production', LOG_NIVEL: 'warn' } })
  filho.stdout.on('data', (d) => { saida += d }); filho.stderr.on('data', (d) => { saida += d })
  try {
    let ok = false
    for (let i = 0; i < 100 && !ok && filho.exitCode === null; i++) {
      ok = await fetch(`http://127.0.0.1:${porta}/api/saude`).then((r) => r.ok).catch(() => false)
      if (!ok) await new Promise((r) => setTimeout(r, 200))
    }
    assert.equal(ok, true, `o servidor não respondeu: ${saida.slice(0, 500)}`)
    const mods = await (await fetch(`http://127.0.0.1:${porta}/api/modalidades`)).json()
    assert.deepEqual(mods.map((m) => m.valor), ['mirim', 'fac', 'juvenil', 'senior', 'casais'], 'as modalidades padrão estão carregadas logo na partida')
  } finally {
    filho.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300))
    await admin.query(`drop database if exists ${nome} with (force)`); await admin.end()
  }
})
