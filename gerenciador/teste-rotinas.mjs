// Backup na nuvem (OneDrive, cifrado com age) e mensagens de aniversário (textbee), executados pelo executor do painel
// com Microsoft, OneDrive, textbee, docker e instâncias FALSOS:   node --test gerenciador/teste-rotinas.mjs
// Precisa do programa "age" instalado (o instalador do painel instala).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const RAIZ = new URL('..', import.meta.url).pathname
const temAge = spawnSync('age', ['--version']).status === 0
const T = mkdtempSync(join(tmpdir(), 'rotinas-'))
const D = { opt: join(T, 'opt'), dados: join(T, 'dados'), etc: join(T, 'etc'), bin: join(T, 'bin'), comp: join(T, 'comp'), nuvem: join(T, 'nuvem') }
for (const d of Object.values(D)) mkdirSync(d, { recursive: true })
for (const d of ['pedidos', 'estado']) mkdirSync(join(D.dados, d), { recursive: true })
const LOG = join(T, 'chamadas.log'), FAKE = join(T, 'fake.json')
const exe = (caminho, corpo) => { writeFileSync(caminho, corpo); chmodSync(caminho, 0o755) }

// ---------------------------------------------------------------- curl falso (Microsoft login, Graph/OneDrive, textbee)
exe(join(D.bin, 'curl'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const FAKE = ${JSON.stringify(FAKE)}, NUVEM = ${JSON.stringify(D.nuvem)}, LOG = ${JSON.stringify(LOG)}
const est = fs.existsSync(FAKE) ? JSON.parse(fs.readFileSync(FAKE, 'utf8')) : { itens: {}, sessoes: {}, polls: 0, sms: [], recebidas: [], modo: {} }
const salvar = () => fs.writeFileSync(FAKE, JSON.stringify(est))
const a = process.argv.slice(2); let metodo = 'GET', url = '', saida = null, w = null, dados = [], cab = [], stdin = null
const lerStdin = () => (stdin ??= fs.readFileSync(0))
for (let i = 0; i < a.length; i++) {
  const x = a[i]
  if (x === '-X') metodo = a[++i]; else if (x === '-o') saida = a[++i]; else if (x === '-w') w = a[++i]
  else if (x === '-H') cab.push(a[++i]); else if (x === '-m') i++
  else if (x === '-K') { i++; const c = lerStdin().toString(); stdin = Buffer.alloc(0); const m = /header = "([^"]*)"/.exec(c); if (m) cab.push(m[1]) }
  else if (x === '--data-urlencode') dados.push(Buffer.from(a[++i]))
  else if (x === '--data-binary') { const v = a[++i]; dados.push(v === '@-' ? lerStdin() : v.startsWith('@') ? fs.readFileSync(v.slice(1)) : Buffer.from(v)) }
  else if (x.startsWith('-')) {} else url = x
}
if (dados.length && metodo === 'GET') metodo = 'POST'
const corpo = Buffer.concat(dados.flatMap((d, i) => (i ? [Buffer.from('&'), d] : [d])))
const ok = (obj, st = 200) => { const t = Buffer.isBuffer(obj) || typeof obj === 'string' ? obj : JSON.stringify(obj); if (saida) fs.writeFileSync(saida, t); else process.stdout.write(t); if (w) process.stdout.write(w.replace('\\\\n', '\\n').replace('%{http_code}', String(st))); salvar(); process.exit(st >= 400 && !w ? 22 : 0) }
fs.appendFileSync(LOG, metodo + ' ' + url.split('?')[0] + '\\n')
const auth = cab.find((h) => /^Authorization:/i.test(h)) ?? '', chave = cab.find((h) => /^x-api-key:/i.test(h)) ?? ''
const form = () => Object.fromEntries(corpo.toString().split('&').map((p) => { const [k, ...v] = p.split('='); return [k, decodeURIComponent(v.join('=').replace(/\\+/g, ' '))] }))
if (/\\/api\\/saude$/.test(url)) ok('{}')
// --- login Microsoft
if (/\\/oauth2\\/v2.0\\/devicecode$/.test(url)) ok({ user_code: 'ABCD-1234', device_code: 'dev-123', verification_uri: 'https://microsoft.com/devicelogin', interval: 1, expires_in: 60 })
if (/\\/oauth2\\/v2.0\\/token$/.test(url)) {
  const f = form()
  if (f.grant_type === 'refresh_token') { if (f.refresh_token !== est.refresh) ok({ error: 'invalid_grant' }, 400); est.refresh = 'r-' + crypto.randomUUID(); ok({ access_token: 'acesso-ok', refresh_token: est.refresh }) }
  if (est.polls++ < 1) ok({ error: 'authorization_pending' }, 400)
  est.refresh = 'r-inicial'; ok({ access_token: 'acesso-ok', refresh_token: est.refresh })
}
// --- Graph / OneDrive
if (url.startsWith('https://graph.microsoft.com/') || url.startsWith('https://upload.falso/')) {
  if (!url.startsWith('https://upload.falso/') && auth !== 'Authorization: Bearer acesso-ok') ok({ error: { code: 'InvalidAuthenticationToken' } }, 401)
  const u = new URL(url), p = decodeURIComponent(u.pathname)
  if (p === '/v1.0/me/drive') ok({ owner: { user: { displayName: 'Conta Backup' } }, quota: { remaining: 5 * 1073741824 } })
  if (p === '/v1.0/me/drive/root/children' || /:\\/children$/.test(p) && metodo === 'POST') ok({ id: 'pasta' }, 201)
  let m
  if ((m = /^\\/v1.0\\/me\\/drive\\/root:\\/(.+):\\/createUploadSession$/.exec(p))) { const id = 'up' + crypto.randomUUID().slice(0, 8); est.sessoes[id] = { caminho: m[1] }; fs.writeFileSync(path.join(NUVEM, id + '.parcial'), ''); ok({ uploadUrl: 'https://upload.falso/' + id }) }
  if ((m = /^\\/(up[0-9a-f]+)$/.exec(p))) {
    const s = est.sessoes[m[1]]; const faixa = /bytes (\\d+)-(\\d+)\\/(\\d+)/.exec(cab.find((h) => /^Content-Range/i.test(h)) ?? '')
    fs.appendFileSync(path.join(NUVEM, m[1] + '.parcial'), corpo)
    if (+faixa[2] + 1 < +faixa[3]) ok({ nextExpectedRanges: [String(+faixa[2] + 1) + '-'] }, 202)
    const id = 'it' + crypto.randomUUID().slice(0, 8); fs.renameSync(path.join(NUVEM, m[1] + '.parcial'), path.join(NUVEM, id))
    est.itens[id] = { caminho: s.caminho, size: fs.statSync(path.join(NUVEM, id)).size }; ok({ id, name: path.basename(s.caminho) }, 201)
  }
  if ((m = /^\\/v1.0\\/me\\/drive\\/root:\\/(.+):\\/children$/.exec(p))) {
    const pasta = m[1] + '/'
    const filhos = Object.entries(est.itens).filter(([, v]) => v.caminho.startsWith(pasta) && !v.caminho.slice(pasta.length).includes('/')).map(([id, v]) => ({ id, name: path.basename(v.caminho), size: v.size, createdDateTime: '2026-01-01T00:00:00Z' }))
    const subpastas = [...new Set(Object.values(est.itens).map((v) => v.caminho).filter((c) => c.startsWith(pasta) && c.slice(pasta.length).includes('/')).map((c) => c.slice(pasta.length).split('/')[0]))].map((n) => ({ name: n, folder: {} }))
    ok({ value: [...filhos, ...subpastas] })
  }
  if ((m = /^\\/v1.0\\/me\\/drive\\/items\\/([^/]+)\\/content$/.exec(p))) ok(fs.readFileSync(path.join(NUVEM, m[1])))
  if ((m = /^\\/v1.0\\/me\\/drive\\/items\\/([^/]+)$/.exec(p)) && metodo === 'DELETE') { delete est.itens[m[1]]; ok('', 204) }
  ok({ error: { message: 'rota falsa desconhecida ' + metodo + ' ' + p } }, 404)
}
// --- textbee
if (url.startsWith('https://api.textbee.dev/')) {
  if (chave !== 'x-api-key: chave-textbee-0123456789') ok({ message: 'Unauthorized' }, 401)
  if (/gateway\\/send-sms$/.test(url)) { if (est.modo.limite && est.sms.length >= est.modo.limite) ok({ message: 'Daily limit reached' }, 429); est.sms.push(JSON.parse(corpo.toString())); ok({ data: { success: true, smsBatchId: 'b1', recipientCount: 1 } }) }
  if (/gateway\\/messages/.test(url)) ok({ data: est.recebidas, meta: {} })
}
ok({ erro: 'url desconhecida ' + url }, 404)
`)
// ---------------------------------------------------------------- docker falso (pg_dump/pg_restore/psql/compose)
exe(join(D.bin, 'docker'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const LOG = ${JSON.stringify(LOG)}, a = process.argv.slice(2), dir = process.cwd(), inst = path.basename(dir)
fs.appendFileSync(LOG, 'docker ' + inst + ' ' + a.join(' ').slice(0, 120) + '\\n')
if (a[0] !== 'compose') process.exit(0)
if (a[1] === 'ps') { if (!fs.existsSync(path.join(dir, 'parado'))) process.stdout.write('db\\napp\\n'); process.exit(0) }
if (a[1] === 'exec') {
  const cmd = a[a.length - 1]
  if (/pg_dump/.test(cmd)) { process.stdout.write(Buffer.concat([Buffer.from('PGDMP'), Buffer.from(' banco de ' + inst + ' ' + 'x'.repeat(3000))])); process.exit(0) }
  if (/pg_restore/.test(cmd)) { fs.writeFileSync(path.join(dir, 'restaurado.bin'), fs.readFileSync(0)); process.exit(0) }
  if (/to_regclass/.test(cmd)) { process.stdout.write('t\\n'); process.exit(0) }
  if (/psql/.test(cmd)) { fs.readFileSync(0); const f = path.join(dir, 'aniversarios.tsv'); if (fs.existsSync(f)) process.stdout.write(fs.readFileSync(f)); process.exit(0) }
}
process.exit(0)
`)

