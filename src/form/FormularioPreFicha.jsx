import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { buscarCep } from '../lib/cep.js'
import {
  COMO_CONHECEU, ESTADOS_CIVIS, MODALIDADES, RELIGIOES, SEXOS, UFS,
} from '../../shared/opcoes.js'
import {
  calcularIdade, mascaraCep, mascaraTelefone, modalidadesCompativeis, somenteDigitos,
} from '../../shared/util.js'
import { INICIAL, temConjuge, validar } from '../../shared/validacao.js'

import { TextoMarca } from '../lib/marca.jsx'

/** Contatos do acampamento (rodapé), conforme a marca configurada. */
function Contatos({ marca }) {
  const itens = []
  if (marca.whatsapp) {
    itens.push(<span key="w">WhatsApp: <a href={`https://wa.me/${marca.whatsapp}`} target="_blank" rel="noreferrer">
      {mascaraTelefone(marca.whatsapp.replace(/^55/, ''))}</a></span>)
  }
  if (marca.email) itens.push(<span key="e">E-mail: <a href={`mailto:${marca.email}`}>{marca.email}</a></span>)
  if (marca.instagram) {
    itens.push(<span key="i">Instagram: <a href={`https://instagram.com/${marca.instagram}`} target="_blank" rel="noreferrer">@{marca.instagram}</a></span>)
  }
  if (marca.site) itens.push(<span key="s"><a href={marca.site} target="_blank" rel="noreferrer">{marca.site.replace(/^https?:\/\//, '')}</a></span>)
  if (!itens.length) return null
  return <span className="contatos">Em caso de dúvidas: {itens.reduce((acc, item, i) => (i ? [...acc, ' · ', item] : [item]), [])}</span>
}

/* ---------- componentes de campo ---------- */

function Campo({ id, rotulo, erro, obrigatorio, dica, children }) {
  return (
    <div className={`campo ${erro ? 'com-erro' : ''}`}>
      {rotulo && (
        <label htmlFor={id}>
          {rotulo}
          {obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {dica && !erro && <small className="dica">{dica}</small>}
      {erro && <small className="erro" id={`${id}-erro`}>{erro}</small>}
    </div>
  )
}

function SimNao({ id, rotulo, valor, onChange, erro }) {
  return (
    <fieldset className={`campo sim-nao ${erro ? 'com-erro' : ''}`} id={id}>
      <legend>{rotulo}<span className="obrigatorio" aria-hidden="true"> *</span></legend>
      <div className="opcoes-inline">
        <label className={`pilula ${valor === true ? 'ativa' : ''}`}>
          <input type="radio" name={id} checked={valor === true} onChange={() => onChange(true)} /> Sim
        </label>
        <label className={`pilula ${valor === false ? 'ativa' : ''}`}>
          <input type="radio" name={id} checked={valor === false} onChange={() => onChange(false)} /> Não
        </label>
      </div>
      {erro && <small className="erro">{erro}</small>}
    </fieldset>
  )
}

/* ---------- formulário ---------- */

/**
 * modo: 'anonimo' (sem conta), 'nova' (inscrição pela conta) ou 'editar' (alterar os próprios dados).
 */
export default function FormularioPreFicha({ marca, modo = 'anonimo', inicial = null, jaFeitas = [], onConcluido, onCancelar }) {
  const editar = modo === 'editar'
  const [f, setF] = useState(() => ({ ...INICIAL, ...(inicial ?? {}), aceites: [], website: '' }))
  const [erros, setErros] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [cepStatus, setCepStatus] = useState({ carregando: false, msg: '' })
  const formRef = useRef(null)
  // CAPTCHA opcional (Cloudflare Turnstile), só se o acampamento configurou
  const captchaRef = useRef(null)
  const widgetRef = useRef(null)
  const [captchaToken, setCaptchaToken] = useState('')
  useEffect(() => {
    if (modo !== 'anonimo' || !marca.captcha?.siteKey || !captchaRef.current) return
    const desenhar = () => {
      if (widgetRef.current !== null || !window.turnstile) return
      widgetRef.current = window.turnstile.render(captchaRef.current, {
        sitekey: marca.captcha.siteKey, language: 'pt-br',
        callback: (t) => setCaptchaToken(t), 'expired-callback': () => setCaptchaToken(''),
      })
    }
    if (window.turnstile) return desenhar()
    const sc = document.createElement('script')
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    sc.async = true
    sc.onload = desenhar
    document.head.appendChild(sc)
  }, [marca.captcha])

  const idade = useMemo(() => calcularIdade(f.data_nascimento), [f.data_nascimento])
  const feitas = modo === 'nova' ? jaFeitas : []
  const compativeis = useMemo(() => modalidadesCompativeis(idade, f.estado_civil).filter((m) => !feitas.includes(m)),
    [idade, f.estado_civil, feitas.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const menor = idade != null && idade < 18

  const set = (campo) => (valorOuEvento) => {
    const v = valorOuEvento?.target
      ? (valorOuEvento.target.type === 'checkbox' ? valorOuEvento.target.checked : valorOuEvento.target.value)
      : valorOuEvento
    setF((anterior) => ({ ...anterior, [campo]: v }))
    if (erros[campo]) setErros((anterior) => ({ ...anterior, [campo]: undefined }))
  }

  // Se só existe uma modalidade compatível, já sugere ela.
  useEffect(() => {
    if (compativeis.length === 1 && !f.modalidade) setF((a) => ({ ...a, modalidade: compativeis[0] }))
  }, [compativeis, f.modalidade])

  // Consulta ViaCEP quando o CEP fica completo.
  const cepDigitos = somenteDigitos(f.cep)
  useEffect(() => {
    if (cepDigitos.length !== 8) { setCepStatus({ carregando: false, msg: '' }); return }
    let ativo = true
    setCepStatus({ carregando: true, msg: '' })
    buscarCep(cepDigitos)
      .then((end) => {
        if (!ativo) return
        setF((a) => ({
          ...a,
          logradouro: end.logradouro || a.logradouro,
          bairro: end.bairro || a.bairro,
          cidade: end.cidade || a.cidade,
          uf: end.uf || a.uf,
        }))
        setErros((a) => ({ ...a, cep: undefined, cidade: undefined, uf: undefined }))
        setCepStatus({ carregando: false, msg: '' })
      })
      .catch((err) => {
        if (ativo) setCepStatus({ carregando: false, msg: err.message })
      })
    return () => { ativo = false }
  }, [cepDigitos])

  async function enviar(ev) {
    ev.preventDefault()
    setErroEnvio('')
    const e = validar(f, editar ? 0 : marca.termos.length)
    setErros(e)
    const primeiro = Object.keys(e).find((k) => e[k])
    if (primeiro) {
      const el = formRef.current?.querySelector(`#${primeiro}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus?.({ preventScroll: true })
      return
    }

    setEnviando(true)
    try {
      if (editar) await api.put('/api/conta/dados', f)
      else if (modo === 'nova') await api.post('/api/conta/pre-ficha', f)
      else await api.post('/api/pre-fichas', marca.captcha ? { ...f, captcha: captchaToken } : f)
    } catch (err) {
      setEnviando(false)
      if (marca.captcha && window.turnstile && widgetRef.current !== null) { window.turnstile.reset(widgetRef.current); setCaptchaToken('') }
      if (err.dados?.erros?.captcha) {
        setErroEnvio('Confirme a verificação "não sou um robô" e envie de novo.')
      } else if (err.dados?.erros) {
        setErros(err.dados.erros)
        setErroEnvio('Confira os campos destacados.')
      } else if (err.status === 409 || err.status === 401) {
        setErroEnvio(err.dados?.mensagem || 'Não foi possível enviar.')
      } else if (err.status === 503) {
        setErroEnvio('As inscrições ainda não estão disponíveis. Tente novamente mais tarde.')
      } else if (err.status === 429) {
        setErroEnvio(err.dados?.mensagem || 'Muitos envios a partir desta rede. Aguarde alguns minutos e tente novamente.')
      } else {
        setErroEnvio('Não foi possível enviar sua pré-ficha. Verifique sua conexão e tente novamente.')
      }
      return
    }
    setEnviando(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (editar) return onConcluido?.('Seus dados foram atualizados.')
    setEnviado(true)
  }

  if (enviado) {
    return (
      <div className="cartao sucesso">
        <div className="icone-sucesso" aria-hidden="true">✓</div>
        <h2>Pré-ficha enviada!</h2>
        <p>Obrigado, <strong>{f.nome_completo.split(' ')[0]}</strong>!</p>
        <p><TextoMarca texto={marca.mensagemSucesso} /></p>
        {onConcluido && <div className="acoes"><button className="botao-principal" onClick={() => onConcluido()}>Ir para minha área</button></div>}
        <p className="rodape-texto"><Contatos marca={marca} /></p>
      </div>
    )
  }

  return (
    <form ref={formRef} className="cartao" onSubmit={enviar} noValidate>
      {/* honeypot */}
      <div className="honeypot" aria-hidden="true">
        <label>Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>

      <section>
        <h2>Dados pessoais</h2>
        <Campo id="nome_completo" rotulo="Nome e sobrenome" obrigatorio erro={erros.nome_completo}>
          <input id="nome_completo" autoComplete="name" value={f.nome_completo} onChange={set('nome_completo')} maxLength={150} />
        </Campo>
        <div className="linha">
          <Campo id="data_nascimento" rotulo="Data de nascimento" obrigatorio erro={erros.data_nascimento}
            dica={idade != null && idade >= 0 ? `${idade} anos` : undefined}>
            <input id="data_nascimento" type="date" autoComplete="bday" value={f.data_nascimento}
              max={new Date().toISOString().slice(0, 10)} onChange={set('data_nascimento')} />
          </Campo>
          <Campo id="sexo" rotulo="Sexo" obrigatorio erro={erros.sexo}>
            <select id="sexo" value={f.sexo} onChange={set('sexo')}>
              <option value="">Selecione</option>
              {SEXOS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        <div className="linha">
          <Campo id="estado_civil" rotulo="Estado civil" obrigatorio erro={erros.estado_civil}>
            <select id="estado_civil" value={f.estado_civil} onChange={set('estado_civil')}>
              <option value="">Selecione</option>
              {ESTADOS_CIVIS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </Campo>
          <Campo id="profissao" rotulo="Profissão" erro={erros.profissao}>
            <input id="profissao" value={f.profissao} onChange={set('profissao')} maxLength={120} />
          </Campo>
        </div>
        <Campo id="telefone" rotulo="Telefone / WhatsApp" obrigatorio erro={erros.telefone}
          dica="É por este número que entraremos em contato quando chegar a sua vez.">
          <input id="telefone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="(48) 99999-9999"
            value={f.telefone} onChange={(e) => set('telefone')(mascaraTelefone(e.target.value))} />
        </Campo>
        {menor && (
          <div className="destaque">
            <p>Como o(a) campista é menor de 18 anos, informe um responsável:</p>
            <div className="linha">
              <Campo id="responsavel_nome" rotulo="Nome do responsável" obrigatorio erro={erros.responsavel_nome}>
                <input id="responsavel_nome" value={f.responsavel_nome} onChange={set('responsavel_nome')} maxLength={150} />
              </Campo>
              <Campo id="responsavel_telefone" rotulo="Telefone do responsável" obrigatorio erro={erros.responsavel_telefone}>
                <input id="responsavel_telefone" type="tel" inputMode="numeric" placeholder="(48) 99999-9999"
                  value={f.responsavel_telefone}
                  onChange={(e) => set('responsavel_telefone')(mascaraTelefone(e.target.value))} />
              </Campo>
            </div>
          </div>
        )}
        {temConjuge(f) && (
          <div className="destaque">
            <p>Sobre o seu cônjuge (opcional — ajuda a equipe a identificar o casal):</p>
            <div className="linha">
              <Campo id="conjuge_nome" rotulo="Nome do cônjuge" erro={erros.conjuge_nome}>
                <input id="conjuge_nome" value={f.conjuge_nome} onChange={set('conjuge_nome')} maxLength={150} />
              </Campo>
              <Campo id="conjuge_telefone" rotulo="Telefone do cônjuge" erro={erros.conjuge_telefone}>
                <input id="conjuge_telefone" type="tel" inputMode="numeric" placeholder="(48) 99999-9999"
                  value={f.conjuge_telefone} onChange={(e) => set('conjuge_telefone')(mascaraTelefone(e.target.value))} />
              </Campo>
            </div>
            {marca.preferenciaConjuge !== false && <>
            <fieldset className="campo sim-nao" id="conjuge_fez_acampamento">
              <legend>Seu cônjuge já fez este acampamento?</legend>
              <div className="opcoes-inline">
                <label className={`pilula ${f.conjuge_fez_acampamento === true ? 'ativa' : ''}`}>
                  <input type="radio" name="conjuge_fez" checked={f.conjuge_fez_acampamento === true} onChange={() => set('conjuge_fez_acampamento')(true)} /> Sim
                </label>
                <label className={`pilula ${f.conjuge_fez_acampamento === false ? 'ativa' : ''}`}>
                  <input type="radio" name="conjuge_fez" checked={f.conjuge_fez_acampamento === false} onChange={() => set('conjuge_fez_acampamento')(false)} /> Não
                </label>
              </div>
            </fieldset>
            {f.conjuge_fez_acampamento && (
              <Campo id="conjuge_acampamento_numero" rotulo="Qual acampamento? (número, se souber)" erro={erros.conjuge_acampamento_numero}
                dica="Ex.: 24 (para o 24º acampamento).">
                <input id="conjuge_acampamento_numero" inputMode="numeric" maxLength={6} value={f.conjuge_acampamento_numero}
                  onChange={(e) => set('conjuge_acampamento_numero')(e.target.value.replace(/\D/g, ''))} />
              </Campo>
            )}
            </>}
          </div>
        )}
      </section>

      <section>
        <h2>Informações religiosas</h2>
        <div className="linha">
          <Campo id="religiao" rotulo="Religião" obrigatorio erro={erros.religiao}>
            <select id="religiao" value={f.religiao} onChange={set('religiao')}>
              <option value="">Selecione</option>
              {RELIGIOES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Campo>
          {f.religiao === 'Outra' && (
            <Campo id="religiao_outra" rotulo="Qual?" obrigatorio erro={erros.religiao_outra}>
              <input id="religiao_outra" value={f.religiao_outra} onChange={set('religiao_outra')} maxLength={70} />
            </Campo>
          )}
        </div>
        <div className="linha tres">
          <SimNao id="batizado" rotulo="Batizado(a)?" valor={f.batizado} onChange={set('batizado')} erro={erros.batizado} />
          <SimNao id="primeira_eucaristia" rotulo="Primeira eucaristia?" valor={f.primeira_eucaristia}
            onChange={set('primeira_eucaristia')} erro={erros.primeira_eucaristia} />
          <SimNao id="crismado" rotulo="Crismado(a)?" valor={f.crismado} onChange={set('crismado')} erro={erros.crismado} />
        </div>
        <Campo id="paroquia" rotulo="Qual paróquia frequenta?" erro={erros.paroquia}>
          <input id="paroquia" value={f.paroquia} onChange={set('paroquia')} maxLength={150} />
        </Campo>
        <SimNao id="participa_pastoral" rotulo="Participa de alguma pastoral?" valor={f.participa_pastoral}
          onChange={set('participa_pastoral')} erro={erros.participa_pastoral} />
        {f.participa_pastoral && (
          <Campo id="pastoral_qual" rotulo="Qual pastoral?" obrigatorio erro={erros.pastoral_qual}>
            <input id="pastoral_qual" value={f.pastoral_qual} onChange={set('pastoral_qual')} maxLength={150} />
          </Campo>
        )}
      </section>

      <section>
        <h2>Contato</h2>
        <Campo id="email" rotulo="E-mail" obrigatorio erro={erros.email}>
          <input id="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} maxLength={200} />
        </Campo>
        <div className="linha">
          <Campo id="instagram" rotulo="Instagram" erro={erros.instagram}>
            <input id="instagram" placeholder="@seuperfil" value={f.instagram} onChange={set('instagram')} maxLength={100} />
          </Campo>
          <Campo id="facebook" rotulo="Facebook" erro={erros.facebook}>
            <input id="facebook" placeholder="Nome ou link do perfil" value={f.facebook} onChange={set('facebook')} maxLength={150} />
          </Campo>
        </div>
      </section>

      <section>
        <h2>Endereço</h2>
        <div className="linha">
          <Campo id="cep" rotulo="CEP" obrigatorio erro={erros.cep || cepStatus.msg}
            dica={cepStatus.carregando ? 'Buscando endereço…' : 'O endereço é preenchido automaticamente.'}>
            <input id="cep" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000"
              value={f.cep} onChange={(e) => set('cep')(mascaraCep(e.target.value))} />
          </Campo>
          <Campo id="numero" rotulo="Número" erro={erros.numero}>
            <input id="numero" value={f.numero} onChange={set('numero')} maxLength={20} />
          </Campo>
        </div>
        <Campo id="logradouro" rotulo="Rua / logradouro" erro={erros.logradouro}>
          <input id="logradouro" autoComplete="address-line1" value={f.logradouro} onChange={set('logradouro')} maxLength={200} />
        </Campo>
        <div className="linha">
          <Campo id="complemento" rotulo="Complemento" erro={erros.complemento}>
            <input id="complemento" value={f.complemento} onChange={set('complemento')} maxLength={100} />
          </Campo>
          <Campo id="bairro" rotulo="Bairro" erro={erros.bairro}>
            <input id="bairro" value={f.bairro} onChange={set('bairro')} maxLength={100} />
          </Campo>
        </div>
        <div className="linha cidade-uf">
          <Campo id="cidade" rotulo="Cidade" obrigatorio erro={erros.cidade}>
            <input id="cidade" autoComplete="address-level2" value={f.cidade} onChange={set('cidade')} maxLength={100} />
          </Campo>
          <Campo id="uf" rotulo="UF" obrigatorio erro={erros.uf}>
            <select id="uf" value={f.uf} onChange={set('uf')}>
              <option value="">--</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Campo>
        </div>
      </section>

      <section>
        <h2>Acampamento</h2>
        <Campo id="como_conheceu" rotulo="Como conheceu o acampamento?" obrigatorio erro={erros.como_conheceu}>
          <select id="como_conheceu" value={f.como_conheceu} onChange={set('como_conheceu')}>
            <option value="">Selecione</option>
            {COMO_CONHECEU.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Campo>
        {f.como_conheceu === 'Outro' && (
          <Campo id="como_conheceu_outro" rotulo="Conte como conheceu" obrigatorio erro={erros.como_conheceu_outro}>
            <input id="como_conheceu_outro" value={f.como_conheceu_outro} onChange={set('como_conheceu_outro')} maxLength={180} />
          </Campo>
        )}
        <Campo id="motivo" rotulo="Por que deseja participar do acampamento?" obrigatorio erro={erros.motivo}>
          <textarea id="motivo" rows={4} value={f.motivo} onChange={set('motivo')} maxLength={2000} />
        </Campo>
        <fieldset className={`campo ${erros.modalidade ? 'com-erro' : ''}`} id="modalidade" tabIndex={-1}>
          <legend>Qual modalidade deseja fazer?<span className="obrigatorio" aria-hidden="true"> *</span></legend>
          <div className="modalidades">
            {MODALIDADES.map((m) => {
              const jaFez = feitas.includes(m.valor)
              const desabilitada = jaFez || (idade != null && !compativeis.includes(m.valor))
              return (
                <label key={m.valor}
                  className={`modalidade ${f.modalidade === m.valor ? 'ativa' : ''} ${desabilitada ? 'desabilitada' : ''}`}>
                  <input type="radio" name="modalidade" value={m.valor} disabled={desabilitada}
                    checked={f.modalidade === m.valor} onChange={() => set('modalidade')(m.valor)} />
                  <strong>{m.rotulo}</strong>
                  <span>{jaFez ? 'você já fez' : m.faixa}</span>
                </label>
              )
            })}
          </div>
          {idade == null && <small className="dica">Informe a data de nascimento para ver as modalidades disponíveis.</small>}
          {erros.modalidade && <small className="erro">{erros.modalidade}</small>}
        </fieldset>
      </section>

      <section>
        <h2>Informações adicionais</h2>
        <SimNao id="possui_vicio" rotulo="Possui algum vício?" valor={f.possui_vicio}
          onChange={set('possui_vicio')} erro={erros.possui_vicio} />
        {f.possui_vicio && (
          <Campo id="vicio_qual" rotulo="Qual?" obrigatorio erro={erros.vicio_qual}>
            <input id="vicio_qual" value={f.vicio_qual} onChange={set('vicio_qual')} maxLength={200} />
          </Campo>
        )}
        <Campo id="restricoes_medicas" rotulo="Restrições médicas" erro={erros.restricoes_medicas}
          dica="Alergias, medicamentos de uso contínuo, condições de saúde etc. Deixe em branco se não houver.">
          <textarea id="restricoes_medicas" rows={3} value={f.restricoes_medicas} onChange={set('restricoes_medicas')} maxLength={1000} />
        </Campo>
        <Campo id="retiros_anteriores" rotulo="Retiros que já participou" erro={erros.retiros_anteriores}>
          <textarea id="retiros_anteriores" rows={3} value={f.retiros_anteriores} onChange={set('retiros_anteriores')} maxLength={1000} />
        </Campo>
      </section>

      {!editar && marca.termos.length > 0 && (
        <section className="termos">
          {marca.termos.map((termo, i) => (
            <label key={i} className={`check ${erros[`aceite_${i}`] ? 'com-erro' : ''}`} id={`aceite_${i}`}>
              <input type="checkbox" checked={f.aceites[i] === true} onChange={(e) => {
                const aceites = [...f.aceites]
                aceites[i] = e.target.checked
                set('aceites')(aceites)
                setErros((a) => ({ ...a, [`aceite_${i}`]: undefined }))
              }} />
              <span><TextoMarca texto={termo} /></span>
            </label>
          ))}
          {marca.termos.some((_, i) => erros[`aceite_${i}`]) && (
            <small className="erro">Marque todas as declarações para continuar.</small>
          )}
        </section>
      )}

      {modo === 'anonimo' && marca.captcha && <div className="captcha" ref={captchaRef} />}
      {erroEnvio && <div className="alerta-erro" role="alert">{erroEnvio}</div>}

      <div className="acoes">
        <button type="submit" className="botao-principal" disabled={enviando}>
          {enviando ? 'Enviando…' : editar ? 'Salvar alterações' : 'Enviar ficha de inscrição'}
        </button>
        {onCancelar && <button type="button" className="botao-secundario" onClick={onCancelar}>Voltar</button>}
      </div>

      <p className="rodape-texto">
        Ao enviar a ficha de inscrição, você concorda com os termos e condições do acampamento.<br />
        <Contatos marca={marca} />
      </p>
    </form>
  )
}
