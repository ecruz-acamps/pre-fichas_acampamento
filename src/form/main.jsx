import FotoPerfil from './FotoPerfil.jsx'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import FormularioPreFicha from './FormularioPreFicha.jsx'
import { api } from '../lib/api.js'
import { TextoMarca, useMarca } from '../lib/marca.jsx'
import { MODALIDADES, rotuloDe } from '../../shared/opcoes.js'
import { formatarDataHora, mascaraCpf } from '../../shared/util.js'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '../styles.css'
import { registrarPwa } from '../pwa.js'

registrarPwa()

/* ---------- peças da tela de entrada ---------- */

function CampoTexto({ id, rotulo, erro, ...props }) {
  return (
    <div className={`campo ${erro ? 'com-erro' : ''}`}>
      <input id={id} placeholder={rotulo} aria-label={rotulo} className="entrada-grande" {...props} />
      {erro && <small className="erro">{erro}</small>}
    </div>
  )
}

function CampoSenha({ id, rotulo = 'Senha', valor, onChange, erro, autoComplete = 'current-password' }) {
  const [ver, setVer] = useState(false)
  return (
    <div className={`campo ${erro ? 'com-erro' : ''}`}>
      <div className="senha-com-olho">
        <input id={id} type={ver ? 'text' : 'password'} placeholder={rotulo} aria-label={rotulo} className="entrada-grande"
          value={valor} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} maxLength={200} />
        <button type="button" className="olho" onClick={() => setVer(!ver)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'}>
          {ver ? '🙈' : '👁'}
        </button>
      </div>
      {erro && <small className="erro">{erro}</small>}
    </div>
  )
}

function Entrar({ marca, irPara, onEntrou }) {
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const mudarLogin = (v) => setLogin(/^[\d.\-\s]+$/.test(v) ? mascaraCpf(v) : v)
  async function enviar(ev) {
    ev.preventDefault()
    setErro('')
    if (!login.trim() || !senha) return setErro('Informe CPF ou e-mail e a senha.')
    setEnviando(true)
    try {
      await api.post('/api/conta/login', { login, senha })
      onEntrou()
    } catch (e) {
      setErro(e.dados?.mensagem || 'Não foi possível entrar. Tente novamente.')
    } finally { setEnviando(false) }
  }
  return (
    <form className="cartao tela-entrada" onSubmit={enviar} noValidate>
      <h1>Seja bem-vindo!</h1>
      <p className="subtitulo">Acessando sua conta você consegue se inscrever para participar de {marca.nome ? <strong>{marca.nome}</strong> : 'um acampamento'}.</p>
      <CampoTexto id="login" rotulo="CPF ou E-mail" value={login} onChange={(e) => mudarLogin(e.target.value)}
        autoComplete="username" inputMode="email" maxLength={200} />
      <CampoSenha id="senha" valor={senha} onChange={setSenha} />
      <small className="dica-conta">*Conta antiga (sem senha)? Use <button type="button" className="link inline" onClick={() => irPara('esqueci')}>Esqueci minha senha</button> para criar a sua.</small>
      {erro && <div className="alerta-erro" role="alert">{erro}</div>}
      <div className="acoes"><button className="botao-principal largo" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button></div>
      <p className="termos-uso">Acessando você concorda com os Termos de Uso e a Política de Privacidade do acampamento.</p>
      <button type="button" className="link grande" onClick={() => irPara('esqueci')}>Esqueci minha senha</button>
      <p className="criar-conta">Primeira vez aqui? <button type="button" className="link inline grande" onClick={() => irPara('cadastro')}>Cadastre-se e faça a inscrição</button></p>
    </form>
  )
}

