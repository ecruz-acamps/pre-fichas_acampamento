import { Fragment, useMemo, useState } from 'react'
import { MODALIDADES, STATUS, STATUS_NA_FILA } from '../../shared/opcoes.js'
import { chaveLocal, melhorGrafia } from '../../shared/util.js'
import { SeletorNucleo, filtrarNucleo, useFichas } from './Fila.jsx'
import { baixarCsv } from './csv.js'

const vazio = () => ({ total: 0, ...Object.fromEntries(MODALIDADES.map((m) => [m.valor, 0])) })

/** Agrupa as fichas por cidade e bairro, contando por modalidade. */
function agrupar(linhas) {
  const cidades = new Map()
  const total = vazio()
  for (const l of linhas) {
    const ck = `${l.uf}|${chaveLocal(l.cidade)}`
    const cidade = cidades.get(ck) ?? { chave: ck, nomeCidade: l.cidade, uf: l.uf, ...vazio(), bairros: new Map() }
    cidade.nomeCidade = melhorGrafia(cidade.nomeCidade, l.cidade)
    cidade.nome = `${cidade.nomeCidade}/${l.uf}`
    const bk = chaveLocal(l.bairro) ?? '(sem bairro)'
    const bairro = cidade.bairros.get(bk) ?? { chave: bk, nome: l.bairro || '(bairro não informado)', ...vazio() }
    if (l.bairro) bairro.nome = melhorGrafia(bairro.nome, l.bairro)
    for (const alvo of [cidade, bairro, total]) { alvo.total++; alvo[l.modalidade]++ }
    cidade.bairros.set(bk, bairro)
    cidades.set(ck, cidade)
  }
  const ordenar = (a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR')
  return {
    total,
    cidades: [...cidades.values()].sort(ordenar).map((c) => ({ ...c, bairros: [...c.bairros.values()].sort(ordenar) })),
  }
}

export default function Resumo({ usuario, nucleos }) {
  const { linhas, carregando, erro } = useFichas()
  const [nucleo, setNucleo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('fila')
  const [abertas, setAbertas] = useState(() => new Set())
  const coordenador = usuario.papel === 'coordenador'

  const filtradas = useMemo(() => filtrarNucleo(linhas, nucleo).filter((l) =>
    filtroStatus === 'todos' || (filtroStatus === 'fila' ? STATUS_NA_FILA.includes(l.status) : l.status === filtroStatus)),
  [linhas, nucleo, filtroStatus])
  const { total, cidades } = useMemo(() => agrupar(filtradas), [filtradas])

  const alternar = (chave) => setAbertas((s) => {
    const n = new Set(s)
    if (n.has(chave)) n.delete(chave); else n.add(chave)
    return n
  })

  function exportar() {
    const linhasCsv = []
    for (const c of cidades) {
      for (const b of c.bairros) linhasCsv.push([c.nome, b.nome, ...MODALIDADES.map((m) => b[m.valor]), b.total])
    }
    baixarCsv(`resumo-por-cidade-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Cidade', 'Bairro', ...MODALIDADES.map((m) => m.rotulo), 'Total'], linhasCsv)
  }

  const celulas = (g) => (
    <>
      {MODALIDADES.map((m) => <td key={m.valor} className={`num ${g[m.valor] ? '' : 'zero'}`}>{g[m.valor]}</td>)}
      <td className="num total">{g.total}</td>
    </>
  )

  return (
    <>
      <div className="titulo-secao">
        <h1>Resumo por cidade e bairro</h1>
        <p className="subtitulo">Quantas pessoas há em cada lugar, por modalidade — para saber quem chamar em cada acampamento.</p>
      </div>

      <div className="filtros">
        <SeletorNucleo nucleos={nucleos} coordenador={coordenador} valor={nucleo} onChange={setNucleo} />
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} aria-label="Status">
          <option value="fila">Na fila (aguardando + em contato)</option>
          <option value="todos">Todos os status</option>
          {STATUS.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
        <button className="botao-secundario" onClick={() => setAbertas(new Set(cidades.map((c) => c.chave)))}>Abrir todos os bairros</button>
        <button className="botao-secundario" onClick={exportar} disabled={!cidades.length}>Exportar CSV</button>
      </div>

      <div className="cartoes-resumo">
        {MODALIDADES.map((m) => (
          <div key={m.valor} className="cartao-numero">
            <span>{m.rotulo}</span>
            <strong>{total[m.valor]}</strong>
            <small>{m.faixa}</small>
          </div>
        ))}
        <div className="cartao-numero destaque-total">
          <span>Total</span>
          <strong>{total.total}</strong>
          <small>{cidades.length} cidade(s)</small>
        </div>
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}

      <div className="tabela-wrap">
        <table className="tabela resumo">
          <thead>
            <tr>
              <th>Cidade / bairro</th>
              {MODALIDADES.map((m) => <th key={m.valor} className="num">{m.rotulo}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {cidades.map((c) => (
              <Fragment key={c.chave}>
                <tr className="clicavel linha-cidade" onClick={() => alternar(c.chave)}>
                  <td>
                    <span className="seta" aria-hidden="true">{abertas.has(c.chave) ? '▾' : '▸'}</span>
                    <strong>{c.nome}</strong> <small className="dica">{c.bairros.length} bairro(s)</small>
                  </td>
                  {celulas(c)}
                </tr>
                {abertas.has(c.chave) && c.bairros.map((b) => (
                  <tr key={b.chave} className="linha-bairro">
                    <td>{b.nome}</td>
                    {celulas(b)}
                  </tr>
                ))}
              </Fragment>
            ))}
            {!carregando && !cidades.length && (
              <tr><td colSpan={MODALIDADES.length + 2} className="vazio">Nenhuma pré-ficha com esses filtros.</td></tr>
            )}
          </tbody>
          {cidades.length > 0 && (
            <tfoot>
              <tr><td>Total</td>{celulas(total)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}
