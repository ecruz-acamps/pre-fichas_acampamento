#!/usr/bin/env bash
# Acompanhar ao vivo o que o servidor está fazendo (como um "verbose").
#
#   sudo acompanhar.sh                 # tarefas do painel central (nova instância, atualizar, backup…)
#   sudo acompanhar.sh servico         # serviço que executa os pedidos do painel (systemd)
#   sudo acompanhar.sh instancia NOME  # logs ao vivo de um acampamento (ex.: prefichas-beata-albertina)
#   sudo acompanhar.sh proxy           # proxy HTTPS compartilhado (certificados Let's Encrypt)
#   sudo acompanhar.sh tudo            # tarefas + serviço + proxy juntos
#
# Ctrl+C para sair (não interrompe a tarefa que está rodando).
set -uo pipefail
TAREFAS=/var/lib/prefichas-gerenciador/estado/tarefas
cor() { printf '\033[1;36m%s\033[0m\n' "$*"; }

tarefas() {
  cor "Acompanhando as tarefas do painel central (Ctrl+C para sair)…"
  local atual=""
  while :; do
    local ultimo
    ultimo="$(ls -1t "$TAREFAS"/*.log 2>/dev/null | head -1)"
    if [ -n "$ultimo" ] && [ "$ultimo" != "$atual" ]; then
      [ -n "$atual" ] && kill "$TAIL" 2>/dev/null
      atual="$ultimo"
      local info="${ultimo%.log}.json"
      echo
      cor "══ $(jq -r '"\(.acao) · \(.alvo) · por \(.por) · \(.situacao)"' "$info" 2>/dev/null || basename "$ultimo") ══"
      tail -n +1 -F "$ultimo" 2>/dev/null &
      TAIL=$!
    fi
    sleep 2
  done
}

case "${1:-tarefas}" in
  tarefas) trap 'kill $TAIL 2>/dev/null; exit 0' INT; tarefas ;;
  servico) journalctl -f -o cat -u prefichas-gerenciador-executor.service -u prefichas-gerenciador-coleta.service ;;
  instancia)
    [[ "${2:-}" =~ ^prefichas-[a-z0-9-]+$ ]] && [ -f "/opt/$2/.env" ] || { echo "Uso: $0 instancia prefichas-NOME"; ls -d /opt/prefichas-* 2>/dev/null; exit 1; }
    cd "/opt/$2" && docker compose logs -f --tail 50 ;;
  proxy) docker logs -f --tail 50 prefichas-proxy ;;
  tudo)
    trap 'kill 0; exit 0' INT
    journalctl -f -o cat -u prefichas-gerenciador-executor.service | sed 's/^/[serviço] /' &
    docker logs -f --tail 5 prefichas-proxy 2>&1 | sed 's/^/[proxy] /' &
    tarefas ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
