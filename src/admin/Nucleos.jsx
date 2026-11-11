import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { UFS } from '../../shared/opcoes.js'
import { chaveLocal } from '../../shared/util.js'
import DividirCidade from './DividirCidade.jsx'

const chaveArea = (a) => `${a.uf}|${chaveLocal(a.cidade)}|${chaveLocal(a.bairro) ?? ''}`

function EditorNucleo({ inicial, localidades, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [grupo, setGrupo] = useState(inicial?.entraGrupoId ?? '')
  const [areas, setAreas] = useState(inicial?.areas?.length ? inicial.areas.map((a) => ({ ...a, bairro: a.bairro ?? '' })) : [])
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const cidadesConhecidas = useMemo(() => [...new Map(localidades.map((l) => [`${l.uf}|${chaveLocal(l.cidade)}`, l])).values()], [localidades])
  const naoCobertas = useMemo(() => {
    const noEditor = new Set(areas.map(chaveArea))
    const cidadesNoEditor = new Set(areas.filter((a) => !a.bairro).map((a) => `${a.uf}|${chaveLocal(a.cidade)}`))
    return localidades.filter((l) => !l.coberto && !noEditor.has(chaveArea(l)) && !cidadesNoEditor.has(`${l.uf}|${chaveLocal(l.cidade)}`))
  }, [localidades, areas])

  const alterar = (i, campo, valor) => setAreas((as) => as.map((a, j) => (j === i ? { ...a, [campo]: valor } : a)))
  const adicionar = (area) => setAreas((as) => (as.some((a) => chaveArea(a) === chaveArea(area)) ? as : [...as, { bairro: '', ...area }]))

  async function salvar(e) {
    e.preventDefault()
    setErro(''); setSalvando(true)
    const corpo = { nome, entraGrupoId: grupo.trim(), areas: areas.filter((a) => a.cidade.trim()).map((a) => ({ uf: a.uf, cidade: a.cidade, bairro: a.bairro || null })) }
    try {
      if (inicial?.id) await api.put(`/api/admin/nucleos/${inicial.id}`, corpo)
      else await api.post('/api/admin/nucleos', corpo)
      onSalvo()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível salvar o núcleo.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="cartao editor-nucleo" onSubmit={salvar}>
      <h2>{inicial?.id ? `Editar ${inicial.nome}` : 'Novo núcleo'}</h2>
      <div className="campo">
        <label htmlFor="nucleo-nome">Nome do núcleo</label>
        <input id="nucleo-nome" required maxLength={120} placeholder="Ex.: Núcleo Grande Florianópolis" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>

      <div className="campo">
        <label htmlFor="nucleo-grupo">Grupo do Microsoft Entra (opcional)</label>
        <input id="nucleo-grupo" maxLength={36} spellCheck="false" placeholder="ID do objeto do grupo, ex.: 00000000-0000-0000-0000-000000000000" value={grupo} onChange={(e) => setGrupo(e.target.value)} />
        <small className="dica">Com o login Microsoft no modo "grupos" (Configurações), quem estiver neste grupo entra como coordenador deste núcleo, sem precisar de liberação.</small>
      </div>

      <h3>Cidades e bairros atendidos</h3>
      <p className="dica">Deixe o bairro em branco para incluir a cidade inteira. Maiúsculas e acentos não importam.</p>
      <datalist id="lista-cidades">{cidadesConhecidas.map((c) => <option key={`${c.uf}${c.cidade}`} value={c.cidade} />)}</datalist>
      <table className="tabela tabela-areas">
        <thead><tr><th>UF</th><th>Cidade</th><th>Bairro</th><th></th></tr></thead>
        <tbody>
          {areas.map((a, i) => (
            <tr key={i}>
              <td>
                <select value={a.uf} onChange={(e) => alterar(i, 'uf', e.target.value)} aria-label="UF">
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </td>
              <td><input list="lista-cidades" value={a.cidade} required onChange={(e) => alterar(i, 'cidade', e.target.value)} aria-label="Cidade" /></td>
              <td>
                <input list={`bairros-${i}`} value={a.bairro} placeholder="(cidade inteira)" onChange={(e) => alterar(i, 'bairro', e.target.value)} aria-label="Bairro" />
                <datalist id={`bairros-${i}`}>
                  {localidades.filter((l) => l.bairro && l.uf === a.uf && chaveLocal(l.cidade) === chaveLocal(a.cidade))
                    .map((l) => <option key={l.bairro} value={l.bairro} />)}
                </datalist>
              </td>
              <td><button type="button" className="link perigo" onClick={() => setAreas(areas.filter((_, j) => j !== i))}>remover</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="botao-secundario" onClick={() => adicionar({ uf: areas.at(-1)?.uf ?? 'SC', cidade: '' })}>+ Adicionar cidade/bairro</button>

      {naoCobertas.length > 0 && (
        <details className="sugestoes">
          <summary>Lugares com pré-fichas que ainda não têm núcleo ({naoCobertas.length})</summary>
          <ul>
            {naoCobertas.slice(0, 100).map((l) => (
              <li key={chaveArea(l)}>
                <span>{l.cidade}/{l.uf}{l.bairro ? ` · ${l.bairro}` : ''} <small className="dica">({l.fichas})</small></span>
                <span className="acoes-linha">
                  <button type="button" className="link" onClick={() => adicionar({ uf: l.uf, cidade: l.cidade, bairro: '' })}>+ cidade inteira</button>
                  {l.bairro && <button type="button" className="link" onClick={() => adicionar({ uf: l.uf, cidade: l.cidade, bairro: l.bairro })}>+ só o bairro</button>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {erro && <div className="alerta-erro">{erro}</div>}
      <div className="linha-acoes">
        <button type="button" className="botao-secundario" onClick={onCancelar}>Cancelar</button>
        <button className="botao-principal pequeno" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar núcleo'}</button>
      </div>
    </form>
  )
}

export default function Nucleos({ nucleos, onAlterar }) {
  const [localidades, setLocalidades] = useState([])
  const [editando, setEditando] = useState(null) // null | {} (novo) | núcleo
  const [dividindo, setDividindo] = useState(false)
  const [erro, setErro] = useState('')
  const [grupos, setGrupos] = useState(null)   // resultado de "Criar grupos no Entra"
  const [criando, setCriando] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [leitura, setLeitura] = useState(null)        // resultado de "Ler grupos do Entra"
  const [livres, setLivres] = useState([])           // grupos "Pré-fichas…" do Entra ainda sem núcleo
  const [config, setConfig] = useState(null)         // { leituraDias, ultimaLeitura, pronto }
  const carregarEntra = () => {
    api.get('/api/admin/entra/grupos-livres').then(setLivres).catch(() => {})
    api.get('/api/admin/sso').then(setConfig).catch(() => {})
  }
  useEffect(() => { carregarEntra() }, [])

  const carregarLocalidades = () => api.get('/api/admin/localidades').then(setLocalidades).catch(() => {})
  useEffect(() => { carregarLocalidades() }, [])

  const semNucleo = localidades.filter((l) => !l.coberto).reduce((s, l) => s + l.fichas, 0)

  async function criarGrupos() {
    if (!confirm('Criar no Microsoft Entra um grupo de segurança para cada núcleo que ainda não tem? Depois, coloque os coordenadores de cada núcleo no grupo dele.')) return
    setErro(''); setGrupos(null); setCriando(true)
    try { setGrupos(await api.post('/api/admin/nucleos/criar-grupos-entra', {})); onAlterar() } catch (err) { setErro(err.dados?.mensagem || 'Não foi possível criar os grupos.') } finally { setCriando(false) }
  }

  async function excluir(n) {
    if (!confirm(`Excluir o ${n.nome}? Os coordenadores dele deixarão de ver essas fichas.`)) return
    let apagarGrupo = false
    if (n.entraGrupoId && n.entraGrupoCriado && !n.entraGrupoSumiu) {
      apagarGrupo = confirm(`Apagar TAMBÉM o grupo "${n.entraGrupoNome || 'Pré-fichas – ' + n.nome}" no Microsoft Entra?\n\nOK = apaga o núcleo e o grupo no Entra.\nCancelar = apaga só o núcleo (o grupo fica no Entra).`)
    }
    setErro('')
    try {
      await api.delete(`/api/admin/nucleos/${n.id}${apagarGrupo ? '?apagarGrupoEntra=1' : ''}`)
      onAlterar(); carregarLocalidades(); carregarEntra()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível excluir.')
    }
  }

  async function lerEntra(termo = '') {
    setErro(''); setLeitura(null); setLendo(true)
    try { setLeitura(await api.post('/api/admin/nucleos/ler-entra', termo ? { termo } : {})); onAlterar(); carregarEntra() } catch (err) { setErro(err.dados?.mensagem || 'Não foi possível ler o Entra.') } finally { setLendo(false) }
  }

  async function vincular(grupo, nucleoId) {
    if (!nucleoId) return
    setErro('')
    try { await api.post(`/api/admin/nucleos/${nucleoId}/vincular-grupo`, { grupo }); onAlterar(); carregarEntra() } catch (err) { setErro(err.dados?.mensagem || 'Não foi possível vincular.') }
  }

  async function mudarDias(dias) {
    try { await api.put('/api/admin/sso', { leituraDias: dias, provisionar: config.provisionar, criarPendentes: config.criarPendentes }); setConfig({ ...config, leituraDias: dias }) } catch { setErro('Não foi possível salvar o intervalo.') }
  }

  if (dividindo) {
    return (
      <DividirCidade nucleos={nucleos} localidades={localidades} onCancelar={() => setDividindo(false)}
        onNucleoCriado={onAlterar} onSalvo={() => { onAlterar(); return carregarLocalidades() }} />
    )
  }

  if (editando) {
    return (
      <EditorNucleo inicial={editando} localidades={localidades} onCancelar={() => setEditando(null)}
        onSalvo={() => { setEditando(null); onAlterar(); carregarLocalidades() }} />
    )
  }

  return (
    <>
      <div className="titulo-secao com-acoes">
        <div>
          <h1>Núcleos</h1>
          <p className="subtitulo">Cada núcleo reúne cidades e bairros. O coordenador de núcleo só vê as pré-fichas da sua área (associe em Usuários).</p>
        </div>
        <div className="acoes-linha">
          <button className="botao-secundario" onClick={() => lerEntra()} disabled={lendo}>{lendo ? 'Lendo…' : 'Ler grupos do Entra'}</button>
          <button className="botao-secundario" disabled={lendo} onClick={() => { const t = window.prompt('Início do nome do grupo no Entra (ex.: Santo Amaro). Use para grupos que não começam com "Pré-fichas":'); if (t && t.trim()) lerEntra(t.trim()) }}>Buscar grupo por nome</button>
          <button className="botao-secundario" onClick={criarGrupos} disabled={criando}>{criando ? 'Criando…' : 'Criar grupos no Entra'}</button>
          <button className="botao-secundario" onClick={() => setDividindo(true)}>Dividir cidade por bairros</button>
          <button className="botao-principal pequeno" onClick={() => setEditando({})}>+ Novo núcleo</button>
        </div>
      </div>

      {semNucleo > 0 && (
        <div className="alerta-ok">
          {semNucleo} pré-ficha(s) estão em cidades/bairros que nenhum núcleo atende. Edite ou crie um núcleo para incluí-las.
        </div>
      )}
      {erro && <div className="alerta-erro">{erro}</div>}
      {grupos && (
        <div className={grupos.falhas.length ? 'alerta-erro' : 'alerta-ok'} role="status">
          {grupos.mensagem || `${grupos.criados.length} grupo(s) criado(s) no Entra.`}
          {grupos.criados.length > 0 && <> Nomes: {grupos.criados.map((c) => `Pré-fichas – ${c.nome}`).join('; ')}. Agora adicione os coordenadores de cada núcleo como membros do grupo dele, no Entra.</>}
          {grupos.falhas.length > 0 && <> Falhou: {grupos.falhas.map((f) => `${f.nome} (${f.motivo})`).join('; ')}.</>}
        </div>
      )}

      {leitura && (
        <div className="alerta-ok" role="status">
          Leitura do Entra concluída: {leitura.atualizados} grupo(s) conferido(s)
          {leitura.vinculados.length > 0 && <>, {leitura.vinculados.length} ligado(s) automaticamente ({leitura.vinculados.map((v) => `${v.nucleo}`).join(', ')})</>}
          {leitura.sumiram > 0 && <>, <strong>{leitura.sumiram} não existe(m) mais no Entra</strong></>}
          {leitura.livres > 0 && <>, {leitura.livres} grupo(s) encontrado(s) sem núcleo (abaixo)</>}.
        </div>
      )}
      {config?.pronto && (
        <p className="dica">
          Última leitura do Entra: {config.ultimaLeitura ? new Date(config.ultimaLeitura).toLocaleString('pt-BR') : 'nunca'} ·
          {' '}ler automaticamente a cada{' '}
          <select value={config.leituraDias} onChange={(e) => mudarDias(Number(e.target.value))} aria-label="Leitura automática do Entra">
            <option value={0}>— (só pelo botão)</option><option value={1}>1 dia</option><option value={3}>3 dias</option><option value={7}>7 dias</option><option value={15}>15 dias</option><option value={30}>30 dias</option>
          </select>
        </p>
      )}
      {livres.length > 0 && (
        <div className="cartao">
          <h3>Grupos do Entra sem núcleo</h3>
          <p className="dica">Encontrados na última leitura (nome começando por "Pré-fichas" ou pelo termo buscado). Escolha o núcleo de cada um para ligar.</p>
          {livres.map((g) => (
            <div key={g.id} className="linha-form" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{g.nome}</strong>
              <select defaultValue="" onChange={(e) => vincular(g.id, e.target.value)} aria-label={`Núcleo do grupo ${g.nome}`}>
                <option value="">Ligar a qual núcleo?</option>
                {nucleos.filter((n) => !n.entraGrupoId).map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="grade-nucleos">
        {nucleos.map((n) => (
          <div key={n.id} className="cartao cartao-nucleo">
            <div className="topo-nucleo">
              <h2>{n.nome}</h2>
              <span className="contador grande" title="Pessoas na fila">{n.na_fila} na fila</span>
            </div>
            <p className="dica">Coordenação: {n.coordenadores.length ? n.coordenadores.map((c) => c.nome).join(', ') : 'ninguém associado'}</p>
            {n.entraGrupoId && (
              <p className="dica" title={n.entraGrupoId}>
                Grupo do Entra: <strong>{n.entraGrupoNome || n.entraGrupoId}</strong>{' '}
                {n.entraGrupoSumiu ? <span className="selo alerta">não existe mais no Entra</span> : <span className="selo">{n.entraGrupoCriado ? 'criado pelo sistema' : 'ligado'}</span>}
              </p>
            )}
            <div className="chips">
              {n.areas.map((a, i) => <span key={i} className="chip">{a.cidade}/{a.uf}{a.bairro ? ` · ${a.bairro}` : ' (toda)'}</span>)}
              {!n.areas.length && <span className="dica">Nenhuma cidade definida.</span>}
            </div>
            <div className="acoes-linha">
              <button className="botao-secundario" onClick={() => setEditando(n)}>Editar</button>
              <button className="link perigo" onClick={() => excluir(n)}>Excluir</button>
            </div>
          </div>
        ))}
        {!nucleos.length && <p className="dica">Nenhum núcleo cadastrado. Crie o primeiro para dar acesso aos coordenadores.</p>}
      </div>
    </>
  )
}
