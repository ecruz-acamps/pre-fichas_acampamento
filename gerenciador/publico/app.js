// Painel central — interface (sem bibliotecas). Todo texto vindo do servidor entra por textContent.
'use strict'
const app = document.getElementById('app')
let tela = 'instancias'
let usuario = null
let tarefaAberta = null
let instanciaMs = null   // instância aberta na tela "Login Microsoft"
let instanciaAlvo = null // instância aberta nas telas "Trocar link" e "Apagar"
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
      h('button', { class: 'secundario', onclick: () => pedir({ acao: 'backup', instancia: i.pasta }, `Fazer backup de ${i.nome || i.pasta} agora?`) }, 'Backup'), ' ',
      ['cloudflare', 'direta'].includes(i.publicacao) && h('button', { class: 'secundario', onclick: () => { instanciaAlvo = i; tela = 'trocar-link'; desenhar() } }, 'Trocar link'), ' ',
      h('button', { class: 'perigo', onclick: () => { instanciaAlvo = i; tela = 'apagar'; desenhar() } }, 'Apagar'))))
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


// ------------------------------------------------------------------ trocar o link de acesso de uma instância
function telaTrocarLink(area) {
  const i = instanciaAlvo
  const erros = {}
  const campo = (nome, rotulo, input, dica) => h('div', { class: 'campo' }, h('label', { for: nome }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[nome] = h('span', { class: 'erro-campo' }))
  const aviso = h('div')
  const atual = i.url ? i.url.replace(/^https?:\/\//, '') : '—'
  const pub = h('select', { id: 'publicacao', name: 'publicacao' },
    h('option', { value: 'cloudflare' }, 'Cloudflare — NOME.movimentocampista.com.br (sem abrir portas)'),
    h('option', { value: 'direta' }, 'Domínio próprio — apontando para o IP da VM (HTTPS automático)'))
  pub.value = i.publicacao === 'direta' ? 'direta' : 'cloudflare'
  const blocoCf = campo('subdominio', 'Novo endereço na Cloudflare', h('div', { class: 'sufixo' }, h('input', { id: 'subdominio', name: 'subdominio', maxlength: '63' }), h('span', {}, '.movimentocampista.com.br')))
  const blocoDir = campo('dominio', 'Novo domínio', h('input', { id: 'dominio', name: 'dominio', placeholder: 'prefichas.seuacampamento.com.br' }), 'Crie antes um registro A apontando para o IP público da VM.')
  const mostrar = () => { blocoCf.hidden = pub.value !== 'cloudflare'; blocoDir.hidden = pub.value !== 'direta' }
  pub.addEventListener('change', mostrar)
  const form = h('form', { class: 'cartao', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((el) => el.replaceChildren())
    const d = Object.fromEntries(new FormData(form))
    if (!confirm(`Trocar o link de ${i.nome || i.pasta}?\n\nO endereço novo é publicado e conferido antes de o antigo sair. Se não responder, nada muda. Depois, os links antigos (${atual}) deixam de funcionar.`)) return
    try { const r = await api('POST', '/api/tarefas', { acao: 'trocar-link', instancia: i.pasta, publicacao: d.publicacao, subdominio: d.subdominio, dominio: d.dominio }); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
    }
  } },
  h('h2', {}, `Trocar o link de acesso · ${i.nome || i.pasta}`),
  h('p', {}, 'Endereço atual: ', h('strong', {}, atual)),
  h('p', { class: 'dica' }, 'O sistema, o banco e os usuários continuam os mesmos: só muda o endereço. Quem usa o login Microsoft precisará trocar o URI de redirecionamento no Entra.'),
  campo('publicacao', 'Como publicar', pub), blocoCf, blocoDir,
  aviso,
  h('button', { class: 'principal', type: 'submit' }, 'Trocar o link'), ' ',
  h('button', { class: 'link', type: 'button', onclick: () => { tela = 'instancias'; desenhar() } }, 'cancelar'))
  mostrar()
  area.append(form)
}

// ------------------------------------------------------------------ apagar uma instância
function telaApagar(area) {
  const i = instanciaAlvo
  const aviso = h('div'), erroConf = h('span', { class: 'erro-campo' })
  const sem = h('input', { type: 'checkbox', id: 'sem-backup' })
  const conf = h('input', { id: 'confirmar', autocomplete: 'off', spellcheck: 'false', placeholder: i.pasta })
  const form = h('form', { class: 'cartao', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); erroConf.replaceChildren()
    if (!confirm(`APAGAR ${i.nome || i.pasta}? O banco de dados dele sai do servidor${sem.checked ? ' SEM backup' : ' (com backup antes)'}. Isso não pode ser desfeito pelo painel.`)) return
    try { const r = await api('POST', '/api/tarefas', { acao: 'apagar', instancia: i.pasta, confirmar: conf.value.trim(), sem_backup: sem.checked }); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
      aviso.append(h('div', { class: 'alerta erro' }, err.message))
      if (err.dados?.erros?.confirmar) erroConf.append(err.dados.erros.confirmar)
    }
  } },
  h('h2', {}, `Apagar a instância · ${i.nome || i.pasta}`),
  h('div', { class: 'alerta erro' }, 'Atenção: apaga o sistema deste acampamento no servidor, com todas as inscrições.'),
  h('ul', { class: 'dica' },
    h('li', {}, 'Antes de apagar, é feito um backup do banco, guardado em /var/backups/prefichas-apagados/ (dá para restaurar depois).'),
    h('li', {}, 'O endereço é tirado do ar (túnel da Cloudflare ou proxy) e os containers e dados são removidos.'),
    h('li', {}, 'A pasta (código e configurações) vai para uma lixeira por 30 dias.')),
  h('div', { class: 'campo' }, h('label', { for: 'confirmar' }, `Para confirmar, digite o nome da pasta: ${i.pasta}`), conf, erroConf),
  h('label', { class: 'check' }, sem, ' Apagar mesmo sem backup (só se o sistema está quebrado e o backup não funciona)'),
  aviso,
  h('button', { class: 'perigo', type: 'submit' }, 'Apagar esta instância'), ' ',
  h('button', { class: 'link', type: 'button', onclick: () => { tela = 'instancias'; desenhar() } }, 'cancelar'))
  area.append(form)
}


