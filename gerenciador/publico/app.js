// Painel central — interface (sem bibliotecas). Todo texto vindo do servidor entra por textContent.
'use strict'
const app = document.getElementById('app')
let tela = 'instancias'
let usuario = null
let tarefaAberta = null
let atualizador = null

function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)))
  return el
}
async function api(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'fetch', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined })
  const dados = await r.json().catch(() => ({}))
  if (r.status === 401 && url !== '/api/login') { usuario = null; desenhar() }
  if (!r.ok) throw Object.assign(new Error(dados.mensagem || `Erro ${r.status}`), { dados })
  return dados
}
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—')
const PUB = { cloudflare: 'Cloudflare', direta: 'Direta (proxy da VM)', local: 'Rede local', propria: 'Direta (Caddy próprio)', 'proxy-externo': 'Proxy externo' }

// ------------------------------------------------------------------ entrar
function telaEntrar() {
  const erro = h('div')
  const form = h('form', { class: 'cartao entrar', onsubmit: async (e) => {
    e.preventDefault(); erro.replaceChildren()
    const d = Object.fromEntries(new FormData(form))
    try { usuario = (await api('POST', '/api/login', d)).email; desenhar() } catch (err) { erro.append(h('div', { class: 'alerta erro' }, err.message)) }
  } },
  h('h1', {}, 'Painel central'), h('p', { class: 'dica' }, 'Gerenciamento dos acampamentos deste servidor.'),
  h('div', { class: 'campo' }, h('label', { for: 'e' }, 'E-mail'), h('input', { id: 'e', name: 'email', type: 'email', required: true, autocomplete: 'username' })),
  h('div', { class: 'campo' }, h('label', { for: 's' }, 'Senha'), h('input', { id: 's', name: 'senha', type: 'password', required: true, autocomplete: 'current-password' })),
  h('div', { class: 'campo' }, h('label', { for: 'c' }, 'Código do autenticador'), h('input', { id: 'c', name: 'codigo', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: true, autocomplete: 'one-time-code' })),
  erro, h('button', { class: 'principal', type: 'submit' }, 'Entrar'))
  app.replaceChildren(form)
}