function instancia(pasta, nome, linhasSms = []) {
  const dir = join(D.opt, pasta); mkdirSync(join(dir, 'scripts'), { recursive: true }); mkdirSync(join(dir, 'backups'), { recursive: true })
  writeFileSync(join(dir, '.env'), `COMPOSE_PROJECT_NAME=${pasta}\nNOME_ACAMPAMENTO=${nome}\nPORTA_LOCAL=3061\n`)
  exe(join(dir, 'scripts/backup.sh'), `#!/bin/sh\necho local > backups/seguranca.dump\necho "backup local feito"\n`)
  writeFileSync(join(dir, 'aniversarios.tsv'), linhasSms.map((l) => l.join('\t')).join('\n') + (linhasSms.length ? '\n' : ''))
}
function pedir(corpo, extra = {}) {
  const id = randomUUID()
  writeFileSync(join(D.dados, 'pedidos', `${id}.json`), JSON.stringify({ por: 'adm@x.com', ...corpo }))
  const r = executor('pedidos', extra)
  const tarefa = JSON.parse(readFileSync(join(D.dados, 'estado/tarefas', `${id}.json`), 'utf8'))
  return { tarefa, log: readFileSync(join(D.dados, 'estado/tarefas', `${id}.log`), 'utf8'), saida: r }
}
function executor(modo, extra = {}) {
  return spawnSync('bash', [join(RAIZ, 'scripts/gerenciador-executor.sh'), modo], { encoding: 'utf8', timeout: 120000,
    env: { ...process.env, PATH: `${D.bin}:${process.env.PATH}`, GERENCIADOR_DADOS: D.dados, PREFICHAS_OPT: D.opt, PREFICHAS_ETC: D.etc, PREFICHAS_SCRIPTS: D.comp,
      PREFICHAS_ESPERA_LOGIN: '0', PREFICHAS_SMS_INTERVALO: '0', ...extra } })
}
const fake = () => JSON.parse(readFileSync(FAKE, 'utf8'))
const mexerFake = (f) => { const e = existsSync(FAKE) ? fake() : { itens: {}, sessoes: {}, polls: 0, sms: [], recebidas: [], modo: {} }; f(e); writeFileSync(FAKE, JSON.stringify(e)) }
const estado = (n) => JSON.parse(readFileSync(join(D.dados, 'estado', n), 'utf8'))
const G1 = '11111111-2222-3333-4444-555555555555', G2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
let SECRETA

