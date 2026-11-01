import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { UFS } from '../../shared/opcoes.js'
import { chaveLocal } from '../../shared/util.js'

/**
 * Divide uma cidade entre núcleos, bairro a bairro (ex.: Palhoça → Centro,
 * Ponte do Imaruim, Aririu e São Sebastião). Cada bairro fica em no máximo um núcleo.
 */
export default function DividirCidade({ nucleos, localidades, onSalvo, onCancelar, onNucleoCriado }) {
  const [uf, setUf] = useState('SC')
  const [cidade, setCidade] = useState('')
  const [dados, setDados] = useState(null) // resposta do servidor
  const [linhas, setLinhas] = useState([]) // [{chave, bairro, fichas, na_fila, nucleo_id}]
  const [novos, setNovos] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [salvando, setSalvando] = useState(false)

  const cidades = useMemo(() => [...new Map(localidades.filter((l) => l.uf === uf)
    .map((l) => [chaveLocal(l.cidade), l.cidade])).values()].sort((a, b) => a.localeCompare(b, 'pt-BR')), [localidades, uf])

  async function carregar(e, manterMensagem = false) {
    e?.preventDefault()
    setErro('')
    if (!manterMensagem) setOk('')
    try {
      const r = await api.get(`/api/admin/nucleos/divisao?uf=${uf}&cidade=${encodeURIComponent(cidade)}`)
      setDados(r)
      setLinhas(r.bairros.map((b) => ({ ...b, nucleo_id: b.nucleo_id ?? '' })))
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível carregar os bairros.')
    }
  }

  function adicionarBairros() {
    const existentes = new Set(linhas.map((l) => chaveLocal(l.bairro)))
    const extras = novos.split(/\n|;/).map((b) => b.trim()).filter((b) => b && !existentes.has(chaveLocal(b)))
    const unicos = [...new Map(extras.map((b) => [chaveLocal(b), b])).values()]
    setLinhas([...linhas, ...unicos.map((b) => ({ chave: chaveLocal(b), bairro: b, fichas: 0, na_fila: 0, nucleo_id: '' }))]
      .sort((a, b) => a.bairro.localeCompare(b.bairro, 'pt-BR')))
    setNovos('')
  }

  async function criarNucleo() {
    const nome = prompt('Nome do novo núcleo (ex.: Ponte do Imaruim):')
    if (!nome?.trim()) return
    try {
      await api.post('/api/admin/nucleos', { nome: nome.trim(), areas: [] })
      await onNucleoCriado()
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível criar o núcleo.')
    }
  }

  const alterar = (i, nucleoId) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, nucleo_id: nucleoId } : l)))
  const semNucleo = linhas.filter((l) => !l.nucleo_id)
  const resumo = nucleos.map((n) => ({
    ...n,
    bairros: linhas.filter((l) => Number(l.nucleo_id) === n.id).length,
    pessoas: linhas.filter((l) => Number(l.nucleo_id) === n.id).reduce((s, l) => s + l.na_fila, 0),
  })).filter((n) => n.bairros)

  async function salvar() {
    if (dados.cidade_inteira.length &&
      !confirm(`Hoje ${dados.cidade_inteira.map((n) => n.nome).join(', ')} atende ${dados.cidade} inteira. Ao salvar, isso é substituído pela divisão por bairros. Continuar?`)) return
    setErro(''); setOk(''); setSalvando(true)
    try {
      await api.put('/api/admin/nucleos/divisao', {
        uf, cidade: dados.cidade,
        atribuicoes: linhas.map((l) => ({ bairro: l.bairro, nucleo_id: l.nucleo_id ? Number(l.nucleo_id) : null })),
      })
      await onSalvo()
      await carregar(null, true)
      setOk(`Divisão de ${dados.cidade} salva. Os coordenadores de cada núcleo já veem as fichas dos seus bairros.`)
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="cartao dividir-cidade">
      <h2>Dividir cidade por bairros</h2>
      <p className="dica">
        Para cidades atendidas por mais de um núcleo (ex.: Palhoça). Escolha a cidade e indique o núcleo de cada bairro.
        Os bairros vêm das pré-fichas recebidas; acrescente os que ainda não apareceram.
      </p>
      <form className="linha-form tres-col" onSubmit={carregar}>
        <div className="campo">
          <label htmlFor="div-uf">UF</label>
          <select id="div-uf" value={uf} onChange={(e) => setUf(e.target.value)}>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="div-cidade">Cidade</label>
          <input id="div-cidade" list="div-cidades" required value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Palhoça" />
          <datalist id="div-cidades">{cidades.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <button className="botao-principal pequeno">Carregar bairros</button>
      </form>

      {erro && <div className="alerta-erro">{erro}</div>}
      {ok && <div className="alerta-ok">{ok}</div>}

      {dados && (
        <>
          {dados.cidade_inteira.length > 0 && (
            <div className="alerta-aviso">
              Hoje {dados.cidade_inteira.map((n) => n.nome).join(', ')} atende {dados.cidade} inteira. A divisão por bairros vai substituir isso.
            </div>
          )}
          {dados.sem_bairro > 0 && (
            <div className="alerta-aviso">
              {dados.sem_bairro} pré-ficha(s) de {dados.cidade} estão sem bairro informado e não ficarão em nenhum núcleo — o
              administrador e a equipe continuam vendo essas fichas na fila.
            </div>
          )}

          {resumo.length > 0 && (
            <div className="chips resumo-divisao">
              {resumo.map((n) => <span key={n.id} className="chip">{n.nome}: {n.bairros} bairro(s) · {n.pessoas} na fila</span>)}
              {semNucleo.length > 0 && <span className="chip sem">{semNucleo.length} bairro(s) sem núcleo</span>}
            </div>
          )}

          <table className="tabela tabela-divisao">
            <thead><tr><th>Bairro</th><th className="num">Pré-fichas</th><th className="num">Na fila</th><th>Núcleo</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={l.chave ?? l.bairro} className={l.nucleo_id ? '' : 'sem-nucleo'}>
                  <td>{l.bairro}</td>
                  <td className="num">{l.fichas}</td>
                  <td className="num">{l.na_fila}</td>
                  <td>
                    <select value={l.nucleo_id} onChange={(e) => alterar(i, e.target.value)} aria-label={`Núcleo do bairro ${l.bairro}`}>
                      <option value="">— sem núcleo —</option>
                      {nucleos.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {!linhas.length && <tr><td colSpan={4} className="vazio">Nenhum bairro ainda. Acrescente abaixo.</td></tr>}
            </tbody>
          </table>

          <div className="campo">
            <label htmlFor="div-novos">Acrescentar bairros (um por linha)</label>
            <textarea id="div-novos" rows={3} value={novos} onChange={(e) => setNovos(e.target.value)} placeholder={'Bela Vista\nJardim Eldorado'} />
            <div className="acoes-linha">
              <button type="button" className="botao-secundario" onClick={adicionarBairros} disabled={!novos.trim()}>Acrescentar</button>
              <button type="button" className="link" onClick={criarNucleo}>+ criar outro núcleo</button>
            </div>
          </div>

          <div className="linha-acoes">
            <button type="button" className="botao-secundario" onClick={onCancelar}>Voltar</button>
            <button type="button" className="botao-principal pequeno" disabled={salvando} onClick={salvar}>
              {salvando ? 'Salvando…' : `Salvar divisão de ${dados.cidade}`}
            </button>
          </div>
        </>
      )}
      {!dados && <div className="linha-acoes"><button type="button" className="botao-secundario" onClick={onCancelar}>Voltar</button></div>}
    </div>
  )
}
