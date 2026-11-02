import { lerConfig } from './config.js'
import { criarPool, migrar } from './db.js'
import { construirApp } from './app.js'
import { limparSessoesExpiradas } from './sessao.js'
import { aplicarMarcaInicial } from './marca.js'

const config = lerConfig()
const pool = criarPool(config.databaseUrl)
const app = await construirApp({ pool, config })

await migrar(pool, app.log)
await aplicarMarcaInicial(pool, config.marcaInicial, app.log, config.nomeInicial)

const limpeza = setInterval(() => limparSessoesExpiradas(pool).catch((e) => app.log.error(e)), 60 * 60 * 1000)
limpeza.unref()

async function encerrar(sinal) {
  app.log.info(`Recebido ${sinal}, encerrando…`)
  app.verificadorAtualizacao.parar()
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGTERM', () => encerrar('SIGTERM'))
process.on('SIGINT', () => encerrar('SIGINT'))

await app.listen({ port: config.porta, host: config.host })

const instalada = app.verificadorAtualizacao.instalada
app.log.info({ versao: instalada.versao, commit: instalada.commit?.slice(0, 7) ?? 'desconhecido' }, 'Versão instalada')
if (config.atualizacao.ativo) app.verificadorAtualizacao.iniciar(config.atualizacao.horas)
