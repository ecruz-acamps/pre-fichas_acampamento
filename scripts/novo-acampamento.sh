#!/usr/bin/env bash
# Instala um acampamento nesta pasta: gera o .env, sobe banco + aplicação (+ HTTPS),
# define o nome do acampamento, cria o primeiro administrador e pede a chave.
#
# O jeito mais simples é o instalador de um comando (ele chama este script):
#   curl -fsSL https://raw.githubusercontent.com/ecruz-acamps/pre-fichas_acampamento/main/instalar.sh | sudo bash
#
# Uso direto (as perguntas que faltarem são feitas no terminal):
#   ./scripts/novo-acampamento.sh --nome "Acampamento Exemplo" \
#       --dominio prefichas.exemplo.com.br --admin voce@email.com --nome-admin "Seu Nome"
#
# Opções:
#   --nome NOME        nome do acampamento (aparece no formulário e no painel)
#   --dominio DOM      domínio público com HTTPS automático. Vazio = sem domínio (acesso pelo IP)
#   --admin EMAIL      e-mail do primeiro administrador
#   --nome-admin NOME  nome do primeiro administrador
#   --chave XXX-0000   chave de ativação (se omitida, é pedida no fim; ENTER ativa depois pelo painel)
#   --porta-http N     porta pública do site (padrão 80; se ocupada, 8180 ou a próxima livre)
#   --porta N          porta local da aplicação (padrão 3000; vários acampamentos: 3001, 3002...)
#   --marca ARQ        (avançado) arquivo de marca completo, ver marcas/modelo.json
#   --cloudflare       publica o --dominio pelo Cloudflare Tunnel (HTTPS sem usar portas 80/443;
#                      precisa de CF_API_TOKEN ou /etc/prefichas/cloudflare.env)
#   --multi            vários acampamentos atrás de um proxy compartilhado (sem Caddy próprio)
#   --forcar           sobrescreve um .env existente (CUIDADO: troca a senha do banco gerada antes)
set -euo pipefail
cd "$(dirname "$0")/.."

PORTA_WEB="${PORTA_HTTP:-}" NOME="" DOMINIO="-" ADMIN="" NOME_ADMIN="" PORTA="3000" MULTI=0 CLOUDFLARE=0 FORCAR=0 CHAVE="" MARCA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --nome) NOME="$2"; shift 2 ;;
    --dominio) DOMINIO="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --nome-admin) NOME_ADMIN="$2"; shift 2 ;;
    --porta) PORTA="$2"; shift 2 ;;
    --porta-http) PORTA_WEB="$2"; shift 2 ;;
    --chave) CHAVE="$2"; shift 2 ;;
    --marca) MARCA="$2"; shift 2 ;;
    --multi) MULTI=1; shift ;;
    --cloudflare) CLOUDFLARE=1; shift ;;
    --forcar) FORCAR=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1"; exit 1 ;;
  esac
done

TEM_TTY=0; { : </dev/tty; } 2>/dev/null && TEM_TTY=1
perguntar() { # variável, pergunta, padrão
  local atual="${!1}"
  if [ -z "$atual" ] || [ "$atual" = "-" ]; then
    atual=""
    if [ "$TEM_TTY" = 1 ]; then read -r -p "$2${3:+ [$3]}: " atual </dev/tty; fi
    atual="${atual:-$3}"
  fi
  printf -v "$1" '%s' "$atual"
}

