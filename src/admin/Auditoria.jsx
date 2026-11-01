import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { formatarDataHora } from '../../shared/util.js'
import { DescricaoEvento, SeloTipo, TIPOS_EVENTO, autorEvento } from './EventoAuditoria.jsx'
import { baixarCsv } from './csv.js'

const hoje = () => new Date().toLocaleDateString('sv-SE')
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const ATALHOS = [
  { rotulo: 'Movimentações na fila (recusas e fim da fila)', tipos: 'recusa,fim_da_fila' },
  { rotulo: 'Só "fim da fila"', tipos: 'fim_da_fila' },
  { rotulo: 'Preferências e vínculos de cônjuge', tipos: 'preferencia,conjuge' },
  { rotulo: 'Todos os eventos', tipos: '' },
]

export default function Auditoria() {
  const [tipos, setTipos] = useState('recusa,fim_da_fila')
  const [de, setDe] = useState(diasAtras(90))
  const [ate, setAte] = useState(hoje())
  const [busca, setBusca] = useState('')
  const [eventos, setEventos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    const q = new URLSearchParams({ limite: '2000' })
    if (tipos) q.set('tipo', tipos)
    if (de) q.set('de', de)
    if (ate) q.set('ate', ate)
    try {
      setEventos(await api.get(`/api/admin/auditoria?${q}`))
    } catch {
      setErro('Não foi possível carregar a auditoria.')
    } finally {
      setCarregando(false)
    }
  }, [tipos, de, ate])

  useEffect(() => { carregar() }, [carregar])

  const visiveis = useMemo(() => {
    const t = normalizar(busca.trim())
    if (!t) return eventos
    return eventos.filter((e) => [e.nome_completo, e.usuario, e.observacao, e.cidade].some((v) => normalizar(v).includes(t)))
  }, [eventos, busca])

  const contagem = useMemo(() => {
    const c = {}
    for (const e of visiveis) c[e.tipo] = (c[e.tipo] || 0) + 1
    return c
  }, [visiveis])

  function exportar() {
    baixarCsv(`auditoria-${de || 'inicio'}-a-${ate || hoje()}.csv`,
      ['Data/hora', 'Evento', 'Pessoa', 'Modalidade', 'Cidade', 'Feito por', 'Status anterior', 'Status novo',
        'Comentário / motivo', 'Na fila desde (antes)', 'Na fila desde (depois)', 'Recusa nº'],
      visiveis.map((e) => [
        formatarDataHora(e.criado_em), TIPOS_EVENTO.find((t) => t.valor === e.tipo)?.rotulo ?? e.tipo,
        e.nome_completo, rotuloDe(MODALIDADES, e.modalidade), `${e.cidade}/${e.uf}`, autorEvento(e),
        e.status_anterior ?? '', e.status_novo ?? '', e.observacao ?? '',
        e.detalhes?.entrada_anterior ? formatarDataHora(e.detalhes.entrada_anterior) : '',
        e.detalhes?.entrada_nova ? formatarDataHora(e.detalhes.entrada_nova) : '',
        e.detalhes?.numero ?? '',
      ]))
  }

  return (
    <>
      <div className="titulo-secao">
        <h1>Auditoria</h1>
        <p className="subtitulo">
          Tudo o que aconteceu com as pré-fichas: quem fez, quando e por quê. Os registros são gravados pelo
          banco de dados e não podem ser editados.
        </p>
      </div>

      <div className="filtros">
        <select value={tipos} onChange={(e) => setTipos(e.target.value)} aria-label="Tipo de evento">
          {ATALHOS.map((a) => <option key={a.tipos} value={a.tipos}>{a.rotulo}</option>)}
          {TIPOS_EVENTO.filter((t) => !ATALHOS.some((a) => a.tipos === t.valor)).map((t) => (
            <option key={t.valor} value={t.valor}>Só "{t.rotulo}"</option>
          ))}
        </select>
        <label className="campo-inline">De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="campo-inline">Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <input type="search" placeholder="Filtrar por pessoa, usuário ou comentário" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="botao-secundario" onClick={carregar} disabled={carregando}>{carregando ? 'Carregando…' : 'Atualizar'}</button>
        <button className="botao-secundario" onClick={exportar} disabled={!visiveis.length}>Exportar CSV</button>
      </div>

      <div className="tribos-contagem">
        {TIPOS_EVENTO.filter((t) => contagem[t.valor]).map((t) => (
          <span key={t.valor} className="chip-tribo"><SeloTipo tipo={t.valor} /><strong>{contagem[t.valor]}</strong></span>
        ))}
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}
      {eventos.length >= 2000 && <div className="alerta-aviso">Mostrando os 2000 eventos mais recentes. Reduza o período para ver os demais.</div>}

      <div className="tabela-wrap">
        <table className="tabela auditoria">
          <thead><tr><th>Quando</th><th>Evento</th><th>Pessoa</th><th>O que aconteceu</th><th>Feito por</th></tr></thead>
          <tbody>
            {visiveis.map((e) => (
              <tr key={e.id} className={`evento-${e.tipo}`}>
                <td className="nowrap">{formatarDataHora(e.criado_em)}</td>
                <td><SeloTipo tipo={e.tipo} /></td>
                <td>{e.nome_completo}<small className="dica bloco">{rotuloDe(MODALIDADES, e.modalidade)} · {e.cidade}/{e.uf}</small></td>
                <td><DescricaoEvento e={e} /></td>
                <td>{autorEvento(e)}</td>
              </tr>
            ))}
            {!carregando && !visiveis.length && <tr><td colSpan={5} className="vazio">Nenhum evento neste período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
