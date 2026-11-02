import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { CorTribo } from '../lib/marca.jsx'
import { MODALIDADES, STATUS, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade, formatarData } from '../../shared/util.js'
import { calcularPosicoes, useFichas } from './Fila.jsx'
import { SeloPreferencia, preferenciaAtiva } from './Preferencia.jsx'
import { baixarCsv } from './csv.js'

const nomeAcampamento = (a) => `${a.numero}º ${rotuloDe(MODALIDADES, a.modalidade)}`
const periodo = (a) => (a.data_inicio
  ? `${formatarData(a.data_inicio)}${a.data_fim && a.data_fim !== a.data_inicio ? ` a ${formatarData(a.data_fim)}` : ''}`
  : 'sem data')
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function FormAcampamento({ inicial, onSalvar, onCancelar }) {
  const [a, setA] = useState(inicial ?? { numero: '', modalidade: 'juvenil', data_inicio: '', data_fim: '', observacao: '' })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    setErro(''); setSalvando(true)
    try {
      await onSalvar({ ...a, numero: Number(a.numero) })
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="cartao form-acampamento" onSubmit={salvar}>
      <h2>{inicial ? `Editar ${nomeAcampamento(inicial)}` : 'Cadastrar acampamento realizado'}</h2>
      <div className="linha-form cinco">
        <div className="campo">
          <label htmlFor="ac-numero">Número</label>
          <input id="ac-numero" type="number" min="1" required placeholder="Ex.: 45" value={a.numero}
            onChange={(e) => setA({ ...a, numero: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ac-modalidade">Modalidade</label>
          <select id="ac-modalidade" value={a.modalidade} onChange={(e) => setA({ ...a, modalidade: e.target.value })}>
            {MODALIDADES.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="ac-inicio">Início</label>
          <input id="ac-inicio" type="date" value={a.data_inicio ?? ''} onChange={(e) => setA({ ...a, data_inicio: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ac-fim">Fim</label>
          <input id="ac-fim" type="date" value={a.data_fim ?? ''} onChange={(e) => setA({ ...a, data_fim: e.target.value })} />
        </div>
        <div className="botoes-form">
          <button className="botao-principal pequeno" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          {onCancelar && <button type="button" className="botao-secundario" onClick={onCancelar}>Cancelar</button>}
        </div>
      </div>
      <div className="campo">
        <label htmlFor="ac-obs">Observação (opcional)</label>
        <input id="ac-obs" maxLength={1000} value={a.observacao ?? ''} onChange={(e) => setA({ ...a, observacao: e.target.value })} />
      </div>
      {erro && <div className="alerta-erro">{erro}</div>}
    </form>
  )
}

function SeletorTribo({ marca, valor, onChange, rotuloVazio = 'Tribo…', incluirVazio = true }) {
  return (
    <select className="seletor-tribo" value={valor ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="Tribo">
      {incluirVazio && <option value="">{rotuloVazio}</option>}
      {marca.tribos.map((t) => <option key={t.nome} value={t.nome}>{t.nome}</option>)}
      <option value="__sem">(sem tribo)</option>
    </select>
  )
}

function DetalheAcampamento({ acampamento: base, marca, onVoltar, onAlterado }) {
  const [a, setA] = useState(null)
  const [editando, setEditando] = useState(false)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [todasModalidades, setTodasModalidades] = useState(false)
  const { linhas: fichas, recarregar: recarregarFichas } = useFichas()

  const carregar = useCallback(() => api.get(`/api/admin/acampamentos/${base.id}`).then(setA).catch(() => setErro('Falha ao carregar.')), [base.id])
  useEffect(() => { carregar() }, [carregar])

  const posicoes = useMemo(() => calcularPosicoes(fichas), [fichas])
  const participantesIds = useMemo(() => new Set(a?.participantes.map((p) => p.pre_ficha_id)), [a])
  const porTribo = useMemo(() => {
    const c = {}
    for (const p of a?.participantes ?? []) c[p.tribo ?? ''] = (c[p.tribo ?? ''] || 0) + 1
    return c
  }, [a])

  // Candidatos: quem ainda não foi registrado nesta edição. Confirmados primeiro, depois a ordem da fila.
  // Preferência só conta nas edições que ela cobre (ex.: cônjuge fez o 24º → 25º e 26º)
  const temPref = (f) => {
    if (marca?.preferenciaConjuge === false) return false
    const p = preferenciaAtiva(f)
    return Boolean(p && a && p.modalidade === a.modalidade && a.numero >= p.valida_de && a.numero <= p.valida_ate)
  }
  const candidatos = useMemo(() => {
    if (!a) return []
    const termo = normalizar(busca.trim())
    const peso = { confirmado: 0, em_contato: 1, aguardando: 2, participou: 3, desistiu: 4 }
    return fichas
      .filter((f) => !participantesIds.has(f.id))
      .filter((f) => todasModalidades || f.modalidade === a.modalidade)
      .filter((f) => !termo || [f.nome_completo, f.cidade, f.bairro, f.telefone].some((v) => normalizar(v).includes(termo)))
      // Preferência ativa (cônjuge) nesta modalidade vem primeiro, depois status e ordem da fila
      .sort((x, y) => Number(temPref(y)) - Number(temPref(x)) ||
        peso[x.status] - peso[y.status] || (posicoes.get(x.id) ?? 1e9) - (posicoes.get(y.id) ?? 1e9))
      .slice(0, 200)
  }, [a, fichas, participantesIds, todasModalidades, busca, posicoes])

  async function registrar(fichaId, tribo) {
    setErro('')
    try {
      await api.put(`/api/admin/acampamentos/${base.id}/participantes/${fichaId}`, { tribo: tribo === '__sem' ? null : tribo })
      await Promise.all([carregar(), recarregarFichas()])
      onAlterado()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível registrar.')
    }
  }

  async function remover(p) {
    if (!confirm(`Remover ${p.nome_completo} do ${nomeAcampamento(a)}? A ficha voltará como "Confirmado".`)) return
    try {
      await api.delete(`/api/admin/acampamentos/${base.id}/participantes/${p.pre_ficha_id}`)
      await Promise.all([carregar(), recarregarFichas()])
      onAlterado()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível remover.')
    }
  }

  async function excluir() {
    if (!confirm(`Excluir o cadastro do ${nomeAcampamento(a)}?`)) return
    try {
      await api.delete(`/api/admin/acampamentos/${base.id}`)
      onAlterado(); onVoltar()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível excluir.')
    }
  }

  function exportar() {
    baixarCsv(`acampamento-${a.numero}-${a.modalidade}.csv`, ['Tribo', 'Nome', 'Idade', 'Telefone', 'Cidade', 'Bairro'],
      a.participantes.map((p) => [p.tribo ?? '', p.nome_completo, calcularIdade(p.data_nascimento), p.telefone, `${p.cidade}/${p.uf}`, p.bairro ?? '']))
  }

  if (!a) return <p className="carregando">{erro || 'Carregando…'}</p>

  return (
    <>
      <button className="link voltar" onClick={onVoltar}>← Todos os acampamentos</button>
      {editando ? (
        <FormAcampamento inicial={a} onCancelar={() => setEditando(false)} onSalvar={async (dados) => {
          await api.patch(`/api/admin/acampamentos/${a.id}`, dados)
          setEditando(false); carregar(); onAlterado()
        }} />
      ) : (
        <div className="titulo-secao com-acoes">
          <div>
            <h1>{nomeAcampamento(a)}</h1>
            <p className="subtitulo">{periodo(a)} · {a.participantes.length} participante(s){a.observacao ? ` · ${a.observacao}` : ''}</p>
          </div>
          <div className="acoes-linha">
            <button className="botao-secundario" onClick={() => setEditando(true)}>Editar</button>
            <button className="botao-secundario" onClick={exportar} disabled={!a.participantes.length}>Exportar CSV</button>
            {a.participantes.length === 0 && <button className="botao-secundario perigo" onClick={excluir}>Excluir</button>}
          </div>
        </div>
      )}

      {erro && <div className="alerta-erro">{erro}</div>}

      <div className="tribos-contagem">
        {marca.tribos.map((t) => (
          <span key={t.nome} className="chip-tribo"><span className="bolinha" style={{ background: t.cor }} />{t.nome}<strong>{porTribo[t.nome] || 0}</strong></span>
        ))}
        {porTribo[''] > 0 && <span className="chip-tribo">Sem tribo<strong>{porTribo['']}</strong></span>}
      </div>

      <div className="duas-colunas">
        <section>
          <h2 className="subtitulo-secao">Fizeram este acampamento</h2>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Cidade / bairro</th><th>Tribo</th><th></th></tr></thead>
              <tbody>
                {a.participantes.map((p) => (
                  <tr key={p.pre_ficha_id}>
                    <td>{p.nome_completo}<small className="dica bloco">{calcularIdade(p.data_nascimento)} anos{p.modalidade !== a.modalidade ? ` · pediu ${rotuloDe(MODALIDADES, p.modalidade)}` : ''}</small></td>
                    <td>{p.cidade}/{p.uf}{p.bairro && <small className="dica bloco">{p.bairro}</small>}</td>
                    <td>
                      <CorTribo tribo={p.tribo} marca={marca} />
                      <SeletorTribo marca={marca} valor="" rotuloVazio="trocar…" onChange={(t) => t && registrar(p.pre_ficha_id, t)} />
                    </td>
                    <td><button className="link perigo" onClick={() => remover(p)}>remover</button></td>
                  </tr>
                ))}
                {!a.participantes.length && <tr><td colSpan={4} className="vazio">Ninguém registrado ainda. Use a lista ao lado.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="subtitulo-secao">Registrar quem fez</h2>
          <p className="dica">Escolha a tribo da pessoa para marcar que ela fez o {nomeAcampamento(a)}. Ela sai da fila de espera. {marca?.preferenciaConjuge !== false && 'Quem tem ★ preferência (cônjuge) aparece primeiro.'}</p>
          <div className="filtros">
            <input type="search" placeholder="Buscar por nome, cidade, bairro ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="check-inline">
              <input type="checkbox" checked={todasModalidades} onChange={(e) => setTodasModalidades(e.target.checked)} /> outras modalidades
            </label>
          </div>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Pos.</th><th>Nome</th><th>Status</th><th>Fez? Tribo</th></tr></thead>
              <tbody>
                {candidatos.map((f) => (
                  <tr key={f.id}>
                    <td className="posicao">{posicoes.get(f.id) ?? '—'}</td>
                    <td>{f.nome_completo} {marca?.preferenciaConjuge !== false && <SeloPreferencia ficha={f} />}<small className="dica bloco">{f.cidade}/{f.uf}{f.bairro ? ` · ${f.bairro}` : ''}</small></td>
                    <td><span className={`selo-status status-${f.status}`}>{rotuloDe(STATUS, f.status)}</span></td>
                    <td><SeletorTribo marca={marca} valor="" onChange={(t) => t && registrar(f.id, t)} /></td>
                  </tr>
                ))}
                {!candidatos.length && <tr><td colSpan={4} className="vazio">Nenhuma ficha encontrada.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}

export default function Acampamentos({ marca }) {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [selecionado, setSelecionado] = useState(null)
  const [criando, setCriando] = useState(false)

  const carregar = useCallback(() => api.get('/api/admin/acampamentos').then(setLista).finally(() => setCarregando(false)), [])
  useEffect(() => { carregar() }, [carregar])

  if (!marca) return <p className="carregando">Carregando…</p>
  if (selecionado) {
    return <DetalheAcampamento acampamento={selecionado} marca={marca} onVoltar={() => setSelecionado(null)} onAlterado={carregar} />
  }

  return (
    <>
      <div className="titulo-secao com-acoes">
        <div>
          <h1>Acampamentos realizados</h1>
          <p className="subtitulo">Cadastre cada edição (número + modalidade) e registre quem participou e a cor da tribo.</p>
        </div>
        {!criando && <button className="botao-principal pequeno" onClick={() => setCriando(true)}>+ Novo acampamento</button>}
      </div>

      {criando && (
        <FormAcampamento onCancelar={() => setCriando(false)} onSalvar={async (dados) => {
          const novo = await api.post('/api/admin/acampamentos', dados)
          setCriando(false); await carregar(); setSelecionado(novo)
        }} />
      )}

      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Acampamento</th><th>Período</th><th className="num">Participantes</th><th>Por tribo</th></tr></thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id} className="clicavel" onClick={() => setSelecionado(a)}>
                <td><strong>{nomeAcampamento(a)}</strong></td>
                <td>{periodo(a)}</td>
                <td className="num">{a.participantes}</td>
                <td>
                  <span className="mini-tribos">
                    {Object.entries(a.por_tribo).map(([nome, n]) => (
                      <span key={nome} title={nome || 'sem tribo'} className="mini-tribo">
                        <span className="bolinha" style={{ background: marca.tribos.find((t) => t.nome === nome)?.cor ?? '#ccc' }} />{n}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
            {!carregando && !lista.length && <tr><td colSpan={4} className="vazio">Nenhum acampamento cadastrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