const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
before(() => {
  instancia('prefichas-a', 'Acampamento A', [['aniversario', 'MARIA da Silva', '(48) 99999-0001', '40', ''], ['acampamento', 'João Souza', '48 98888-0002', '3', '16º Sênior'],
    ['aniversario', 'Sem Celular', '123', '30', ''], ['aniversario', 'Bloqueada Pessoa', '(48) 97777-0003', '25', '']])
  instancia('prefichas-b', 'Acampamento B', [['aniversario', 'Maria Silva', '+55 48 99999-0001', '40', ''], ['aniversario', 'Pedro Lima', '(11) 96666-0004', '50', '']])
})

test('backup: não liga sem OneDrive e chave; conecta pelo código (device code) e guarda só o token de atualização', { skip: !temAge && 'instale o age' }, () => {
  assert.equal(pedir({ acao: 'backup-config', ligado: true, hora: '02:30', tenant_id: G1, client_id: G2, manter_diarios: 14, manter_mensais: 6 }).tarefa.situacao, 'erro', 'sem OneDrive conectado não liga')
  assert.equal(pedir({ acao: 'backup-config', ligado: false, hora: '02:30', tenant_id: 'nao', client_id: G2 }).tarefa.situacao, 'erro')
  assert.equal(pedir({ acao: 'backup-config', ligado: false, hora: '02:30', tenant_id: G1, client_id: G2 }).tarefa.situacao, 'concluida')
  const c = pedir({ acao: 'backup-conectar' })
  assert.equal(c.tarefa.situacao, 'concluida', c.log); assert.match(c.log, /ABCD-1234/); assert.match(c.log, /Conta Backup/)
  const env = readFileSync(join(D.etc, 'onedrive.env'), 'utf8'); assert.match(env, /OD_REFRESH=r-inicial/); assert.doesNotMatch(env, /acesso-ok/, 'o token de acesso não é guardado')
  assert.equal((statSync(join(D.etc, 'onedrive.env')).mode & 0o777).toString(8), '600')
  assert.equal(readFileSync(join(D.dados, 'estado/nuvem-codigo.json'), 'utf8'), '', 'o código some do painel ao concluir')
})

