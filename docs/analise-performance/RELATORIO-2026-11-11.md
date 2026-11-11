# Revisão geral — performance, segurança e espaço (versão 2.23.1)

Data: 2026-11-11 · Cenário-alvo: **~30 acampamentos na mesma VM, ~40 mil pessoas no total** (o maior com 10–20 mil fichas), abertura de inscrições com 500 envios em 10 minutos, 30 usuários no painel.

Revisão feita por quatro revisores (banco, backend, telas, infraestrutura). Os achados de impacto alto foram conferidos no código. **Nenhum código foi alterado nesta etapa.**

## Resumo executivo

1. **O sistema aguenta o volume de dados** (40 mil pessoas é pouco para o banco: 950 envios por segundo medidos). Os riscos estão em volta: memória e disco da VM com 30 instâncias, dois limites que recusam gente na abertura das inscrições e três pontos de segurança.
2. **Segurança:** a senha inicial igual ao CPF permite tomar contas em massa com uma lista de CPFs; há um caminho para alguém virar coordenador usando o cadastro aberto + login Microsoft; e a atualização roda como root o que estiver na `main` do GitHub.
3. **Abertura das inscrições:** com os limites padrão, de 500 envios em 10 minutos **200 são recusados**, e uma rajada simultânea devolve "Erro interno" para a maioria. O servidor em si está folgado.
4. **VM com 30 acampamentos:** em 4 GB não cabe; em 8 GB cabe parado com pouca folga. Os bancos estão com a configuração padrão (feita para um servidor só) e os backups com fotos podem encher o disco (60–180 GB em 30 dias, estimativa).
5. **Telas:** os menus "Todos" e "Campistas" travam a aba por 4 a 9 segundos com 20 mil fichas; a "Pré Ficha - Espera" está boa.

## Tabela priorizada

### Fazer já (impacto alto, esforço pequeno ou médio)

| ID | Título | Tipo | Esforço | Onde |
|---|---|---|---|---|
| S-1 | Conta importada: senha = CPF permite tomada de contas em massa | segurança | M | `server/rotas/conta.js:179-204` |
| S-2 | Cadastro pendente + login Microsoft (modo grupos): a senha de quem cadastrou continua valendo | segurança | P | `server/rotas/sso.js:119-125`, `server/rotas/auth.js:109-135` |
| A-1 | Limite global de 300 envios/hora recusa 200 de 500 na abertura | abertura | P | `server/config.js:25-27`, `docker-compose.yml:62-64` |
| A-2 | Rajada de cadastros vira "Erro interno" (fila do hash de senha estoura sem tratamento) | abertura | P | `server/rotas/conta.js:154,244,258`, `server/protecao.js` |
| V-1 | Postgres e Node sem ajuste para 30 instâncias; limites de memória não protegem a VM | memória | P | `docker-compose.yml:19-57`, `server/db.js:11` |
| V-2 | Backups: 30 dias × 30 instâncias, com fotos, no mesmo disco, sem agendamento automático | espaço | M | `scripts/backup.sh`, `scripts/novo-acampamento.sh` |
| V-3 | Painel da VM roda `docker stats` uma vez por instância a cada minuto | CPU | P | `scripts/gerenciador-executor.sh:497` |
| T-1 | "Todos" e "Campistas" travam 4–9 s com 20 mil fichas | telas | P/M | `src/admin/Nomes.jsx:61-173` |
| B-1 | "Desfazer importação" de lote grande estoura o tempo (31 s) e pode falhar | banco | P | `server/importacao.js`, migração `004` |

### Planejar (impacto alto, esforço grande ou decisão sua)

| ID | Título | Tipo | Esforço |
|---|---|---|---|
| S-3 | Atualização executa a `main` como root, sem tag nem assinatura | segurança | M |
| P-1 | Painel carrega todas as fichas de uma vez (13 MB; exportação 38–48 MB) | perf/memória | M–G |
| V-4 | Um PostgreSQL único com 30 bancos em vez de 30 containers | memória/espaço | G |
| S-4 | Backups sem criptografia e sem cópia fora da VM; lixeira guarda segredos | segurança | M |
| S-5 | Aplicação conecta ao banco como superusuário; trilha de auditoria pode ser apagada | segurança | M |

