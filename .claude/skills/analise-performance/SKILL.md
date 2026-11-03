---
name: analise-performance
description: Análise de performance do sistema de pré-fichas por um squad de 4 desenvolvedores seniores (banco, backend, frontend, infraestrutura), com relatório priorizado de melhorias. Use quando pedirem análise/auditoria de performance, "rodar o squad" ou /analise-performance.
---
# Análise de performance com o squad sênior

Objetivo: revisar TODO o sistema (servidor, banco, telas, implantação) e entregar um relatório
único com as melhorias de performance priorizadas por impacto x esforço.

## 1. Preparar o contexto (você, coordenador)
- Rode `git log --oneline -15` e `git diff --stat origin/main...HEAD` para saber o que mudou.
- Se `$ARGUMENTS` trouxer um foco (ex.: "só fila", "abertura das inscrições"), repasse a todos.
- Se houver PostgreSQL de teste, informe a URL aos revisores de banco e backend.

## 2. Acionar o squad EM PARALELO (uma única mensagem, 4 chamadas ao Agent)
| Revisor | subagent_type | Área |
|---|---|---|
| Banco de dados | `perf-banco` | consultas, índices, views, gatilhos, pool |
| Backend | `perf-backend` | rotas, hooks, cache, CPU, chamadas externas, pico de envios |
| Frontend | `perf-frontend` | bundle, carregamento, renderização, listas, Web Vitals |
| Infraestrutura | `perf-infra` | Docker, Compose, Caddy/cloudflared, Postgres, logs, atualização |

Cada prompt deve conter: o foco (se houver), o cenário de carga de referência abaixo e a
instrução de seguir `.claude/skills/analise-performance/FORMATO.md`.

**Cenário de referência**: um acampamento com 20 mil pré-fichas acumuladas, 30 usuários no
painel, abertura das inscrições com 500 envios em 10 minutos, servidor de 2 vCPU / 4 GB,
participantes em celulares simples com 4G fraco.

## 3. Consolidar (você)
1. Junte os achados, elimine duplicados entre revisores (mantenha o ID mais forte e cite os outros).
2. **Confira** cada achado ALTO no código (abra o arquivo/linha): descarte o que não se confirmar.
3. Classifique numa matriz: *Fazer já* (impacto alto, esforço P/M) · *Planejar* (alto, G) ·
   *Ganhos rápidos* (médio/baixo, P) · *Não fazer agora*.
4. Escreva `docs/analise-performance/RELATORIO-AAAA-MM-DD.md` com:
   - resumo executivo (5 linhas, linguagem simples para quem não é técnico);
   - tabela priorizada: ID · título · impacto · esforço · onde;
   - detalhes de cada achado (formato do FORMATO.md);
   - pontos fortes;
   - plano sugerido em etapas (ex.: Etapa 1 = itens "Fazer já");
   - o que foi medido e o que é hipótese.
5. NÃO altere código nesta etapa. Pergunte ao usuário quais itens implementar.

## 4. Repetir
Rode de novo após grandes mudanças; compare com o relatório anterior (o que melhorou, o que piorou).
