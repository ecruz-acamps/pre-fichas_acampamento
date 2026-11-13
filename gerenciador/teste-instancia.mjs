// Apagar instância e trocar o link de acesso (executor do painel central), com instâncias, docker, curl, túnel e proxy FALSOS:
//   node --test gerenciador/teste-instancia.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const RAIZ = new URL('..', import.meta.url).pathname
const T = mkdtempSync(join(tmpdir(), 'inst-'))
const D = { opt: join(T, 'opt'), dados: join(T, 'dados'), etc: join(T, 'etc'), bin: join(T, 'bin'), comp: join(T, 'comp'), lixo: join(T, 'lixeira'), bkp: join(T, 'apagados') }
for (const d of Object.values(D)) mkdirSync(d, { recursive: true })
mkdirSync(join(D.dados, 'pedidos'), { recursive: true }); mkdirSync(join(D.dados, 'estado'), { recursive: true })
const LOG = join(T, 'chamadas.log')
const exe = (caminho, corpo) => { writeFileSync(caminho, `#!/bin/sh\n${corpo}\n`); chmodSync(caminho, 0o755) }
exe(join(D.bin, 'docker'), `echo "docker $PWD $*" >> ${LOG}; exit 0`)
exe(join(D.bin, 'curl'), `for a; do u="$a"; done; case "$u" in *falha*) exit 22 ;; esac; exit 0`)
exe(join(D.comp, 'tunel-compartilhado.sh'), `echo "tunel $*" >> ${LOG}; exit 0`)
exe(join(D.comp, 'proxy-compartilhado.sh'), `echo "proxy $*" >> ${LOG}; exit 0`)
writeFileSync(join(D.etc, 'painel.env'), 'DOMINIO_BASE=movimentocampista.com.br\n')

function instancia(pasta, env, { backupOk = true } = {}) {
  const dir = join(D.opt, pasta); mkdirSync(join(dir, 'scripts'), { recursive: true }); mkdirSync(join(dir, 'atualizacao/estado'), { recursive: true })
  writeFileSync(join(dir, '.env'), Object.entries({ COMPOSE_PROJECT_NAME: pasta, NOME_ACAMPAMENTO: 'Teste', PORTA_LOCAL: '3055', POSTGRES_PASSWORD: 'segredo-do-banco', ...env }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
  chmodSync(join(dir, '.env'), 0o600)
  exe(join(dir, 'scripts/backup.sh'), backupOk ? 'echo dados-do-banco > "$PASTA_BACKUP/prefichas-1.dump"' : 'exit 1')
  writeFileSync(join(dir, 'atualizacao/estado/publicacao.json'), JSON.stringify({ ativo: env.PUBLICACAO === 'cloudflare', endereco: env.ENDERECO_PUBLICO ?? '' }))
  return dir
}
function pedir(corpo, extra = {}) {
  const id = randomUUID()
  writeFileSync(join(D.dados, 'pedidos', `${id}.json`), JSON.stringify({ por: 'adm@x.com', ...corpo }))
  const r = spawnSync('bash', [join(RAIZ, 'scripts/gerenciador-executor.sh'), 'pedidos'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PATH: `${D.bin}:${process.env.PATH}`, GERENCIADOR_DADOS: D.dados, PREFICHAS_OPT: D.opt, PREFICHAS_ETC: D.etc, PREFICHAS_SCRIPTS: D.comp,
      PREFICHAS_LIXEIRA: D.lixo, PREFICHAS_BACKUPS_APAGADOS: D.bkp, PREFICHAS_SAUDE_URL: 'http://{host}/api/saude', PREFICHAS_ESPERA_TENTATIVAS: '2', PREFICHAS_ESPERA_SEGUNDOS: '0', ...extra } })
  const tarefa = JSON.parse(readFileSync(join(D.dados, 'estado/tarefas', `${id}.json`), 'utf8'))
  const log = existsSync(join(D.dados, 'estado/tarefas', `${id}.log`)) ? readFileSync(join(D.dados, 'estado/tarefas', `${id}.log`), 'utf8') : ''
  return { tarefa, log, saida: r.stdout + r.stderr }
}
const env = (pasta) => Object.fromEntries(readFileSync(join(D.opt, pasta, '.env'), 'utf8').split('\n').filter(Boolean).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]))
const chamadas = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [])
const limpar = () => writeFileSync(LOG, '')

