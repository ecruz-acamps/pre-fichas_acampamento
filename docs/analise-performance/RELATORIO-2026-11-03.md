# Relatório de performance — 2026-11-03

Squad: banco de dados (BD), backend (BE), frontend (FE) e infraestrutura (INF).
Cenário de referência: 20 mil pré-fichas, 30 usuários no painel, 500 inscrições em 10 minutos,
servidor de 2 vCPU / 4 GB, participantes em celular simples com 4G fraco.

## Resumo executivo

1. **O painel fica lento quando a fila cresce.** Com 20 mil fichas, a tela da Fila leva **22 segundos**
   para abrir, baixa **26 MB** e cada tecla na busca trava a tela por **4–5 segundos**. A causa é uma só:
   o painel baixa e desenha **todas** as fichas de uma vez (com dados que só o detalhe usa).
2. **Uma configuração do banco (JIT) desperdiça até 2/3 do tempo** dessa consulta. Desligar é uma linha.
3. **As inscrições (abertura da fila) aguentam bem**: o banco grava 500 fichas em 32 ms. Faltam só
   2 índices para as conferências de duplicado e de limite ficarem ~5–65× mais rápidas.
4. **Risco operacional**: os logs do Docker crescem sem limite e podem encher o disco (o banco para).
5. O formulário público está bom (abre em ~2,6 s no 4G fraco) e pode chegar a < 2 s com ajustes simples.

## Prioridades

### Fazer já (impacto alto, esforço pequeno/médio)
| ID | Melhoria | Impacto | Esforço | Onde |
|---|---|---|---|---|
| P1 | Desligar o JIT do PostgreSQL | ALTO | P | `server/db.js:12` |
| P2 | Logs do Docker com limite de tamanho | ALTO | P | `docker-compose.yml` |
| P3 | Fila paginada e resumida no servidor (detalhe completo só ao abrir a ficha) | ALTO | M | `server/rotas/fila.js:37-79`, `src/admin/Fila.jsx` |
| P4 | Núcleos calculados uma vez (join) em vez de subconsulta por linha | ALTO | P/M | `server/rotas/fila.js:39-40` |
| P5 | Busca da fila sem travar (texto pré-normalizado + debounce; depois busca no servidor) | ALTO | P/M | `src/admin/Fila.jsx:116-133` |
| P6 | Abas do painel compartilham os dados (sem baixar tudo de novo); Resumo com totais do servidor | ALTO | P/M | `useFichas` em Fila/Nomes/Resumo/Acampamentos |
| P7 | Índices para inscrição: duplicado (nome+nascimento) e `created_at` | MÉDIO | P | migração nova; `server/rotas/publico.js:60-83` |
| P8 | Pool com tempo limite de conexão e de consulta | MÉDIO | P | `server/db.js:12` |

### Planejar
| ID | Melhoria | Impacto | Esforço | Onde |
|---|---|---|---|---|
| L1 | Atualização sem reconstruir no servidor (imagem pronta no GitHub/GHCR) | ALTO no pico / MÉDIO | M | `scripts/atualizar.sh:52`, `Dockerfile` |
| L2 | Formulário mais leve: CSS separado do painel, marca embutida no HTML, 2 pesos de fonte | MÉDIO | M | `vite.config.js`, `src/form/main.jsx`, `server/marca.js` |

### Ganhos rápidos
| ID | Melhoria | Impacto | Esforço | Onde |
|---|---|---|---|---|
| G1 | Limites de memória/CPU por container (`mem_limit`) | MÉDIO | P | `docker-compose.yml` |
| G2 | Compressão sem Caddy (gzip no nginx de exemplo; `.br/.gz` pré-gerados no Node) | MÉDIO | P | `deploy/nginx.conf`, `server/app.js` |
| G3 | Sessão: renovar validade só quando faltar metade do prazo (hoje: UPDATE em toda requisição) | MÉDIO | P | `server/sessao.js`, `server/participantes.js` |
| G4 | Criação/troca de senha (scrypt) pelo mesmo limitador do login | MÉDIO | P | `server/rotas/conta.js:89,152,166` |
| G5 | Posição na fila por contagem com índice (sem `row_number()` da fila toda) | MÉDIO | P | `server/rotas/conta.js:62` |
| G6 | Índice parcial `cpf` para "modalidades já feitas" | BAIXO/MÉDIO | P | `server/rotas/conta.js:45-47` |
| G7 | Auditoria do coordenador com filtro de escopo depois do join | MÉDIO | P | `server/rotas/fila.js:190` |
| G8 | cloudflared com versão fixa, métricas e healthcheck; Caddy/túnel esperam a app saudável | MÉDIO | P | `docker-compose.yml` |
| G9 | Escopo do usuário calculado uma vez por requisição nas ações do painel | BAIXO/MÉDIO | P | `server/escopo.js`, `server/rotas/fila.js` |
| G10 | Divisão de código do painel (telas pouco usadas sob demanda) | BAIXO | P | `src/admin/App.jsx` |

