import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { formatarDataHora } from '../../shared/util.js'

const n = (x) => Number(x ?? 0).toLocaleString('pt-BR')
const nomeSeguro = (nome) => nome.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7E]/g, '_').slice(0, 100)

/** Configurações → Importar pré-fichas: envia a planilha (CSV ou Excel), mostra a SIMULAÇÃO e só grava depois da confirmação. */
export default function ImportarFichas() {
  const entrada = useRef(null)
  const [simulacao, setSimulacao] = useState(null)
  const [erro, setErro] = useState('')
  const [faltam, setFaltam] = useState([])
  const [lendo, setLendo] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [confirmei, setConfirmei] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [lotes, setLotes] = useState([])
  const [aviso, setAviso] = useState('')

  const carregarLotes = () => api.get('/api/admin/importacao/lotes').then(setLotes).catch(() => {})
  useEffect(() => { carregarLotes() }, [])

  async function escolher(ev) {
    const arquivo = ev.target.files?.[0]
    ev.target.value = ''
    if (!arquivo) return
    setErro(''); setFaltam([]); setSimulacao(null); setResultado(null); setConfirmei(false); setAviso('')
    if (!/\.(csv|xlsx)$/i.test(arquivo.name)) return setErro('Envie um arquivo .csv ou .xlsx (no Excel: Arquivo → Salvar como).')
    if (arquivo.size > 40 * 1024 * 1024) return setErro('O arquivo tem mais de 40 MB.')
    setLendo(true)
    try {
      const corpo = new Blob([arquivo], { type: 'application/octet-stream' })
      setSimulacao(await api.enviarArquivo('/api/admin/importacao/simular', corpo, { metodo: 'POST', cabecalhos: { 'X-Nome-Arquivo': nomeSeguro(arquivo.name) } }))
    } catch (e) {
      setErro(e.dados?.mensagem || 'Não foi possível ler o arquivo.')
      setFaltam(e.dados?.faltam ?? [])
    } finally { setLendo(false) }
  }

  async function aplicar() {
    setErro(''); setAplicando(true)
    try {
      const r = await api.post('/api/admin/importacao/aplicar', { token: simulacao.token })
      setResultado(r); setSimulacao(null); setConfirmei(false); carregarLotes()
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível importar.') } finally { setAplicando(false) }
  }

  async function desfazer(lote, alteradas, forcar = false) {
    const texto = forcar
      ? `A equipe já mexeu em ${alteradas} ficha(s) deste lote. Apagar o lote inteiro mesmo assim? As alterações feitas nelas serão perdidas.`
      : `Desfazer a importação ${lote}? As fichas importadas (e as edições criadas por ela) serão apagadas.`
    if (!window.confirm(texto)) return
    setErro(''); setAviso('')
    try {
      const r = await api.delete(`/api/admin/importacao/lotes/${encodeURIComponent(lote)}${forcar ? '?forcar=1' : ''}`)
      setAviso(`Importação desfeita: ${n(r.fichas)} ficha(s) apagada(s).`); setResultado(null); carregarLotes()
    } catch (e) {
      if (e.dados?.precisaForcar && !forcar) return desfazer(lote, alteradas, true)
      setErro(e.dados?.mensagem || 'Não foi possível desfazer.')
    }
  }

  const r = simulacao?.resumo
  const baixar = (nome, rotulo, quantidade) => quantidade > 0 && (
    <a className="link" href={`/api/admin/importacao/relatorio/${nome}?token=${encodeURIComponent(simulacao.token)}`} download>{rotulo}</a>
  )

  return (
    <section className="cartao importar-fichas" aria-labelledby="titulo-importar">
      <h2 id="titulo-importar">Importar pré-fichas de uma planilha</h2>
      <p className="dica">
        Envie a planilha em <strong>CSV ou Excel (.xlsx)</strong>. Primeiro o sistema faz uma <strong>simulação</strong> e mostra o que vai acontecer; <strong>nada é gravado</strong> até você confirmar.
        A <strong>data da pré-ficha</strong> da planilha é mantida como data de entrada na fila. Quem tem pré-ficha entra na fila; quem só tem "Onde Fui Campista" entra como "Já participou", fora da fila;
        o que não der para classificar fica de fora, numa lista para você decidir. Uma importação pode ser desfeita.
      </p>
      {aviso && <div className="alerta-ok" role="status">{aviso}</div>}
      {erro && <div className="alerta-erro" role="alert">{erro}{faltam.length > 0 && <ul>{faltam.map((c) => <li key={c}>{c}</li>)}</ul>}</div>}

      <input ref={entrada} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={escolher} />
      <div className="botoes-area">
        <button type="button" className="botao-principal" disabled={lendo || aplicando} onClick={() => entrada.current?.click()}>
          {lendo ? 'Lendo o arquivo…' : simulacao ? 'Escolher outro arquivo' : 'Escolher planilha (CSV ou Excel)'}
        </button>
      </div>

      {simulacao && r && (
        <div className="simulacao">
          <h3>Simulação: {simulacao.arquivo}</h3>
          <p className="dica">Nada foi gravado ainda. Confira os números:</p>
          <dl className="grade">
            <div className="item"><dt>Linhas lidas</dt><dd>{n(r.linhas)}</dd></div>
            <div className="item"><dt>Serão importadas</dt><dd><strong>{n(r.importar)}</strong></dd></div>
            <div className="item"><dt>Na fila de espera</dt><dd>{n(r.naFila)}</dd></div>
            <div className="item"><dt>Campistas que já participaram</dt><dd>{n(r.campistasSemFila)}</dd></div>
            <div className="item"><dt>Participações em acampamentos</dt><dd>{n(r.participacoes)} ({n(r.edicoesNovas)} edições novas)</dd></div>
            <div className="item"><dt>Ignoradas (já existem no sistema)</dt><dd>{n(r.ignoradas)}</dd></div>
          </dl>
          {Object.keys(r.porModalidade).length > 0 && (
            <p className="dica">Fila por modalidade: {Object.entries(r.porModalidade).map(([m, q]) => `${rotuloDe(MODALIDADES, m)} ${n(q)}`).join(' · ')}.
              {r.primeiraData && <> Datas de pré-ficha mantidas: de {r.primeiraData.split('-').reverse().join('/')} a {r.ultimaData.split('-').reverse().join('/')}.</>}</p>
          )}
          <ul className="dica">
            {r.comAlerta > 0 && <li><strong>{n(r.comAlerta)}</strong> ficha(s) pedem conferência da equipe (a observação interna explica; {n(r.revisarModalidade)} com "revisar modalidade"). {baixar('revisar.csv', 'Baixar lista', r.comAlerta)}</li>}
            {(r.semEmail > 0 || r.semCep > 0) && <li>Sem e-mail: {n(r.semEmail)} · sem CEP: {n(r.semCep)} · sem "por que participar": {n(r.semMotivo)} (ficam vazios, nada é inventado).</li>}
            {r.tribosNovas.length > 0 && <li>Tribos que serão acrescentadas: {r.tribosNovas.join(', ')}.</li>}
          </ul>

          {r.quarentena > 0 && (
            <div className="alerta-aviso">
              <strong>{n(r.quarentena)} linha(s) em quarentena (NÃO serão importadas)</strong>{r.semClassificacao > 0 && <> — {n(r.semClassificacao)} sem como classificar</>}. {baixar('quarentena.csv', 'Baixar lista completa', r.quarentena)}
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead><tr><th>Linha</th><th>Nome</th><th>Motivo</th></tr></thead>
                  <tbody>{simulacao.quarentena.map((q) => <tr key={q.linha}><td>{q.linha}</td><td>{q.nome}</td><td>{q.motivo}</td></tr>)}</tbody>
                </table>
              </div>
              {r.quarentena > simulacao.quarentena.length && <p className="dica">Mostrando as primeiras {simulacao.quarentena.length}; baixe a lista completa.</p>}
            </div>
          )}
          {r.ignoradas > 0 && <p className="dica">{baixar('ignoradas.csv', 'Baixar lista das ignoradas', r.ignoradas)}</p>}

          {r.importar > 0 ? (
            <>
              <label className="check">
                <input type="checkbox" checked={confirmei} onChange={(e) => setConfirmei(e.target.checked)} />
                Conferi a simulação e quero importar <strong>{n(r.importar)} ficha(s)</strong>. Sei que posso desfazer depois.
              </label>
              <div className="botoes-area">
                <button type="button" className="botao-principal" disabled={!confirmei || aplicando} onClick={aplicar}>
                  {aplicando ? 'Importando… (pode levar alguns segundos)' : `Importar ${n(r.importar)} ficha(s)`}
                </button>
              </div>
            </>
          ) : <p className="alerta-erro">Não há nenhuma ficha para importar neste arquivo.</p>}
        </div>
      )}

      {resultado && (
        <div className="alerta-ok" role="status">
          <strong>Importação concluída:</strong> {n(resultado.resumo.gravadas)} ficha(s), {n(resultado.resumo.participacoesGravadas)} participação(ões), {n(resultado.resumo.contasCriadas ?? 0)} conta(s) criada(s) (usuário e senha = CPF), {n(resultado.resumo.edicoesCriadas)} edição(ões) criada(s).
          Lote <code>{resultado.lote}</code>. Se algo não ficou como esperado, use "Desfazer" na lista abaixo.
        </div>
      )}

      {lotes.length > 0 && (
        <>
          <h3>Importações feitas</h3>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Arquivo</th><th>Por</th><th>Fichas</th><th></th></tr></thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.lote}>
                    <td className="nowrap">{formatarDataHora(l.criado_em)}</td><td>{l.arquivo ?? '—'}</td><td>{l.por ?? 'terminal'}</td>
                    <td>{n(l.fichas)}{l.alteradas > 0 && <span className="selo info" title="A equipe já mexeu nestas fichas">{n(l.alteradas)} alterada(s)</span>}</td>
                    <td><button type="button" className="botao-secundario perigo" onClick={() => desfazer(l.lote, l.alteradas)}>Desfazer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