// ------------------------------------------------------------------ instâncias
async function telaInstancias(area) {
  const d = await api('GET', '/api/instancias')
  const s = d.servidor
  if (s) {
    area.append(h('section', { class: 'cartao' }, h('h2', {}, 'Servidor'),
      h('div', { class: 'grade-servidor' },
        h('div', { class: 'metrica' }, h('b', {}, s.carga ?? '—'), h('span', {}, `carga (1 min) · ${s.cpus ?? '?'} vCPU`)),
        h('div', { class: 'metrica' }, h('b', {}, `${s.memoria_usada_mb ?? '?'} / ${s.memoria_total_mb ?? '?'} MB`), h('span', {}, 'memória')),
        h('div', { class: 'metrica' }, h('b', {}, `${s.disco_usado ?? '?'} / ${s.disco_total ?? '?'}`), h('span', {}, `disco (${s.disco_pct ?? '?'})`)),
        h('div', { class: 'metrica' }, h('b', {}, s.proxy ? 'no ar' : 'não instalado'), h('span', {}, `proxy compartilhado · ${s.dominios_diretos ?? 0} domínio(s)`)),
        h('div', { class: 'metrica' }, h('b', {}, dataHora(d.coletado_em)), h('span', {}, 'última leitura')))))
  }
  const linhas = (d.instancias ?? []).map((i) => h('tr', {},
    h('td', {}, h('strong', {}, i.nome || i.pasta), h('div', { class: 'dica' }, i.pasta)),
    h('td', {}, i.url ? h('a', { href: i.url, target: '_blank', rel: 'noreferrer' }, i.url) : '—', h('div', { class: 'dica' }, PUB[i.publicacao] ?? i.publicacao ?? '—')),
    h('td', {}, h('span', { class: `selo ${i.saude === 'ok' ? 'ok' : i.saude === 'fora' ? 'erro' : 'neutro'}` }, i.saude === 'ok' ? 'no ar' : i.saude === 'fora' ? 'fora do ar' : '—')),
    h('td', {}, i.versao || '—'), h('td', {}, i.memoria || '—'), h('td', {}, String(i.porta ?? '—')),
    h('td', {}, h('button', { class: 'secundario', onclick: () => pedir({ acao: 'atualizar', instancia: i.pasta }, `Atualizar ${i.nome || i.pasta}? Faz backup antes.`) }, 'Atualizar'), ' ',
      h('button', { class: 'secundario', onclick: () => pedir({ acao: 'backup', instancia: i.pasta }, `Fazer backup de ${i.nome || i.pasta} agora?`) }, 'Backup'))))
  area.append(h('section', { class: 'cartao' },
    h('div', { class: 'topo' }, h('h2', {}, `Instâncias (${(d.instancias ?? []).length})`),
      h('div', {}, h('button', { class: 'secundario', onclick: () => pedir({ acao: 'atualizar-todas' }, 'Atualizar TODAS as instâncias, uma de cada vez (com backup)?') }, 'Atualizar todas'), ' ',
        h('button', { class: 'principal', onclick: () => { tela = 'nova'; desenhar() } }, '+ Nova instância'))),
    (d.instancias ?? []).length ? h('div', { class: 'tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['Acampamento', 'Endereço', 'Situação', 'Versão', 'Memória', 'Porta', 'Ações'].map((t) => h('th', {}, t)))),
      h('tbody', {}, linhas))) : h('p', { class: 'dica' }, 'Nenhuma instância ainda (ou o servidor ainda não publicou a lista — aguarde 1 minuto).')))
}
async function pedir(pedido, confirmacao) {
  if (confirmacao && !confirm(confirmacao)) return
  try { const r = await api('POST', '/api/tarefas', pedido); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (e) { alert(e.message) }
}

// ------------------------------------------------------------------ nova instância
function telaNova(area) {
  const erros = {}
  const campo = (nome, rotulo, input, dica) => h('div', { class: 'campo' }, h('label', { for: nome }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[nome] = h('span', { class: 'erro-campo' }))
  const pub = h('select', { id: 'publicacao', name: 'publicacao' },
    h('option', { value: 'cloudflare' }, 'Cloudflare — NOME.movimentocampista.com.br (sem abrir portas)'),
    h('option', { value: 'direta' }, 'Direta — domínio próprio apontando para o IP da VM (HTTPS automático)'),
    h('option', { value: 'local' }, 'Só rede local — pelo IP, sem HTTPS'))
  const blocoCf = campo('subdominio', 'Endereço na Cloudflare', h('div', { class: 'sufixo' }, h('input', { id: 'subdominio', name: 'subdominio', maxlength: '63' }), h('span', {}, '.movimentocampista.com.br')))
  const blocoDir = campo('dominio', 'Domínio', h('input', { id: 'dominio', name: 'dominio', placeholder: 'prefichas.seuacampamento.com.br' }), 'Crie antes um registro A apontando para o IP público da VM.')
  const nome = h('input', { id: 'nome', name: 'nome', maxlength: '80', required: true, oninput: () => {
    const sub = form.querySelector('#subdominio')
    if (!sub.dataset.mexido) sub.value = nome.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^acampamento\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63)
  } })
  const mostrar = () => { blocoCf.hidden = pub.value !== 'cloudflare'; blocoDir.hidden = pub.value !== 'direta' }
  pub.addEventListener('change', mostrar)
  const aviso = h('div')
  const form = h('form', { class: 'cartao', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((el) => el.replaceChildren())
    const d = Object.fromEntries(new FormData(form)); d.acao = 'nova'
    try { const r = await api('POST', '/api/tarefas', d); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
    }
  } },
  h('h2', {}, 'Nova instância (acampamento)'),
  campo('nome', 'Nome do acampamento', nome),
  campo('publicacao', 'Publicação', pub), blocoCf, blocoDir,
  h('div', { class: 'linha-2' },
    campo('admin_email', 'E-mail do administrador', h('input', { id: 'admin_email', name: 'admin_email', type: 'email', required: true })),
    campo('admin_nome', 'Nome do administrador', h('input', { id: 'admin_nome', name: 'admin_nome', required: true }))),
  campo('chave', 'Chave de ativação (opcional)', h('input', { id: 'chave', name: 'chave', placeholder: 'XXX-0000', autocomplete: 'off' }), 'Se deixar vazio, o painel do acampamento pede no primeiro acesso.'),
  aviso,
  h('button', { class: 'principal', type: 'submit' }, 'Criar instância'), ' ',
  h('button', { class: 'link', type: 'button', onclick: () => { tela = 'instancias'; desenhar() } }, 'cancelar'))
  form.querySelector('#subdominio').addEventListener('input', (e) => { e.target.dataset.mexido = '1' })
  mostrar()
  area.append(form, h('p', { class: 'dica' }, 'A criação leva alguns minutos. A senha temporária do administrador aparece no andamento da tarefa — repasse por um canal seguro.'))
}

