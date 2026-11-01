import { useState } from 'react'
import { api } from '../lib/api.js'
import { formatarDataHora } from '../../shared/util.js'

const curto = (sha) => (sha ? sha.slice(0, 7) : '—')

/** Aviso fixo no topo do painel (só administradores) quando há versão nova. */
export function AvisoAtualizacao({ info, onVer }) {
  if (!info?.desatualizado) return null
  const n = info.commits_atras
  return (
    <div className="aviso-atualizacao" role="status">
      <span className="sino" aria-hidden="true">🔔</span>
      <div>
        <strong>Nova versão do sistema disponível{n ? ` — ${n} ${n > 1 ? 'atualizações' : 'atualização'}` : ''}.</strong>
        <span> Ela precisa ser instalada no servidor{info.disponivel?.mensagem ? `: “${info.disponivel.mensagem}”` : ''}.</span>
      </div>
      <button className="botao-secundario" onClick={onVer}>Ver o que mudou e como atualizar</button>
    </div>
  )
}

export default function Atualizacoes({ info, onAtualizado }) {
  const [verificando, setVerificando] = useState(false)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)

  async function verificar() {
    setErro(''); setVerificando(true)
    try {
      onAtualizado(await api.post('/api/admin/atualizacao/verificar'))
    } catch (e) {
      setErro(e.status === 429 ? 'Aguarde um minuto para verificar de novo.' : 'Não foi possível verificar agora.')
    } finally {
      setVerificando(false)
    }
  }

  const pasta = info?.pasta || '/opt/prefichas-<acampamento>'
  const comando = `cd ${pasta}\nsudo ${info?.docker === false ? 'MODO=local ' : ''}./scripts/atualizar.sh`
  async function copiar() {
    try { await navigator.clipboard.writeText(comando); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem permissão */ }
  }

  if (!info) return <p className="carregando">Carregando…</p>
  const { instalada, disponivel } = info

  let situacao
  if (!info.ativo) situacao = <span className="situacao neutra">Verificação desligada (ATUALIZACAO_VERIFICAR=false)</span>
  else if (info.erro) situacao = <span className="situacao neutra">Não foi possível comparar</span>
  else if (info.desatualizado) situacao = <span className="situacao pendente">Atualização pendente</span>
  else if (info.desatualizado === false) situacao = <span className="situacao ok">Sistema em dia</span>
  else situacao = <span className="situacao neutra">Verificando…</span>

  return (
    <>
      <div className="titulo-secao com-acoes">
        <div>
          <h1>Atualizações do sistema</h1>
          <p className="subtitulo">
            O sistema consulta o GitHub ({info.repo ?? '—'}, branch {info.branch ?? '—'}) ao iniciar e a cada poucas horas.
            {info.verificado_em && ` Última verificação: ${formatarDataHora(info.verificado_em)}.`}
          </p>
        </div>
        <button className="botao-secundario" onClick={verificar} disabled={verificando || !info.ativo}>
          {verificando ? 'Verificando…' : 'Verificar agora'}
        </button>
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}
      {info.erro && <div className="alerta-aviso">{info.erro}</div>}

      <div className="cartoes-versao">
        <div className="cartao">
          <small className="dica">Instalada neste servidor</small>
          <p className="versao">Versão {instalada?.versao ?? '—'} <code>{curto(instalada?.commit)}</code></p>
          {instalada?.data && <p className="dica">de {formatarDataHora(instalada.data)}</p>}
          <div>{situacao}</div>
        </div>
        <div className="cartao">
          <small className="dica">Mais recente no GitHub</small>
          <p className="versao"><code>{curto(disponivel?.commit)}</code></p>
          {disponivel?.data && <p className="dica">de {formatarDataHora(disponivel.data)}</p>}
          {disponivel?.mensagem && <p>“{disponivel.mensagem}”</p>}
        </div>
      </div>

      {info.desatualizado && (
        <>
          {info.novidades?.length > 0 && (
            <section className="cartao novidades">
              <h2>O que mudou ({info.commits_atras})</h2>
              <ul>
                {info.novidades.map((n) => (
                  <li key={n.commit}>
                    <span>{n.mensagem}</span>
                    <small className="dica"> · {n.data ? formatarDataHora(n.data) : ''} · <code>{curto(n.commit)}</code></small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="cartao como-atualizar">
            <h2>Como atualizar</h2>
            <p>
              A atualização é feita no servidor por quem administra a máquina (acesso SSH). Ela leva poucos minutos,
              faz um <strong>backup automático antes</strong> e mantém todos os dados.
            </p>
            <pre>{comando}</pre>
            <button className="botao-secundario" onClick={copiar}>{copiado ? 'Copiado!' : 'Copiar comandos'}</button>
            <p className="dica">
              {info?.pasta ? '' : <>Troque <code>&lt;acampamento&gt;</code> pela pasta desta instalação. </>}
              Com vários acampamentos no mesmo servidor, cada um é atualizado na sua pasta.
              Depois da atualização, este aviso some sozinho.
            </p>
          </section>
        </>
      )}
    </>
  )
}
