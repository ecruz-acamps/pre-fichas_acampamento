// Painel central — interface (sem bibliotecas). Todo texto vindo do servidor entra por textContent.
'use strict'
const app = document.getElementById('app')
let tela = 'instancias'
let usuario = null
let tarefaAberta = null
let instanciaMs = null   // instância aberta na tela "Login Microsoft"
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
  erro, h('button', { class: 'principal', type: 'submit' }, 'Entrar'),
  h('p', { class: 'dica' }, h('button', { class: 'link', type: 'button', onclick: telaEsqueci }, 'Esqueci minha senha')))
  app.replaceChildren(form)
}

// "Esqueci minha senha", direto nesta tela: e-mail + código ATUAL do autenticador + senha nova.
function telaSenhaAlterada() {
  history.replaceState(null, '', location.pathname)   // tira qualquer token da barra de endereço
  app.replaceChildren(h('div', { class: 'cartao entrar' }, h('h1', {}, 'Senha alterada'), h('p', {}, 'Você saiu de todos os aparelhos. Entre com a senha nova.'),
    h('button', { class: 'principal', type: 'button', onclick: telaEntrar }, 'Ir para o login')))
}
function telaEsqueci() {
  const aviso = h('div')
  const form = h('form', { class: 'cartao entrar', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren()
    const d = Object.fromEntries(new FormData(form))
    if (d.senha !== d.confirmacao) return aviso.append(h('div', { class: 'alerta erro' }, 'A confirmação não confere com a senha nova.'))
    try { await api('POST', '/api/redefinir-mfa', { email: d.email, codigo: d.codigo, senha: d.senha }); telaSenhaAlterada() } catch (err) { aviso.append(h('div', { class: 'alerta erro' }, err.message)) }
  } },
  h('h1', {}, 'Esqueci minha senha'),
  h('p', { class: 'dica' }, 'Informe o seu e-mail, o código ATUAL do aplicativo autenticador e a senha nova. Não precisa de e-mail nem de VPN. Depois de trocar, você sai de todos os aparelhos.'),
  h('div', { class: 'campo' }, h('label', { for: 'em' }, 'E-mail'), h('input', { id: 'em', name: 'email', type: 'email', required: true, autocomplete: 'username' })),
  h('div', { class: 'campo' }, h('label', { for: 'cc' }, 'Código do autenticador'), h('input', { id: 'cc', name: 'codigo', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: true, autocomplete: 'one-time-code' })),
  h('div', { class: 'campo' }, h('label', { for: 'n1' }, 'Senha nova (mínimo 12 caracteres)'), h('input', { id: 'n1', name: 'senha', type: 'password', required: true, minlength: '12', maxlength: '200', autocomplete: 'new-password' })),
  h('div', { class: 'campo' }, h('label', { for: 'n2' }, 'Repita a senha nova'), h('input', { id: 'n2', name: 'confirmacao', type: 'password', required: true, autocomplete: 'new-password' })),
  aviso, h('button', { class: 'principal', type: 'submit' }, 'Trocar senha'),
  h('p', { class: 'dica' }, h('button', { class: 'link', type: 'button', onclick: telaEntrar }, 'Voltar ao login'), ' · ',
    h('button', { class: 'link', type: 'button', onclick: telaEsqueciEmail }, 'Prefiro receber um link por e-mail')),
  h('p', { class: 'dica' }, 'Perdeu também o celular do autenticador? Peça a quem administra o servidor o comando novo-autenticador.'))
  app.replaceChildren(form)
}
// Alternativa: o link chega por e-mail e, para entrar com a senha nova, ainda é preciso o código do autenticador.
function telaEsqueciEmail() {
  const aviso = h('div')
  const form = h('form', { class: 'cartao entrar', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren()
    try {
      const r = await api('POST', '/api/esqueci', { email: form.querySelector('#em').value })
      aviso.append(h('div', { class: 'alerta ok' }, r.mensagem))
    } catch (err) { aviso.append(h('div', { class: 'alerta erro' }, err.message)) }
  } },
  h('h1', {}, 'Receber link por e-mail'), h('p', { class: 'dica' }, 'Informe o e-mail do seu usuário. Enviaremos um link para criar uma senha nova (você vai precisar do código do autenticador).'),
  h('div', { class: 'campo' }, h('label', { for: 'em' }, 'E-mail'), h('input', { id: 'em', type: 'email', required: true, autocomplete: 'username' })),
  aviso, h('button', { class: 'principal', type: 'submit' }, 'Enviar link'),
  h('p', { class: 'dica' }, h('button', { class: 'link', type: 'button', onclick: telaEsqueci }, 'Voltar')))
  app.replaceChildren(form)
}
function telaRedefinir(token) {
  const aviso = h('div')
  const sair = () => { history.replaceState(null, '', location.pathname); telaEntrar() }
  const form = h('form', { class: 'cartao entrar', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren()
    const d = Object.fromEntries(new FormData(form))
    if (d.senha !== d.confirmacao) return aviso.append(h('div', { class: 'alerta erro' }, 'A confirmação não confere com a senha nova.'))
    try {
      await api('POST', '/api/redefinir', { token, senha: d.senha, codigo: d.codigo })
      telaSenhaAlterada()
    } catch (err) { aviso.append(h('div', { class: 'alerta erro' }, err.message)) }
  } },
  h('h1', {}, 'Crie uma senha nova'),
  h('div', { class: 'campo' }, h('label', { for: 'n1' }, 'Senha nova (mínimo 12 caracteres)'), h('input', { id: 'n1', name: 'senha', type: 'password', required: true, minlength: '12', maxlength: '200', autocomplete: 'new-password' })),
  h('div', { class: 'campo' }, h('label', { for: 'n2' }, 'Repita a senha nova'), h('input', { id: 'n2', name: 'confirmacao', type: 'password', required: true, autocomplete: 'new-password' })),
  h('div', { class: 'campo' }, h('label', { for: 'cc' }, 'Código do autenticador'), h('input', { id: 'cc', name: 'codigo', inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: true, autocomplete: 'one-time-code' })),
  aviso, h('button', { class: 'principal', type: 'submit' }, 'Salvar senha nova'),
  h('p', { class: 'dica' }, h('button', { class: 'link', type: 'button', onclick: sair }, 'Voltar ao login')))
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
        h('div', { class: 'metrica' }, h('b', {}, dataHora(d.coletado_em)), h('span', {}, 'última leitura')),
        h('div', { class: 'metrica' }, h('b', {}, s.versao_painel || '—'), h('span', {}, 'versão do painel '),
          h('button', { class: 'link', onclick: () => pedir({ acao: 'atualizar-painel' }, 'Atualizar o painel central? Ele reinicia em alguns segundos.') }, 'atualizar')))))
  }
  const linhas = (d.instancias ?? []).map((i) => h('tr', {},
    h('td', {}, h('strong', {}, i.nome || i.pasta), h('div', { class: 'dica' }, i.pasta)),
    h('td', {}, i.url ? h('a', { href: i.url, target: '_blank', rel: 'noreferrer' }, i.url) : '—', h('div', { class: 'dica' }, PUB[i.publicacao] ?? i.publicacao ?? '—')),
    h('td', {}, h('span', { class: `selo ${i.saude === 'ok' ? 'ok' : i.saude === 'fora' ? 'erro' : 'neutro'}` }, i.saude === 'ok' ? 'no ar' : i.saude === 'fora' ? 'fora do ar' : '—')),
    h('td', {}, i.versao || '—'), h('td', {}, i.memoria || '—'), h('td', {}, String(i.porta ?? '—')),
    h('td', {}, h('span', { class: `selo ${i.microsoft?.habilitado ? 'ok' : 'neutro'}` }, i.microsoft?.habilitado ? 'ligado' : 'desligado'), ' ',
      h('button', { class: 'link', onclick: () => { instanciaMs = i; tela = 'microsoft'; desenhar() } }, 'configurar')),
    h('td', {}, h('button', { class: 'secundario', onclick: () => pedir({ acao: 'atualizar', instancia: i.pasta }, `Atualizar ${i.nome || i.pasta}? Faz backup antes.`) }, 'Atualizar'), ' ',
      h('button', { class: 'secundario', onclick: () => pedir({ acao: 'backup', instancia: i.pasta }, `Fazer backup de ${i.nome || i.pasta} agora?`) }, 'Backup'))))
  area.append(h('section', { class: 'cartao' },
    h('div', { class: 'topo' }, h('h2', {}, `Instâncias (${(d.instancias ?? []).length})`),
      h('div', {}, h('button', { class: 'secundario', onclick: () => pedir({ acao: 'atualizar-todas' }, 'Atualizar TODAS as instâncias, uma de cada vez (com backup)?') }, 'Atualizar todas'), ' ',
        h('button', { class: 'principal', onclick: () => { tela = 'nova'; desenhar() } }, '+ Nova instância'))),
    (d.instancias ?? []).length ? h('div', { class: 'tabela-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['Acampamento', 'Endereço', 'Situação', 'Versão', 'Memória', 'Porta', 'Login Microsoft', 'Ações'].map((t) => h('th', {}, t)))),
      h('tbody', {}, linhas))) : h('p', { class: 'dica' }, 'Nenhuma instância ainda (ou o servidor ainda não publicou a lista — aguarde 1 minuto).')))
}
async function pedir(pedido, confirmacao) {
  if (confirmacao && !confirm(confirmacao)) return
  try { const r = await api('POST', '/api/tarefas', pedido); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (e) { alert(e.message) }
}


// ------------------------------------------------------------------ login Microsoft de uma instância
function telaMicrosoft(area) {
  const i = instanciaMs, m = i.microsoft ?? {}
  const erros = {}
  const campo = (nome, rotulo, input, dica) => h('div', { class: 'campo' }, h('label', { for: nome }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[nome] = h('span', { class: 'erro-campo' }))
  const aviso = h('div')
  const caminho = '/api/auth/microsoft/callback'
  const form = h('form', { class: 'cartao', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((el) => el.replaceChildren())
    const d = Object.fromEntries(new FormData(form))
    const habilitar = d.habilitar === 'on'
    if (!confirm(habilitar ? `Ligar o login Microsoft em ${i.nome || i.pasta}? O sistema dele reinicia por alguns segundos.` : `Desligar o login Microsoft em ${i.nome || i.pasta}? O sistema dele reinicia por alguns segundos.`)) return
    try { const r = await api('POST', '/api/tarefas', { acao: 'microsoft', instancia: i.pasta, habilitar, tenant_id: d.tenant_id, client_id: d.client_id, segredo: d.segredo }); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
    }
  } },
  h('h2', {}, `Login com a Microsoft · ${i.nome || i.pasta}`),
  h('p', { class: 'dica' }, 'Cada acampamento é um tenant próprio: só os que você ligar aqui mostram o botão "Entrar com a Microsoft" no painel. Os demais continuam só com senha.'),
  h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'habilitar', ...(m.habilitado ? { checked: true } : {}) }), ' Usar login Microsoft neste acampamento'),
  h('ol', { class: 'dica' },
    h('li', {}, 'No Microsoft Entra: Registros de aplicativo → Novo registro ("Contas somente neste diretório organizacional").'),
    h('li', {}, 'URI de redirecionamento (Web): ', h('code', {}, i.url ? `${i.url.replace(/\/+$/, '')}${caminho}` : `https://ENDERECO-DO-ACAMPAMENTO${caminho}`)),
    h('li', {}, 'Certificados e segredos → Novo segredo de cliente: copie o VALOR (aparece uma vez).')),
  campo('tenant_id', 'ID do diretório (locatário)', h('input', { id: 'tenant_id', name: 'tenant_id', value: m.tenant_id ?? '', spellcheck: 'false', autocomplete: 'off' })),
  campo('client_id', 'ID do aplicativo (cliente)', h('input', { id: 'client_id', name: 'client_id', value: m.client_id ?? '', spellcheck: 'false', autocomplete: 'off' })),
  campo('segredo', 'Valor do segredo do aplicativo', h('input', { id: 'segredo', name: 'segredo', type: 'password', autocomplete: 'new-password', placeholder: m.segredo ? '(guardado — deixe em branco para manter)' : '' }),
    'O segredo fica só no servidor e nunca é mostrado de novo.'),
  aviso,
  h('button', { class: 'principal', type: 'submit' }, 'Salvar e reiniciar o acampamento'), ' ',
  h('button', { class: 'link', type: 'button', onclick: () => { tela = 'instancias'; desenhar() } }, 'cancelar'))
  area.append(form)
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
  // Cloudflare escolhida e sem token guardado: avisa e leva para Configurações
  api('GET', '/api/configuracoes').then((c) => {
    if (c.cloudflare?.token_configurado === false) {
      aviso.append(h('div', { class: 'alerta erro', id: 'sem-token' }, 'O token da Cloudflare ainda não foi configurado: ',
        h('button', { class: 'link', type: 'button', onclick: () => { tela = 'configuracoes'; desenhar() } }, 'cole o token na aba Configurações'), ' antes de usar a publicação pela Cloudflare.'))
      const mostrarAviso = () => { const el = aviso.querySelector('#sem-token'); if (el) el.hidden = pub.value !== 'cloudflare' }
      pub.addEventListener('change', mostrarAviso); mostrarAviso()
    }
  }).catch(() => {})
  area.append(form, h('p', { class: 'dica' }, 'A criação leva alguns minutos. A senha temporária do administrador aparece no andamento da tarefa — repasse por um canal seguro.'))
}

