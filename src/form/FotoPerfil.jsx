import { useRef, useState } from 'react'
import { prepararFoto } from '../lib/foto.js'

/**
 * Escolher/tirar a foto (opcional). `urlAtual`: foto que a conta já tem (mostrada até escolher outra).
 * `onChange(blob | null)`: foto nova pronta para enviar; null = remover.
 */
export default function FotoPerfil({ urlAtual = null, onChange, rotulo = 'Sua foto (opcional)', desabilitado = false }) {
  const entrada = useRef(null)
  const [previa, setPrevia] = useState(null)
  const [removida, setRemovida] = useState(false)
  const [erro, setErro] = useState('')
  const [lendo, setLendo] = useState(false)
  const mostrando = previa || (!removida ? urlAtual : null)

  async function escolher(ev) {
    const arquivo = ev.target.files?.[0]
    ev.target.value = ''   // deixa escolher o mesmo arquivo de novo
    if (!arquivo) return
    setErro(''); setLendo(true)
    try {
      const blob = await prepararFoto(arquivo)
      // prévia como data: (a política de segurança do site não permite blob:)
      setPrevia(await new Promise((ok, falha) => { const l = new FileReader(); l.onload = () => ok(l.result); l.onerror = falha; l.readAsDataURL(blob) })); setRemovida(false)
      onChange(blob)
    } catch (e) { setErro(e.message) } finally { setLendo(false) }
  }
  function remover() { setPrevia(null); setRemovida(true); setErro(''); onChange(null) }

  return (
    <div className="campo foto-perfil">
      <span className="rotulo-foto" id="rotulo-foto">{rotulo}</span>
      <div className="foto-linha">
        <div className="foto-previa" aria-hidden="true">
          {mostrando ? <img src={mostrando} alt="" /> : <span>📷</span>}
        </div>
        <div className="foto-acoes">
          <input ref={entrada} type="file" accept="image/*" capture="user" hidden aria-labelledby="rotulo-foto" onChange={escolher} disabled={desabilitado} />
          <button type="button" className="botao-secundario" disabled={desabilitado || lendo} onClick={() => entrada.current?.click()}>
            {lendo ? 'Preparando…' : mostrando ? 'Trocar foto' : 'Tirar ou escolher uma foto'}
          </button>
          {mostrando && <button type="button" className="link inline" disabled={desabilitado} onClick={remover}>Remover</button>}
        </div>
      </div>
      {erro && <span className="erro-campo" role="alert">{erro}</span>}
      <small className="dica">Serve para a equipe identificar você. Só o acampamento vê a sua foto, e você pode trocar ou remover quando quiser.</small>
    </div>
  )
}