### Ganhos rápidos (impacto médio ou baixo, esforço pequeno)

| ID | Título | Tipo |
|---|---|---|
| G-1 | Conferência de duplicata varre a tabela (167 ms → 0,08 ms com reescrita) | perf |
| G-2 | Painel em tela branca quando um pedaço da tela falha ao carregar após atualização | telas |
| G-3 | Formulário fica em branco esperando `/api/modalidades` (FCP 2 s → 4,5 s com servidor lento) | telas |
| G-4 | "Esqueci minha senha" da conta espera o e-mail sair: o tempo revela quem tem conta | segurança |
| G-5 | Sessões de participantes vencidas nunca são apagadas (metade do backup sem fotos) | espaço |
| G-6 | 60 verificações de saúde: ~240 execuções por minuto com tudo parado | CPU |
| G-7 | Exportar CSV trava ~3 s (formatador de data recriado a cada linha) | telas |
| G-8 | Fontes Roboto são 38% do primeiro carregamento do formulário | tamanho |
| G-9 | Foto sem cache: até 300 KB do banco a cada abertura da ficha | perf |
| G-10 | Imagens antigas do Docker e cache de build nunca são limpos; `cloudflared:latest` parado | espaço |
| G-11 | Login Microsoft: 6 IPs conseguem bloquear a entrada de todos | segurança |
| G-12 | Senha temporária do administrador fica em log legível no painel da VM | segurança |
| G-13 | Índice para a Auditoria filtrada por tipo | perf |
| G-14 | Importação pela tela trava o processo por segundos e segura arquivos na memória | perf/memória |
| G-15 | Token de redefinição fica na URL até concluir | segurança |

### Não fazer agora

- Trocar React por Preact (risco alto para ~60 kB).
- Clones git rasos (ganho de ~0,3 GB no total).
- Deduplicar o texto dos termos em cada ficha (dezenas de MB; só vale depois dos backups).
- Cifrar o segredo TOTP e apagar `ip_origem` antigo: úteis para LGPD, mas depois dos itens acima.

## Detalhes dos itens "Fazer já"

### S-1 · Senha inicial = CPF
- **Evidência (código conferido):** conta importada aceita CPF como login e como senha. O bloqueio é por conta (8 erros), mas o ataque usa uma tentativa por CPF, então nunca dispara; resta o limite de 10 logins/min por IP (~14 mil tentativas/dia por IP). Depois de entrar, dá para ler a ficha inteira e a foto, trocar a senha e **desistir da vaga** da pessoa. O cadastro ainda confirma se um CPF tem conta.
- **Observação:** senha = CPF foi decisão sua; o que muda aqui é a escala (milhares de contas importadas) e o ataque em massa.
- **Recomendação:** no primeiro acesso, pedir também a **data de nascimento** (a importação já grava) e obrigar a criar senha na hora; enquanto a senha for a inicial, a sessão só serve para trocar a senha; bloquear o IP que erra em vários CPFs diferentes; resposta neutra no cadastro.
- **Como medir:** teste com 50 contas importadas e 50 logins CPF/CPF do mesmo IP: nenhum entra sem a data de nascimento.

### S-2 · Cadastro pendente + login Microsoft
- **Evidência (código conferido, ataque não executado):** (1) alguém se cadastra em "Quero me cadastrar" com o e-mail corporativo de um futuro coordenador e uma senha própria; (2) quando o coordenador verdadeiro entra pela Microsoft no modo "grupos", o sistema ativa esse cadastro pendente sem trocar a senha (`sso.js:122`); (3) quem fez o cadastro entra com e-mail e senha como coordenador daquele núcleo. Exige cadastro da equipe aberto (padrão) e modo "grupos".
- **Recomendação:** ao ligar uma conta à Microsoft, regravar a senha com valor aleatório e derrubar sessões; recusar login por senha em contas gerenciadas pelo Entra; não promover pendente com e-mail não confirmado.
- **Como medir:** teste de integração (a "Microsoft falsa" já existe): cadastro → login Microsoft → login por senha deve dar 401.