// ------------------------------------------------------------------ tarefas
async function telaTarefas(area) {
  const d = await api('GET', '/api/tarefas')
  const nomeAcao = { nova: 'Nova instância', atualizar: 'Atualizar', backup: 'Backup', 'atualizar-todas': 'Atualizar todas', 'atualizar-painel': 'Atualizar o painel', cloudflare: 'Token da Cloudflare', 'cloudflare-remover': 'Remover token da Cloudflare', 'tunel-unificar': 'Unificar túneis da Cloudflare', 'email': 'Servidor de e-mail', 'email-teste': 'E-mail de teste', 'email-remover': 'Remover servidor de e-mail', 'email-aplicar': 'Aplicar e-mail aos acampamentos', 'microsoft': 'Login Microsoft', 'vpn-reconectar': 'Reconectar a VPN', 'vpn-credenciais': 'Trocar credenciais da VPN' }
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

// ------------------------------------------------------------------ configurações
async function telaConfiguracoes(area) {
  const conf = await api('GET', '/api/configuracoes')
  const cfg = conf.cloudflare ?? {}
  const aviso = h('div')
  const token = h('input', { id: 'cf-token', name: 'token', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
    placeholder: cfg.token_configurado ? '•••••••• (já configurado — cole só para trocar)' : 'Cole aqui o token da API da Cloudflare' })
  const base = h('input', { id: 'cf-base', name: 'dominio_base', value: cfg.dominio_base || 'movimentocampista.com.br', maxlength: '120' })
  const erros = { token: h('span', { class: 'erro-campo' }), dominio_base: h('span', { class: 'erro-campo' }) }
  const situacao = cfg.token_configurado === true ? h('span', { class: 'selo ok' }, 'token configurado')
    : cfg.token_configurado === false ? h('span', { class: 'selo erro' }, 'token não configurado') : h('span', { class: 'selo neutro' }, 'aguardando leitura do servidor')
  const form = h('form', { class: 'cartao', autocomplete: 'off', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((x) => x.replaceChildren())
    if (!token.value.trim() && !cfg.token_configurado) { erros.token.append('Cole o token da Cloudflare.'); return }
    try {
      const r = await api('POST', '/api/tarefas', { acao: 'cloudflare', token: token.value, dominio_base: base.value })
      token.value = ''   // o token sai da tela na hora
      tarefaAberta = r.id; tela = 'tarefas'; desenhar()
    } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
    }
  } },
  h('div', { class: 'topo' }, h('h2', {}, 'Cloudflare (publicação pelo túnel)'), situacao),
  h('p', { class: 'dica' }, 'O token permite criar o endereço e o túnel de cada acampamento na Cloudflare. Ele é conferido na Cloudflare antes de ser aceito e fica guardado só no servidor (arquivo que apenas o administrador do sistema lê). Depois de salvo, não aparece mais em nenhuma tela.'),
  h('div', { class: 'campo' }, h('label', { for: 'cf-base' }, 'Domínio na Cloudflare'), base,
    h('span', { class: 'dica' }, 'Os acampamentos ficam em NOME.este-domínio.'), erros.dominio_base),
  h('div', { class: 'campo' }, h('label', { for: 'cf-token' }, 'Token da API'), token, erros.token,
    h('details', {}, h('summary', { class: 'dica' }, 'Como criar o token na Cloudflare'),
      h('ol', { class: 'dica' },
        h('li', {}, 'Entre em dash.cloudflare.com → seu perfil → Tokens de API → Criar token → Criar token personalizado.'),
        h('li', {}, 'Permissões: Conta › Cloudflare Tunnel › Editar  e  Zona › DNS › Editar.'),
        h('li', {}, 'Recursos: Conta (a sua conta) e Zona (o domínio acima).'),
        h('li', {}, 'Crie, copie o token e cole aqui. A Cloudflare só mostra o token uma vez.')))),
  aviso,
  h('button', { class: 'principal', type: 'submit' }, cfg.token_configurado ? 'Salvar e verificar' : 'Salvar token'), ' ',
  cfg.token_configurado && h('button', { class: 'secundario', type: 'button', onclick: () => {
    if (confirm('Remover o token da Cloudflare do servidor? Os acampamentos já publicados continuam no ar; só não será possível criar novos pela Cloudflare até colar um token de novo.')) pedir({ acao: 'cloudflare-remover' })
  } }, 'Remover token'))
  area.append(form, h('p', { class: 'dica' }, cfg.atualizado_em ? `Último token guardado em ${dataHora(cfg.atualizado_em)}.` : ''))
  cartaoTunel(area, conf.tunel ?? {})
  cartaoEmail(area, conf.email ?? {})
  await cartaoVpn(area)
}

