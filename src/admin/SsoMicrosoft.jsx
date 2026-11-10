import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

/** Configurações → Login com a Microsoft. Quem habilita (e informa os IDs e o segredo) é o painel central da VM; aqui só se vê a situação. */
export default function SsoMicrosoft() {
  const [c, setC] = useState(null)
  const [aviso, setAviso] = useState('')
  useEffect(() => { api.get('/api/admin/sso').then(setC).catch(() => setAviso('Não foi possível carregar.')) }, [])
  if (!c) return <section><h2>Login com a Microsoft</h2><p className="dica">{aviso || 'Carregando…'}</p></section>

  async function alterar(mudanca) {
    setAviso('')
    const novo = { ...c, ...mudanca }
    try { await api.put('/api/admin/sso', { criarPendentes: novo.criarPendentes, provisionar: novo.provisionar }); setC(novo); setAviso('Salvo.') } catch { setAviso('Não foi possível salvar.') }
  }
  return (
    <section>
      <h2>Login com a Microsoft</h2>
      <p>
        Situação: <strong>{c.pronto ? 'ligado' : c.habilitado ? 'habilitado, mas incompleto' : 'desligado'}</strong>.
        {!c.habilitado && <span className="dica"> O login com a conta Microsoft corporativa é habilitado pelo administrador da VM, no painel central (Instâncias → Login Microsoft).</span>}
        {c.habilitado && !c.pronto && <span className="dica"> Falta algum dado (ID do diretório, ID do aplicativo, segredo ou endereço público). Peça ao administrador da VM para conferir no painel central.</span>}
      </p>
      {c.habilitado && (
        <>
          <p className="dica">Diretório: <code>{c.tenantId || '—'}</code> · Aplicativo: <code>{c.clientId || '—'}</code> · URI de redirecionamento: <code>{c.redirectUri || '—'}</code></p>
          <div className="campo">
            <label htmlFor="sso-modo">Primeiro acesso de quem entra pela Microsoft</label>
            <select id="sso-modo" value={c.provisionar} onChange={(e) => alterar({ provisionar: e.target.value })}>
              <option value="liberacao">Aguardar a liberação de um administrador (em Usuários)</option>
              <option value="grupos">Entrar direto como coordenador, com o núcleo definido pelos grupos do Entra</option>
            </select>
            {c.provisionar === 'grupos' && <small className="dica">Cada núcleo guarda o ID do seu grupo do Entra (em Núcleos → editar). Quem não estiver em nenhum grupo de núcleo não entra. Quem sair de todos os grupos perde os núcleos na próxima entrada. O token precisa trazer os grupos: veja o manual.</small>}
          </div>
          {c.provisionar === 'liberacao' && (
            <label className="check">
              <input type="checkbox" checked={c.criarPendentes} onChange={(e) => alterar({ criarPendentes: e.target.checked })} />
              <span>Quem entrar pela primeira vez e ainda não tiver acesso vira um <strong>cadastro aguardando liberação</strong>. Desmarcado = só entra quem já foi cadastrado.</span>
            </label>
          )}
          {aviso && <span className="dica" role="status">{aviso}</span>}
        </>
      )}
    </section>
  )
}
