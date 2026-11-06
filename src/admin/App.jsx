import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { carregarMarca } from '../lib/marca.jsx'
import Login from './Login.jsx'
import RedefinirSenha from './RedefinirSenha.jsx'
import Fila from './Fila.jsx'
import Resumo from './Resumo.jsx'
const Acampamentos = lazy(() => import('./Acampamentos.jsx')) // carregada só quando abrir a tela
const Nucleos = lazy(() => import('./Nucleos.jsx')) // carregada só quando abrir a tela
const Usuarios = lazy(() => import('./Usuarios.jsx')) // carregada só quando abrir a tela
const Configuracoes = lazy(() => import('./Configuracoes.jsx')) // carregada só quando abrir a tela
const Auditoria = lazy(() => import('./Auditoria.jsx')) // carregada só quando abrir a tela
import Nomes from './Nomes.jsx'
import AlterarSenha from './AlterarSenha.jsx'
import Ativacao from './Ativacao.jsx'
import { limparCacheFichas } from './Fila.jsx'
import { BotaoAtualizacao, DialogoAtualizacao } from './Atualizacoes.jsx'

// Telas do painel e quem pode ver cada uma
const TELAS = [
  { id: 'fila', rotulo: 'Fila', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'nomes', rotulo: 'Nomes (A–Z)', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'resumo', rotulo: 'Resumo por cidade', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'acampamentos', rotulo: 'Acampamentos', papeis: ['admin', 'equipe'] },
  { id: 'auditoria', rotulo: 'Auditoria', papeis: ['admin', 'equipe', 'coordenador'] },
  { id: 'nucleos', rotulo: 'Núcleos', papeis: ['admin'] },
  { id: 'usuarios', rotulo: 'Usuários', papeis: ['admin'] },
  { id: 'configuracoes', rotulo: 'Configurações', papeis: ['admin'] },
]