// Túnel único da Cloudflare: todos os acampamentos publicados pela Cloudflare usam o mesmo túnel (um só cloudflared).
function cartaoTunel(area, t) {
  const n = (t.enderecos ?? []).length
  const selo = !t.existe ? h('span', { class: 'selo neutro' }, 'ainda não criado')
    : t.rodando ? h('span', { class: 'selo ok' }, `no ar · ${n} endereço(s)`) : h('span', { class: 'selo erro' }, 'parado')
  const partes = [h('div', { class: 'topo' }, h('h2', {}, 'Túnel único da Cloudflare'), selo),
    h('p', { class: 'dica' }, 'Todos os acampamentos publicados pela Cloudflare passam por UM só túnel desta VM (um único cloudflared). Cada acampamento novo é só um endereço a mais dentro dele; o túnel é criado sozinho no primeiro.')]
  if (n) partes.push(h('ul', { class: 'dica' }, ...(t.enderecos ?? []).map((e) => h('li', {}, e))))
  if (t.proprios > 0) {
    partes.push(h('div', { class: 'alerta erro' }, `${t.proprios} acampamento(s) ainda usam um túnel próprio (versão antiga). Unifique para usar só o túnel único e apagar os antigos.`),
      h('p', { class: 'dica' }, 'Para cada acampamento, o sistema publica no túnel único, confere que o site responde por ele e só então desliga o túnel antigo. Se não responder, o endereço volta ao túnel antigo e nada muda para o público.'),
      h('button', { class: 'principal', type: 'button', onclick: () => pedir({ acao: 'tunel-unificar' }, `Mover ${t.proprios} acampamento(s) para o túnel único? O site de cada um é conferido antes de desligar o túnel antigo.`) }, 'Unificar túneis'))
  }
  area.append(h('section', { class: 'cartao' }, ...partes))
}

