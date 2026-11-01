// Proteções do login além do limite por IP:
//  - limite por CONTA: muitas senhas erradas para o mesmo e-mail bloqueiam a conta por um tempo,
//    mesmo que as tentativas venham de IPs diferentes;
//  - limite de verificações simultâneas de senha (scrypt é pesado de propósito): evita que uma
//    enxurrada de tentativas trave o servidor.

export function criarProtecaoLogin({ maxFalhas = 8, janelaMin = 15, bloqueioMin = 15, simultaneas = 2, fila = 20 } = {}) {
  const contas = new Map()
  let ativas = 0
  const esperando = []

  const limpar = (agora) => {
    if (contas.size < 10_000) return
    for (const [k, v] of contas) if (v.ate < agora && v.desde + janelaMin * 60_000 < agora) contas.delete(k)
  }

  return {
    /** Minutos restantes de bloqueio da conta (0 = liberada). */
    bloqueio(email) {
      const c = contas.get(email)
      if (!c || !c.ate || c.ate < Date.now()) return 0
      return Math.ceil((c.ate - Date.now()) / 60_000)
    },
    falhou(email) {
      const agora = Date.now()
      limpar(agora)
      let c = contas.get(email)
      if (!c || c.desde + janelaMin * 60_000 < agora) c = { falhas: 0, desde: agora, ate: 0 }
      c.falhas++
      if (c.falhas >= maxFalhas) { c.ate = agora + bloqueioMin * 60_000; c.falhas = 0; c.desde = agora }
      contas.set(email, c)
    },
    acertou(email) { contas.delete(email) },

    /** Executa `fn` respeitando o limite de verificações simultâneas. Lança 'OCUPADO' se a fila encher. */
    async limitar(fn) {
      if (ativas >= simultaneas) {
        if (esperando.length >= fila) throw Object.assign(new Error('Servidor ocupado'), { code: 'OCUPADO' })
        await new Promise((resolve) => esperando.push(resolve))
      }
      ativas++
      try { return await fn() } finally {
        ativas--
        esperando.shift()?.()
      }
    },
  }
}
