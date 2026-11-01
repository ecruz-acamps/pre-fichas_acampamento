import { useEffect, useState } from 'react'
import { api } from './api.js'
import { partesNegrito } from '../../shared/util.js'

let promessa = null

/** Carrega (uma vez) a identidade do acampamento configurada no servidor. */
export function carregarMarca(forcar = false) {
  if (!promessa || forcar) promessa = api.get('/api/marca')
  return promessa
}

export function useMarca() {
  const [marca, setMarca] = useState(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let ativo = true
    carregarMarca().then((m) => ativo && setMarca(m)).catch(() => ativo && setErro(true))
    return () => { ativo = false }
  }, [])
  return { marca, erro, setMarca }
}

/** Texto da marca com suporte a **negrito** (sem HTML: seguro). */
export function TextoMarca({ texto }) {
  return partesNegrito(texto).map((p, i) => (p.negrito ? <strong key={i}>{p.texto}</strong> : <span key={i}>{p.texto}</span>))
}

export function CorTribo({ tribo, marca }) {
  if (!tribo) return <span className="tribo sem">sem tribo</span>
  const cor = marca?.tribos?.find((t) => t.nome === tribo)?.cor ?? '#999999'
  return <span className="tribo"><span className="bolinha" style={{ background: cor }} />{tribo}</span>
}
