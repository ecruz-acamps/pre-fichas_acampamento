// Envio de e-mails pelo servidor SMTP configurado (SMTP_HOST, SMTP_USUARIO...).
import nodemailer from 'nodemailer'

export function criarEmail(cfg, log) {
  if (!cfg) return null
  const transporte = nodemailer.createTransport({
    host: cfg.host, port: cfg.porta, secure: cfg.seguro,
    auth: cfg.usuario ? { user: cfg.usuario, pass: cfg.senha } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  })
  return {
    async enviar({ para, assunto, texto, html, nomeRemetente }) {
      try {
        await transporte.sendMail({ from: { name: nomeRemetente || 'Acampamento', address: cfg.remetente }, to: para, subject: assunto, text: texto, html })
        return true
      } catch (e) {
        log?.error({ err: e.message }, 'Falha ao enviar e-mail')
        return false
      }
    },
  }
}