// Servidor de e-mail (SMTP): usado no "Esqueci minha senha" do painel central e dos acampamentos novos.
// O servidor envia um e-mail de teste ANTES de guardar; a senha nunca volta para a tela.
function cartaoEmail(area, e) {
  const aviso = h('div')
  const erros = {}
  const campo = (id, rotulo, input, dica) => h('div', { class: 'campo' }, h('label', { for: id }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[id] = h('span', { class: 'erro-campo' }))
  const host = h('input', { id: 'host', name: 'host', value: e.host || 'smtp.gmail.com', maxlength: '120' })
  const porta = h('select', { id: 'porta', name: 'porta' },
    h('option', { value: '465' }, '465 — SSL (recomendado)'), h('option', { value: '587' }, '587 — STARTTLS'))
  porta.value = String(e.porta === 587 ? 587 : 465)
  const usuarioSmtp = h('input', { id: 'usuario', name: 'usuario', value: e.usuario || '', maxlength: '120', autocomplete: 'off', placeholder: 'voce@gmail.com' })
  const senha = h('input', { id: 'senha', name: 'senha', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
    placeholder: e.configurado ? '•••••••• (já configurada — preencha só para trocar)' : 'Senha de app do Google' })
  const remetente = h('input', { id: 'remetente', name: 'remetente', type: 'email', value: e.remetente || '', maxlength: '200', placeholder: 'igual ao usuário, se for um e-mail' })
  const aplicar = h('input', { id: 'aplicar', type: 'checkbox' })
  const selo = e.configurado ? h('span', { class: 'selo ok' }, 'configurado') : h('span', { class: 'selo erro' }, 'não configurado')
  const form = h('form', { class: 'cartao', autocomplete: 'off', onsubmit: async (ev) => {
    ev.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((x) => x.replaceChildren())
    try {
      const r = await api('POST', '/api/tarefas', { acao: 'email', host: host.value, porta: Number(porta.value), usuario: usuarioSmtp.value, senha: senha.value,
        remetente: remetente.value, aplicar: aplicar.checked })
      senha.value = ''   // a senha sai da tela na hora
      tarefaAberta = r.id; tela = 'tarefas'; desenhar()
    } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
    }
  } },
  h('div', { class: 'topo' }, h('h2', {}, 'Servidor de e-mail'), selo),
  h('p', { class: 'dica' }, 'Envia o link do "Esqueci minha senha" (deste painel e dos acampamentos) e fica guardado só no servidor, num arquivo que apenas o administrador do sistema lê. Ao salvar, o servidor manda um e-mail de teste para ',
    h('b', {}, usuario), ' e só guarda se o envio funcionar. A senha não volta para nenhuma tela.'),
  campo('host', 'Servidor (SMTP)', host), campo('porta', 'Porta', porta),
  campo('usuario', 'Usuário', usuarioSmtp, 'Normalmente é o seu e-mail completo.'),
  campo('senha', 'Senha', senha, 'No Gmail, use uma SENHA DE APP (myaccount.google.com → Segurança → Verificação em duas etapas → Senhas de app). Letras, números e . _ ~ + = : @ % ! * , ; ? / -'),
  campo('remetente', 'E-mail do remetente', remetente, 'Aparece como "de quem" nos e-mails. No Gmail, use o mesmo e-mail do usuário.'),
  h('div', { class: 'campo' }, h('label', { for: 'aplicar' }, aplicar, ' Aplicar também aos acampamentos já criados'),
    h('span', { class: 'dica' }, 'Grava este servidor de e-mail em cada acampamento existente e reinicia o sistema deles por alguns segundos. Necessário para o "Esqueci minha senha" funcionar nos acampamentos que já existem.')),
  aviso,
  h('button', { class: 'principal', type: 'submit' }, 'Salvar e testar'), ' ',
  e.configurado && h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'email-teste' }) }, 'Enviar e-mail de teste'), ' ',
  e.configurado && h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'email-aplicar' }, 'Gravar o servidor de e-mail em todos os acampamentos e reiniciar o sistema deles por alguns segundos?') }, 'Aplicar aos acampamentos'), ' ',
  e.configurado && h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'email-remover' }, 'Remover o servidor de e-mail do painel central? Os acampamentos já criados continuam com a configuração que têm.') }, 'Remover'))
  area.append(form, h('p', { class: 'dica' }, e.atualizado_em ? `Último servidor de e-mail guardado em ${dataHora(e.atualizado_em)}.` : ''))
}