porta_ocupada() {
  if command -v ss >/dev/null; then ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
quem_usa() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/users:(("//; s/"$//'; }
porta_livre_a_partir() { local p="$1"; while porta_ocupada "$p"; do p=$((p + 1)); done; echo "$p"; }

command -v docker >/dev/null || { echo "Docker não encontrado. Use o instalador: instalar.sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' não encontrado."; exit 1; }

if [ -f .env ] && [ "$FORCAR" = 0 ]; then
  echo "Já existe um .env nesta pasta (instalação existente). Use --forcar para recriar."
  exit 1
fi

perguntar NOME "Nome do acampamento (ex.: Acampamento Exemplo)" ""
[ -n "$NOME" ] || { echo "Informe o nome do acampamento."; exit 1; }
if [ "$DOMINIO" = "-" ]; then
  perguntar DOMINIO "Domínio com HTTPS (ex.: prefichas.seuacampamento.com.br) — ENTER para usar sem domínio, pelo IP" ""
fi
[ "$DOMINIO" = ":80" ] && DOMINIO=""
perguntar ADMIN "E-mail do primeiro administrador" ""
perguntar NOME_ADMIN "Nome do primeiro administrador" ""
[ -n "$ADMIN" ] && [ -n "$NOME_ADMIN" ] || { echo "Informe e-mail e nome do administrador."; exit 1; }
[ -z "$MARCA" ] || [ -f "$MARCA" ] || { echo "Arquivo de marca não encontrado: $MARCA"; exit 1; }

# Identificador técnico a partir do nome (sem acentos/espaços)
SLUG="$(printf '%s' "$NOME" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf '%s' "$NOME")"
SLUG="$(printf '%s' "$SLUG" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
PROJETO="prefichas-${SLUG:-acampamento}"
if command -v openssl >/dev/null; then SENHA_DB="$(openssl rand -hex 24)"
else SENHA_DB="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi

# ---- Portas -----------------------------------------------------------------
PERFIS="caddy" COOKIE="true" PORTA_HTTP=80 PORTA_HTTPS=443 SITE="${DOMINIO}"
PORTA=$(porta_livre_a_partir "$PORTA")
if [ "$CLOUDFLARE" = 1 ]; then
  [ -n "$DOMINIO" ] || { echo "--cloudflare precisa de --dominio (ex.: nome.movimentocampista.com.br)."; exit 1; }
  PERFIS="tunel"
elif [ "$MULTI" = 1 ]; then
  PERFIS=""
elif [ -n "$DOMINIO" ]; then
  if porta_ocupada 80 || porta_ocupada 443; then
    echo
    echo "⚠ As portas 80/443 deste servidor já estão em uso:"
    porta_ocupada 80 && echo "   porta 80:  $(quem_usa 80 || echo 'outro programa')"
    porta_ocupada 443 && echo "   porta 443: $(quem_usa 443 || echo 'outro programa')"
    echo "  Sem elas não dá para emitir o certificado HTTPS do domínio."
    echo "  Vou instalar SEM HTTPS numa porta livre (você pode trocar depois — veja o manual)."
    DOMINIO=""
  fi
fi
if [ "$MULTI" = 0 ] && [ "$CLOUDFLARE" = 0 ] && [ -z "$DOMINIO" ]; then
  SITE=":80"; COOKIE="false"
  if [ -n "$PORTA_WEB" ]; then
    porta_ocupada "$PORTA_WEB" && { echo "A porta $PORTA_WEB já está em uso por $(quem_usa "$PORTA_WEB" || echo 'outro programa')."; exit 1; }
    PORTA_HTTP="$PORTA_WEB"
  else
    PORTA_HTTP=$(porta_ocupada 80 && porta_livre_a_partir 8180 || echo 80)
  fi
  PORTA_HTTPS=$(porta_livre_a_partir 8543)
  if [ "$PORTA_HTTP" != 80 ]; then echo "→ Porta 80 ocupada por $(quem_usa 80 || echo 'outro programa'): usando a porta $PORTA_HTTP."; fi
fi
URL_PUB=""; [ -n "$DOMINIO" ] && URL_PUB="https://${DOMINIO}"
# Sem domínio: o link do "Esqueci minha senha" usa o IP do servidor
IP_LOCAL="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$URL_PUB" ] && [ "$MULTI" = 0 ] && [ -n "$IP_LOCAL" ]; then
  URL_PUB="http://${IP_LOCAL}$([ "$PORTA_HTTP" = 80 ] || echo ":${PORTA_HTTP}")"
fi

umask 077
cat > .env <<ENV
# Gerado por scripts/novo-acampamento.sh em $(date '+%F %T')
COMPOSE_PROJECT_NAME=${PROJETO}
PASTA_INSTALACAO=$(pwd)
NOME_ACAMPAMENTO=${NOME}
MARCA_INICIAL=${MARCA}
COMPOSE_PROFILES=${PERFIS}
DOMINIO=${SITE}
URL_PUBLICA=${URL_PUB}
PORTA_HTTP=${PORTA_HTTP}
PORTA_HTTPS=${PORTA_HTTPS}
PORTA_LOCAL=${PORTA}
POSTGRES_DB=prefichas
POSTGRES_USER=prefichas
POSTGRES_PASSWORD=${SENHA_DB}
COOKIE_SEGURO=${COOKIE}
SESSAO_HORAS=12
LIMITE_ENVIOS_POR_HORA=30
CONTA_OBRIGATORIA=true
DOMINIO_BASE=${DOMINIO_BASE:-movimentocampista.com.br}
ENDERECO_PUBLICO=$([ "$CLOUDFLARE" = 1 ] && echo "$DOMINIO")
ENV
if [ -n "${SMTP_USUARIO:-}" ]; then
  { echo "SMTP_HOST=${SMTP_HOST:-smtp.gmail.com}"; echo "SMTP_PORTA=${SMTP_PORTA:-465}"
    echo "SMTP_USUARIO=${SMTP_USUARIO}"; echo "SMTP_SENHA=${SMTP_SENHA// /}"; echo "SMTP_REMETENTE=${SMTP_USUARIO}"; } >> .env
fi
echo "✓ Configuração criada (${PROJETO})"

if [ "$CLOUDFLARE" = 1 ]; then
  echo "→ Publicando ${DOMINIO} na Cloudflare…"
  TOKEN_TUNEL="$(./scripts/cloudflare-tunel.sh "$DOMINIO" http://app:3000)" || { rm -f .env; exit 1; }
  echo "TUNEL_TOKEN=${TOKEN_TUNEL}" >> .env
fi

# Versão do código (aparece no painel e permite avisar quando houver atualização)
VERSAO_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
VERSAO_DATA="$(git log -1 --format=%cI 2>/dev/null || true)"
VERSAO_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
export VERSAO_COMMIT VERSAO_DATA VERSAO_BRANCH

echo "→ Preparando e iniciando o sistema (na primeira vez leva alguns minutos)…"
./scripts/subir-app.sh

echo -n "→ Aguardando o sistema iniciar"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORTA}/api/saude" >/dev/null 2>&1; then echo " ✓"; break; fi
  echo -n "."; sleep 2
done
curl -fsS "http://127.0.0.1:${PORTA}/api/saude" >/dev/null || { echo; echo "✗ O sistema não respondeu. Veja: docker compose logs app"; exit 1; }

echo
SAIDA_ADMIN="$(docker compose exec -T app node server/cli.js criar-admin "$ADMIN" "$NOME_ADMIN")"
SENHA_TEMP="$(printf '%s\n' "$SAIDA_ADMIN" | sed -n 's/^Senha temporária: //p')"

# Atualização pelo painel (botão "Atualizar agora")
./scripts/instalar-atualizador.sh >/dev/null 2>&1 && echo "✓ Atualização pelo painel ativada" && {
  # situação inicial da publicação (o painel liga/desliga depois)
  TK=false; grep -qs '^CF_API_TOKEN=.' /etc/prefichas/cloudflare.env && TK=true
  printf '{"ativo":%s,"endereco":"%s","sucesso":true,"mensagem":"Instalação","token_configurado":%s,"dominio_base":"%s","em":"%s"}\n' \
    "$([ "$CLOUDFLARE" = 1 ] && echo true || echo false)" "$([ "$CLOUDFLARE" = 1 ] && echo "$DOMINIO")" "$TK" \
    "${DOMINIO_BASE:-movimentocampista.com.br}" "$(date -Iseconds)" > atualizacao/estado/publicacao.json 2>/dev/null || true
} \
  || echo "⚠ Não foi possível ativar a atualização pelo painel (use ./scripts/atualizar.sh)."

# Ativação
ATIVADO=0
for tentativa in 1 2 3; do
  if [ -z "$CHAVE" ] && [ "$TEM_TTY" = 1 ]; then
    read -r -p "Chave de ativação (XXX-0000) — ENTER para ativar depois pelo painel: " CHAVE </dev/tty
  fi
  [ -z "$CHAVE" ] && break
  if docker compose exec -T app node server/cli.js licenca ativar "$CHAVE"; then ATIVADO=1; break; fi
  CHAVE=""
  [ "$TEM_TTY" = 1 ] || break
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$DOMINIO" ]; then BASE="https://${DOMINIO}"
elif [ "$MULTI" = 1 ]; then BASE="(configure o proxy para 127.0.0.1:${PORTA})"
elif [ "$PORTA_HTTP" = 80 ]; then BASE="http://${IP:-IP-DO-SERVIDOR}"
else BASE="http://${IP:-IP-DO-SERVIDOR}:${PORTA_HTTP}"; fi

echo
echo "════════════════════════════════════════════════════════════"
echo "  ✓ ${NOME} instalado"
echo
echo "  Formulário:  ${BASE}/"
echo "  Painel:      ${BASE}/admin/"
echo "  Login:       ${ADMIN}"
echo "  Senha temporária: ${SENHA_TEMP:-veja acima}   (será pedida uma nova no 1º acesso)"
[ "$ATIVADO" = 1 ] || echo "  Ativação:    o painel vai pedir a chave XXX-0000 no 1º acesso"
echo "  Pasta:       $(pwd)"
echo "════════════════════════════════════════════════════════════"
if [ "$MULTI" = 1 ]; then
  echo "Acrescente ao Caddyfile do proxy compartilhado (deploy/Caddyfile.multi):"
  echo "${DOMINIO:-seu.dominio} {"; echo "	encode zstd gzip"; echo "	reverse_proxy 127.0.0.1:${PORTA}"; echo "}"
fi
echo "Próximos passos: entre no painel, troque a senha, ajuste logo/cores em Configurações"
echo "e agende o backup (./scripts/backup.sh — veja o manual)."