// ------------------------------------------------------------------ tarefas
async function telaTarefas(area) {
  const d = await api('GET', '/api/tarefas')
  const nomeAcao = { nova: 'Nova instância', atualizar: 'Atualizar', backup: 'Backup', 'atualizar-todas': 'Atualizar todas' }
  const linha = (t) => h('tr', { style: 'cursor:pointer', onclick: () => { tarefaAberta = t.id; desenhar() } },
    h('td', {}, dataHora(t.inicio || t.pedido_em)), h('td', {}, nomeAcao[t.acao] ?? t.acao), h('td', {}, t.alvo || t.nome || t.instancia || '—'),
    h('td', {}, h('span', { class: `selo ${t.situacao === 'concluida' ? 'ok' : t.situacao === 'erro' ? 'erro' : 'neutro'}` }, t.situacao)), h('td', {}, t.por || '—'))
  if (tarefaAberta) {
    try {
      const t = await api('GET', `/api/tarefas/${tarefaAberta}`)
      area.append(h('section', { class: 'cartao' }, h('div', { class: 'topo' }, h('h2', {}, `${nomeAcao[t.acao] ?? t.acao}: ${t.alvo || ''}`),
        h('span', { class: `selo ${t.situacao === 'concluida' ? 'ok' : t.situacao === 'erro' ? 'erro' : 'neutro'}` }, t.situacao)),
        t.mensagem && h('p', {}, t.mensagem), h('pre', { class: 'log' }, t.log || '(sem saída ainda)')))
    } catch { area.append(h('section', { class: 'cartao' }, h('p', { class: 'dica' }, 'Tarefa na fila: o servidor começa em alguns segundos…'))) }
  }
  area.append(h('section', { class: 'cartao' }, h('h2', {}, 'Tarefas'), h('div', { class: 'tabela-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Quando', 'Ação', 'Alvo', 'Situação', 'Por'].map((x) => h('th', {}, x)))),
    h('tbody', {}, [...d.pendentes, ...d.tarefas].map(linha))))))
  const andando = [...d.pendentes, ...d.tarefas].some((t) => t.situacao === 'na fila' || t.situacao === 'executando')
  if (andando) atualizador = setTimeout(desenhar, 3000)
}

// ------------------------------------------------------------------ auditoria
async function telaAuditoria(area) {
  const lista = await api('GET', '/api/auditoria')
  area.append(h('section', { class: 'cartao' }, h('h2', {}, 'Auditoria'), h('div', { class: 'tabela-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Quando', 'Quem', 'Ação', 'Detalhes'].map((x) => h('th', {}, x)))),
    h('tbody', {}, lista.map((a) => {
      const { em, quem, acao, ...resto } = a
      return h('tr', {}, h('td', {}, dataHora(em)), h('td', {}, quem), h('td', {}, acao), h('td', { class: 'dica' }, Object.entries(resto).map(([k, v]) => `${k}: ${v}`).join(' · ')))
    }))))))
}

// ------------------------------------------------------------------ montagem
async function desenhar() {
  clearTimeout(atualizador)
  if (usuario === null) {
    try { usuario = (await api('GET', '/api/eu')).email } catch { usuario = null }
    if (!usuario) return telaEntrar()
  }
  const area = h('div')
  const aba = (id, rotulo) => h('button', { class: `aba ${tela === id ? 'ativa' : ''}`, onclick: () => { tela = id; if (id !== 'tarefas') tarefaAberta = null; desenhar() } }, rotulo)
  app.replaceChildren(
    h('header', { class: 'topo' }, h('div', {}, h('h1', {}, 'Painel central'), h('small', {}, 'Acampamentos deste servidor')),
      h('div', {}, h('small', {}, usuario), ' ', h('button', { class: 'link', onclick: async () => { await api('POST', '/api/sair').catch(() => {}); usuario = null; desenhar() } }, 'Sair'))),
    h('nav', { class: 'abas' }, aba('instancias', 'Instâncias'), aba('nova', 'Nova instância'), aba('tarefas', 'Tarefas'), aba('auditoria', 'Auditoria')),
    area)
  try {
    if (tela === 'nova') telaNova(area)
    else if (tela === 'tarefas') await telaTarefas(area)
    else if (tela === 'auditoria') await telaAuditoria(area)
    else await telaInstancias(area)
  } catch (e) { if (usuario) area.append(h('div', { class: 'alerta erro' }, e.message)) }
}
desenhar()