test('trocar link (Cloudflare → outro subdomínio): publica e confere o novo ANTES, atualiza a instância e só então tira o antigo', () => {
  instancia('prefichas-a', { PUBLICACAO: 'cloudflare', URL_PUBLICA: 'https://antigo.movimentocampista.com.br', DOMINIO: 'antigo.movimentocampista.com.br', ENDERECO_PUBLICO: 'antigo.movimentocampista.com.br' })
  limpar()
  const r = pedir({ acao: 'trocar-link', instancia: 'prefichas-a', publicacao: 'cloudflare', subdominio: 'novo-nome' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const c = chamadas()
  assert.deepEqual(c.filter((x) => x.startsWith('tunel')), ['tunel verificar novo-nome.movimentocampista.com.br', 'tunel adicionar novo-nome.movimentocampista.com.br 3055', 'tunel remover antigo.movimentocampista.com.br'])
  assert.ok(c.some((x) => /docker .*prefichas-a compose up -d|docker .* up -d/.test(x)), 'reinicia a instância')
  const e = env('prefichas-a')
  assert.deepEqual([e.URL_PUBLICA, e.DOMINIO, e.PUBLICACAO, e.ENDERECO_PUBLICO], ['https://novo-nome.movimentocampista.com.br', 'novo-nome.movimentocampista.com.br', 'cloudflare', 'novo-nome.movimentocampista.com.br'])
  assert.equal(e.POSTGRES_PASSWORD, 'segredo-do-banco', 'o resto do .env fica intacto')
  assert.equal(JSON.parse(readFileSync(join(D.opt, 'prefichas-a/atualizacao/estado/publicacao.json'), 'utf8')).endereco, 'novo-nome.movimentocampista.com.br')
  assert.match(r.log, /redirecionamento no Entra/)
})

test('trocar link para domínio próprio usa o proxy compartilhado e tira o antigo do túnel', () => {
  limpar()
  const r = pedir({ acao: 'trocar-link', instancia: 'prefichas-a', publicacao: 'direta', dominio: 'Prefichas.Meu-Acampamento.com.br' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  assert.deepEqual(chamadas().filter((x) => /^(tunel|proxy)/.test(x)), ['proxy adicionar prefichas.meu-acampamento.com.br 3055', 'tunel remover novo-nome.movimentocampista.com.br'])
  const e = env('prefichas-a'); assert.deepEqual([e.PUBLICACAO, e.URL_PUBLICA, e.ENDERECO_PUBLICO], ['direta', 'https://prefichas.meu-acampamento.com.br', ''])
})

test('trocar link: se o endereço novo NÃO responde, desfaz — o antigo continua e a instância não muda', () => {
  const antes = readFileSync(join(D.opt, 'prefichas-a/.env'), 'utf8')
  limpar()
  const r = pedir({ acao: 'trocar-link', instancia: 'prefichas-a', publicacao: 'direta', dominio: 'falha.exemplo.com.br' })
  assert.equal(r.tarefa.situacao, 'erro'); assert.match(r.log, /ainda não responde/)
  assert.equal(readFileSync(join(D.opt, 'prefichas-a/.env'), 'utf8'), antes)
  assert.deepEqual(chamadas().filter((x) => /^(tunel|proxy)/.test(x)), ['proxy adicionar falha.exemplo.com.br 3055', 'proxy remover falha.exemplo.com.br'], 'só o novo é desfeito; o antigo nem é tocado')
})

test('trocar link: recusa endereço igual, em uso por outra instância, inválido e instância que não é Cloudflare/direta', () => {
  instancia('prefichas-b', { PUBLICACAO: 'cloudflare', URL_PUBLICA: 'https://b.movimentocampista.com.br', ENDERECO_PUBLICO: 'b.movimentocampista.com.br', PORTA_LOCAL: '3056' })
  instancia('prefichas-local', { PUBLICACAO: 'local', URL_PUBLICA: 'http://10.0.0.1' })
  const falha = (corpo, re) => { limpar(); const r = pedir({ acao: 'trocar-link', ...corpo }); assert.equal(r.tarefa.situacao, 'erro', JSON.stringify(corpo)); assert.match(r.log, re); assert.equal(chamadas().filter((x) => /^(tunel|proxy)/.test(x)).length, 0, 'nada foi publicado') }
  falha({ instancia: 'prefichas-b', publicacao: 'cloudflare', subdominio: 'b' }, /igual ao atual/)
  falha({ instancia: 'prefichas-b', publicacao: 'direta', dominio: 'prefichas.meu-acampamento.com.br' }, /já é usado por outra/)
  falha({ instancia: 'prefichas-b', publicacao: 'cloudflare', subdominio: 'Nome Ruim; id' }, /inválido/)
  falha({ instancia: 'prefichas-b', publicacao: 'direta', dominio: 'x$(id).com' }, /inválido/)
  falha({ instancia: 'prefichas-local', publicacao: 'cloudflare', subdominio: 'abc' }, /Só dá para trocar/)
  falha({ instancia: 'prefichas-gerenciador', publicacao: 'cloudflare', subdominio: 'abc' }, /inválida/)
  falha({ instancia: '../etc', publicacao: 'cloudflare', subdominio: 'abc' }, /inválida/)
})

test('apagar: exige o nome certo; faz backup, tira o endereço, remove containers/dados e manda a pasta para a lixeira', () => {
  instancia('prefichas-x', { PUBLICACAO: 'cloudflare', URL_PUBLICA: 'https://x.movimentocampista.com.br', ENDERECO_PUBLICO: 'x.movimentocampista.com.br', PORTA_LOCAL: '3057' })
  limpar()
  const errado = pedir({ acao: 'apagar', instancia: 'prefichas-x', confirmar: 'prefichas-y' })
  assert.equal(errado.tarefa.situacao, 'erro'); assert.match(errado.log, /Confirmação não confere/); assert.ok(existsSync(join(D.opt, 'prefichas-x')))
  limpar()
  const r = pedir({ acao: 'apagar', instancia: 'prefichas-x', confirmar: 'prefichas-x' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  assert.equal(existsSync(join(D.opt, 'prefichas-x')), false, 'a pasta saiu de /opt')
  const lixo = readdirSync(D.lixo).filter((n) => n.startsWith('prefichas-x-')); assert.equal(lixo.length, 1, 'e está na lixeira')
  const bk = readdirSync(D.bkp).find((n) => n.startsWith('prefichas-x-')); assert.ok(bk)
  assert.deepEqual(readdirSync(join(D.bkp, bk)).sort(), ['LEIA-ME.txt', 'prefichas-1.dump'])
  assert.equal(readFileSync(join(D.bkp, bk, 'LEIA-ME.txt'), 'utf8').includes('segredo-do-banco'), false, 'sem segredos no backup/leia-me')
  const c = chamadas()
  assert.ok(c.includes('tunel remover x.movimentocampista.com.br')); assert.ok(c.some((x) => /compose down -v --remove-orphans/.test(x)))
})

test('apagar: sem backup não apaga nada (a menos que peça); recusa o gerenciador, o proxy e nomes estranhos', () => {
  instancia('prefichas-z', { PUBLICACAO: 'direta', URL_PUBLICA: 'https://z.exemplo.com.br', PORTA_LOCAL: '3058' }, { backupOk: false })
  limpar()
  const r = pedir({ acao: 'apagar', instancia: 'prefichas-z', confirmar: 'prefichas-z' })
  assert.equal(r.tarefa.situacao, 'erro'); assert.match(r.log, /NÃO apaguei nada/)
  assert.ok(existsSync(join(D.opt, 'prefichas-z/.env'))); assert.equal(chamadas().filter((x) => /^(tunel|proxy)|compose/.test(x)).length, 0, 'nada foi tirado do ar nem parado')
  const forcado = pedir({ acao: 'apagar', instancia: 'prefichas-z', confirmar: 'prefichas-z', sem_backup: true })
  assert.equal(forcado.tarefa.situacao, 'concluida', forcado.log); assert.ok(chamadas().includes('proxy remover z.exemplo.com.br')); assert.equal(existsSync(join(D.opt, 'prefichas-z')), false)
  for (const nome of ['prefichas-gerenciador', 'prefichas-proxy', 'prefichas-tunel', '../opt', 'prefichas-nao-existe']) {
    mkdirSync(join(D.opt, nome.replace(/\//g, '_')), { recursive: true })
    const x = pedir({ acao: 'apagar', instancia: nome, confirmar: nome }); assert.equal(x.tarefa.situacao, 'erro', nome)
  }
})

test('atualizar limpa as imagens antigas do Docker sem uso (mais de 1 dia) depois de dar certo; se falhar, não limpa', () => {
  const dir = instancia('prefichas-limpeza', { PUBLICACAO: 'direta' })
  exe(join(dir, 'scripts/atualizar.sh'), 'echo "✓ Atualizado."')
  limpar()
  const r = pedir({ acao: 'atualizar', instancia: 'prefichas-limpeza' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const c = chamadas()
  assert.ok(c.some((x) => /docker \S+ image prune -a -f --filter until=24h/.test(x)), c.join('\n'))
  assert.ok(c.some((x) => /docker \S+ builder prune -a -f --filter until=24h/.test(x)))
  assert.match(r.log, /Limpeza do Docker/); assert.equal(r.tarefa.resumo ?? r.tarefa.mensagem ?? '', r.tarefa.resumo ?? r.tarefa.mensagem ?? '')
  assert.doesNotMatch(JSON.stringify(r.tarefa), /Limpeza do Docker/, 'o resumo da tarefa continua sendo o da atualização')
  exe(join(dir, 'scripts/atualizar.sh'), 'echo "✗ Falhou."; exit 1')
  limpar()
  assert.equal(pedir({ acao: 'atualizar', instancia: 'prefichas-limpeza' }).tarefa.situacao, 'erro')
  assert.equal(chamadas().some((x) => /prune/.test(x)), false)
})