test('chave de recuperação: só a pública fica na VM; a secreta aparece uma vez e some ao confirmar', { skip: !temAge && 'instale o age' }, () => {
  assert.equal(pedir({ acao: 'backup-chave-gerar' }).tarefa.situacao, 'concluida')
  assert.match(readFileSync(join(D.etc, 'backup-chave.pub'), 'utf8'), /^age1[0-9a-z]{58}\n$/)
  SECRETA = estado('backup-chave.json').chave; assert.match(SECRETA, /^AGE-SECRET-KEY-1/)
  assert.equal(spawnSync('grep', ['-rq', 'AGE-SECRET-KEY', D.etc]).status, 1, 'a chave secreta nunca é gravada em /etc/prefichas')
  assert.equal(pedir({ acao: 'backup-chave-gerar' }).tarefa.situacao, 'erro', 'não troca sem confirmar a substituição')
  assert.equal(pedir({ acao: 'backup-chave-guardada' }).tarefa.situacao, 'concluida'); assert.equal(readFileSync(join(D.dados, 'estado/backup-chave.json'), 'utf8'), '')
})

test('backup de todos: cada acampamento vai cifrado para a sua pasta no OneDrive; nada em claro fica no disco; retenção diária + mensal', { skip: !temAge && 'instale o age' }, () => {
  // backups antigos já na nuvem (para a retenção): 6 diários de janeiro e 1 de cada mês anterior
  mexerFake((e) => { for (const d of ['2025-09-03', '2025-10-05', '2025-11-02', '2025-12-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'])
    e.itens['old' + d.replace(/-/g, '')] = { caminho: `PreFichas-Backups/prefichas-a/prefichas-a__${d}_0230.dump.age`, size: 10 } })
  assert.equal(pedir({ acao: 'backup-config', ligado: true, hora: '02:30', tenant_id: G1, client_id: G2, manter_diarios: 3, manter_mensais: 2 }).tarefa.situacao, 'concluida')
  const r = pedir({ acao: 'backup-nuvem' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const itens = fake().itens
  const deA = Object.entries(itens).filter(([, v]) => v.caminho.startsWith('PreFichas-Backups/prefichas-a/')).map(([id, v]) => ({ id, nome: v.caminho.split('/').pop() })).sort((x, y) => x.nome.localeCompare(y.nome))
  const novoA = deA.find((x) => x.nome.includes(hoje)); assert.ok(novoA, 'backup de hoje enviado')
  assert.match(novoA.nome, /^prefichas-a__\d{4}-\d{2}-\d{2}_\d{4}\.dump\.age$/)
  // retenção: 3 mais recentes + primeiro de cada um dos 2 meses mais recentes
  assert.deepEqual(deA.map((x) => x.nome.slice(13, 23)), ['2026-01-02', '2026-01-04', '2026-01-05', hoje].sort().filter((v, i, l) => l.indexOf(v) === i))
  // cifrado: não começa com PGDMP; abre com a chave secreta e traz o banco certo
  const bruto = readFileSync(join(D.nuvem, novoA.id)); assert.notEqual(bruto.subarray(0, 5).toString(), 'PGDMP')
  const aberto = execFileSync('age', ['-d', '-i', '-', join(D.nuvem, novoA.id)], { input: SECRETA + '\n' }).toString()
  assert.match(aberto, /^PGDMP banco de prefichas-a/)
  assert.ok(Object.values(itens).some((v) => v.caminho.startsWith('PreFichas-Backups/prefichas-b/')), 'cada acampamento na sua pasta')
  assert.equal(statSync(join(D.dados, 'tmp/envio.dump.age')).size, 0, 'o temporário cifrado é esvaziado')
  assert.equal(spawnSync('grep', ['-rq', 'PGDMP', join(D.dados)]).status, 1, 'nenhum dump em claro no disco do painel')
  assert.equal(estado('backup-ultimo.json').instancias, 2)
  assert.deepEqual(Object.keys(estado('backups-nuvem.json').acampamentos).sort(), ['prefichas-a', 'prefichas-b'])
})

test('restaurar: confere a chave e o nome antes; faz backup de segurança local; grava o banco e religa o sistema', { skip: !temAge && 'instale o age' }, () => {
  const lista = estado('backups-nuvem.json').acampamentos['prefichas-a']; const alvo = lista[0]
  const base = { acao: 'backup-restaurar', instancia: 'prefichas-a', arquivo: alvo.id, nome: alvo.name, confirmar: 'prefichas-a' }
  const outra = execFileSync('age-keygen', { encoding: 'utf8' }).split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-1'))
  writeFileSync(LOG, '')
  const errada = pedir({ ...base, chave: outra })
  assert.equal(errada.tarefa.situacao, 'erro'); assert.match(errada.log, /chave não abre/)
  assert.equal(readFileSync(LOG, 'utf8').includes('stop app'), false, 'com a chave errada o sistema nem para')
  assert.equal(pedir({ ...base, chave: SECRETA, confirmar: 'prefichas-b' }).tarefa.situacao, 'erro', 'confirmação errada')
  const ok = pedir({ ...base, chave: SECRETA })
  assert.equal(ok.tarefa.situacao, 'concluida', ok.log)
  assert.match(readFileSync(join(D.opt, 'prefichas-a/restaurado.bin'), 'latin1'), /^PGDMP banco de prefichas-a/)
  assert.ok(existsSync(join(D.opt, 'prefichas-a/backups/seguranca.dump')), 'backup de segurança local antes de restaurar')
  const l = readFileSync(LOG, 'utf8'); assert.ok(l.indexOf('stop app') < l.indexOf('start app'))
  assert.equal(spawnSync('grep', ['-rq', 'AGE-SECRET-KEY', D.dados, D.etc]).status, 1, 'a chave usada na restauração não fica gravada')
})

test('mensagens: só campistas, dedupe entre acampamentos, celular inválido e bloqueados fora; SAIR bloqueia; não repete no mesmo dia; limite', () => {
  assert.equal(pedir({ acao: 'sms-config', ligado: false, hora: '09:00', limite_dia: 200, token: 'chave-textbee-0123456789', device_id: 'aparelho01', modelo_aniversario: '', modelo_acampamento: '' }).tarefa.situacao, 'concluida')
  assert.equal(spawnSync('grep', ['-rq', 'chave-textbee', join(D.dados, 'estado')]).status, 1, 'a chave do textbee não vai para o estado do painel')
  assert.equal(pedir({ acao: 'sms-bloqueio', telefone: '(48) 97777-0003', bloquear: true }).tarefa.situacao, 'concluida')
  // prévia: nada enviado
  const pv = pedir({ acao: 'sms-enviar', previa: true })
  assert.equal(pv.tarefa.situacao, 'concluida', pv.log)
  const prev = estado('sms-previa.json').mensagens
  assert.deepEqual(prev.map((m) => `${m.tipo}:${m.nome}`).sort(), ['acampamento:João', 'aniversario:Maria', 'aniversario:Pedro'], 'Maria aparece uma vez (dois acampamentos), bloqueada e sem celular fora')
  assert.ok(prev.every((m) => /••••\d{4}$/.test(m.telefone)), 'telefone mascarado no painel')
  assert.equal(existsSync(FAKE) ? fake().sms.length : 0, 0)
  // envio real, com uma resposta SAIR do Pedro recebida antes
  mexerFake((e) => { e.recebidas = [{ sender: '+5511966660004', message: 'SAIR', direction: 'received' }] })
  const r = pedir({ acao: 'sms-enviar' })
  assert.equal(r.tarefa.situacao, 'concluida', r.log)
  const enviados = fake().sms
  assert.deepEqual(enviados.map((x) => x.recipients[0]).sort(), ['+5548988880002', '+5548999990001'])
  assert.ok(enviados.every((x) => x.deviceId === 'aparelho01'))
  const maria = enviados.find((x) => x.recipients[0] === '+5548999990001').message
  assert.match(maria, /^Olá, Maria! Hoje é o seu aniversário/); assert.match(maria, /Acampamento A/); assert.match(maria, /responda SAIR\.$/)
  assert.match(enviados.find((x) => x.recipients[0] === '+5548988880002').message, /3 ano\(s\) que você viveu o 16º Sênior/)
  assert.match(readFileSync(join(D.etc, 'sms-bloqueio.txt'), 'utf8'), /\+5511966660004/, 'quem respondeu SAIR entra na lista')
  // de novo no mesmo dia: nada
  assert.equal(pedir({ acao: 'sms-enviar' }).tarefa.situacao, 'concluida'); assert.equal(fake().sms.length, 2)
  const hist = readFileSync(join(D.dados, 'estado/sms', `${hoje}.jsonl`), 'utf8'); assert.doesNotMatch(hist, /99999-?0001|5548999990001/, 'histórico sem o telefone completo')
})

test('mensagens: limite diário e 429 do textbee param o envio; teste vai para o número pedido', () => {
  writeFileSync(join(D.opt, 'prefichas-b/aniversarios.tsv'), ['Ana Um\t(21) 95555-0001', 'Bia Dois\t(21) 95555-0002', 'Caio Tres\t(21) 95555-0003'].map((l) => `aniversario\t${l}\t20\t`).join('\n') + '\n')
  mexerFake((e) => { e.modo.limite = 3 })   // o textbee aceita só mais 1 (já há 2)
  const r = pedir({ acao: 'sms-enviar' })
  assert.match(r.log, /429/); assert.equal(fake().sms.length, 3)
  mexerFake((e) => { e.modo = {} })
  assert.equal(pedir({ acao: 'sms-config', ligado: false, hora: '09:00', limite_dia: 1, modelo_aniversario: '', modelo_acampamento: '' }).tarefa.situacao, 'concluida')
  const r2 = pedir({ acao: 'sms-enviar' }); assert.match(r2.log, /Limite diário \(1\)/); assert.equal(fake().sms.length, 4)
  const t = pedir({ acao: 'sms-teste', telefone: '(48) 91234-5678' }); assert.equal(t.tarefa.situacao, 'concluida', t.log)
  assert.equal(fake().sms.at(-1).recipients[0], '+5548912345678'); assert.match(fake().sms.at(-1).message, /^\[TESTE\]/)
})

test('agendamento: no horário, o "coletar" enfileira o backup e as mensagens uma vez por dia (aparecem em Tarefas)', () => {
  writeFileSync(join(D.etc, 'backup.conf'), 'BACKUP_LIGADO=true\nBACKUP_HORA=00:00\nMANTER_DIARIOS=14\nMANTER_MENSAIS=6\n')
  writeFileSync(join(D.etc, 'sms.json'), JSON.stringify({ ligado: true, hora: '00:00', limite_dia: 10 }))
  for (const f of ['.backup-dia', '.sms-dia']) writeFileSync(join(D.dados, 'estado', f), '')
  executor('coletar')
  const acoes = () => readdirSync(join(D.dados, 'pedidos')).map((f) => JSON.parse(readFileSync(join(D.dados, 'pedidos', f), 'utf8')).acao).sort()
  assert.deepEqual(acoes(), ['backup-nuvem', 'sms-enviar'])
  executor('coletar'); assert.deepEqual(acoes(), ['backup-nuvem', 'sms-enviar'], 'só uma vez por dia')
  const conf = estado('configuracoes.json')
  assert.equal(conf.backup.ligado, true); assert.equal(conf.backup.conectado, true); assert.equal(conf.sms.token_configurado, true)
  assert.equal(JSON.stringify(conf).includes('chave-textbee') || JSON.stringify(conf).includes('r-'), false, 'nenhum segredo no estado publicado')
})
