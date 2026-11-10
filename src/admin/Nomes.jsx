import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { CorTribo } from '../lib/marca.jsx'
import { MODALIDADES, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { linkWhatsApp } from '../../shared/util.js'
import { calcularPosicoes, useFichas } from './Fila.jsx'
import Detalhe from './Detalhe.jsx'
import { baixarCsv } from './csv.js'

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const inicial = (nome) => {
  const c = normalizar(nome).trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}
const LETRAS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']
const acampamentosTexto = (parts) => (parts ?? [])
  .map((p) => `${p.numero}º ${rotuloDe(MODALIDADES, p.modalidade)}${p.tribo ? ` (${p.tribo})` : ''}`).join(', ')

/**
 * Lista geral de nomes em ordem alfabética:
 *   - pré-fichas que o usuário pode ver (coordenador: só do seu núcleo);
 *   - todos os campistas (quem já fez o acampamento), de todos os núcleos.
 */
export default function Nomes({ usuario, marca, nucleos }) {
  const { linhas: fichas, setLinhas, recarregar: recarregarFichas } = useFichas()
  const recarregar = async () => { const l = await recarregarFichas(); setVersaoCampistas((v) => v + 1); return l }
  const [campistas, setCampistas] = useState([])
  const [tipo, setTipo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [selecionada, setSelecionada] = useState(null)
  const coordenador = usuario.papel === 'coordenador'

  // Campistas: carrega ao abrir e quando a lista for recarregada (não a cada alteração local)
  const [versaoCampistas, setVersaoCampistas] = useState(0)
  useEffect(() => { api.get('/api/admin/campistas').then(setCampistas).catch(() => setCampistas([])) }, [versaoCampistas])

  const posicoes = useMemo(() => calcularPosicoes(fichas), [fichas])
  const nomesNucleos = useMemo(() => {
    const m = new Map(nucleos.map((n) => [n.id, n.nome]))
    for (const c of campistas) (c.nucleos ?? []).forEach((id, i) => { if (!m.has(id) && c.nucleos_nomes?.[i]) m.set(id, c.nucleos_nomes[i]) })
    return m
  }, [nucleos, campistas])
  const nomeNucleo = (id) => nomesNucleos.get(id)

  // Une as duas fontes por pessoa
  const pessoas = useMemo(() => {
    const mapa = new Map()
    const pessoa = (f, extra) => ({
      id: f.id, nome: f.nome_completo, cidade: f.cidade, uf: f.uf, bairro: f.bairro, telefone: f.telefone, email: f.email,
      status: f.status, modalidade: f.modalidade, participacoes: f.participacoes ?? [], ficha: f, ...extra,
    })
    // Pré-fichas que o usuário pode ver (coordenador: só do seu núcleo) — pode alterar
    for (const f of fichas) mapa.set(f.id, pessoa(f, { editavel: f.editavel !== false, preficha: true }))
    // Campistas de todos os núcleos — ficha completa; altera só se for do seu núcleo
    for (const c of campistas) {
      if (!mapa.has(c.id)) mapa.set(c.id, pessoa(c, { editavel: c.da_minha_area, preficha: false }))
    }
    for (const p of mapa.values()) p.nucleos = (p.ficha.nucleos ?? []).map(nomeNucleo).filter(Boolean)
    return [...mapa.values()]
      .map((p) => ({ ...p, campista: p.participacoes.length > 0, letra: inicial(p.nome) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
  }, [fichas, campistas, nucleos]) // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = useMemo(() => {
    const t = normalizar(busca.trim())
    return pessoas.filter((p) => {
      if (tipo === 'prefichas' && (p.campista || !p.preficha)) return false
      if (tipo === 'campistas' && !p.campista) return false
      return !t || [p.nome, p.cidade, p.bairro, ...p.nucleos].some((v) => normalizar(v).includes(t))
    })
  }, [pessoas, tipo, busca])

  const porLetra = useMemo(() => {
    const g = new Map()
    for (const p of visiveis) g.set(p.letra, [...(g.get(p.letra) ?? []), p])
    return g
  }, [visiveis])

  const total = {
    todos: pessoas.length,
    prefichas: pessoas.filter((p) => p.preficha && !p.campista).length,
    campistas: pessoas.filter((p) => p.campista).length,
  }

  function exportar() {
    baixarCsv(`nomes-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Nome', 'Tipo', 'Telefone', 'E-mail', 'Cidade', 'Bairro', 'Núcleo', 'Situação / acampamentos'],
      visiveis.map((p) => [p.nome, p.campista ? 'Campista' : 'Pré-ficha', p.telefone, p.email, `${p.cidade}/${p.uf}`, p.bairro ?? '',
        p.nucleos.join(', '), p.campista ? acampamentosTexto(p.participacoes) : rotuloDe(STATUS, p.status)]))
  }

  async function atualizar(id, campos) {
    const f = await api.patch(`/api/admin/pre-fichas/${id}`, campos)
    setLinhas((ls) => ls.map((l) => (l.id === id ? f : l)))
    setSelecionada((s) => ({ ...s, ficha: f, status: f.status }))
    return true
  }
  const reabrir = async (id) => {
    const l = await recarregar()
    const f = l?.find((x) => x.id === id)
    if (f) setSelecionada((s) => ({ ...s, ficha: f }))
  }

  const abaRotulos = [
    ['todos', 'Todos'],
    ['prefichas', coordenador ? 'Pré-fichas do meu núcleo' : 'Pré-fichas'],
    ['campistas', 'Todos os campistas'],
  ]

  return (
    <>
      <div className="titulo-secao">
        <h1>Nomes (A–Z)</h1>
        <p className="subtitulo">
          {coordenador
            ? `Pré-fichas apenas do seu núcleo${nucleos.length ? ` (${nucleos.map((n) => n.nome).join(', ')})` : ''} e todos os campistas de todos os núcleos (ficha completa), em ordem alfabética. Campistas de outros núcleos abrem em modo consulta.`
            : 'Pré-fichas e campistas, em ordem alfabética.'}
        </p>
      </div>

      <nav className="abas" aria-label="Tipo">
        {abaRotulos.map(([v, r]) => (
          <button key={v} className={`aba ${tipo === v ? 'ativa' : ''}`} onClick={() => setTipo(v)}>
            {r} <span className="contador">{total[v]}</span>
          </button>
        ))}
      </nav>

      <div className="filtros">
        <input type="search" placeholder="Buscar por nome, cidade, bairro ou núcleo" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="botao-secundario" onClick={exportar} disabled={!visiveis.length}>Exportar CSV</button>
      </div>

      <div className="indice-letras" aria-label="Ir para a letra">
        {LETRAS.map((l) => (
          <a key={l} href={`#letra-${l}`} className={porLetra.has(l) ? '' : 'vazia'}
            onClick={(e) => { e.preventDefault(); document.getElementById(`letra-${l}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{l}</a>
        ))}
      </div>

      {LETRAS.filter((l) => porLetra.has(l)).map((l) => (
        <section key={l} id={`letra-${l}`} className="grupo-letra">
          <h2 className="letra">{l}</h2>
          <div className="tabela-wrap">
            <table className="tabela">
              <tbody>
                {porLetra.get(l).map((p) => (
                  <tr key={p.id} className="clicavel" onClick={() => setSelecionada(p)}>
                    <td className="col-nome"><strong>{p.nome}</strong></td>
                    <td><span className={`selo-tipo ${p.campista ? 'campista' : 'preficha'}`}>{p.campista ? 'Campista' : 'Pré-ficha'}</span></td>
                    <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                      {linkWhatsApp(p.telefone) ? <a href={linkWhatsApp(p.telefone)} target="_blank" rel="noreferrer">{p.telefone}</a> : p.telefone}
                    </td>
                    <td>{p.cidade}/{p.uf}{p.bairro && <small className="dica bloco">{p.bairro}</small>}</td>
                    <td>{p.nucleos.length ? p.nucleos.join(', ') : <span className="dica">sem núcleo</span>}</td>
                    <td>
                      {p.campista
                        ? p.participacoes.map((x, i) => (
                          <span key={i} className="acamp-tribo">{x.numero}º {rotuloDe(MODALIDADES, x.modalidade)} · <CorTribo tribo={x.tribo} marca={marca} /></span>
                        ))
                        : <span className={`selo-status status-${p.status}`}>{rotuloDe(STATUS, p.status)}{posicoes.get(p.id) ? ` · ${posicoes.get(p.id)}º na fila` : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!visiveis.length && <p className="vazio">Nenhum nome encontrado.</p>}

      {selecionada && (
        <Detalhe
          ficha={selecionada.ficha} marca={marca} usuario={usuario} todas={fichas}
          somenteLeitura={!selecionada.editavel}
          posicao={posicoes.get(selecionada.id)} nomeNucleo={nomeNucleo}
          onFechar={() => setSelecionada(null)}
          onSalvar={(campos) => atualizar(selecionada.id, campos)}
          onFilaAlterada={(f) => reabrir(f.id)}
          onFichaAtualizada={(f) => reabrir(f.id)}
        />
      )}
    </>
  )
}
