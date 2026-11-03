# Formato de entrega de cada revisor do squad

Responda em português, só com achados de **performance** (velocidade, uso de CPU/memória/disco/rede,
escala). Segurança e estilo só entram se afetarem performance.

Para cada achado:

```
### [ID] Título curto            (ex.: BD-01, BE-03, FE-02, INF-04)
- Onde: caminho/arquivo.js:linha (um ou mais)
- Evidência: o que você viu no código ou mediu (números, EXPLAIN, tamanho do bundle…)
- Impacto: ALTO | MÉDIO | BAIXO — e em qual situação (ex.: "abertura da fila com 500 envios/min",
  "fila com 20 mil fichas", "celular 3G")
- Esforço: P (horas) | M (1–2 dias) | G (mais)
- Recomendação: o que mudar, de forma concreta (trecho de código/SQL/config quando ajudar)
- Como medir: o teste/métrica que comprova a melhoria
```

Regras:
- Só aponte o que verificou no código atual; marque como **(hipótese)** o que não pôde confirmar.
- Diga explicitamente o que **está bom** e não precisa mudar (seção "Pontos fortes", curta).
- Máximo de 12 achados, do maior impacto para o menor.
- Termine com uma linha: "Medições feitas: …" ou "Sem medições (análise só do código)".