// VPN do servidor: situação, reconectar e (strongSwan) troca de credenciais com retorno automático.
// A configuração inicial e o fechamento da porta 22 ficam só no terminal, de propósito.
async function cartaoVpn(area) {
  const v = await api('GET', '/api/vpn').catch(() => ({ configurada: null }))
  const selo = v.configurada === false ? h('span', { class: 'selo neutro' }, 'não configurada')
    : v.configurada === null ? h('span', { class: 'selo neutro' }, 'aguardando leitura do servidor')
      : v.conectada ? h('span', { class: 'selo ok' }, 'conectada') : h('span', { class: 'selo erro' }, 'desconectada')
  const partes = [h('div', { class: 'topo' }, h('h2', {}, 'VPN do servidor'), selo)]
  if (v.configurada === false || v.configurada === null) {
    partes.push(h('p', { class: 'dica' }, 'A VPN ainda não foi configurada neste servidor. A configuração inicial é feita pelo terminal, com o analista de segurança ao lado: '),
      h('pre', { class: 'log' }, 'sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh configurar'))
  } else {
    partes.push(h('p', { class: 'dica' }, `Cliente: ${v.tipo === 'forticlient' ? 'FortiClient' : 'strongSwan'}`
      + (v.redes?.length ? ` · redes pelo túnel: ${v.redes.join(', ')}` : '') + (v.ip_na_vpn ? ` · IP do servidor na VPN: ${v.ip_na_vpn}` : '')
      + (v.coletado_em ? ` · lido em ${dataHora(v.coletado_em)}` : '')))
    if (v.erro) partes.push(h('div', { class: 'alerta erro' }, v.erro))
    if (v.detalhe) partes.push(h('pre', { class: 'log' }, v.detalhe))
    partes.push(h('div', {}, h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'vpn-reconectar' },
      'Reconectar a VPN agora? O painel pode ficar alguns segundos sem resposta se você o acessa pela VPN.') }, 'Reconectar')))
    if (v.troca_credenciais) {
      const aviso = h('div'); const erros = { psk: h('span', { class: 'erro-campo' }), senha: h('span', { class: 'erro-campo' }) }
      const psk = h('input', { id: 'vpn-psk', type: 'password', autocomplete: 'off', placeholder: 'Nova chave pré-compartilhada (PSK) — opcional' })
      const senha = v.tem_usuario ? h('input', { id: 'vpn-senha', type: 'password', autocomplete: 'off', placeholder: 'Nova senha do usuário da VPN — opcional' }) : null
      partes.push(h('form', { autocomplete: 'off', onsubmit: async (e) => {
        e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((x) => x.replaceChildren())
        if (!confirm('Trocar as credenciais da VPN? O túnel será reiniciado. Se não subir em 90 segundos, o servidor volta sozinho para as credenciais anteriores. A página pode ficar sem resposta nesse tempo.')) return
        try { const r = await api('POST', '/api/tarefas', { acao: 'vpn-credenciais', psk: psk.value, senha: senha?.value ?? '' }); psk.value = ''; if (senha) senha.value = ''; tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
          aviso.append(h('div', { class: 'alerta erro' }, err.message)); for (const [k, m] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(m)
        }
      } }, h('h3', {}, 'Trocar chave ou senha'),
      h('p', { class: 'dica' }, 'Antes, a mudança precisa estar feita no FortiGate. Se o túnel não subir com os novos valores, o servidor volta sozinho para os anteriores (você acompanha em Tarefas).'),
      h('div', { class: 'campo' }, h('label', { for: 'vpn-psk' }, 'Chave (PSK)'), psk, erros.psk),
      senha && h('div', { class: 'campo' }, h('label', { for: 'vpn-senha' }, 'Senha do usuário'), senha, erros.senha),
      aviso, h('button', { class: 'principal', type: 'submit' }, 'Trocar e testar')))
    } else {
      partes.push(h('p', { class: 'dica' }, 'Com o FortiClient, a troca de chave ou senha ainda é feita pelo terminal: '),
        h('pre', { class: 'log' }, 'sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh configurar'))
    }
  }
  partes.push(h('p', { class: 'dica' }, 'Por segurança, a configuração inicial da VPN e o fechamento da porta 22 só podem ser feitos pelo terminal.'))
  area.append(h('section', { class: 'cartao' }, ...partes))
}

