import { useRef, useState } from 'react'
import { api } from '../lib/api.js'

/** Tela de ativação: chave no formato XXX-0000, em duas caixas, como um serial. */
export default function Ativacao({ marca, usuario, onAtivado, onSair }) {
  const [letras, setLetras] = useState('')
  const [numeros, setNumeros] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const caixaNumeros = useRef(null)
  const caixaLetras = useRef(null)

  const admin = usuario.papel === 'admin'
  const completa = letras.length === 3 && numeros.length === 4

  // Aceita colar a chave inteira ("ABC-1234", "abc 1234"...) em qualquer caixa
  function colar(e) {
    const texto = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const m = texto.match(/^([A-Z]{3})(\d{0,4})/)
    if (!m) return
    e.preventDefault()
    setLetras(m[1]); setNumeros(m[2]); setErro('')
    caixaNumeros.current?.focus()
  }

  async function ativar(e) {
    e.preventDefault()
    if (!completa) return setErro('Digite a chave completa: 3 letras e 4 números.')
    setErro(''); setEnviando(true)
    try {
      await api.post('/api/admin/licenca/ativar', { chave: `${letras}-${numeros}` })
      onAtivado()
    } catch (err) {
      setEnviando(false)
      setErro(err.status === 429
        ? 'Muitas tentativas. Aguarde um minuto e tente novamente.'
        : err.dados?.mensagem || 'Não foi possível ativar.')
    }
  }

  return (
    <main className="pagina estreita">
      <form className="cartao login ativacao" onSubmit={ativar}>
        {marca?.logoUrl && <img className="logo" src={marca.logoUrl} alt="" />}
        <h1>Ativação do sistema</h1>
        {admin ? (
          <>
            <p className="subtitulo">
              Para começar a usar{marca?.nome ? ` o sistema do ${marca.nome}` : ' o sistema'}, informe a chave de ativação.
            </p>
            <div className="serial" onPaste={colar}>
              <input ref={caixaLetras} aria-label="Letras da chave" placeholder="XXX" maxLength={3} autoFocus
                autoComplete="off" spellCheck={false} value={letras}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
                  setLetras(v); setErro('')
                  if (v.length === 3) caixaNumeros.current?.focus()
                }} />
              <span aria-hidden="true">–</span>
              <input ref={caixaNumeros} aria-label="Números da chave" placeholder="0000" maxLength={4} inputMode="numeric"
                autoComplete="off" value={numeros}
                onKeyDown={(e) => { if (e.key === 'Backspace' && !numeros) caixaLetras.current?.focus() }}
                onChange={(e) => { setNumeros(e.target.value.replace(/\D/g, '').slice(0, 4)); setErro('') }} />
            </div>
            {erro && <div className="alerta-erro" role="alert">{erro}</div>}
            <div className="acoes">
              <button className="botao-principal" disabled={enviando || !completa}>{enviando ? 'Verificando…' : 'Ativar'}</button>
            </div>
            <p className="dica centro">Não tem a chave? Fale com o responsável pela implantação do sistema.</p>
          </>
        ) : (
          <p className="subtitulo">
            O sistema ainda não foi ativado. Assim que um administrador informar a chave de ativação, o painel ficará disponível.
          </p>
        )}
        <button type="button" className="link" onClick={onSair}>Sair</button>
      </form>
    </main>
  )
}
