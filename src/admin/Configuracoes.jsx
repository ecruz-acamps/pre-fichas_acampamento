import SsoMicrosoft from './SsoMicrosoft.jsx'
import ImportarFichas from './ImportarFichas.jsx'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { carregarMarca, TextoMarca } from '../lib/marca.jsx'
import { ajustarCor, corTextoSobre } from '../../shared/marca.js'

const CAMPOS_EXPORTADOS = ['nome', 'nomeCurto', 'corPrimaria', 'whatsapp', 'email', 'instagram', 'site',
  'tituloFormulario', 'textoFormulario', 'mensagemSucesso', 'termos', 'tribos', 'recusasParaFimDaFila', 'edicoesPreferenciaConjuge', 'preferenciaConjuge', 'casaisExigeSenior', 'cadastroEquipe', 'mostrarPosicaoFila', 'impressaoTitulo', 'impressaoSubtitulo', 'impressaoTextoDireita']

/** Publicação na internet pela Cloudflare: o administrador liga ou desliga. */
function Publicacao({ nomeCurto }) {
  const [p, setP] = useState(null)
  const [sub, setSub] = useState('')
  const [token, setToken] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const carregar = () => api.get('/api/admin/publicacao/estado').then((r) => {
    setP(r)
    setSub((atual) => atual || (r.endereco ? r.endereco.split('.')[0] : sugestao(nomeCurto)))
    return r
  }).catch(() => {})
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!p?.andamento) return
    const t = setInterval(carregar, 3000)
    return () => clearInterval(t)
  }, [p?.andamento]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pedir(ativo) {
    setErro(''); setEnviando(true)
    try {
      await api.post('/api/admin/publicacao', { ativo, subdominio: sub, token: token || undefined })
      setToken('')
      await carregar()
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível enviar o pedido.') } finally { setEnviando(false) }
  }
  if (!p) return null
  const base = p.dominioBase
  return (
    <section>
      <h2>Publicação na internet (Cloudflare)</h2>
      {!p.disponivel ? (
        <p className="dica">Para ligar a publicação por aqui, atualize o sistema pelo botão <strong>Atualizações</strong> (o servidor precisa da versão nova do atualizador).</p>
      ) : (
        <>
          <p>
            Situação: {p.andamento ? <strong>alterando… (pode levar 1 minuto)</strong>
              : p.ativo ? <strong className="texto-ok">publicado em <a href={`https://${p.endereco}`} target="_blank" rel="noreferrer">https://{p.endereco}</a></strong>
                : <strong>desligada</strong> }
          </p>
          <p className="dica">Ligada, o sistema fica acessível pela internet em <code>NOME.{base}</code> com HTTPS, pelo túnel da Cloudflare — sem usar as portas 80/443 e sem abrir portas no roteador. Desligada, o acesso é só pela rede local (IP do servidor).</p>
          <div className="linha-form">
            <label htmlFor="pub-sub" className="sr-only">Endereço</label>
            <input id="pub-sub" value={sub} maxLength={63} disabled={p.andamento}
              onChange={(e) => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} aria-label="Endereço" />
            <span>.{base}</span>
          </div>
          {p.tokenConfigurado === false && (
            <div className="campo">
              <label htmlFor="pub-token">Token da API da Cloudflare (só na primeira vez)</label>
              <input id="pub-token" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" />
              <small className="dica">Crie em dash.cloudflare.com → Perfil → Tokens de API, com as permissões <strong>Conta › Cloudflare Tunnel › Editar</strong> e <strong>Zona › DNS › Editar</strong> ({base}). Fica guardado só no servidor.</small>
            </div>
          )}
          <div className="botoes-area">
            <button type="button" className="botao-principal pequeno" disabled={enviando || p.andamento || !sub} onClick={() => pedir(true)}>
              {p.ativo ? 'Trocar endereço / republicar' : 'Ligar publicação'}
            </button>
            {p.ativo && (
              <button type="button" className="botao-secundario" disabled={enviando || p.andamento}
                onClick={() => window.confirm('Desligar a publicação? O sistema deixa de abrir pela internet (só pela rede local).') && pedir(false)}>
                Desligar publicação
              </button>
            )}
          </div>
          {erro && <div className="alerta-erro">{erro}</div>}
          {p.ultimo && !p.andamento && p.ultimo.sucesso === false && <div className="alerta-erro">{p.ultimo.mensagem}</div>}
          {p.log?.length > 0 && (
            <details><summary className="dica">Detalhes da última alteração</summary><pre className="log-curto">{p.log.join('\n')}</pre></details>
          )}
        </>
      )}
    </section>
  )
}

