# Análise de performance — método do squad

Um "squad" de 4 revisores seniores (agentes do Claude Code), cada um especialista numa área,
analisa o sistema inteiro e um coordenador junta tudo num relatório priorizado.

| Revisor | Arquivo | Olha para |
|---|---|---|
| Banco de dados | `.claude/agents/perf-banco.md` | consultas, índices, views, gatilhos, pool |
| Backend | `.claude/agents/perf-backend.md` | rotas, cache, CPU, chamadas externas, pico de inscrições |
| Frontend | `.claude/agents/perf-frontend.md` | tamanho das páginas, carregamento no celular, listas grandes |
| Infraestrutura | `.claude/agents/perf-infra.md` | Docker, Postgres, Caddy/Cloudflare, logs, atualização |

**Como rodar** (no Claude Code, dentro desta pasta): `/analise-performance`
(ou com foco: `/analise-performance abertura das inscrições`).

O passo a passo está em `.claude/skills/analise-performance/SKILL.md` e o formato de cada achado
em `.claude/skills/analise-performance/FORMATO.md`. Os relatórios ficam nesta pasta,
um por data (`RELATORIO-AAAA-MM-DD.md`), para comparar a evolução.
