import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { UFS } from '../../shared/opcoes.js'
import { chaveLocal } from '../../shared/util.js'
import DividirCidade from './DividirCidade.jsx'

const chaveArea = (a) => `${a.uf}|${chaveLocal(a.cidade)}|${chaveLocal(a.bairro) ?? ''}`

function EditorNucleo({ inicial, localidades, onSalvo, onCancelar }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
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
    const corpo = { nome, areas: areas.filter((a) => a.cidade.trim()).map((a) => ({ uf: a.uf, cidade: a.cidade, bairro: a.bairro || null })) }
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

  const carregarLocalidades = () => api.get('/api/admin/localidades').then(setLocalidades).catch(() => {})
  useEffect(() => { carregarLocalidades() }, [])

  const semNucleo = localidades.filter((l) => !l.coberto).reduce((s, l) => s + l.fichas, 0)

  async function excluir(n) {
    if (!confirm(`Excluir o ${n.nome}? Os coordenadores dele deixarão de ver essas fichas.`)) return
    try {
      await api.delete(`/api/admin/nucleos/${n.id}`)
      onAlterar(); carregarLocalidades()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível excluir.')
    }
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

      <div className="grade-nucleos">
        {nucleos.map((n) => (
          <div key={n.id} className="cartao cartao-nucleo">
            <div className="topo-nucleo">
              <h2>{n.nome}</h2>
              <span className="contador grande" title="Pessoas na fila">{n.na_fila} na fila</span>
            </div>
            <p className="dica">Coordenação: {n.coordenadores.length ? n.coordenadores.map((c) => c.nome).join(', ') : 'ninguém associado'}</p>
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