### Não fazer agora (baixo impacto no cenário atual)
Ajuste fino do PostgreSQL (INF-04), `nice` no backup (INF-06), restauração com `--single-transaction`
(INF-07), limites no Caddy (INF-10), `docker image prune` após atualizar (INF-09 — barato, pode entrar junto
com L1), ETag no HTML e em `/api/marca` (BE-09), cache de CEP com coalescência e falha (BE-10), cache do
"licença não ativada" (BE-11), remover índice de histórico não usado (BD-09).

## Detalhes dos principais achados

### P1 — JIT do PostgreSQL (BD-01)
- **Evidência (medida)**: a lista da fila tem custo estimado ~968 mil (> limite de 500 mil do JIT), que
  compila 123 funções a cada chamada: **2,2 s com JIT × 0,62–0,74 s sem**; coordenador 1,49 s × 0,14–0,19 s.
  30 aberturas simultâneas: 21,8 s × 11,5 s.
- **Recomendação**: `new pg.Pool({ connectionString, max: 10, options: '-c jit=off' })`.
- **Como medir**: `EXPLAIN ANALYZE` sem o bloco "JIT:".

### P2 — Logs sem limite (INF-01)
- **Evidência (código)**: nenhum serviço tem `logging:`; Fastify registra cada requisição e o Caddy, cada acesso.
- **Recomendação**: âncora `x-logging: &log { driver: local, options: { max-size: "10m", max-file: "3" } }`
  aplicada a db, app, caddy e tunel.
- **Como medir**: `du -sh /var/lib/docker/containers/*/*-json.log` ao longo de semanas.

### P3 — Fila inteira em toda abertura (BD-02, BE-01, BE-07, FE-01, FE-02)
- **Evidência (medida)**: `GET /api/admin/pre-fichas` devolve 20.000 linhas com `p.*` e 4 subconsultas por
  linha = **25,8–31 MB**; ordenação vai para disco; no navegador: **22,2 s** até a tabela, 20.000 `<tr>`,
  340 mil nós, 116 MB de memória; Node chegou a **1,15 GB** com 30 aberturas.
- **Recomendação**: lista resumida (~12 colunas da tabela) e paginada por cursor `(entrada_fila_em, id)` —
  o índice `pre_fichas_fila_idx` já serve —, filtros (modalidade/status/busca) no servidor, padrão "na fila";
  participações/preferências e dados completos em `GET /api/admin/pre-fichas/:id` ao abrir o detalhe.
  Mesmo tratamento para `/api/admin/campistas`.
- **Como medir**: < 200 KB por página, < 1 s até a primeira linha, p95 com 30 clientes.

### P4 — Núcleos por linha (BD-03)
- **Evidência (medida)**: só essa subconsulta custa 375 ms em 20 mil fichas; feita uma vez (join + group by), 67 ms.
- **Recomendação**: CTE com `array_agg(distinct nucleo_id)` agrupado e `left join` (SQL no relatório do BD);
  para > 100 mil fichas, coluna `nucleos bigint[]` mantida por gatilho.

### P5 — Busca travando (FE-03)
- **Evidência (medida)**: 4,1–5,1 s por tecla; 25,8 s com CPU 4× mais lenta.
- **Recomendação**: campo de busca normalizado calculado uma vez + `useDeferredValue`/debounce 250 ms;
  com P3, busca no servidor.

### P6 — Abas rebaixando tudo (FE-04, FE-05)
- **Evidência (código)**: `useFichas()` instanciado em 4 telas, cada uma com sua carga; Nomes recarrega
  campistas a cada mudança; busca de cônjuge varre a lista inteira por tecla.
- **Recomendação**: dados no App (contexto) com recarga manual; Resumo com totais agregados do servidor;
  busca de cônjuge no servidor (`limit 8`).

### P7 — Índices das conferências da inscrição (BD-05, BD-06, BE-03)
- **Evidência (medida)**: duplicado 4,6 ms → **0,07 ms** com índice; limite 24 h 5,3 ms → **1,0 ms**.
- **Recomendação** (migração 008):
  ```sql
  create index pre_fichas_duplicado_idx on pre_fichas (chave_local(nome_completo), data_nascimento)
    where status in ('aguardando','em_contato','confirmado');
  create index pre_fichas_created_idx on pre_fichas (created_at);
  create index pre_fichas_cpf_participou_idx on pre_fichas (cpf) where status = 'participou';  -- G6
  ```

