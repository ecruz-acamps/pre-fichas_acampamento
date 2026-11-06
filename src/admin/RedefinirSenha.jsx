import { useState } from 'react'
import { api } from '../lib/api.js'

/** Pedir o link por e-mail ("Esqueci minha senha") ou, com o token do link, criar a senha nova. */
export default function RedefinirSenha({ marca, token, onVoltar }) {
  const [email, setEmail] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pedeCodigo, setPedeCodigo] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [pronto, setPronto] = useState(false)
  const [enviando, setEnviando] = useState(false)

  async function pedir(e) {
    e.preventDefault()
    setErro(''); setEnviando(true)
    try {
      const r = await api.post('/api/auth/esqueci', { email })
      setAviso(r.mensagem)
    } catch (err) {
      setErro(err.dados?.mensagem || (err.status === 429 ? 'Muitos pedidos. Aguarde alguns minutos.' : 'Não foi possível enviar agora.'))
    } finally { setEnviando(false) }
  }

  async function salvar(e) {
    e.preventDefault()
    setErro('')
    if (nova.length < 8) return setErro('A nova senha deve ter pelo menos 8 caracteres.')
    if (nova !== confirmacao) return setErro('A confirmação não confere com a nova senha.')
    setEnviando(true)
    try {
      await api.post('/api/auth/redefinir', { token, senha: nova, ...(pedeCodigo ? { codigo } : {}) })
      window.history.replaceState(null, '', window.location.pathname)   // tira o token da barra de endereço
      setPronto(true)
    } catch (err) {
      if (err.dados?.precisa2fa) { setPedeCodigo(true); setErro(pedeCodigo ? err.dados.mensagem : '') }
      else setErro(err.dados?.mensagem || 'Não foi possível redefinir a senha.')
    } finally { setEnviando(false) }
  }

  const voltar = () => { window.history.replaceState(null, '', window.location.pathname); onVoltar() }
  const cabecalho = (titulo, texto) => (
    <>
      {marca?.logoUrl && <img className="logo" src={marca.logoUrl} alt="" />}
      <h1>{titulo}</h1>
      <p className="subtitulo">{marca?.nome ? `${marca.nome} · ` : ''}{texto}</p>
    </>
  )

  if (pronto) {
    return (
      <main className="pagina estreita">
        <div className="cartao login">
          {cabecalho('Senha alterada', 'pronto!')}
          <p>Você saiu de todos os aparelhos. Entre com a senha nova.</p>
          <div className="acoes"><button className="botao-principal" onClick={voltar}>Ir para o login</button></div>
        </div>
      </main>
    )
  }

  if (token) {
    return (
      <main className="pagina estreita">
        <form className="cartao login" onSubmit={salvar}>
          {cabecalho('Crie uma senha nova', 'acesso restrito à equipe.')}
          <div className="campo">
            <label htmlFor="nova">Senha nova (mínimo 8 caracteres)</label>
            <input id="nova" type="password" autoComplete="new-password" required minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="confirmacao">Repita a senha nova</label>
            <input id="confirmacao" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
          </div>
          {pedeCodigo && (
            <div className="campo">
              <label htmlFor="codigo">Código do aplicativo autenticador</label>
              <input id="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required placeholder="000000"
                value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
              <small className="dica">Sua conta usa verificação em duas etapas: o link do e-mail não basta, é preciso também o código.</small>
            </div>
          )}
          {erro && <div className="alerta-erro" role="alert">{erro}</div>}
          <div className="acoes">
            <button className="botao-principal" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha nova'}</button>
          </div>
          <p className="dica centro">Perdeu também o celular do autenticador? Peça a um administrador para redefinir o seu acesso.</p>
        </form>
      </main>
    )
  }

  return (
    <main className="pagina estreita">
      <form className="cartao login" onSubmit={pedir}>
        {cabecalho('Esqueci minha senha', 'acesso restrito à equipe.')}
        {aviso ? <div className="alerta-ok" role="status">{aviso}</div> : (
          <>
            <p>Informe o e-mail do seu usuário. Enviaremos um link para criar uma senha nova.</p>
            <div className="campo">
              <label htmlFor="email-esqueci">E-mail</label>
              <input id="email-esqueci" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {erro && <div className="alerta-erro" role="alert">{erro}</div>}
            <div className="acoes"><button className="botao-principal" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar link'}</button></div>
          </>
        )}
        <p className="centro"><button type="button" className="link" onClick={voltar}>Voltar ao login</button></p>
      </form>
    </main>
  )
}
