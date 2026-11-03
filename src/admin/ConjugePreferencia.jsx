import { useDeferredValue, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { formatarDataHora, mascaraTelefone } from '../../shared/util.js'
import { SITUACOES_PREFERENCIA, edicoesCobertas, sugerirConjuges } from './Preferencia.jsx'

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ultimaParticipacao = (f) => f?.participacoes?.at(-1)

export default function ConjugePreferencia({ ficha: f, todas, marca, podeGerir, onFichaAtualizada }) {
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ligada = marca?.preferenciaConjuge !== false
  const edicoes = ligada ? (marca?.edicoesPreferenciaConjuge ?? 2) : 0
  const declarou = f.conjuge_nome || f.conjuge_telefone || f.conjuge_fez_acampamento !== null

  const sugestoes = useMemo(() => (f.conjuge_id ? [] : sugerirConjuges(f, todas)), [f, todas])
  const buscaAdiada = useDeferredValue(busca)
  const resultados = useMemo(() => {
    const t = normalizar(buscaAdiada.trim())
    if (t.length < 3) return []
    return todas.filter((o) => o.id !== f.id && normalizar(o.nome_completo).includes(t)).slice(0, 8)
  }, [buscaAdiada, todas, f.id])

  async function executar(fn) {
    setErro(''); setEnviando(true)
    try {
      const r = await fn()
      onFichaAtualizada(r.ficha)
      return true
    } catch (err) {
      setErro(err.dados?.mensagem || 'Não foi possível concluir.')
      return false
    } finally {
      setEnviando(false)
    }
  }

  const vincular = (conjugeId) => executar(() => api.put(`/api/admin/pre-fichas/${f.id}/conjuge`, { conjuge_id: conjugeId }))
    .then((ok) => ok && setBusca(''))

  function abrirFormulario() {
    const conjuge = todas.find((o) => o.id === f.conjuge_id)
    const part = ultimaParticipacao(conjuge)
    setForm({
      conjuge_nome: f.conjuge_vinculado_nome || f.conjuge_nome || '',
      acampamento_numero: part?.numero ?? f.conjuge_acampamento_numero ?? '',
      modalidade: part?.modalidade ?? f.modalidade,
      observacao: '',
    })
  }

  async function registrar(e) {
    e.preventDefault()
    const ok = await executar(() => api.post(`/api/admin/pre-fichas/${f.id}/preferencias`, {
      ...form, acampamento_numero: Number(form.acampamento_numero), conjuge_ficha_id: f.conjuge_id ?? undefined,
    }))
    if (ok) setForm(null)
  }

  async function revogar(p) {
    const motivo = prompt(`Motivo para revogar a preferência (cônjuge fez o ${p.acampamento_numero}º):`)
    if (!motivo?.trim()) return
    await executar(() => api.post(`/api/admin/preferencias/${p.id}/revogar`, { motivo }))
  }

  const numero = Number(form?.acampamento_numero)

  return (
    <section className="bloco-conjuge">
      <h3>{ligada ? 'Cônjuge e preferência' : 'Cônjuge'}</h3>

      {declarou && (
        <p className="declarado">
          <small className="dica bloco">Declarado no formulário:</small>
          {f.conjuge_nome || 'cônjuge sem nome informado'}
          {f.conjuge_telefone && ` · ${mascaraTelefone(f.conjuge_telefone)}`}
          {f.conjuge_fez_acampamento === true && ` · já fez o acampamento${f.conjuge_acampamento_numero ? ` (${f.conjuge_acampamento_numero}º)` : ''}`}
          {f.conjuge_fez_acampamento === false && ' · ainda não fez o acampamento'}
        </p>
      )}

      <div className="vinculo">
        {f.conjuge_id ? (
          <p>
            Vinculado(a) a <strong>{f.conjuge_vinculado_nome}</strong>
            {podeGerir && <button className="link perigo" disabled={enviando}
              onClick={() => confirm('Desfazer o vínculo de cônjuge?') && vincular(null)}>desvincular</button>}
          </p>
        ) : podeGerir ? (
          <>
            {sugestoes.length > 0 && (
              <div className="sugestoes-conjuge">
                <small className="dica">Possível cônjuge encontrado (telefone ou nome):</small>
                {sugestoes.map((o) => (
                  <button key={o.id} className="botao-secundario" disabled={enviando} onClick={() => vincular(o.id)}>
                    Vincular a {o.nome_completo}
                    {ultimaParticipacao(o) && ` (fez o ${ultimaParticipacao(o).numero}º ${rotuloDe(MODALIDADES, ultimaParticipacao(o).modalidade)})`}
                  </button>
                ))}
              </div>
            )}
            <input type="search" placeholder="Buscar a ficha do cônjuge pelo nome para vincular" value={busca}
              onChange={(e) => setBusca(e.target.value)} />
            {resultados.map((o) => (
              <button key={o.id} className="resultado-busca" disabled={enviando} onClick={() => vincular(o.id)}>
                {o.nome_completo} <small className="dica">{o.cidade}/{o.uf}{ultimaParticipacao(o) ? ` · fez o ${ultimaParticipacao(o).numero}º` : ''}</small>
              </button>
            ))}
            {ligada && <small className="dica bloco">
              Com os cônjuges vinculados, quando um fizer o acampamento o outro ganha a preferência automaticamente
              {edicoes ? ` (${edicoes} edições seguintes)` : ''}.
            </small>}
          </>
        ) : <p className="dica">Nenhum cônjuge vinculado.</p>}
      </div>

      {ligada && f.preferencias?.length > 0 && (
        <ul className="lista-preferencias">
          {f.preferencias.map((p) => (
            <li key={p.id} className={`pref-${p.situacao}`}>
              <span className={`selo-pref ${p.situacao}`}>{SITUACOES_PREFERENCIA[p.situacao]}</span>{' '}
              Cônjuge <strong>{p.conjuge_nome}</strong> fez o {p.acampamento_numero}º {rotuloDe(MODALIDADES, p.modalidade)} →
              preferência no <strong>{edicoesCobertas(p)}</strong>
              <small className="dica bloco">
                {p.origem === 'automatica' ? 'Gerada automaticamente' : 'Registrada manualmente'} em {formatarDataHora(p.criado_em)}
                {p.observacao && ` · ${p.observacao}`}
                {p.motivo_revogacao && ` · revogada: ${p.motivo_revogacao}`}
              </small>
              {podeGerir && p.situacao === 'ativa' && <button className="link perigo" onClick={() => revogar(p)}>revogar</button>}
            </li>
          ))}
        </ul>
      )}

      {podeGerir && !form && edicoes > 0 && (
        <button className="botao-secundario" onClick={abrirFormulario}>Registrar preferência de cônjuge</button>
      )}
      {ligada && form && (
        <form className="form-acao" onSubmit={registrar}>
          <div className="linha">
            <div className="campo">
              <label htmlFor="pref-nome">Nome do cônjuge</label>
              <input id="pref-nome" required={!f.conjuge_id} disabled={!!f.conjuge_id} maxLength={150} value={form.conjuge_nome}
                onChange={(e) => setForm({ ...form, conjuge_nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="pref-numero">Acampamento que o cônjuge fez (nº)</label>
              <input id="pref-numero" required inputMode="numeric" value={form.acampamento_numero}
                onChange={(e) => setForm({ ...form, acampamento_numero: e.target.value.replace(/\D/g, '') })} />
            </div>
          </div>
          <div className="linha">
            <div className="campo">
              <label htmlFor="pref-modalidade">Modalidade</label>
              <select id="pref-modalidade" value={form.modalidade} onChange={(e) => setForm({ ...form, modalidade: e.target.value })}>
                {MODALIDADES.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="pref-obs">Observação (opcional)</label>
              <input id="pref-obs" maxLength={1000} value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </div>
          </div>
          {numero > 0 && (
            <p className="dica">
              Preferência no <strong>{edicoesCobertas({ valida_de: numero + 1, valida_ate: numero + edicoes, modalidade: form.modalidade })}</strong>.
            </p>
          )}
          <div className="acoes-linha">
            <button className="botao-principal pequeno" disabled={enviando}>{enviando ? 'Registrando…' : 'Registrar preferência'}</button>
            <button type="button" className="link" onClick={() => setForm(null)}>cancelar</button>
          </div>
        </form>
      )}
      {erro && <div className="alerta-erro">{erro}</div>}
    </section>
  )
}
