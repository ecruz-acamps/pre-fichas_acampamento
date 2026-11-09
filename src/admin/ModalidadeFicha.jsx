import { useState } from 'react'
import { api } from '../lib/api.js'
import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { limparCacheFichas } from './Fila.jsx'

/**
 * Escolha da modalidade de uma ficha (administrador e coordenador de núcleo).
 * `compativeis` = o que cabe pela idade e estado civil. A posição na fila não muda.
 * "Manter" confirma a modalidade atual (tira a marca "revisar").
 */
export default function ModalidadeFicha({ ficha, compativeis, onConcluir, compacto = false }) {
  const opcoes = [...new Set([ficha.modalidade, ...compativeis])]
  const [nova, setNova] = useState(compativeis.includes(ficha.modalidade) || !compativeis.length ? ficha.modalidade : compativeis[0])
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const mudou = nova !== ficha.modalidade

  async function enviar(valor) {
    if (valor !== ficha.modalidade && !window.confirm(`Alterar a modalidade de ${rotuloDe(MODALIDADES, ficha.modalidade)} para ${rotuloDe(MODALIDADES, valor)}? A pessoa passa a contar na fila da nova modalidade (a data de inscrição não muda).`)) return
    setErro(''); setEnviando(true)
    try {
      const r = await api.post(`/api/admin/pre-fichas/${ficha.id}/modalidade`, { modalidade: valor })
      limparCacheFichas()
      onConcluir?.(r)
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível alterar.') } finally { setEnviando(false) }
  }
  return (
    <div className={`modalidade-ficha ${compacto ? 'compacto' : ''}`}>
      <select value={nova} onChange={(e) => setNova(e.target.value)} aria-label={`Modalidade de ${ficha.nome_completo}`} disabled={enviando}>
        {opcoes.map((m) => <option key={m} value={m}>{rotuloDe(MODALIDADES, m)}{m === ficha.modalidade ? ' (atual)' : ''}</option>)}
      </select>
      <button type="button" className="botao-principal pequeno" disabled={enviando || !mudou} onClick={() => enviar(nova)}>Alterar</button>
      {ficha.revisar && <button type="button" className="botao-secundario" disabled={enviando} onClick={() => enviar(ficha.modalidade)}>Manter {rotuloDe(MODALIDADES, ficha.modalidade)}</button>}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}
