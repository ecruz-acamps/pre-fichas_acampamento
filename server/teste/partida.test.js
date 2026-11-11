// Partida de verdade: o servidor novo precisa subir e responder
//   (a) contra um banco VAZIO (instalação nova) e
//   (b) contra um banco que está num estado ANTERIOR do esquema (atualização de instância existente).
// Regressões: 2.20 (lia modalidades antes das migrações: instalação nova caía) e 2.23 (lia a coluna "sexo" antes da migração 022:
// atualização caía). O servidor só pode usar tabelas/colunas novas DEPOIS de migrar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'

const URL_TESTE = process.env.DATABASE_URL_TESTE
const RAIZ = new URL('../..', import.meta.url).pathname
const MIGRACOES = new URL('../migrations/', import.meta.url)

/** Cria um banco novo, aplica as migrações até `ate` (null = nenhuma) como a instância antiga teria feito, sobe o servidor e confere. */
async function subirContra(ate) {
  const nome = `prefichas_partida_${randomBytes(4).toString('hex')}`
  const admin = new pg.Client({ connectionString: URL_TESTE }); await admin.connect()
  await admin.query(`create database ${nome}`)
  const u = new URL(URL_TESTE); u.pathname = `/${nome}`
  let filho
  try {
    if (ate) {
      const banco = new pg.Client({ connectionString: u.toString() }); await banco.connect()
      await banco.query('create table schema_migrations (nome text primary key, aplicada_em timestamptz not null default now())')
      for (const arq of (await readdir(MIGRACOES)).filter((a) => a.endsWith('.sql')).sort()) {
        if (arq > ate) break
        await banco.query(await readFile(new URL(arq, MIGRACOES), 'utf8')); await banco.query('insert into schema_migrations (nome) values ($1)', [arq])
      }
      await banco.end()
    }
    const porta = 39000 + Math.floor(Math.random() * 900)
    let saida = ''
    filho = spawn('node', ['server/index.js'], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: u.toString(), PORTA: String(porta), HOST: '127.0.0.1', NODE_ENV: 'production', LOG_NIVEL: 'warn' } })
    filho.stdout.on('data', (d) => { saida += d }); filho.stderr.on('data', (d) => { saida += d })
    let ok = false
    for (let i = 0; i < 100 && !ok && filho.exitCode === null; i++) {
      ok = await fetch(`http://127.0.0.1:${porta}/api/saude`).then((r) => r.ok).catch(() => false)
      if (!ok) await new Promise((r) => setTimeout(r, 200))
    }
    assert.equal(ok, true, `o servidor não respondeu (banco em ${ate ?? 'vazio'}): ${saida.slice(0, 400)}`)
    const mods = await (await fetch(`http://127.0.0.1:${porta}/api/modalidades`)).json()
    assert.deepEqual(mods.map((m) => m.valor), ['mirim', 'fac', 'juvenil', 'senior', 'casais'], 'modalidades carregadas logo na partida')
    const banco = new pg.Client({ connectionString: u.toString() }); await banco.connect()
    const { rows } = await banco.query('select count(*)::int n from schema_migrations'); await banco.end()
    assert.equal(rows[0].n, (await readdir(MIGRACOES)).filter((a) => a.endsWith('.sql')).length, 'todas as migrações foram aplicadas')
  } finally {
    filho?.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300))
    await admin.query(`drop database if exists ${nome} with (force)`); await admin.end()
  }
}

test('instalação nova: servidor sobe com banco vazio (migrações antes de usar as tabelas)', { skip: !URL_TESTE && 'defina DATABASE_URL_TESTE' }, async () => {
  await subirContra(null)
})

test('atualização: servidor sobe a partir de cada um dos últimos estados do esquema (colunas novas só depois de migrar)', { skip: !URL_TESTE && 'defina DATABASE_URL_TESTE' }, async () => {
  const todas = (await readdir(MIGRACOES)).filter((a) => a.endsWith('.sql')).sort()
  for (const anterior of todas.slice(-7, -1)) await subirContra(anterior)   // banco parado numa das 6 migrações antes da última
})
