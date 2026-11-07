import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

/**
 * Cadastro feito pela própria pessoa (coordenador ou equipe): ela cria o usuário e fica sem acesso até um administrador liberar.
 * Com `token` (link do e-mail), confirma o e-mail.
 */
export default function CadastroEquipe({ marca, token, onVoltar }) {
  const [d, setD] = useState({ nome: '', email: '', senha: '', confirmar: '' })
  const [erros, setErros] = useState({})
  const [erro, setErro] = useState('')
  const [pronto, setPronto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [confirmacao, setConfirmacao] = useState(token ? 'conferindo' : null)
  const iniciou = useRef(false)
  const voltar = () => { window.history.replaceState(null, '', window.location.pathname); onVoltar() }
  const set = (c) => (e) => { setD((a) => ({ ...a, [c]: e.target.value })); setErros((a) => ({ ...a, [c]: undefined })) }

  useEffect(() => {
    if (!token || iniciou.current) return
    iniciou.current = true
    api.post('/api/auth/confirmar-email', { token })
      .then(() => setConfirmacao('ok'))
      .catch((e) => { setConfirmacao('erro'); setErro(e.dados?.mensagem || 'Não foi possível confirmar.') })
  }, [token])

  async function enviar(ev) {
    ev.preventDefault()
    setErro('')
    const e = {}
    if (d.nome.trim().length < 3) e.nome = 'Informe o seu nome completo.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) e.email = 'E-mail inválido.'
    if (d.senha.length < 8) e.senha = 'A senha deve ter pelo menos 8 caracteres.'
    if (d.confirmar !== d.senha) e.confirmar = 'As senhas não conferem.'
    setErros(e)
    if (Object.keys(e).length) return
    setEnviando(true)
    try {
      setPronto((await api.post('/api/auth/cadastro', { nome: d.nome, email: d.email, senha: d.senha })).mensagem)
    } catch (err) {
      if (err.dados?.erros) setErros(err.dados.erros)
      setErro(err.dados?.mensagem || 'Não foi possível enviar o cadastro.')
    } finally { setEnviando(false) }
  }

  const topo = (titulo) => (
    <>
      {marca?.logoUrl && <img className="logo" src={marca.logoUrl} alt="" />}
      <h1>{titulo}</h1>
    </>
  )

  if (token) {
    return (
      <main className="pagina estreita">
        <div className="cartao login">
          {topo('Confirmar e-mail')}
          {confirmacao === 'conferindo' && <p className="carregando">Conferindo…</p>}
          {confirmacao === 'ok' && <div className="alerta-ok" role="status">E-mail confirmado! Agora é só aguardar um administrador liberar o seu acesso. Você será avisado por e-mail.</div>}
          {confirmacao === 'erro' && <div className="alerta-erro" role="alert">{erro}</div>}
          <div className="acoes"><button className="botao-principal" onClick={voltar}>Ir para o login</button></div>
        </div>
      </main>
    )
  }

  const campo = (id, rotulo, extra) => (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} value={d[id]} onChange={set(id)} {...extra} />
      {erros[id] && <span className="erro-campo" role="alert">{erros[id]}</span>}
    </div>
  )
  return (
    <main className="pagina estreita">
      <form className="cartao login" onSubmit={enviar} noValidate>
        {topo('Cadastro da equipe')}
        <p className="subtitulo">{marca?.nome ? `${marca.nome} · ` : ''}coordenadores e equipe.</p>
        {pronto ? <div className="alerta-ok" role="status">{pronto}</div> : (
          <>
            <p>Crie o seu usuário. <strong>Você não terá acesso até um administrador liberar</strong> e escolher o que você pode ver.</p>
            {campo('nome', 'Nome completo', { autoComplete: 'name', maxLength: 120 })}
            {campo('email', 'E-mail', { type: 'email', autoComplete: 'username', maxLength: 200 })}
            {campo('senha', 'Senha (mínimo 8 caracteres)', { type: 'password', autoComplete: 'new-password' })}
            {campo('confirmar', 'Repita a senha', { type: 'password', autoComplete: 'new-password' })}
            {erro && <div className="alerta-erro" role="alert">{erro}</div>}
            <div className="acoes"><button className="botao-principal" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar cadastro'}</button></div>
          </>
        )}
        <p className="centro"><button type="button" className="link" onClick={voltar}>Voltar ao login</button></p>
      </form>
    </main>
  )
}