### A-1 · Limite global de envios
- **Evidência (medida):** 500 cadastros com os limites padrão: 300 aceitos, 200 recusados com "Muitas inscrições neste momento". Os 300 aceitos levaram 15 s. O limite de 30 por IP por hora também pega salão paroquial e rede de celular.
- **Recomendação:** padrão de ~3.000/hora (ou janela por minuto), contar só depois de gravar, ~100/hora por IP. Até lá: defina `LIMITE_ENVIOS_GLOBAL_HORA=3000` no `.env` antes de uma abertura.

### A-2 · "Erro interno" na rajada
- **Evidência (medida):** 100 cadastros no mesmo instante: 22 aceitos e 78 com erro 500. A fila do cálculo de senha aceita 2 em execução + 20 em espera, e só o login trata o estouro. O cálculo em si é barato (133 ms).
- **Recomendação:** fila longa para criação de senha no cadastro (a curta fica só para o login), responder "tente em instantes" em vez de erro, e calcular antes de gastar o captcha.

### V-1 · Memória por instância
- **Evidência:** Postgres sem parâmetros (padrões: `shared_buffers` 128 MB, 100 conexões, WAL até 1 GB); app com heap de 512 MB e pool de 10. Limites somam ~53 GB. Medido: app parado usa 87 MB; 5 listas grandes simultâneas levam a 453 MB. Estimativa: par app+banco 110–170 MB parado → 30 pares = **4–6 GB** com o sistema.
- **Recomendação:** parâmetros enxutos no banco (`shared_buffers=32MB`, `max_connections=20`, `max_wal_size=128MB`, `wal_level=minimal`…), `MEMORIA_BANCO=256m`, `MEMORIA_APP=384m` com heap de 256 MB, `DB_POOL_MAX=4–5`, swap de 2–4 GB no host. **VM recomendada: 8 GB no mínimo; 16 GB com folga.**
- **Como medir no servidor:** `docker stats --no-stream`, `free -m`.

### V-2 · Backups
- **Evidência:** 30 dias de retenção por instância, no mesmo disco; fotos (JPEG, não comprimem) dominam: no teste, 105 MB com fotos contra 5 MB sem. Nenhum script agenda o backup diário (instâncias criadas pelo painel ficam só com o backup feito a cada atualização). Dump que falha deixa arquivo truncado com cara de válido.
- **Recomendação:** um agendamento único no painel da VM que percorre as instâncias em sequência; retenção 7 diários + 4 semanais; fotos em backup semanal separado; gravar em temporário e validar; abortar com alerta se o disco estiver com menos de 15% livre; reduzir a foto para ~40 KB.
- **Como medir:** `du -sh /opt/prefichas-*/backups | sort -h`.

### V-3 · Coleta do painel da VM
- **Evidência (código conferido):** `docker stats` dentro do laço por instância, timer de 1 minuto: 30 chamadas de ~2 s por ciclo (estimativa). Dois erros de resultado: soma containers de instância com nome parecido e erra valores em GiB.
- **Recomendação:** uma chamada antes do laço, nome exato, timer de 2–5 min.

### T-1 · "Todos" e "Campistas"
- **Evidência (medida, 20 mil fichas):** abrir "Todos" leva 7,7–9,1 s e cria ~529 mil elementos na página; "Campistas" 4,4 s. A ordenação usa o mesmo comparador lento que já corrigimos na fila (1.959 ms contra 30 ms), e a lista inteira é desenhada.
- **Recomendação:** comparador reutilizado, filtrar antes de ordenar, mostrar 200 por vez (ou por letra), busca com atraso, guardar os campistas em cache.
- **Meta:** abrir em menos de 300 ms.

### B-1 · Desfazer importação
- **Evidência (medida):** apagar lote de 10 mil fichas levou 31,7 s (limite: 15 s) por falta de índice em `conjuge_id`; com dois índices, 290 ms. Além disso, apagar a ficha de um cônjuge com preferência automática viola uma regra do banco e aborta tudo.
- **Recomendação:** migração com os dois índices e a correção do nome do cônjuge nas preferências.

