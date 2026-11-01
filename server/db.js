import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'

// Datas (tipo date) voltam como texto 'AAAA-MM-DD', sem conversão de fuso horário.
pg.types.setTypeParser(1082, (v) => v)
// bigint (ids) como número JavaScript — seguro até 9 quatrilhões.
pg.types.setTypeParser(20, (v) => Number(v))

export function criarPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 })
}

const PASTA_MIGRACOES = new URL('./migrations/', import.meta.url)

/** Aplica, em ordem, os arquivos .sql de server/migrations que ainda não rodaram. */
export async function migrar(pool, log = console) {
  const cliente = await pool.connect()
  try {
    // Evita que duas instâncias apliquem migrações ao mesmo tempo.
    await cliente.query('select pg_advisory_lock(727274)')
    await cliente.query(`create table if not exists schema_migrations (
      nome text primary key, aplicada_em timestamptz not null default now())`)
    const { rows } = await cliente.query('select nome from schema_migrations')
    const aplicadas = new Set(rows.map((r) => r.nome))
    const arquivos = (await readdir(PASTA_MIGRACOES)).filter((a) => a.endsWith('.sql')).sort()

    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue
      const sql = await readFile(new URL(arquivo, PASTA_MIGRACOES), 'utf8')
      await cliente.query('begin')
      try {
        await cliente.query(sql)
        await cliente.query('insert into schema_migrations (nome) values ($1)', [arquivo])
        await cliente.query('commit')
        log.info(`Migração aplicada: ${arquivo}`)
      } catch (e) {
        await cliente.query('rollback')
        throw new Error(`Falha na migração ${arquivo}: ${e.message}`)
      }
    }
  } finally {
    await cliente.query('select pg_advisory_unlock(727274)').catch(() => {})
    cliente.release()
  }
}

/** Executa uma função dentro de uma transação. */
export async function transacao(pool, fn) {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')
    const resultado = await fn(cliente)
    await cliente.query('commit')
    return resultado
  } catch (e) {
    await cliente.query('rollback').catch(() => {})
    throw e
  } finally {
    cliente.release()
  }
}