const sugestao = (nome = '') => nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/^acampamento\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63)

/** Importação de contas antigas (planilha CSV). As pessoas criam a senha pelo "Esqueci minha senha". */
function ContasAntigas() {
  const [resumo, setResumo] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const carregar = () => api.get('/api/admin/participantes/resumo').then(setResumo).catch(() => {})
  useEffect(() => { carregar() }, [])
  async function importar(ev) {
    const arquivo = ev.target.files?.[0]
    ev.target.value = ''
    if (!arquivo) return
    setErro(''); setResultado(null); setEnviando(true)
    try {
      setResultado(await api.post('/api/admin/participantes/importar', { csv: await arquivo.text() }))
      carregar()
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível importar.') } finally { setEnviando(false) }
  }
  return (
    <div className="contas-antigas">
      <h3>Contas dos participantes</h3>
      {resumo && <p className="dica">{resumo.total} conta(s) · {resumo.sem_senha} ainda sem senha (importadas).</p>}
      {resumo && !resumo.recuperacao && (
        <div className="alerta-erro">O envio de e-mails não está configurado: sem ele ninguém consegue recuperar a senha nem criar a senha de uma conta importada. Veja "E-mail" no manual de instalação.</div>
      )}
      <p className="dica">Importar contas antigas: planilha <strong>CSV</strong> com as colunas <code>cpf</code>, <code>email</code>, <code>nome</code> e <code>data_nascimento</code>.
        As contas entram <strong>sem senha</strong>; no primeiro acesso a pessoa clica em "Esqueci minha senha" e cria a senha pelo link enviado ao e-mail.</p>
      <label className="botao-secundario">
        {enviando ? 'Importando…' : 'Escolher planilha CSV'}
        <input type="file" accept=".csv,text/csv" hidden onChange={importar} disabled={enviando} />
      </label>
      {erro && <div className="alerta-erro">{erro}</div>}
      {resultado && (
        <div className="alerta-ok">
          Importadas: <strong>{resultado.importados}</strong> · já existiam: {resultado.ignorados} · com erro: {resultado.erros.length}
          {resultado.erros.length > 0 && <ul>{resultado.erros.slice(0, 20).map((e) => <li key={e.linha}>Linha {e.linha}: {e.motivo}</li>)}</ul>}
        </div>
      )}
    </div>
  )
}

function Campo({ id, rotulo, dica, erro, children }) {
  return (
    <div className={`campo ${erro ? 'com-erro' : ''}`}>
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {dica && !erro && <small className="dica">{dica}</small>}
      {erro && <small className="erro">{erro}</small>}
    </div>
  )
}

/** Prévia do topo do formulário e dos botões com as cores escolhidas. */
function Previa({ m, logoUrl }) {
  const ok = /^#[0-9a-f]{6}$/i.test(m.corPrimaria)
  const cor = ok ? m.corPrimaria : '#7b5612'
  return (
    <div className="previa" style={{ '--cor': cor, '--cor-clara': ajustarCor(cor, 0.88), '--cor-texto': corTextoSobre(cor) }}>
      <small className="dica">Prévia</small>
      {logoUrl && <img className="logo" src={logoUrl} alt="" />}
      <p className="nome-acampamento">{m.nome}</p>
      <h3>{m.tituloFormulario}</h3>
      <p className="dica"><TextoMarca texto={m.textoFormulario} /></p>
      <div className="acoes"><span className="botao-principal">Enviar ficha de inscrição</span></div>
    </div>
  )
}

export default function Configuracoes({ marca, onSalvar }) {
  const [m, setM] = useState(null)
  const [erros, setErros] = useState({})
  const [mensagem, setMensagem] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [logoUrl, setLogoUrl] = useState(null)
  const [logoImpUrl, setLogoImpUrl] = useState(null)
  const arquivoLogoImp = useRef(null)
  const arquivoLogo = useRef(null)
  const arquivoMarca = useRef(null)

  useEffect(() => {
    if (marca && !m) {
      setM(Object.fromEntries(CAMPOS_EXPORTADOS.map((c) => [c, marca[c]])))
      setLogoUrl(marca.logoUrl)
      setLogoImpUrl(marca.logoImpressaoUrl)
    }
  }, [marca, m])

  if (!m) return <p className="carregando">Carregando…</p>

  const set = (campo) => (e) => setM({ ...m, [campo]: e.target.value })
  const aviso = (tipo, texto) => { setMensagem({ tipo, texto }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function atualizarMarcaGlobal() {
    const nova = await carregarMarca(true)
    setLogoUrl(nova.logoUrl)
    setLogoImpUrl(nova.logoImpressaoUrl)
    onSalvar(nova)
  }

  async function salvar(dados = m) {
    setSalvando(true); setErros({}); setMensagem(null)
    try {
      await api.put('/api/admin/marca', dados)
      await atualizarMarcaGlobal()
      aviso('ok', 'Configurações salvas. O formulário público já está com a nova identidade.')
      return true
    } catch (err) {
      setErros(err.dados?.erros ?? {})
      aviso('erro', err.dados?.mensagem || 'Não foi possível salvar.')
      return false
    } finally {
      setSalvando(false)
    }
  }

  async function enviarLogo(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    if (arquivo.size > 1024 * 1024) return aviso('erro', 'A logo deve ter no máximo 1 MB.')
    try {
      await api.enviarArquivo('/api/admin/marca/logo', arquivo)
      await atualizarMarcaGlobal()
      aviso('ok', 'Logo atualizada.')
    } catch (err) {
      aviso('erro', err.dados?.mensagem || 'Não foi possível enviar a logo.')
    }
  }

  async function enviarLogoImp(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    if (arquivo.size > 1024 * 1024) return aviso('erro', 'A imagem deve ter no máximo 1 MB.')
    try {
      await api.enviarArquivo('/api/admin/marca/logo-impressao', arquivo)
      await atualizarMarcaGlobal()
      aviso('ok', 'Logo da impressão atualizado.')
    } catch (err) { aviso('erro', err.dados?.mensagem || 'Não foi possível enviar a imagem.') }
  }
  async function removerLogoImp() {
    if (!confirm('Remover o logo da impressão?')) return
    await api.delete('/api/admin/marca/logo-impressao')
    await atualizarMarcaGlobal()
  }

  async function removerLogo() {
    if (!confirm('Remover a logo?')) return
    await api.delete('/api/admin/marca/logo')
    await atualizarMarcaGlobal()
  }

  function exportar() {
    const blob = new Blob([JSON.stringify(m, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `marca-${(m.nomeCurto || 'acampamento').normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importar(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    try {
      const dados = JSON.parse(await arquivo.text())
      const novo = { ...m, ...Object.fromEntries(CAMPOS_EXPORTADOS.filter((c) => dados[c] !== undefined).map((c) => [c, dados[c]])) }
      if (!confirm(`Aplicar a identidade "${novo.nome}"? Isso substitui as configurações atuais (a logo não muda).`)) return
      if (await salvar(novo)) setM(novo)
    } catch {
      aviso('erro', 'Arquivo inválido. Use um arquivo .json exportado por esta tela ou da pasta marcas/.')
    }
  }

  const alterarLista = (campo, i, valor) => setM({ ...m, [campo]: m[campo].map((x, j) => (j === i ? valor : x)) })
  const removerDaLista = (campo, i) => setM({ ...m, [campo]: m[campo].filter((_, j) => j !== i) })
  const mover = (campo, i, d) => {
    const lista = [...m[campo]]
    const j = i + d
    if (j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    setM({ ...m, [campo]: lista })
  }

  return (
    <>
      <div className="titulo-secao com-acoes">
        <div>
          <h1>Configurações do acampamento</h1>
          <p className="subtitulo">Identidade visual, contatos, textos do formulário, declarações e tribos. Vale na hora para o formulário público.</p>
        </div>
        <div className="acoes-linha">
          <button className="botao-secundario" onClick={exportar}>Exportar marca (.json)</button>
          <button className="botao-secundario" onClick={() => arquivoMarca.current.click()}>Importar marca</button>
          <input ref={arquivoMarca} type="file" accept="application/json,.json" hidden onChange={importar} />
          <a className="botao-secundario" href="/" target="_blank" rel="noreferrer">Ver formulário ↗</a>
        </div>
      </div>

      {mensagem && <div className={mensagem.tipo === 'ok' ? 'alerta-ok' : 'alerta-erro'} role="status">{mensagem.texto}</div>}

      <div className="config-grade">
        <form className="cartao" onSubmit={(e) => { e.preventDefault(); salvar() }}>
          <section>
            <h2>Identidade</h2>
            <div className="linha">
              <Campo id="cfg-nome" rotulo="Nome do acampamento" erro={erros.nome}>
                <input id="cfg-nome" required maxLength={120} value={m.nome} onChange={set('nome')} />
              </Campo>
              <Campo id="cfg-curto" rotulo="Nome curto" dica="Usado no painel e na aba do navegador." erro={erros.nomeCurto}>
                <input id="cfg-curto" maxLength={60} value={m.nomeCurto} onChange={set('nomeCurto')} />
              </Campo>
            </div>
            <div className="linha">
              <Campo id="cfg-cor" rotulo="Cor principal" erro={erros.corPrimaria} dica="Os tons claros e escuros são calculados automaticamente.">
                <div className="seletor-cor">
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(m.corPrimaria) ? m.corPrimaria : '#7b5612'}
                    onChange={set('corPrimaria')} aria-label="Escolher cor" />
                  <input id="cfg-cor" value={m.corPrimaria} maxLength={7} onChange={set('corPrimaria')} />
                </div>
              </Campo>
              <div className="campo">
                <label>Logo</label>
                <div className="logo-config">
                  {logoUrl ? <img src={logoUrl} alt="Logo atual" /> : <span className="dica">Sem logo</span>}
                  <button type="button" className="botao-secundario" onClick={() => arquivoLogo.current.click()}>
                    {logoUrl ? 'Trocar' : 'Enviar logo'}
                  </button>
                  {logoUrl && <button type="button" className="link perigo" onClick={removerLogo}>remover</button>}
                  <input ref={arquivoLogo} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={enviarLogo} />
                </div>
                <small className="dica">PNG, JPG, WEBP ou SVG até 1 MB. Também vira o ícone do site e a imagem da prévia no WhatsApp.</small>
              </div>
            </div>
          </section>

          <section>
            <h2>Contatos (rodapé do formulário)</h2>
            <div className="linha">
              <Campo id="cfg-whats" rotulo="WhatsApp" erro={erros.whatsapp} dica="Com DDD.">
                <input id="cfg-whats" inputMode="tel" value={m.whatsapp} onChange={set('whatsapp')} />
              </Campo>
              <Campo id="cfg-email" rotulo="E-mail" erro={erros.email}>
                <input id="cfg-email" type="email" value={m.email} onChange={set('email')} />
              </Campo>
            </div>
            <div className="linha">
              <Campo id="cfg-insta" rotulo="Instagram" erro={erros.instagram}>
                <input id="cfg-insta" placeholder="@perfil" value={m.instagram} onChange={set('instagram')} />
              </Campo>
              <Campo id="cfg-site" rotulo="Site" erro={erros.site}>
                <input id="cfg-site" placeholder="https://" value={m.site} onChange={set('site')} />
              </Campo>
            </div>
          </section>

          <section>
            <h2>Textos do formulário</h2>
            <p className="dica">Use <code>**texto**</code> para deixar em negrito.</p>
            <Campo id="cfg-titulo" rotulo="Título" erro={erros.tituloFormulario}>
              <input id="cfg-titulo" maxLength={120} value={m.tituloFormulario} onChange={set('tituloFormulario')} />
            </Campo>
            <Campo id="cfg-texto" rotulo="Apresentação" erro={erros.textoFormulario}>
              <textarea id="cfg-texto" rows={3} maxLength={1500} value={m.textoFormulario} onChange={set('textoFormulario')} />
            </Campo>
            <Campo id="cfg-sucesso" rotulo="Mensagem após o envio" erro={erros.mensagemSucesso}>
              <textarea id="cfg-sucesso" rows={3} maxLength={1500} value={m.mensagemSucesso} onChange={set('mensagemSucesso')} />
            </Campo>
          </section>

          <section>
            <h2>Declarações obrigatórias</h2>
            <p className="dica">A pessoa precisa marcar todas. O texto aceito fica gravado em cada pré-ficha.</p>
            {erros.termos && <small className="erro">{erros.termos}</small>}
            {m.termos.map((t, i) => (
              <div key={i} className="item-lista">
                <textarea rows={2} maxLength={1000} value={t} onChange={(e) => alterarLista('termos', i, e.target.value)} aria-label={`Declaração ${i + 1}`} />
                <div className="botoes-item">
                  <button type="button" className="link" onClick={() => mover('termos', i, -1)} aria-label="Subir">↑</button>
                  <button type="button" className="link" onClick={() => mover('termos', i, 1)} aria-label="Descer">↓</button>
                  <button type="button" className="link perigo" onClick={() => removerDaLista('termos', i)}>remover</button>
                </div>
              </div>
            ))}
            <button type="button" className="botao-secundario" onClick={() => setM({ ...m, termos: [...m.termos, ''] })}>+ Adicionar declaração</button>
          </section>

          <section>
            <h2>Regras da fila</h2>
            <Campo id="cfg-recusas" rotulo="Recusas seguidas que levam para o fim da fila" erro={erros.recusasParaFimDaFila}
              dica="Quando a pessoa é chamada e diz não esse número de vezes seguidas, ela vai automaticamente para o fim da fila (com registro na auditoria). Use 0 para nunca mover automaticamente.">
              <input id="cfg-recusas" type="number" min="0" max="10" className="numero-curto" value={m.recusasParaFimDaFila}
                onChange={(e) => setM({ ...m, recusasParaFimDaFila: e.target.value === '' ? '' : Number(e.target.value) })} />
            </Campo>
            <label className="check">
              <input type="checkbox" checked={m.preferenciaConjuge !== false} onChange={(e) => setM({ ...m, preferenciaConjuge: e.target.checked })} />
              <span><strong>Preferência do cônjuge</strong> ligada — o formulário pergunta se o cônjuge já fez o acampamento e o painel mostra selos ★, filtro e benefícios. Desligada, tudo isso some (os registros antigos ficam guardados).</span>
            </label>
            {m.preferenciaConjuge !== false && <Campo id="cfg-pref" rotulo="Edições de preferência para o cônjuge" erro={erros.edicoesPreferenciaConjuge}
              dica="Quem fez o acampamento N dá ao cônjuge preferência nas próximas edições da mesma modalidade. Ex.: 2 → fez o 24º, o cônjuge tem preferência no 25º e no 26º. Use 0 para desligar.">
              <input id="cfg-pref" type="number" min="0" max="10" className="numero-curto" value={m.edicoesPreferenciaConjuge}
                onChange={(e) => setM({ ...m, edicoesPreferenciaConjuge: e.target.value === '' ? '' : Number(e.target.value) })} />
            </Campo>}
          </section>

          <section>
            <h2>Impressão da ficha</h2>
            <p className="dica">Cabeçalho da pré-ficha impressa pelo painel (botão 🖨 Imprimir no detalhe da ficha).</p>
            <div className="previa-impressao">
              <div className="pi-esq">{logoImpUrl ? <img src={logoImpUrl} alt="" /> : <span className="dica">logo da esquerda</span>}</div>
              <div className="pi-centro">
                <small>{(m.impressaoSubtitulo || m.nome || '').toUpperCase()}</small>
                <strong>{(m.impressaoTitulo || 'Ficha de pré-inscrição').toUpperCase()}</strong>
              </div>
              <div className="pi-dir">{logoUrl && <img src={logoUrl} alt="" />}<span>{m.impressaoTextoDireita || m.nome}</span></div>
            </div>
            <Campo id="cfg-imp-titulo" rotulo="Título" erro={erros.impressaoTitulo}>
              <input id="cfg-imp-titulo" value={m.impressaoTitulo ?? ''} maxLength={80} onChange={set('impressaoTitulo')} placeholder="Ficha de pré-inscrição" />
            </Campo>
            <Campo id="cfg-imp-sub" rotulo="Linha acima do título" erro={erros.impressaoSubtitulo}
              dica="Ex.: Acampamento São Pe. Pio de Pietrelcina. Em branco = nome do acampamento.">
              <input id="cfg-imp-sub" value={m.impressaoSubtitulo ?? ''} maxLength={120} onChange={set('impressaoSubtitulo')} />
            </Campo>
            <Campo id="cfg-imp-dir" rotulo="Texto ao lado do logo (direita)" erro={erros.impressaoTextoDireita}
              dica='Ex.: Acampamento São Padre Pio (sai como "ACAMPAMENTO" e o nome embaixo). Em branco = nome do acampamento. O logo da direita é o logo principal.'>
              <input id="cfg-imp-dir" value={m.impressaoTextoDireita ?? ''} maxLength={120} onChange={set('impressaoTextoDireita')} />
            </Campo>
            <div className="campo">
              <label>Logo da esquerda (opcional, ex.: brasão da paróquia)</label>
              <div className="logo-config">
                {logoImpUrl ? <img src={logoImpUrl} alt="Logo da impressão" /> : <span className="dica">Sem imagem</span>}
                <button type="button" className="botao-secundario" onClick={() => arquivoLogoImp.current.click()}>{logoImpUrl ? 'Trocar' : 'Enviar imagem'}</button>
                {logoImpUrl && <button type="button" className="link perigo" onClick={removerLogoImp}>remover</button>}
                <input ref={arquivoLogoImp} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={enviarLogoImp} />
              </div>
              <small className="dica">PNG, JPG, WEBP ou SVG até 1 MB. Os textos são salvos com o botão "Salvar configurações".</small>
            </div>
          </section>

          <section>
            <h2>Cadastro da equipe</h2>
            <Campo id="cfg-cadastro-equipe" rotulo="Permitir que coordenadores e equipe se cadastrem sozinhos?"
              dica="Sim: a tela de login mostra 'Quero me cadastrar'. A pessoa cria o usuário e fica SEM acesso até um administrador liberar (escolhendo o papel e os núcleos). Não: só o administrador cria usuários.">
              <select id="cfg-cadastro-equipe" value={m.cadastroEquipe === false ? 'nao' : 'sim'}
                onChange={(e) => setM({ ...m, cadastroEquipe: e.target.value === 'sim' })}>
                <option value="sim">Sim: a pessoa se cadastra e o administrador libera</option>
                <option value="nao">Não: só o administrador cria usuários</option>
              </select>
            </Campo>
          </section>

          <section>
            <h2>Modalidade Casais</h2>
            <Campo id="cfg-casais" rotulo="Para a modalidade Casais é necessário ter feito o Sênior?"
              dica="Sim: quem se inscreve e o cônjuge precisam já ter feito o Sênior. Não: basta o cônjuge já ser campista cadastrado (de qualquer modalidade). Em ambos os casos, o cônjuge precisa já estar cadastrado como campista no sistema. A regra varia de acampamento para acampamento.">
              <select id="cfg-casais" value={m.casaisExigeSenior === false ? 'nao' : 'sim'}
                onChange={(e) => setM({ ...m, casaisExigeSenior: e.target.value === 'sim' })}>
                <option value="sim">Sim: os dois precisam ter feito o Sênior</option>
                <option value="nao">Não: não é obrigatório</option>
              </select>
            </Campo>
          </section>

          <section>
            <h2>Área do participante</h2>
            <label className="check">
              <input type="checkbox" checked={m.mostrarPosicaoFila === true} onChange={(e) => setM({ ...m, mostrarPosicaoFila: e.target.checked })} />
              <span>Mostrar a <strong>posição na fila</strong> para a pessoa quando ela entra na conta (desligado = mostra só a situação: aguardando, em contato…)</span>
            </label>
            <ContasAntigas />
          </section>

          <SsoMicrosoft />

          <section>
            <h2>Tribos</h2>
            <p className="dica">Cores usadas ao registrar quem fez cada acampamento. Renomear uma tribo não altera os registros antigos.</p>
            {erros.tribos && <small className="erro">{erros.tribos}</small>}
            <div className="lista-tribos">
              {m.tribos.map((t, i) => (
                <div key={i} className="item-tribo">
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(t.cor) ? t.cor : '#999999'}
                    onChange={(e) => alterarLista('tribos', i, { ...t, cor: e.target.value })} aria-label={`Cor da tribo ${t.nome}`} />
                  <input value={t.nome} maxLength={40} onChange={(e) => alterarLista('tribos', i, { ...t, nome: e.target.value })} aria-label="Nome da tribo" />
                  <button type="button" className="link perigo" onClick={() => removerDaLista('tribos', i)}>remover</button>
                </div>
              ))}
            </div>
            <button type="button" className="botao-secundario" onClick={() => setM({ ...m, tribos: [...m.tribos, { nome: '', cor: '#888888' }] })}>+ Adicionar tribo</button>
          </section>

          <div className="acoes">
            <button className="botao-principal" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar configurações'}</button>
          </div>
        </form>

        <aside className="config-previa"><Previa m={m} logoUrl={logoUrl} /></aside>
      </div>
      <div className="cartao config-publicacao"><Publicacao nomeCurto={m.nomeCurto || m.nome} /></div>
      <ImportarFichas />
    </>
  )
}
