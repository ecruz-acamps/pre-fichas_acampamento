import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

/** Configurações → Login com a Microsoft (Microsoft Entra ID, OpenID Connect). Só administrador. */
export default function SsoMicrosoft() {
  const [c, setC] = useState(null)
  const [erros, setErros] = useState({})
  const [aviso, setAviso] = useState('')
  const [salvando, setSalvando] = useState(false)
  useEffect(() => { api.get('/api/admin/sso').then(setC).catch(() => setAviso('Não foi possível carregar.')) }, [])
  if (!c) return <section><h2>Login com a Microsoft</h2><p className="dica">{aviso || 'Carregando…'}</p></section>

  async function salvar() {
    setSalvando(true); setErros({}); setAviso('')
    try {
      await api.put('/api/admin/sso', c)
      setC(await api.get('/api/admin/sso')); setAviso('Salvo.')
    } catch (e) { setErros(e.dados?.erros || {}); setAviso(e.dados?.mensagem || 'Não foi possível salvar.') } finally { setSalvando(false) }
  }
  return (
    <section>
      <h2>Login com a Microsoft</h2>
      <p className="dica">Permite entrar no painel com a conta corporativa (Microsoft Entra ID / Microsoft 365), por OpenID Connect. A senha continua funcionando. Quem entra pela Microsoft usa o autenticador da própria Microsoft (não pede o código de duas etapas deste sistema).</p>
      <ol className="dica">
        <li>No portal do Microsoft Entra: <em>Registros de aplicativo → Novo registro</em>, "Contas somente neste diretório organizacional".</li>
        <li>Em <em>URI de redirecionamento</em> (Web), cadastre: <code>{c.redirectUri || '(defina URL_PUBLICA no servidor)'}</code></li>
        <li>Em <em>Certificados e segredos</em>, crie um segredo e coloque o <strong>valor</strong> na variável <code>MICROSOFT_CLIENT_SECRET</code> do servidor (arquivo <code>.env</code>), depois reinicie. Segredo configurado: <strong>{c.segredoConfigurado ? 'sim' : 'não'}</strong>.</li>
        <li>Copie abaixo o <em>ID do diretório (locatário)</em> e o <em>ID do aplicativo (cliente)</em>.</li>
      </ol>
      <div className="campo">
        <label htmlFor="sso-tenant">ID do diretório (locatário)</label>
        <input id="sso-tenant" value={c.tenantId} onChange={(e) => setC({ ...c, tenantId: e.target.value })} spellCheck="false" />
        {erros.tenantId && <small className="erro">{erros.tenantId}</small>}
      </div>
      <div className="campo">
        <label htmlFor="sso-cliente">ID do aplicativo (cliente)</label>
        <input id="sso-cliente" value={c.clientId} onChange={(e) => setC({ ...c, clientId: e.target.value })} spellCheck="false" />
        {erros.clientId && <small className="erro">{erros.clientId}</small>}
      </div>
      <label className="check">
        <input type="checkbox" checked={c.criarPendentes} onChange={(e) => setC({ ...c, criarPendentes: e.target.checked })} />
        <span>Quem entrar pela Microsoft pela primeira vez e ainda não tiver acesso vira um <strong>cadastro aguardando liberação</strong> (em Usuários). Desmarcado = só entra quem já foi cadastrado.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={c.ativo} onChange={(e) => setC({ ...c, ativo: e.target.checked })} />
        <span><strong>Ativar</strong> o botão "Entrar com a Microsoft" na tela de login</span>
      </label>
      {erros.ativo && <small className="erro">{erros.ativo}</small>}
      <div className="acoes"><button type="button" className="botao-principal" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar login Microsoft'}</button> {aviso && <span className="dica" role="status">{aviso}</span>}</div>
    </section>
  )
}
