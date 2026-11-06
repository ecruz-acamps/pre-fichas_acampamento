# Marcas (identidade de cada acampamento)

O nome do acampamento é escolhido na instalação. Para configurar tudo por arquivo, cada `.json` descreve um acampamento: nome, cor, contatos, textos do
formulário, declarações obrigatórias e as tribos (nome + cor).

## Aplicar em uma instalação

```bash
# Docker
docker compose exec app node server/cli.js marca aplicar marcas/meu-acampamento.json
# Sem Docker
npm run usuarios -- marca aplicar marcas/meu-acampamento.json
```

Tudo também pode ser ajustado pelo painel: **Configurações** (somente administradores).
As alterações valem na hora, sem reiniciar nem gerar o site de novo.

## Criar a marca de um novo acampamento

1. Copie o modelo: `cp marcas/modelo.json marcas/novo-acampamento.json`
2. Edite os campos (veja abaixo).
3. (Opcional) Coloque a logo nesta pasta e indique no arquivo: `"logo": "novo-acampamento.png"`
   — PNG, JPG, WEBP ou SVG, até 1 MB. De preferência quadrada ou horizontal, com fundo transparente.
4. Aplique com o comando acima.

Para guardar a configuração feita pelo painel: `node server/cli.js marca exportar marcas/meu-acampamento.json`.

## Campos

> `casaisExigeSenior` (`true`/`false`): na modalidade Casais, os dois precisam ter feito o Sênior? (padrão `true`). Também está em Configurações → Modalidade Casais.


| Campo | O que é |
|---|---|
| `nome` | Nome completo, aparece no topo do formulário e na aba do navegador |
| `nomeCurto` | Versão curta, usada no painel |
| `corPrimaria` | Cor principal (`#RRGGBB`). Tons claros/escuros são calculados automaticamente |
| `whatsapp` | WhatsApp de contato com DDD (o 55 do Brasil é adicionado sozinho) |
| `email`, `instagram`, `site` | Contatos exibidos no rodapé (opcionais) |
| `tituloFormulario` | Título do formulário |
| `textoFormulario` | Texto de apresentação. Use `**assim**` para negrito |
| `mensagemSucesso` | Mensagem exibida após o envio |
| `termos` | Lista de declarações que a pessoa precisa marcar. O texto aceito fica gravado na ficha |
| `tribos` | Lista `{ "nome": "Azul", "cor": "#1e5bd6" }` usada ao registrar quem fez cada acampamento |
| `logo` | (só no arquivo) nome da imagem da logo, nesta mesma pasta |
