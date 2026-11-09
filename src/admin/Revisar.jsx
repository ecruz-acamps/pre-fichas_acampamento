import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { ESTADOS_CIVIS, MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { calcularIdade } from '../../shared/util.js'
import ModalidadeFicha from './ModalidadeFicha.jsx'

/** Fichas com "revisar" nas observações internas: confira a modalidade e altere se fizer sentido. */
export default function Revisar() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  useEffect(() => { api.get('/api/admin/pre-fichas/revisar').then(setLista).catch(() => setErro('Não foi possível carregar a lista.')) }, [])
  const retirar = (id) => setLista((l) => l.filter((x) => x.id !== id))

  if (erro) return <p className="erro">{erro}</p>
  if (!lista) return <p className="carregando">Carregando…</p>
  return (
    <section>
      <h2>Revisar modalidade <small>({lista.length})</small></h2>
      <p className="dica">Fichas marcadas com "revisar" nas observações internas (por exemplo, importadas com uma modalidade que não bate com a idade ou o estado civil). Altere a modalidade se fizer sentido, ou mantenha a atual. Em ambos os casos a marca "revisar" sai da observação e fica registrado quem revisou.</p>
      {!lista.length && <p className="vazio">Nenhuma ficha para revisar.</p>}
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Idade</th><th>Estado civil</th><th>Modalidade</th><th>Cabe pela regra</th><th>Observações internas</th><th>Revisão</th></tr></thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id}>
                <td>{f.nome_completo}<br /><small className="dica">{f.cidade}/{f.uf}</small></td>
                <td>{calcularIdade(f.data_nascimento) ?? '—'}</td>
                <td>{rotuloDe(ESTADOS_CIVIS, f.estado_civil)}</td>
                <td>{rotuloDe(MODALIDADES, f.modalidade)}</td>
                <td>{f.compativeis.map((m) => rotuloDe(MODALIDADES, m)).join(', ') || 'nenhuma'}</td>
                <td><span className="texto-longo">{f.observacoes_internas}</span></td>
                <td><ModalidadeFicha ficha={{ ...f, revisar: true }} compativeis={f.compativeis} compacto onConcluir={() => retirar(f.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
