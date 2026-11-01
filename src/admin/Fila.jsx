import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { MODALIDADES, STATUS, STATUS_NA_FILA, rotuloDe } from '../lib/opcoes.js'
import { calcularIdade, formatarDataHora, linkWhatsApp, somenteDigitos } from '../lib/util.js'
import Detalhe from './Detalhe.jsx'
import { exportarCsv } from './csv.js'

const LOTE = 1000

async function carregarTodas() {
  const linhas = []
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await supabase
      .from('pre_fichas')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(de, de + LOTE - 1)
    if (error) throw error
    linhas.push(...data)
    if (data.length < LOTE) return linhas
  }
}

/** Posição na fila: por modalidade, ordem de chegada, contando só quem ainda está na fila. */
function calcularPosicoes(linhas) {
  const contador = {}
  const posicoes = new Map()
  for (const l of linhas) {
    if (!STATUS_NA_FILA.includes(l.status)) continue
    contador[l.modalidade] = (contador[l.modalidade] || 0) + 1
    posicoes.set(l.id, contador[l.modalidade])
  }
  return posicoes
}

/** Marca fichas com o mesmo e-mail ou telefone (possível cadastro repetido). */
function calcularDuplicados(linhas) {
  const porChave = new Map()
  for (const l of linhas) {
    for (const chave of [`e:${l.email}`, `t:${somenteDigitos(l.telefone)}`]) {
      porChave.set(chave, (porChave.get(chave) || 0) + 1)
    }
  }
  return new Set(
    linhas
      .filter((l) => porChave.get(`e:${l.email}`) > 1 || porChave.get(`t:${somenteDigitos(l.telefone)}`) > 1)
      .map((l) => l.id),
  )
}

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function Fila({ usuario }) {
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [modalidade, setModalidade] = useState('todas')
  const [filtroStatus, setFiltroStatus] = useState('fila')
  const [busca, setBusca] = useState('')
  const [selecionada, setSelecionada] = useState(null)

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      setLinhas(await carregarTodas())
    } catch (e) {
      console.error(e)
      setErro('Não foi possível carregar a fila. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  const posicoes = useMemo(() => calcularPosicoes(linhas), [linhas])
  const duplicados = useMemo(() => calcularDuplicados(linhas), [linhas])

  const contagemFila = useMemo(() => {
    const c = { todas: 0 }
    for (const l of linhas) {
      if (!STATUS_NA_FILA.includes(l.status)) continue
      c.todas++
      c[l.modalidade] = (c[l.modalidade] || 0) + 1
    }
    return c
  }, [linhas])

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim())
    const termoDigitos = somenteDigitos(busca)
    return linhas.filter((l) => {
      if (modalidade !== 'todas' && l.modalidade !== modalidade) return false
      if (filtroStatus === 'fila' && !STATUS_NA_FILA.includes(l.status)) return false
      if (filtroStatus !== 'fila' && filtroStatus !== 'todos' && l.status !== filtroStatus) return false
      if (!termo) return true
      return (
        normalizar(l.nome_completo).includes(termo) ||
        normalizar(l.email).includes(termo) ||
        normalizar(l.cidade).includes(termo) ||
        normalizar(l.paroquia).includes(termo) ||
        (termoDigitos.length >= 4 && somenteDigitos(l.telefone).includes(termoDigitos))
      )
    })
  }, [linhas, modalidade, filtroStatus, busca])

  async function atualizar(id, campos) {
    const { data, error } = await supabase.from('pre_fichas').update(campos).eq('id', id).select().single()
    if (error) {
      console.error(error)
      alert('Não foi possível salvar a alteração.')
      return false
    }
    setLinhas((ls) => ls.map((l) => (l.id === id ? data : l)))
    setSelecionada((s) => (s?.id === id ? data : s))
    return true
  }

  return (
    <div className="painel">
      <header className="painel-topo">
        <div>
          <h1>Fila de espera</h1>
          <p className="subtitulo">{contagemFila.todas} pessoa(s) aguardando · ordem por data e hora de inscrição</p>
        </div>
        <div className="painel-usuario">
          <span>{usuario.email}</span>
          <button className="botao-secundario" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      <nav className="abas" aria-label="Modalidades">
        {[{ valor: 'todas', rotulo: 'Todas' }, ...MODALIDADES].map((m) => (
          <button key={m.valor} className={`aba ${modalidade === m.valor ? 'ativa' : ''}`}
            onClick={() => setModalidade(m.valor)}>
            {m.rotulo} <span className="contador">{contagemFila[m.valor] || 0}</span>
          </button>
        ))}
      </nav>

      <div className="filtros">
        <input type="search" placeholder="Buscar por nome, e-mail, telefone, cidade ou paróquia"
          value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Status">
          <option value="fila">Na fila (aguardando + em contato)</option>
          <option value="todos">Todos os status</option>
          {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
        <button className="botao-secundario" onClick={recarregar} disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
        <button className="botao-secundario" onClick={() => exportarCsv(visiveis, posicoes)} disabled={!visiveis.length}>
          Exportar CSV
        </button>
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              <th title="Posição na fila da modalidade">Pos.</th>
              <th>Inscrição</th>
              <th>Nome</th>
              <th>Idade</th>
              <th>Modalidade</th>
              <th>Cidade</th>
              <th>Telefone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const wa = linkWhatsApp(l.telefone)
              return (
                <tr key={l.id} onClick={() => setSelecionada(l)} className="clicavel">
                  <td className="posicao">{posicoes.get(l.id) ?? '—'}</td>
                  <td className="nowrap">{formatarDataHora(l.created_at)}</td>
                  <td>
                    {l.nome_completo}
                    {duplicados.has(l.id) && <span className="selo alerta" title="Mesmo e-mail ou telefone de outra ficha">possível duplicado</span>}
                  </td>
                  <td>{calcularIdade(l.data_nascimento)}</td>
                  <td>{rotuloDe(MODALIDADES, l.modalidade)}</td>
                  <td>{l.cidade}/{l.uf}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {wa ? <a href={wa} target="_blank" rel="noreferrer">{l.telefone}</a> : l.telefone}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className={`status status-${l.status}`} value={l.status}
                      onChange={(e) => atualizar(l.id, { status: e.target.value })} aria-label="Alterar status">
                      {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
            {!carregando && !visiveis.length && (
              <tr><td colSpan={8} className="vazio">Nenhuma pré-ficha encontrada com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selecionada && (
        <Detalhe
          ficha={selecionada}
          posicao={posicoes.get(selecionada.id)}
          onFechar={() => setSelecionada(null)}
          onSalvar={(campos) => atualizar(selecionada.id, campos)}
        />
      )}
    </div>
  )
}
