import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { carregarMarca, TextoMarca } from '../lib/marca.jsx'
import { ajustarCor, corTextoSobre } from '../../shared/marca.js'

const CAMPOS_EXPORTADOS = ['nome', 'nomeCurto', 'corPrimaria', 'whatsapp', 'email', 'instagram', 'site',
  'tituloFormulario', 'textoFormulario', 'mensagemSucesso', 'termos', 'tribos', 'recusasParaFimDaFila', 'edicoesPreferenciaConjuge']

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
  const arquivoLogo = useRef(null)
  const arquivoMarca = useRef(null)

  useEffect(() => {
    if (marca && !m) {
      setM(Object.fromEntries(CAMPOS_EXPORTADOS.map((c) => [c, marca[c]])))
      setLogoUrl(marca.logoUrl)
    }
  }, [marca, m])

  if (!m) return <p className="carregando">Carregando…</p>

  const set = (campo) => (e) => setM({ ...m, [campo]: e.target.value })
  const aviso = (tipo, texto) => { setMensagem({ tipo, texto }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function atualizarMarcaGlobal() {
    const nova = await carregarMarca(true)
    setLogoUrl(nova.logoUrl)
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
            <Campo id="cfg-pref" rotulo="Edições de preferência para o cônjuge" erro={erros.edicoesPreferenciaConjuge}
              dica="Quem fez o acampamento N dá ao cônjuge preferência nas próximas edições da mesma modalidade. Ex.: 2 → fez o 24º, o cônjuge tem preferência no 25º e no 26º. Use 0 para desligar.">
              <input id="cfg-pref" type="number" min="0" max="10" className="numero-curto" value={m.edicoesPreferenciaConjuge}
                onChange={(e) => setM({ ...m, edicoesPreferenciaConjuge: e.target.value === '' ? '' : Number(e.target.value) })} />
            </Campo>
          </section>

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
    </>
  )
}