// ------------------------------------------------------------------ campo de formulário com erro
function campoF(erros, nome, rotulo, input, dica) {
  return h('div', { class: 'campo' }, h('label', { for: nome }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[nome] = h('span', { class: 'erro-campo' }))
}
async function enviarForm(corpo, aviso, erros, confirmacao) {
  aviso.replaceChildren(); Object.values(erros).forEach((x) => x.replaceChildren())
  if (confirmacao && !confirm(confirmacao)) return
  try { const r = await api('POST', '/api/tarefas', corpo); tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
    aviso.append(h('div', { class: 'alerta erro' }, err.message))
    for (const [k, v] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(v)
  }
}
const tamanho = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil((b ?? 0) / 1024)} KB`)

// ------------------------------------------------------------------ backups na nuvem (OneDrive), por acampamento
async function telaBackups(area) {
  const [conf, inst, lista, codigo, chave] = await Promise.all([api('GET', '/api/configuracoes'), api('GET', '/api/instancias'), api('GET', '/api/backups'),
    api('GET', '/api/nuvem-codigo').catch(() => ({})), api('GET', '/api/backup-chave').catch(() => ({}))])
  const b = conf.backup ?? {}
  const nomeDe = Object.fromEntries((inst.instancias ?? []).map((i) => [i.pasta, i.nome || i.pasta]))

  if (chave.chave) {
    area.append(h('section', { class: 'cartao' }, h('h2', {}, 'Chave de recuperação — guarde agora'),
      h('div', { class: 'alerta erro' }, 'Esta chave aparece só agora (some em 30 minutos). Sem ela, NENHUM backup pode ser aberto. Guarde em um cofre de senhas ou imprima e guarde fora do servidor.'),
      h('pre', { class: 'chave' }, chave.chave),
      h('button', { class: 'secundario', type: 'button', onclick: () => navigator.clipboard?.writeText(chave.chave) }, 'Copiar'), ' ',
      h('button', { class: 'principal', type: 'button', onclick: () => pedir({ acao: 'backup-chave-guardada' }, 'Confirma que guardou a chave em lugar seguro? Ela não será mostrada de novo.') }, 'Já guardei a chave')))
  }
  if (codigo.codigo && Date.parse(codigo.expira) > Date.now()) {
    area.append(h('section', { class: 'cartao' }, h('h2', {}, 'Conectar o OneDrive'),
      h('p', {}, 'Abra ', h('a', { href: codigo.url, target: '_blank', rel: 'noreferrer' }, codigo.url), ', entre com a conta Microsoft que vai guardar os backups e digite o código:'),
      h('pre', { class: 'chave' }, codigo.codigo), h('p', { class: 'dica' }, `Vale até ${dataHora(codigo.expira)}. Depois de entrar, acompanhe em Tarefas.`)))
  }

  // ---- situação e configuração
  const erros = {}; const aviso = h('div')
  const lig = h('input', { type: 'checkbox', id: 'bk-ligado', ...(b.ligado ? { checked: true } : {}) })
  const horaI = h('input', { id: 'hora', type: 'time', value: b.hora || '02:30' })
  const tenant = h('input', { id: 'tenant_id', value: b.tenant_id || '', spellcheck: 'false', autocomplete: 'off' })
  const cliente = h('input', { id: 'client_id', value: b.client_id || '', spellcheck: 'false', autocomplete: 'off' })
  const md = h('input', { id: 'manter_diarios', type: 'number', min: '3', max: '90', value: String(b.manter_diarios ?? 14) })
  const mm = h('input', { id: 'manter_mensais', type: 'number', min: '0', max: '24', value: String(b.manter_mensais ?? 6) })
  const ult = b.ultimo ? `${dataHora(b.ultimo.em)} · ${b.ultimo.instancias} acampamento(s)${b.ultimo.falhas ? ` · ${b.ultimo.falhas} falha(s)` : ' · ok'}` : 'nenhum ainda'
  area.append(h('section', { class: 'cartao' },
    h('h2', {}, 'Backup diário na nuvem (OneDrive)'),
    h('p', { class: 'dica' }, 'Um backup por acampamento, todo dia, cifrado antes de sair do servidor, na pasta PreFichas-Backups do OneDrive (uma subpasta por acampamento). Os administradores dos acampamentos não veem nada disso.'),
    h('div', { class: 'grade-servidor' },
      h('div', { class: 'metrica' }, h('b', {}, b.conectado ? 'conectado' : 'não conectado'), h('span', {}, b.conta || 'OneDrive')),
      h('div', { class: 'metrica' }, h('b', {}, b.chave_definida ? 'definida' : 'não gerada'), h('span', {}, 'chave de recuperação')),
      h('div', { class: 'metrica' }, h('b', {}, b.ligado ? `todo dia às ${b.hora}` : 'desligado'), h('span', {}, 'backup automático')),
      h('div', { class: 'metrica' }, h('b', {}, ult), h('span', {}, 'último backup'))),
    h('ol', { class: 'dica' },
      h('li', {}, 'No Microsoft Entra: Registos de aplicações → Novo registo "Pré-fichas Backup" (só esta organização). Em Autenticação, ative "Permitir fluxos de cliente público". Em Permissões de API, Microsoft Graph → delegadas: Files.ReadWrite e offline_access.'),
      h('li', {}, 'Cole abaixo o ID do diretório e o ID do aplicativo e salve.'),
      h('li', {}, 'Clique em "Conectar o OneDrive" e entre com a conta que vai guardar os backups.'),
      h('li', {}, 'Clique em "Gerar chave de recuperação" e guarde a chave fora do servidor.'),
      h('li', {}, 'Ligue o backup diário.')),
    h('form', { onsubmit: (e) => { e.preventDefault(); enviarForm({ acao: 'backup-config', ligado: lig.checked, hora: horaI.value, tenant_id: tenant.value.trim(), client_id: cliente.value.trim(), manter_diarios: Number(md.value), manter_mensais: Number(mm.value) }, aviso, erros) } },
      h('div', { class: 'linha-2' }, campoF(erros, 'tenant_id', 'ID do diretório (locatário)', tenant), campoF(erros, 'client_id', 'ID do aplicativo (cliente)', cliente)),
      h('div', { class: 'linha-2' }, campoF(erros, 'hora', 'Horário do backup', horaI), campoF(erros, 'manter_diarios', 'Manter backups diários (dias)', md), campoF(erros, 'manter_mensais', 'E 1 por mês, por (meses)', mm)),
      h('label', { class: 'check' }, lig, ' Fazer o backup automaticamente todo dia'),
      aviso, h('button', { class: 'principal', type: 'submit' }, 'Salvar')),
    h('p', {},
      h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'backup-conectar' }) }, b.conectado ? 'Reconectar o OneDrive' : 'Conectar o OneDrive'), ' ',
      h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'backup-chave-gerar', substituir: !!b.chave_definida },
        b.chave_definida ? 'Gerar uma chave NOVA? Os backups antigos continuam abrindo só com a chave antiga; os novos só com a nova.' : null) }, b.chave_definida ? 'Trocar a chave de recuperação' : 'Gerar chave de recuperação'), ' ',
      h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'backup-nuvem' }, 'Fazer agora o backup de TODOS os acampamentos?') }, 'Fazer backup de todos agora'), ' ',
      b.conectado && h('button', { class: 'link', type: 'button', onclick: () => pedir({ acao: 'backup-desconectar' }, 'Desconectar o OneDrive e desligar o backup diário?') }, 'desconectar'))))

  // ---- backups existentes, por acampamento
  const porInst = lista.acampamentos ?? {}
  const linhas = Object.keys({ ...porInst, ...nomeDe }).sort().map((pasta) => {
    const arqs = porInst[pasta] ?? []
    return h('div', { class: 'cartao' },
      h('div', { class: 'topo' }, h('h3', {}, nomeDe[pasta] ?? `${pasta} (sem instância nesta VM)`),
        nomeDe[pasta] && h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'backup-nuvem', instancia: pasta }, `Fazer agora o backup de ${nomeDe[pasta]}?`) }, 'Backup agora')),
      arqs.length ? h('div', { class: 'tabela-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Backup', 'Tamanho', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, arqs.map((a) => h('tr', {},
          h('td', {}, a.name.replace(/^.*__(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2}).*$/, '$3/$2/$1 $4:$5')),
          h('td', {}, tamanho(a.size)),
          h('td', {}, h('button', { class: 'link', type: 'button', onclick: () => { restaurarAlvo = { pasta, nome: nomeDe[pasta], arquivo: a }; tela = 'restaurar'; desenhar() } }, 'Restaurar…'))))))) : h('p', { class: 'dica' }, 'Nenhum backup no OneDrive ainda.'))
  })
  area.append(h('section', {}, h('div', { class: 'topo' }, h('h2', {}, 'Backups no OneDrive'),
    h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'backup-listar' }) }, 'Atualizar lista')),
    h('p', { class: 'dica' }, lista.lido_em ? `Lista lida em ${dataHora(lista.lido_em)}.` : 'Clique em "Atualizar lista" para ler o OneDrive.'), ...linhas))
}
let restaurarAlvo = null
function telaRestaurar(area) {
  const r = restaurarAlvo; const erros = {}; const aviso = h('div')
  const chave = h('textarea', { id: 'chave', rows: '2', spellcheck: 'false', autocomplete: 'off', placeholder: 'AGE-SECRET-KEY-1…' })
  const conf = h('input', { id: 'confirmar', autocomplete: 'off', spellcheck: 'false', placeholder: r.pasta })
  area.append(h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); enviarForm({ acao: 'backup-restaurar', instancia: r.pasta, arquivo: r.arquivo.id, nome: r.arquivo.name, chave: chave.value.trim(), confirmar: conf.value.trim() }, aviso, erros,
    `RESTAURAR ${r.nome ?? r.pasta}? O banco atual será substituído pelo backup de ${r.arquivo.name.replace(/^.*__(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2}).*$/, '$3/$2/$1 $4:$5')}. Antes, é feito um backup de segurança local do banco atual.`) } },
    h('h2', {}, `Restaurar · ${r.nome ?? r.pasta}`),
    h('p', {}, 'Backup: ', h('strong', {}, r.arquivo.name), ` (${tamanho(r.arquivo.size)})`),
    !r.nome && h('div', { class: 'alerta erro' }, 'Esta instância não existe nesta VM. Crie primeiro uma instância com o mesmo nome (Nova instância) e depois restaure nela.'),
    h('ul', { class: 'dica' }, h('li', {}, 'O sistema do acampamento fica parado por alguns instantes.'), h('li', {}, 'Antes de restaurar é feito um backup de segurança local do banco atual (na pasta backups da instância).'), h('li', {}, 'Se der qualquer erro, nada é alterado.')),
    campoF(erros, 'chave', 'Chave de recuperação (só é usada agora; não fica guardada)', chave),
    campoF(erros, 'confirmar', `Para confirmar, digite o nome da pasta: ${r.pasta}`, conf),
    erros.arquivo = h('span', { class: 'erro-campo' }), erros.instancia = h('span', { class: 'erro-campo' }),
    aviso, h('button', { class: 'perigo', type: 'submit', ...(r.nome ? {} : { disabled: true }) }, 'Restaurar este backup'), ' ',
    h('button', { class: 'link', type: 'button', onclick: () => { tela = 'backups'; desenhar() } }, 'cancelar')))
}

// ------------------------------------------------------------------ mensagens de aniversário (SMS pelo textbee.dev)
async function telaMensagens(area) {
  const [conf, previa, hist] = await Promise.all([api('GET', '/api/configuracoes'), api('GET', '/api/sms-previa').catch(() => ({})), api('GET', '/api/sms-historico').catch(() => ({}))])
  const m = conf.sms ?? {}
  const erros = {}; const aviso = h('div')
  const lig = h('input', { type: 'checkbox', id: 'sms-ligado', ...(m.ligado ? { checked: true } : {}) })
  const sair = h('input', { type: 'checkbox', id: 'sms-sair', ...(m.rodape_sair !== false ? { checked: true } : {}) })
  const horaI = h('input', { id: 'hora', type: 'time', value: m.hora || '09:00' })
  const lim = h('input', { id: 'limite_dia', type: 'number', min: '1', max: '10000', value: String(m.limite_dia ?? 200) })
  const token = h('input', { id: 'token', type: 'password', autocomplete: 'off', placeholder: m.token_configurado ? '•••••••• (configurada — cole só para trocar)' : 'chave da API do textbee' })
  const dev = h('input', { id: 'device_id', value: m.device_id || '', spellcheck: 'false', placeholder: '(opcional: usa o aparelho padrão)' })
  const teste = h('input', { id: 'telefone_teste', value: m.telefone_teste || '', placeholder: '(48) 99999-0000' })
  const ma = h('textarea', { id: 'modelo_aniversario', rows: '3', maxlength: '480', placeholder: 'Olá, {nome}! Hoje é o seu aniversário. Que Deus abençoe a sua vida e Nossa Senhora interceda por você. Parabéns! {comunidade}' })
  ma.value = m.modelo_aniversario || ''
  const mc = h('textarea', { id: 'modelo_acampamento', rows: '3', maxlength: '480', placeholder: 'Olá, {nome}! Hoje faz {anos} ano(s) que você viveu o {acampamento}. Que o fogo do Espírito Santo continue aceso em você! Deus te abençoe. {comunidade}' })
  mc.value = m.modelo_acampamento || ''
  area.append(h('section', { class: 'cartao' },
    h('h2', {}, 'Mensagens de aniversário (SMS)'),
    h('p', { class: 'dica' }, 'Todo dia, no horário escolhido, o painel lê os bancos de TODOS os acampamentos e envia pelo textbee.dev: parabéns no aniversário e no aniversário de acampamento (quem participou). Só campistas recebem. A mesma pessoa em mais de um acampamento recebe uma vez. Quem responder SAIR deixa de receber.'),
    h('div', { class: 'grade-servidor' },
      h('div', { class: 'metrica' }, h('b', {}, m.ligado ? `todo dia às ${m.hora}` : 'desligado'), h('span', {}, 'envio automático')),
      h('div', { class: 'metrica' }, h('b', {}, m.token_configurado ? 'configurada' : 'não configurada'), h('span', {}, 'chave do textbee')),
      h('div', { class: 'metrica' }, h('b', {}, String(m.bloqueados ?? 0)), h('span', {}, 'pediram para não receber')),
      h('div', { class: 'metrica' }, h('b', {}, m.ultimo_dia || '—'), h('span', {}, 'último envio'))),
    h('form', { onsubmit: (e) => { e.preventDefault(); enviarForm({ acao: 'sms-config', ligado: lig.checked, hora: horaI.value, limite_dia: Number(lim.value), token: token.value.trim(), device_id: dev.value.trim(),
      telefone_teste: teste.value.trim(), modelo_aniversario: ma.value.trim(), modelo_acampamento: mc.value.trim(), rodape_sair: sair.checked }, aviso, erros) } },
      h('div', { class: 'linha-2' }, campoF(erros, 'token', 'Chave da API do textbee', token, 'Em app.textbee.dev → API Keys. Fica só no servidor.'), campoF(erros, 'device_id', 'ID do aparelho', dev)),
      campoF(erros, 'modelo_aniversario', 'Mensagem de aniversário', ma, 'Use {nome} (primeiro nome) e {comunidade} (nome do acampamento). Em branco = mensagem padrão (exemplo acima).'),
      campoF(erros, 'modelo_acampamento', 'Mensagem de aniversário de acampamento', mc, 'Use {nome}, {anos}, {acampamento} (ex.: 16º Sênior) e {comunidade}.'),
      h('div', { class: 'linha-2' }, campoF(erros, 'hora', 'Horário do envio', horaI), campoF(erros, 'limite_dia', 'Máximo de mensagens por dia', lim, 'O plano gratuito do textbee permite 50/dia e 300/mês.'), campoF(erros, 'telefone_teste', 'Telefone para teste', teste)),
      h('label', { class: 'check' }, sair, ' Terminar cada mensagem com "Para não receber, responda SAIR." (recomendado — LGPD)'),
      h('label', { class: 'check' }, lig, ' Enviar automaticamente todo dia'),
      aviso, h('button', { class: 'principal', type: 'submit' }, 'Salvar')),
    h('p', {},
      h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'sms-enviar', previa: true }) }, 'Ver prévia de hoje (não envia)'), ' ',
      h('button', { class: 'secundario', type: 'button', onclick: () => { const t = teste.value.trim() || prompt('Telefone para o teste (com DDD):'); if (t) pedir({ acao: 'sms-teste', telefone: t }) } }, 'Enviar mensagem de teste'), ' ',
      h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'sms-enviar' }, 'Enviar AGORA as mensagens de hoje? Quem já recebeu hoje não recebe de novo.') }, 'Enviar as de hoje agora'), ' ',
      h('button', { class: 'link', type: 'button', onclick: () => { const t = prompt('Telefone que NÃO deve mais receber (com DDD):'); if (t) pedir({ acao: 'sms-bloqueio', telefone: t, bloquear: true }) } }, 'bloquear um telefone'), ' ',
      h('button', { class: 'link', type: 'button', onclick: () => { const t = prompt('Telefone que volta a receber (com DDD):'); if (t) pedir({ acao: 'sms-bloqueio', telefone: t, bloquear: false }) } }, 'desbloquear'))))

  const tabela = (itens, colunas) => h('div', { class: 'tabela-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...colunas.map(([t]) => h('th', {}, t)))),
    h('tbody', {}, itens.map((x) => h('tr', {}, ...colunas.map(([, f]) => h('td', {}, f(x))))))))
  const tipo = (t) => (t === 'aniversario' ? 'Aniversário' : 'Acampamento')
  if (previa.mensagens) {
    area.append(h('section', { class: 'cartao' }, h('h2', {}, `Prévia de ${previa.dia} (${previa.mensagens.length})`), h('p', { class: 'dica' }, `Gerada em ${dataHora(previa.gerada_em)}. Nada foi enviado.`),
      previa.mensagens.length ? tabela(previa.mensagens, [['Tipo', (x) => tipo(x.tipo)], ['Acampamento', (x) => x.instancia], ['Nome', (x) => x.nome], ['Telefone', (x) => x.telefone], ['Mensagem', (x) => x.mensagem]]) : h('p', { class: 'dica' }, 'Ninguém para hoje.')))
  }
  const env = hist.mensagens ?? []
  area.append(h('section', { class: 'cartao' }, h('h2', {}, `Enviadas hoje (${env.filter((x) => x.ok).length})`),
    env.length ? tabela(env.slice().reverse(), [['Hora', (x) => x.hora], ['Tipo', (x) => tipo(x.tipo)], ['Acampamento', (x) => x.instancia], ['Nome', (x) => x.nome ?? ''], ['Telefone', (x) => x.telefone], ['Situação', (x) => (x.ok ? 'enviada ao textbee' : `falhou: ${x.erro ?? ''}`)]]) : h('p', { class: 'dica' }, 'Nenhuma mensagem enviada hoje.')))
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
  const nomeAcao = { nova: 'Nova instância', atualizar: 'Atualizar', backup: 'Backup', 'atualizar-todas': 'Atualizar todas', 'atualizar-painel': 'Atualizar o painel', cloudflare: 'Token da Cloudflare', 'cloudflare-remover': 'Remover token da Cloudflare', 'tunel-unificar': 'Unificar túneis da Cloudflare', 'tunel-religar': 'Religar o túnel da Cloudflare', 'email': 'Servidor de e-mail', 'email-teste': 'E-mail de teste', 'email-remover': 'Remover servidor de e-mail', 'email-aplicar': 'Aplicar e-mail aos acampamentos', 'microsoft': 'Login Microsoft', 'apagar': 'Apagar instância', 'trocar-link': 'Trocar link de acesso', 'backup-config': 'Configurar backup na nuvem', 'backup-conectar': 'Conectar o OneDrive', 'backup-desconectar': 'Desconectar o OneDrive', 'backup-chave-gerar': 'Gerar chave de recuperação', 'backup-chave-guardada': 'Chave de recuperação guardada', 'backup-nuvem': 'Backup na nuvem', 'backup-listar': 'Ler backups do OneDrive', 'backup-restaurar': 'Restaurar backup', 'sms-config': 'Configurar mensagens', 'sms-enviar': 'Mensagens de aniversário', 'sms-teste': 'Mensagem de teste', 'sms-bloqueio': 'Lista de não receber', 'vpn-reconectar': 'Reconectar a VPN', 'vpn-config': 'Configurar a VPN (FortiClient)', 'vpn-senha': 'Trocar a senha da VPN', 'vpn-ssl': 'Configurar e conectar a VPN', 'vpn-desligar': 'Desligar a VPN', 'ssh-abrir': 'Liberar o SSH' }
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
  if (t.existe && !t.rodando) {
    partes.push(h('div', { class: 'alerta erro' }, 'O cloudflared do túnel único não está rodando: os acampamentos publicados pela Cloudflare estão fora do ar.'),
      h('button', { class: 'principal', type: 'button', onclick: () => pedir({ acao: 'tunel-religar' }, 'Religar o túnel único? Usa o mesmo túnel e os mesmos endereços (nada é duplicado).') }, 'Religar o túnel'))
  }
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

// VPN do servidor (FortiClient): configuração, situação e reconexão. A senha e a chave (PSK) ficam só no FortiClient.
// Formulário completo da VPN (SSL-VPN): instala o FortiClient se faltar, cria o perfil, conecta e liga a reconexão.
function formVpnSsl(v) {
  const aviso = h('div'), erros = {}
  const campo = (k, rotulo, input, dica) => h('div', { class: 'campo' }, h('label', { for: `vpn-ssl-${k}` }, rotulo), input, dica && h('span', { class: 'dica' }, dica), erros[k] = h('span', { class: 'erro-campo' }))
  const gateway = h('input', { id: 'vpn-ssl-gateway', value: v.gateway || '', placeholder: 'vpn.empresa.com.br', maxlength: '253', spellcheck: 'false', autocomplete: 'off' })
  const porta = h('input', { id: 'vpn-ssl-porta', type: 'number', min: '1', max: '65535', value: v.porta || '443' })
  const usuario = h('input', { id: 'vpn-ssl-usuario', value: v.usuario || '', maxlength: '128', spellcheck: 'false', autocomplete: 'off' })
  const senha = h('input', { id: 'vpn-ssl-senha', type: 'password', maxlength: '128', autocomplete: 'new-password' })
  const redes = h('input', { id: 'vpn-ssl-redes', value: (v.redes ?? []).join(', '), placeholder: '192.168.1.0/24, 192.168.50.0/24', spellcheck: 'false', autocomplete: 'off' })
  return h('form', { autocomplete: 'off', onsubmit: async (e) => {
    e.preventDefault(); aviso.replaceChildren(); Object.values(erros).forEach((x) => x.replaceChildren())
    if (!confirm('Configurar e conectar a VPN agora? Se o FortiGate mandar todo o tráfego pela VPN (split tunnel desligado), o servidor desconecta sozinho para o site e o SSH não caírem.')) return
    try {
      const r = await api('POST', '/api/tarefas', { acao: 'vpn-ssl', perfil: v.perfil || 'prefichas', gateway: gateway.value.trim(), porta: Number(porta.value), usuario: usuario.value.trim(), senha: senha.value, redes: redes.value })
      senha.value = ''; tarefaAberta = r.id; tela = 'tarefas'; desenhar()
    } catch (err) { senha.value = ''; aviso.append(h('div', { class: 'alerta erro' }, err.message)); for (const [k, m] of Object.entries(err.dados?.erros ?? {})) erros[k]?.append(m) }
  } }, h('h3', {}, v.configurada ? 'Alterar a configuração (SSL-VPN)' : 'Configurar a VPN (SSL-VPN)'),
  h('p', { class: 'dica' }, 'Instala o FortiClient VPN (se faltar), cria o perfil SSL-VPN, conecta e liga a reconexão automática. A senha vai direto para o FortiClient e nunca aparece em tela, tarefa ou log. No FortiGate: SSL-VPN em modo túnel com split tunnel (só as redes internas) e usuário sem FortiToken.'),
  h('div', { class: 'linha-2' }, campo('gateway', 'Gateway (FortiGate)', gateway), campo('porta', 'Porta do SSL-VPN', porta)),
  h('div', { class: 'linha-2' }, campo('usuario', 'Usuário da VPN', usuario), campo('senha', 'Senha da VPN', senha)),
  campo('redes', 'Redes internas pela VPN', redes, 'As mesmas do split tunnel do FortiGate. Separe por vírgula. Nunca 0.0.0.0/0.'),
  aviso, h('button', { class: 'principal', type: 'submit' }, 'Configurar e conectar'))
}
async function cartaoVpn(area) {
  const v = await api('GET', '/api/vpn').catch(() => ({ configurada: null }))
  const selo = v.configurada === null ? h('span', { class: 'selo neutro' }, 'aguardando leitura do servidor')
    : !v.instalado ? h('span', { class: 'selo neutro' }, 'FortiClient não instalado')
      : !v.configurada ? h('span', { class: 'selo neutro' }, 'não configurada')
        : v.conectada ? h('span', { class: 'selo ok' }, 'conectada') : h('span', { class: 'selo erro' }, 'desconectada')
  const partes = [h('div', { class: 'topo' }, h('h2', {}, 'VPN do servidor (FortiClient)'), selo)]
  if (v.configurada === null) { area.append(h('section', { class: 'cartao' }, ...partes)); return }
  if (!v.instalado) {
    partes.push(h('p', { class: 'dica' }, 'O FortiClient ainda não está instalado: preencha abaixo e o painel instala, configura e conecta.'), formVpnSsl(v))
    area.append(h('section', { class: 'cartao' }, ...partes)); return
  }
  // ---- configuração atual (sem segredos)
  const linha = (rotulo, valor) => h('tr', {}, h('th', {}, rotulo), h('td', {}, valor || '—'))
  partes.push(h('div', { class: 'tabela-wrap' }, h('table', { class: 'tabela-vpn' }, h('tbody', {},
    linha('Cliente', `FortiClient${v.versao ? ` ${v.versao}` : ''}`),
    linha('Perfil', v.configurada ? v.perfil : 'não registrado no painel'),
    linha('Gateway', v.gateway ? `${v.gateway}:${v.porta || '443'}` : ''),
    linha('Usuário', v.configurada ? (v.usuario || 'sem usuário (só chave)') : ''),
    linha('Redes internas pela VPN', (v.redes ?? []).join(', ')),
    linha('IP do servidor na VPN', v.ip_na_vpn || (v.conectada ? 'não identificado' : 'túnel fora do ar')),
    linha('Reconexão automática (a cada 2 min)', v.vigia ? 'ligada' : 'desligada'),
    linha('Lido em', v.coletado_em ? dataHora(v.coletado_em) : '')))))
  if (v.versao && v.versao_ok === false) partes.push(h('div', { class: 'alerta erro' }, `O FortiClient instalado (${v.versao}) não é da linha ${v.linha_esperada}, a mesma do FortiOS 7.4.x do FortiGate. Confira pelo terminal: sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh configurar`))
  if (v.edicao_ems) partes.push(h('div', { class: 'alerta erro' }, 'O FortiClient instalado é a edição completa, que se registra num EMS e, sem EMS, recusa a VPN ("VPN is disabled while registered to EMS"). Troque pela edição gratuita só de VPN pelo terminal: sudo /opt/prefichas-gerenciador/scripts/vpn-fortinet.sh configurar'))
  if (v.erro) partes.push(h('div', { class: 'alerta erro' }, v.erro))
  if (v.detalhe) partes.push(h('details', {}, h('summary', {}, 'Situação informada pelo FortiClient'), h('pre', { class: 'log' }, v.detalhe)))
  if (v.perfis) partes.push(h('details', {}, h('summary', {}, 'Perfis existentes no FortiClient'), h('pre', { class: 'log' }, v.perfis)))
  if (v.configurada) partes.push(h('div', {}, h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'vpn-reconectar' },
    'Reconectar a VPN agora? O painel pode ficar alguns segundos sem resposta se você o acessa pela VPN.') }, 'Reconectar'),
    ' ', h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'vpn-desligar' }, 'Desligar a VPN e a reconexão automática? Use se o servidor ficou sem SSH ou sem internet depois de conectar.') }, 'Desligar a VPN')))
  partes.push(h('div', {}, h('button', { class: 'secundario', type: 'button', onclick: () => pedir({ acao: 'ssh-abrir' }, 'Liberar a porta 22 (SSH) no firewall do servidor para qualquer origem? Use só para recuperar o acesso.') }, 'Emergência: liberar o SSH')))

  partes.push(formVpnSsl(v))

  // ---- trocar a senha do usuário da VPN (vai direto para o chaveiro do FortiClient; nunca volta para a tela)
  if (v.configurada && v.usuario) {
    const avisoS = h('div'), erroS = h('span', { class: 'erro-campo' })
    const senha = h('input', { id: 'vpn-senha', type: 'password', maxlength: '128', autocomplete: 'new-password', spellcheck: 'false' })
    partes.push(h('form', { autocomplete: 'off', onsubmit: async (e) => {
      e.preventDefault(); avisoS.replaceChildren(); erroS.replaceChildren()
      if (!senha.value) { erroS.append('Informe a senha.'); return }
      if (!confirm(`Gravar a nova senha do usuário ${v.usuario} e reconectar a VPN? Se você acessa o painel pela VPN, ele pode ficar alguns segundos sem resposta.`)) return
      try { const r = await api('POST', '/api/tarefas', { acao: 'vpn-senha', senha: senha.value }); senha.value = ''; tarefaAberta = r.id; tela = 'tarefas'; desenhar() } catch (err) {
        senha.value = ''; avisoS.append(h('div', { class: 'alerta erro' }, err.message)); if (err.dados?.erros?.senha) erroS.append(err.dados.erros.senha)
      }
    } }, h('h3', {}, 'Senha da VPN'),
    h('p', { class: 'dica' }, `Grava a senha do usuário ${v.usuario} no FortiClient (fica salva para a reconexão automática) e reconecta. Use quando a senha for trocada ou expirar. O usuário do servidor não pode ter FortiToken/MFA.`),
    h('div', { class: 'campo' }, h('label', { for: 'vpn-senha' }, 'Nova senha'), senha, erroS),
    avisoS, h('button', { class: 'principal', type: 'submit' }, 'Salvar senha e conectar')))
  }
  partes.push(h('p', { class: 'dica' }, 'Por segurança, a instalação do FortiClient, a criação do perfil e o fechamento da porta 22 continuam só pelo terminal.'))
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
    h('nav', { class: 'abas' }, aba('instancias', 'Instâncias'), aba('nova', 'Nova instância'), aba('tarefas', 'Tarefas'), aba('auditoria', 'Auditoria'), aba('backups', 'Backups'), aba('mensagens', 'Mensagens'), aba('configuracoes', 'Configurações')),
    area)
  try {
    if (tela === 'nova') telaNova(area)
    else if (tela === 'microsoft' && instanciaMs) telaMicrosoft(area)
    else if (tela === 'trocar-link' && instanciaAlvo) telaTrocarLink(area)
    else if (tela === 'apagar' && instanciaAlvo) telaApagar(area)
    else if (tela === 'tarefas') await telaTarefas(area)
    else if (tela === 'auditoria') await telaAuditoria(area)
    else if (tela === 'configuracoes') await telaConfiguracoes(area)
    else if (tela === 'backups') await telaBackups(area)
    else if (tela === 'restaurar' && restaurarAlvo) telaRestaurar(area)
    else if (tela === 'mensagens') await telaMensagens(area)
    else await telaInstancias(area)
  } catch (e) {
    if (usuario) area.append(h('div', { class: 'alerta erro' }, e.message + (tela === 'tarefas' ? ' — tentando de novo…' : '')))
    if (usuario && tela === 'tarefas') atualizador = setTimeout(desenhar, 5000)   // a VPN pode estar reiniciando
  }
}
desenhar()