### P8 — Pool sem tempos limite (BE-05, BD-10)
- **Evidência (código + medida)**: pool de 10 sem `connectionTimeoutMillis`/`statement_timeout`; com 10
  cargas da lista ocupando o pool, ações e inscrições esperam indefinidamente.
- **Recomendação**: `connectionTimeoutMillis: 5000`, `-c statement_timeout=15000`, `max` por variável de ambiente.

### L1 — Atualização reconstrói tudo no servidor (INF-02, INF-09)
- **Evidência (código)**: `docker compose up -d --build` roda `npm ci` + `vite build` em 2 vCPU a cada
  atualização, disputando CPU com a app; cada acampamento reconstrói a mesma imagem; imagens antigas acumulam.
- **Recomendação**: GitHub Actions publica a imagem no GHCR por commit; atualização vira `pull` + `up -d`;
  `docker image prune -f` ao final.

### L2 — Formulário público (FE-06, FE-07, FE-08)
- **Evidência (medida)**: 4G fraco + CPU 6×: FCP 2,32 s, LCP 2,58 s (acima de 2,5 s); CSS de 62 KB inclui o
  painel; 3 chamadas à API só depois do JS; 3 pesos da fonte (~66 KB).
- **Recomendação**: CSS separado, marca/licença embutidas no HTML gerado pelo servidor, só pesos 400/700.
- **Meta**: LCP < 2,0 s.

## Pontos fortes (não mexer)
- Índice da fila `(modalidade, status, entrada_fila_em, id)` bem desenhado; consultas por ficha, histórico
  por ficha e conta do participante em < 1 ms.
- Escrita na abertura: 500 inscrições com gatilhos de auditoria em 32 ms.
- Caches de marca/licença com invalidação; assets com cache `immutable`; limitador de scrypt no login.
- Dockerfile multi-estágio enxuto; Postgres não exposto; atualizador por systemd `.path` com trava.
- Formulário com CLS ≈ 0,002 e fontes com `unicode-range`.

## O que foi medido e o que é hipótese
- **Medido** (dados sintéticos: 20 mil fichas, 260 mil linhas de histórico, máquina de 4 vCPU — num servidor
  de 2 vCPU os tempos tendem a ser piores): todos os números de BD; payload, tempo de tela, nós, memória e
  busca do painel; FCP/LCP/CLS do formulário; tamanhos do build.
- **Só pelo código (hipótese de magnitude)**: achados de infraestrutura (sem Docker no ambiente de análise),
  efeitos de sessão/scrypt/compressão do backend.

## Plano sugerido
1. **Etapa 1 (1 dia)**: P1, P2, P7, P8, G1, G8 — configuração e migração, sem mudar telas.
2. **Etapa 2 (2–3 dias)**: P3, P4, P5, P6 — fila paginada e painel leve (o maior ganho para os usuários).
3. **Etapa 3**: G3–G7, G9, G10, L2.
4. **Etapa 4**: L1 (imagem pronta), depois rodar `/analise-performance` de novo e comparar.

---

## Resultado das melhorias (implementadas em 2026-11-03)

Medido com os mesmos dados sintéticos (20 mil fichas):

| Medida | Antes | Depois |
|---|---|---|
| Abrir a Fila no painel | 22,2 s | **1,0 s** |
| Dados baixados pela Fila | 25,8 MB | **0,44 MB** (resumida + compressão) |
| Busca na Fila (por tecla) | 4,1–5,1 s | **0,06–0,1 s** |
| Memória do navegador no painel | 116 MB | **31 MB** |
| Nós na página da Fila | 340 mil | **3,5 mil** (200 linhas por vez) |
| Formulário no 4G fraco (LCP) | 2,58 s | **1,55 s** |
| Consulta da lista no banco | 2,2 s (JIT) | JIT desligado + núcleos agrupados |
| Painel inicial (JS) | 115 KB | **67 KB** |
| Trocar de aba no painel | baixava tudo de novo | **1 download** para todas as abas |

Itens feitos: P1–P8, L1 (imagem pronta com reconstrução local de reserva), G1–G8, G10, BE-10, BE-11,
INF-09 (limpeza de imagens). Não feitos (baixo impacto agora): L2 parcial (CSS separado do painel e marca
embutida no HTML — o LCP já ficou abaixo da meta com a compressão), G9, ajuste fino do PostgreSQL, ETag.

Segurança preservada: a lista resumida e a ficha completa seguem as mesmas regras de acesso (coordenador só
vê fichas da sua área; testes cobrem), a lista em memória do painel é apagada ao sair/expirar/entrar, as
sessões continuam barrando usuário desativado e as senhas continuam com scrypt.
