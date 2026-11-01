# Pré-fichas do Acampamento · Fila de espera

Sistema para receber as pré-fichas de novos campistas e organizar a **fila de espera**
por ordem de chegada (data e hora do envio — quem se inscreveu primeiro tem preferência).

- **`/`** → formulário público de pré-ficha (qualquer pessoa preenche, funciona no celular)
- **`/admin/`** → painel da fila de espera (só usuários autorizados, com login)

Tecnologias: React + Vite (site estático) e [Supabase](https://supabase.com) (banco Postgres,
login e regras de segurança). O endereço é preenchido automaticamente pelo CEP usando a
API pública [ViaCEP](https://viacep.com.br).

## Funcionalidades

**Formulário**
- Dados pessoais, informações religiosas, contato, endereço, acampamento e informações adicionais.
- Telefone/WhatsApp obrigatório (é por ele que a equipe faz o contato).
- Menores de 18 anos: pede nome e telefone de um responsável.
- CEP consulta o ViaCEP e preenche rua, bairro, cidade e UF.
- Modalidade validada pela idade/estado civil (Mirim 7–13, FAC 13–18, Juvenil 18–30,
  Sênior casado(a) ou 30+); quando só uma serve, ela já vem marcada.
- Campos condicionais (pastoral → qual; vício → qual; religião/como conheceu "Outro").
- As três declarações obrigatórias do formulário atual.
- Proteção simples contra robôs (campo "honeypot").

**Painel da fila**
- Fila separada por modalidade, com a **posição** de cada pessoa (ordem de inscrição).
- Data e hora da inscrição até os segundos.
- Status: Aguardando → Em contato → Confirmado / Desistiu / Já participou.
  Quem sai da fila (confirmado, desistiu, participou) libera a posição para o próximo.
- Busca por nome, e-mail, telefone, cidade ou paróquia; filtro por status.
- Ficha completa com observações internas da equipe (registra quem e quando alterou).
- Link direto para o WhatsApp da pessoa.
- Aviso de **possível duplicado** (mesmo e-mail ou telefone em mais de uma ficha).
- Exportação para CSV (abre no Excel).

**Segurança (garantida no banco, não só na tela)**
- Quem envia a ficha **não consegue ler** nenhuma ficha, nem a própria.
- A data/hora da inscrição é definida pelo servidor: ninguém consegue "furar a fila".
- Só usuários cadastrados na tabela `admins` veem e alteram as fichas; mesmo um admin
  só pode alterar `status` e `observacoes_internas`. Não há exclusão pelo sistema.

## Como colocar no ar

### 1. Criar o banco no Supabase
1. Crie uma conta e um projeto em <https://supabase.com> (o plano gratuito atende).
2. No projeto, abra **SQL Editor**, cole o conteúdo de
   [`supabase/migrations/0001_pre_fichas.sql`](supabase/migrations/0001_pre_fichas.sql) e clique em **Run**.
3. Em **Authentication → Sign In / Providers**, **desative "Allow new users to sign up"**
   (assim só quem você cadastrar consegue entrar no painel).

### 2. Cadastrar quem pode ver a fila
1. Em **Authentication → Users → Add user → Create new user**, informe o e-mail e uma senha
   (marque *Auto Confirm User*). Também dá para usar *Send invitation*: a pessoa recebe um
   e-mail e define a própria senha ao abrir o link.
2. No **SQL Editor**, autorize a pessoa:
   ```sql
   insert into public.admins (user_id, nome)
   select id, 'Nome da pessoa' from auth.users where email = 'pessoa@email.com';
   ```
   Para remover o acesso: `delete from public.admins where user_id = (select id from auth.users where email = 'pessoa@email.com');`
3. Em **Authentication → URL Configuration**, coloque o endereço do site em *Site URL*
   e adicione `https://SEU-SITE/admin/` em *Redirect URLs* (para convites e "esqueci minha senha").

### 3. Configurar e publicar o site
1. Copie `.env.example` para `.env` e preencha com os dados de **Project Settings → API**
   (`Project URL` e a chave pública `anon`/`publishable` — **nunca** a `service_role`).
2. Rodar localmente:
   ```bash
   npm install
   npm run dev        # http://localhost:5173  e  http://localhost:5173/admin/
   ```
3. Publicar: qualquer hospedagem de site estático serve (Vercel, Netlify, Cloudflare Pages…).
   - Comando de build: `npm run build` · Pasta de saída: `dist`
   - Cadastre as mesmas variáveis `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e
     `VITE_WHATSAPP_CONTATO` nas configurações da hospedagem.

## Estrutura

```
index.html                 página do formulário
admin/index.html           página do painel
src/form/                  formulário público
src/admin/                 login, fila, detalhes da ficha, exportação CSV
src/lib/                   Supabase, ViaCEP, opções e utilitários
supabase/migrations/       tabelas, permissões e regras de segurança (RLS)
```

## Regra da fila

A posição é calculada **por modalidade**, ordenando por `created_at` (data/hora do servidor,
com precisão de microssegundos) e, em empate, pelo `id`. Entram na contagem apenas as fichas
com status **Aguardando** ou **Em contato**. A view `fila_espera` no banco traz a mesma
posição, caso queira consultar direto pelo Supabase.
