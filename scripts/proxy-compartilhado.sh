#!/usr/bin/env bash
# Proxy HTTPS compartilhado da VM: UM Caddy nas portas 80/443 atende todos os acampamentos
# publicados diretamente (domínio próprio). Os publicados pela Cloudflare não passam por aqui.
#
#   sudo ./scripts/proxy-compartilhado.sh garantir                  # cria/sobe o proxy (idempotente)
#   sudo ./scripts/proxy-compartilhado.sh adicionar DOMINIO PORTA   # publica DOMINIO -> 127.0.0.1:PORTA
#   sudo ./scripts/proxy-compartilhado.sh remover DOMINIO
#   sudo ./scripts/proxy-compartilhado.sh listar
#
# Fica em /opt/prefichas-proxy (Caddyfile + um arquivo por domínio em sites/). O certificado HTTPS
# de cada domínio é emitido sozinho (Let's Encrypt) na primeira visita. Recarrega sem derrubar os outros.
set -euo pipefail
PASTA=/opt/prefichas-proxy
erro() { echo "✗ $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || erro "Rode como administrador (sudo)."
command -v docker >/dev/null || erro "Docker não encontrado."
dominio_valido() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; }
porta_ocupada() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q . ; }
quem_usa() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/users:(("//; s/"$//'; }
rodando() { docker ps --format '{{.Names}}' | grep -qx prefichas-proxy; }
recarregar() { docker exec prefichas-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null; }

garantir() {
  mkdir -p "$PASTA/sites"
  [ -f "$PASTA/Caddyfile" ] || cat > "$PASTA/Caddyfile" <<'CFG'
# Proxy compartilhado dos acampamentos (gerado por scripts/proxy-compartilhado.sh)
{
	# e-mail opcional para avisos do Let's Encrypt: descomente e preencha
	# email voce@exemplo.com
}
import /etc/caddy/sites/*.caddy
CFG
  [ -f "$PASTA/docker-compose.yml" ] || cat > "$PASTA/docker-compose.yml" <<'YML'
name: prefichas-proxy
services:
  caddy:
    image: caddy:2-alpine
    container_name: prefichas-proxy
    restart: unless-stopped
    # rede do host: alcança os acampamentos em 127.0.0.1:PORTA (que não ficam expostos)
    network_mode: host
    mem_limit: 256m
    logging:
      driver: local
      options: { max-size: "10m", max-file: "3" }
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - dados:/data
      - config:/config
volumes:
  dados:
  config:
YML
  if ! rodando; then
    if porta_ocupada 80 || porta_ocupada 443; then
      echo "As portas 80/443 desta VM estão em uso:"
      porta_ocupada 80 && echo "  porta 80:  $(quem_usa 80 || echo 'outro programa')"
      porta_ocupada 443 && echo "  porta 443: $(quem_usa 443 || echo 'outro programa')"
      erro "Libere as portas 80/443 (ou publique pela Cloudflare) e rode de novo."
    fi
    # sem nenhum site ainda, o Caddy precisa de ao menos um arquivo para o import
    ls "$PASTA"/sites/*.caddy >/dev/null 2>&1 || echo "# (vazio)" > "$PASTA/sites/_vazio.caddy"
    (cd "$PASTA" && docker compose up -d >/dev/null)
    echo "✓ Proxy compartilhado no ar (portas 80/443)."
  fi
}

case "${1:-}" in
  garantir) garantir ;;
  adicionar)
    D="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"; P="${3:-}"
    dominio_valido "$D" || erro "Domínio inválido: $D"
    [[ "$P" =~ ^[0-9]{4,5}$ ]] && [ "$P" -ge 1024 ] && [ "$P" -le 65535 ] || erro "Porta inválida: $P"
    garantir
    cat > "$PASTA/sites/${D}.caddy" <<SITE
${D} {
	encode zstd gzip
	request_body {
		max_size 10MB
	}
	reverse_proxy 127.0.0.1:${P}
}
SITE
    rm -f "$PASTA/sites/_vazio.caddy"
    recarregar
    echo "✓ ${D} publicado (HTTPS automático) → 127.0.0.1:${P}"
    ;;
  remover)
    D="$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z')"
    dominio_valido "$D" || erro "Domínio inválido: $D"
    rm -f "$PASTA/sites/${D}.caddy"
    ls "$PASTA"/sites/*.caddy >/dev/null 2>&1 || echo "# (vazio)" > "$PASTA/sites/_vazio.caddy"
    rodando && recarregar
    echo "✓ ${D} removido do proxy."
    ;;
  listar)
    for f in "$PASTA"/sites/*.caddy; do
      [ -e "$f" ] || continue; [ "$(basename "$f")" = _vazio.caddy ] && continue
      printf '%s → %s\n' "$(basename "$f" .caddy)" "$(grep -oE '127\.0\.0\.1:[0-9]+' "$f")"
    done
    ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