// ------------------------------------------------------------------ montagem
async function desenhar() {
  clearTimeout(atualizador)
  if (usuario === null) {
    try { usuario = (await api('GET', '/api/eu')).email } catch { usuario = null }
    if (!usuario) {
      const token = new URLSearchParams(location.search).get('redefinir')
      return token ? telaRedefinir(token) : telaEntrar()
    }
  }
  const area = h('div')
  const aba = (id, rotulo) => h('button', { class: `aba ${tela === id ? 'ativa' : ''}`, onclick: () => { tela = id; if (id !== 'tarefas') tarefaAberta = null; desenhar() } }, rotulo)
  app.replaceChildren(
    h('header', { class: 'topo' }, h('div', {}, h('h1', {}, 'Painel central'), h('small', {}, 'Acampamentos deste servidor')),
      h('div', {}, h('small', {}, usuario), ' ', h('button', { class: 'link', onclick: async () => { await api('POST', '/api/sair').catch(() => {}); usuario = null; desenhar() } }, 'Sair'))),
    h('nav', { class: 'abas' }, aba('instancias', 'Instâncias'), aba('nova', 'Nova instância'), aba('tarefas', 'Tarefas'), aba('auditoria', 'Auditoria'), aba('configuracoes', 'Configurações')),
    area)
  try {
    if (tela === 'nova') telaNova(area)
    else if (tela === 'microsoft' && instanciaMs) telaMicrosoft(area)
    else if (tela === 'tarefas') await telaTarefas(area)
    else if (tela === 'auditoria') await telaAuditoria(area)
    else if (tela === 'configuracoes') await telaConfiguracoes(area)
    else await telaInstancias(area)
  } catch (e) {
    if (usuario) area.append(h('div', { class: 'alerta erro' }, e.message + (tela === 'tarefas' ? ' — tentando de novo…' : '')))
    if (usuario && tela === 'tarefas') atualizador = setTimeout(desenhar, 5000)   // a VPN pode estar reiniciando
  }
}
desenhar()