export default function App() {
  const [usuario, setUsuario] = useState(undefined) // undefined = carregando
  const [licencaAtivada, setLicencaAtivada] = useState(true)
  const [esqueci, setEsqueci] = useState(false)
  const [tokenRedefinir, setTokenRedefinir] = useState(() => new URLSearchParams(window.location.search).get('redefinir'))
  const [marca, setMarca] = useState(null)
  const [nucleos, setNucleos] = useState([])
  const [tela, setTela] = useState('fila')
  const [atualizacao, setAtualizacao] = useState(null)
  const [dialogoAtualizacao, setDialogoAtualizacao] = useState(false)

  const carregarUsuario = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/eu')
      setUsuario(r.usuario ?? null)
      setLicencaAtivada(r.licencaAtivada !== false)
    } catch {
      limparCacheFichas()
      setUsuario(null)
    }
  }, [])

  const recarregarNucleos = useCallback(() => api.get('/api/admin/nucleos').then(setNucleos).catch(() => {}), [])

  useEffect(() => { carregarUsuario(); carregarMarca().then(setMarca).catch(() => {}) }, [carregarUsuario])
  useEffect(() => {
    if (usuario && !usuario.trocar_senha && licencaAtivada) recarregarNucleos()
  }, [usuario, licencaAtivada, recarregarNucleos])

  // Administrador: verifica se há versão nova no GitHub (repete a cada 30 min com o painel aberto)
  useEffect(() => {
    if (usuario?.papel !== 'admin' || usuario.trocar_senha || !licencaAtivada) return
    const buscar = () => api.get('/api/admin/atualizacao').then(setAtualizacao).catch(() => {})
    buscar()
    const t = setInterval(buscar, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [usuario, licencaAtivada])

  useEffect(() => {
    const pendente = () => setLicencaAtivada(false)
    window.addEventListener('licenca-pendente', pendente)
    return () => window.removeEventListener('licenca-pendente', pendente)
  }, [])

  useEffect(() => {
    const expirou = () => { limparCacheFichas(); setUsuario(null) }
    window.addEventListener('sessao-expirada', expirou)
    return () => window.removeEventListener('sessao-expirada', expirou)
  }, [])

  async function sair() {
    await api.post('/api/auth/logout').catch(() => {})
    limparCacheFichas()
    setUsuario(null)
    setTela('fila')
  }

  if (usuario === undefined) return <main className="pagina estreita"><p className="carregando">Carregando…</p></main>
  if (!usuario && (esqueci || tokenRedefinir)) {
    return <RedefinirSenha marca={marca} token={tokenRedefinir} onVoltar={() => { setEsqueci(false); setTokenRedefinir(null) }} />
  }
  if (!usuario) {
    return <Login marca={marca} onEsqueci={() => setEsqueci(true)} onEntrar={(r) => { limparCacheFichas(); setUsuario(r.usuario); setLicencaAtivada(r.licencaAtivada !== false); setTela('fila') }} />
  }
  if (usuario.trocar_senha) {
    return <AlterarSenha primeiroAcesso onConcluir={() => setUsuario({ ...usuario, trocar_senha: false })} onSair={sair} />
  }
  // Depois da instalação e do primeiro acesso, o sistema pede a chave de ativação
  if (!licencaAtivada) {
    return <Ativacao marca={marca} usuario={usuario} onSair={sair} onAtivado={() => { setLicencaAtivada(true); setTela('fila') }} />
  }

  const telas = TELAS.filter((t) => t.papeis.includes(usuario.papel))
  const atual = telas.some((t) => t.id === tela) || tela === 'senha' ? tela : 'fila'
  const props = { usuario, marca, nucleos }

  return (
    <div className="painel">
      <header className="painel-cabecalho">
        <div className="marca-painel">
          {marca?.logoUrl && <img src={marca.logoUrl} alt="" />}
          <div>
            <strong>{marca?.nomeCurto ?? 'Pré-fichas'}</strong>
            <span>Fila de espera</span>
          </div>
        </div>
        <div className="painel-usuario">
          {usuario.papel === 'admin' && <BotaoAtualizacao info={atualizacao} onAbrir={() => setDialogoAtualizacao(true)} />}
          <span title={usuario.email}>
            {usuario.nome}
            <small> · {usuario.papel === 'coordenador' ? 'coordenador(a)' : usuario.papel}</small>
          </span>
          <button className="link" onClick={() => setTela('senha')}>Minha conta</button>
          <button className="botao-secundario" onClick={sair}>Sair</button>
        </div>
      </header>

      <nav className="menu" aria-label="Seções do painel">
        {telas.map((t) => (
          <button key={t.id} className={`aba ${atual === t.id ? 'ativa' : ''}`} onClick={() => setTela(t.id)}>
            {t.rotulo}
          </button>
        ))}
      </nav>


      {atual === 'fila' && <Fila {...props} />}
      {atual === 'nomes' && <Nomes {...props} />}
      {atual === 'resumo' && <Resumo {...props} />}
      <Suspense fallback={<p className="carregando">Carregando…</p>}>
      {atual === 'acampamentos' && <Acampamentos {...props} />}
      {atual === 'auditoria' && <Auditoria {...props} />}
      {atual === 'nucleos' && <Nucleos {...props} onAlterar={recarregarNucleos} />}
      {atual === 'usuarios' && <Usuarios {...props} usuarioAtual={usuario} />}
      {atual === 'configuracoes' && <Configuracoes {...props} onSalvar={(m) => setMarca(m)} />}
      </Suspense>
      {atual === 'senha' && <AlterarSenha usuario={usuario} onUsuario={setUsuario} onConcluir={() => setTela('fila')} />}

      <footer className="rodape-painel">
        {marca?.nome} · Sistema de pré-fichas{atualizacao?.instalada?.versao ? ` · versão ${atualizacao.instalada.versao}` : ''}
        {atualizacao?.instalada?.commit ? ` (${atualizacao.instalada.commit.slice(0, 7)})` : ''}
        {usuario.papel === 'admin' && <> · <button className="link inline" onClick={() => setDialogoAtualizacao(true)}>verificar atualizações</button></>}
      </footer>

      {dialogoAtualizacao && (
        <DialogoAtualizacao info={atualizacao} onInfo={setAtualizacao} onFechar={() => setDialogoAtualizacao(false)} />
      )}
    </div>
  )
}