function Esqueci({ irPara, recuperacao }) {
  const [login, setLogin] = useState('')
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(ev) {
    ev.preventDefault()
    setErro('')
    if (!login.trim()) return setErro('Informe seu CPF ou e-mail.')
    setEnviando(true)
    try {
      setMsg((await api.post('/api/conta/esqueci', { login })).mensagem)
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível enviar. Tente novamente.') } finally { setEnviando(false) }
  }
  return (
    <form className="cartao tela-entrada" onSubmit={enviar} noValidate>
      <h1>Esqueci minha senha</h1>
      {!recuperacao ? (
        <div className="alerta-erro">A recuperação de senha por e-mail ainda não foi configurada. Fale com o acampamento.</div>
      ) : msg ? (
        <div className="alerta-ok">{msg}</div>
      ) : (
        <>
          <p className="subtitulo">Informe seu CPF ou e-mail. Enviaremos um link para criar uma nova senha no e-mail cadastrado.</p>
          <CampoTexto id="login-esqueci" rotulo="CPF ou E-mail" value={login}
            onChange={(e) => setLogin(/^[\d.\-\s]+$/.test(e.target.value) ? mascaraCpf(e.target.value) : e.target.value)} maxLength={200} />
          {erro && <div className="alerta-erro" role="alert">{erro}</div>}
          <div className="acoes"><button className="botao-principal largo" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar link'}</button></div>
        </>
      )}
      <button type="button" className="link grande" onClick={() => irPara('entrar')}>Voltar para entrar</button>
    </form>
  )
}

function Redefinir({ token, onEntrou, irPara }) {
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(ev) {
    ev.preventDefault()
    setErro('')
    if (senha.length < 8) return setErro('A senha deve ter pelo menos 8 caracteres.')
    if (senha !== confirmar) return setErro('As senhas não conferem.')
    setEnviando(true)
    try {
      await api.post('/api/conta/redefinir', { token, senha })
      window.history.replaceState(null, '', '/')
      onEntrou()
    } catch (e) { setErro(e.dados?.mensagem || 'Não foi possível salvar a senha.') } finally { setEnviando(false) }
  }
  return (
    <form className="cartao tela-entrada" onSubmit={enviar} noValidate>
      <h1>Nova senha</h1>
      <p className="subtitulo">Crie a senha que você vai usar para entrar.</p>
      <CampoSenha id="redef-senha" rotulo="Nova senha (mínimo 8 caracteres)" valor={senha} onChange={setSenha} autoComplete="new-password" />
      <CampoSenha id="redef-confirmar" rotulo="Repita a senha" valor={confirmar} onChange={setConfirmar} autoComplete="new-password" />
      {erro && <div className="alerta-erro" role="alert">{erro}</div>}
      <div className="acoes"><button className="botao-principal largo" disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar senha'}</button></div>
      <button type="button" className="link grande" onClick={() => { window.history.replaceState(null, '', '/'); irPara('entrar') }}>Voltar para entrar</button>
    </form>
  )
}

/* ---------- área do participante ---------- */

/** Foto da conta, dentro da área do participante: adicionar, trocar ou remover (salva na hora). */
function MinhaFoto({ conta, recarregar, onAviso }) {
  const [salvando, setSalvando] = useState(false)
  async function mudou(blob) {
    setSalvando(true)
    try {
      if (blob) await api.enviarArquivo('/api/conta/foto', blob); else await api.delete('/api/conta/foto')
      onAviso(blob ? 'Foto salva.' : 'Foto removida.')
      recarregar()
    } catch (e) { onAviso(e.dados?.mensagem || 'Não foi possível salvar a foto.') } finally { setSalvando(false) }
  }
  return <FotoPerfil key={conta.fotoVersao ?? 'sem'} urlAtual={conta.temFoto ? `/api/conta/foto?v=${conta.fotoVersao}` : null} rotulo="Sua foto" onChange={mudou} desabilitado={salvando} />
}

function MinhaArea({ marca, info, recarregar, onSair }) {
  const [tela, setTela] = useState('inicio')
  const [aviso, setAviso] = useState('')
  const [confirmarDesistir, setConfirmarDesistir] = useState(false)
  const { conta, ficha, dados } = info
  const inicial = { ...(dados ?? {}), email: dados?.email || conta.email }
  const voltar = (msg = '') => { setAviso(msg); setTela('inicio'); recarregar() }

  if (tela === 'inscrever') {
    return <FormularioPreFicha marca={marca} modo="nova" inicial={{ ...inicial, modalidade: '' }} jaFeitas={info.modalidadesFeitas ?? []} fezSenior={info.fezSenior === true} onConcluido={() => voltar()} onCancelar={() => setTela('inicio')} />
  }
  if (tela === 'editar') {
    return <FormularioPreFicha marca={marca} modo="editar" inicial={inicial} onConcluido={voltar} onCancelar={() => setTela('inicio')} />
  }

  async function desistir() {
    try {
      await api.post('/api/conta/desistir')
      setConfirmarDesistir(false)
      voltar('Sua desistência foi registrada.')
    } catch (e) { setAviso(e.dados?.mensagem || 'Não foi possível registrar.') }
  }

  const nome = (conta.nome || dados?.nome_completo || '').split(' ')[0]
  return (
    <div className="cartao area-participante">
      <div className="linha-topo">
        <h2>Olá{nome ? `, ${nome}` : ''}!</h2>
        <button className="link" onClick={onSair}>Sair</button>
      </div>
      <p className="dica">CPF {mascaraCpf(conta.cpf)} · {conta.email}</p>
      {conta.senhaInicial && <div className="alerta-aviso">Sua senha ainda é o seu CPF. Recomendamos trocá-la em "Alterar senha" para proteger seus dados.</div>}
      {aviso && <div className="alerta-ok">{aviso}</div>}
      <MinhaFoto conta={conta} recarregar={recarregar} onAviso={setAviso} />

      {ficha?.ativa ? (
        <div className="bloco-situacao">
          <h3>Sua pré-ficha</h3>
          <p>Situação: <strong>{ficha.rotulo}</strong></p>
          {info.mostrarPosicao && ficha.posicao && (
            <p className="posicao-participante">Posição na fila ({rotuloDe(MODALIDADES, ficha.modalidade)}): <strong>{ficha.posicao}º</strong></p>
          )}
          <p className="dica">Inscrição em {formatarDataHora(ficha.created_at)}. A ordem da fila não muda quando você atualiza seus dados.</p>
          <div className="botoes-area">
            <button className="botao-principal" onClick={() => setTela('editar')}>Editar meus dados</button>
            {!confirmarDesistir ? (
              <button className="botao-secundario" onClick={() => setConfirmarDesistir(true)}>Desistir da vaga</button>
            ) : (
              <div className="confirmar">
                <p>Tem certeza? Você sai da fila e, para voltar, entra no fim dela.</p>
                <button className="botao-secundario perigo" onClick={desistir}>Sim, desistir</button>
                <button className="link inline" onClick={() => setConfirmarDesistir(false)}>Cancelar</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bloco-situacao">
          {ficha ? (
            <>
              <h3>Sua última pré-ficha</h3>
              <p>Situação: <strong>{ficha.rotulo}</strong> (inscrição em {formatarDataHora(ficha.created_at)})</p>
            </>
          ) : <p>Você ainda não fez sua inscrição.</p>}
          <div className="botoes-area">
            <button className="botao-principal" onClick={() => setTela('inscrever')}>
              {ficha ? 'Inscrever-me de novo' : 'Fazer minha inscrição'}
            </button>
            {dados && <button className="botao-secundario" onClick={() => setTela('editar')}>Editar meus dados</button>}
          </div>
          {dados && <p className="dica">Seus dados anteriores já vêm preenchidos. Confira o estado civil e escolha a modalidade: quem já fez uma modalidade pode entrar na fila de outra quando tiver os requisitos (ex.: Sênior — casado(a) ou 30 anos ou mais).</p>}
          {info.modalidadesFeitas?.length > 0 && (
            <p className="dica">Você já fez: {info.modalidadesFeitas.map((m) => rotuloDe(MODALIDADES, m)).join(', ')}.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- página ---------- */

function Pagina() {
  const { marca, erro } = useMarca()
  const [ativado, setAtivado] = useState(null)
  const [info, setInfo] = useState(null)
  const token = new URLSearchParams(window.location.search).get('redefinir')
  const [tela, setTela] = useState(token ? 'redefinir' : 'entrar')

  const carregar = useCallback(() => api.get('/api/conta/eu').then(setInfo).catch(() => setInfo({ conta: null })), [])
  useEffect(() => { api.get('/api/licenca').then((r) => setAtivado(r.ativada)).catch(() => setAtivado(true)) }, [])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [tela])

  if (erro) {
    return <main className="pagina"><div className="alerta-erro">Não foi possível carregar a página. Tente novamente em instantes.</div></main>
  }
  if (!marca || ativado === null || !info) return <main className="pagina"><p className="carregando">Carregando…</p></main>

  const sair = async () => { await api.post('/api/conta/sair').catch(() => {}); setTela('entrar'); carregar() }
  const entrou = () => { setTela('entrar'); carregar() }

  let conteudo
  if (!ativado) {
    conteudo = (
      <div className="cartao sucesso">
        <h2>Inscrições em breve</h2>
        <p>As inscrições ainda não estão disponíveis. Volte em breve.</p>
      </div>
    )
  } else if (info.contaObrigatoria === false && !info.conta) {
    conteudo = <FormularioPreFicha marca={marca} />
  } else if (info.conta && tela !== 'redefinir') {
    conteudo = <MinhaArea marca={marca} info={info} recarregar={carregar} onSair={sair} />
  } else if (tela === 'redefinir') {
    conteudo = <Redefinir token={token} onEntrou={entrou} irPara={setTela} />
  } else if (tela === 'cadastro') {
    conteudo = <FormularioPreFicha marca={marca} modo="cadastro" onConcluido={entrou} onCancelar={() => setTela('entrar')} />
  } else if (tela === 'esqueci') {
    conteudo = <Esqueci irPara={setTela} recuperacao={info.recuperacao} />
  } else {
    conteudo = <Entrar marca={marca} irPara={setTela} onEntrou={entrou} />
  }

  const telaDeEntrada = !info.conta && info.contaObrigatoria !== false && tela !== 'cadastro'
  return (
    <main className={`pagina ${telaDeEntrada ? 'pagina-entrada' : ''}`}>
      <header className="cabecalho">
        {marca.logoUrl && <img className="logo" src={marca.logoUrl} alt={marca.nome} />}
        <p className="nome-acampamento">{marca.nome}</p>
        {!telaDeEntrada && (
          <>
            <h1>{marca.tituloFormulario}</h1>
            <p><TextoMarca texto={marca.textoFormulario} /></p>
          </>
        )}
      </header>
      {conteudo}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><Pagina /></StrictMode>)