## Itens "Planejar" — o que decidir

- **S-3 (atualização como root):** quem conseguir publicar na `main` (conta do GitHub comprometida, por exemplo) executa código como root na VM no próximo "Atualizar". Sugestão: proteger a `main` (2FA, PR obrigatório) já; depois, atualizar só para versões marcadas e assinadas.
- **P-1 (lista inteira):** hoje funciona bem até ~3 mil fichas. Para 10–20 mil: resposta "nada mudou" (304), exportação em fluxo no servidor, tirar CPF da lista, e mais adiante paginação no servidor.
- **V-4 (Postgres único):** economiza ~1–1,5 GB de RAM e 2–4 GB de disco, mas vira ponto único de falha e exige mudar instalação, backup e exclusão. Só vale depois do V-1, se a memória continuar apertada.
- **S-4 (backups fora da VM e cifrados):** hoje, perder o disco perde dados e backups juntos.
- **S-5 (usuário do banco):** usar um usuário sem poderes de administrador para a aplicação e impedir que a trilha de auditoria seja apagada.

## Pontos fortes (não mexer)

- Caminho de inscrição bem indexado: 950 envios/s medidos; consultas do dia a dia abaixo de 3 ms.
- "Pré Ficha - Espera" com 20 mil fichas: pronta em 0,9 s, filtros sem travar.
- Login Microsoft bem feito (state, nonce, PKCE, validação completa do token, tempos-limite em toda chamada externa).
- Senhas com scrypt fora do laço principal; tokens e sessões guardados só como hash; sem SQL montado com texto do usuário.
- Navegador: CSP estrita, nenhum `innerHTML`, service worker sem dados pessoais, CSV protegido contra fórmulas.
- Infra: logs com rotação, imagem única compartilhada pelas 30 instâncias, portas só em `127.0.0.1`, banco sem porta exposta, `.env` com permissão restrita, painel da VM valida tudo duas vezes.

## Plano sugerido

- **Etapa 1 — segurança e abertura (pequena):** S-2, A-1, A-2, G-4, G-11, G-12.
- **Etapa 2 — senha inicial:** S-1 (muda o primeiro acesso das contas importadas; precisa da sua decisão).
- **Etapa 3 — caber 30 na VM:** V-1, V-3, G-6, G-10, B-1, G-5.
- **Etapa 4 — backups:** V-2 e S-4.
- **Etapa 5 — telas:** T-1, G-2, G-3, G-7, G-8, G-1, G-9, G-13.
- **Etapa 6 — maiores:** P-1, S-3, S-5, G-14; V-4 só se necessário.

## O que foi medido e o que é hipótese

- **Medido** (banco e servidor locais, dados fictícios, máquina de 4 vCPU/16 GB — os tempos são piso): consultas com `EXPLAIN ANALYZE` e 20 mil fichas; 500 envios; 100 cadastros simultâneos; lista e exportação (tempo, tamanho, memória); apagar lote de 10 mil; tamanho de backup com e sem fotos; leitura de planilha grande; telas no Chromium com 20 mil fichas; formulário com rede lenta simulada; tamanho do pacote do site.
- **Estimado/hipótese** (não havia Docker nem a VM real): consumo de memória e disco das 30 instâncias, custo dos healthchecks e da coleta, tamanho dos backups em produção, tempo de "atualizar todas". Confirme no servidor com `docker stats`, `docker system df -v`, `du -sh /opt/prefichas-*/backups`.
- **Não executado:** os ataques S-1 e S-2 (conclusão por leitura do código); nada foi testado contra a Microsoft, a Cloudflare ou o servidor real.

## Comparação com o relatório anterior (2026-11-03)

Novos desde então: tudo o que veio com importação, contas importadas, login Microsoft, modalidades cadastráveis, menus "Campistas"/"Todos" e as ações novas do painel da VM. O ponto que voltou: o comparador de texto lento, corrigido na fila (2.10.1), reapareceu em `Nomes.jsx` e na formatação de datas.
