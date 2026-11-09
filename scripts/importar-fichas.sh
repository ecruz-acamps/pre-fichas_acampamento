#!/usr/bin/env bash
# Importa pré-fichas de uma planilha (CSV) para ESTE acampamento. Rode na pasta do acampamento (ex.: /opt/prefichas-sao-padre-pio).
#
#   ./scripts/importar-fichas.sh planilha.csv             # SIMULAÇÃO: gera o relatório e NÃO grava nada
#   ./scripts/importar-fichas.sh planilha.csv --aplicar   # grava tudo numa única transação
#   ./scripts/importar-fichas.sh lotes                    # lista as importações feitas
#   ./scripts/importar-fichas.sh desfazer LOTE            # apaga as fichas de um lote (se a equipe não mexeu nelas)
#
# O relatório (resumo.txt, quarentena.csv, revisar.csv, ignoradas.csv) fica em ./importar/relatorio-<data>/.
# Esses arquivos têm dados pessoais: guarde com cuidado e apague quando terminar (rm -r importar).
# A "Data da Pré-Ficha" da planilha é mantida como data de inscrição e de entrada na fila.
set -euo pipefail
cd "$(dirname "$0")/.."
erro() { echo "✗ $*" >&2; exit 1; }
[ -f .env ] || erro "Rode dentro da pasta de um acampamento (não achei o .env)."
command -v docker >/dev/null || erro "Docker não encontrado."
rodar() { docker compose run --rm --no-deps --user "$(id -u):$(id -g)" "$@"; }

case "${1:-}" in
  lotes) rodar app node server/cli.js fichas lotes ;;
  desfazer)
    [ -n "${2:-}" ] || erro "Informe o lote: ./scripts/importar-fichas.sh desfazer LOTE"
    shift; rodar app node server/cli.js fichas desfazer "$@" ;;
  ""|-h|--help) sed -n '2,12p' "$0"; exit 1 ;;
  *)
    ARQ="$1"; shift
    [ -f "$ARQ" ] || erro "Arquivo não encontrado: $ARQ"
    case "$ARQ" in *.csv|*.CSV) ;; *) erro "Use um arquivo .csv (no Excel: Arquivo → Salvar como → CSV).";; esac
    mkdir -p importar; chmod 700 importar
    cp "$ARQ" importar/planilha.csv
    DATA="$(date +%Y%m%d-%H%M)"
    ARGS=(fichas importar /importar/planilha.csv --saida "/importar/relatorio-$DATA")
    for a in "$@"; do
      case "$a" in --aplicar) ARGS+=(--aplicar --lote "importacao-$DATA") ;; *) erro "Opção desconhecida: $a" ;; esac
    done
    rodar -v "$PWD/importar:/importar" app node server/cli.js "${ARGS[@]}"
    echo
    echo "Relatório em: $PWD/importar/relatorio-$DATA/"
    ;;
esac
