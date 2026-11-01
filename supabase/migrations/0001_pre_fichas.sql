-- =====================================================================
-- Pré-fichas do acampamento + fila de espera
-- Rode este arquivo no SQL Editor do Supabase (ou via `supabase db push`).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Usuários que podem ver/gerenciar a fila de espera
-- (o login é feito pelo Supabase Auth; aqui fica só a autorização)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nome       text,
  criado_em  timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Função usada nas políticas: o usuário logado é admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "admin vê a própria linha" on public.admins;
create policy "admin vê a própria linha" on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

-- ---------------------------------------------------------------------
-- Pré-fichas
-- ---------------------------------------------------------------------
create table if not exists public.pre_fichas (
  id                    bigint generated always as identity primary key,
  -- Data/hora da inscrição: definida SEMPRE pelo servidor. É o critério da fila.
  created_at            timestamptz not null default now(),

  -- Dados pessoais
  nome_completo         text not null check (char_length(nome_completo) between 3 and 150),
  data_nascimento       date not null check (data_nascimento between '1900-01-01' and current_date),
  estado_civil          text not null check (estado_civil in ('solteiro','casado','uniao_estavel','divorciado','viuvo')),
  sexo                  text not null check (sexo in ('masculino','feminino')),
  profissao             text check (char_length(profissao) <= 120),
  telefone              text not null check (char_length(telefone) between 10 and 20),
  responsavel_nome      text check (char_length(responsavel_nome) <= 150),
  responsavel_telefone  text check (char_length(responsavel_telefone) <= 20),

  -- Informações religiosas
  religiao              text not null check (char_length(religiao) <= 80),
  batizado              boolean not null,
  primeira_eucaristia   boolean not null,
  crismado              boolean not null,
  paroquia              text check (char_length(paroquia) <= 150),
  participa_pastoral    boolean not null,
  pastoral_qual         text check (char_length(pastoral_qual) <= 150),

  -- Contato
  email                 text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  instagram             text check (char_length(instagram) <= 100),
  facebook              text check (char_length(facebook) <= 150),

  -- Endereço (preenchido via ViaCEP)
  cep                   text not null check (cep ~ '^\d{8}$'),
  logradouro            text check (char_length(logradouro) <= 200),
  numero                text check (char_length(numero) <= 20),
  complemento           text check (char_length(complemento) <= 100),
  bairro                text check (char_length(bairro) <= 100),
  cidade                text not null check (char_length(cidade) <= 100),
  uf                    text not null check (uf ~ '^[A-Z]{2}$'),

  -- Acampamento
  como_conheceu         text not null check (char_length(como_conheceu) <= 200),
  motivo                text not null check (char_length(motivo) between 3 and 2000),
  modalidade            text not null check (modalidade in ('mirim','fac','juvenil','senior')),

  -- Informações adicionais
  possui_vicio          boolean not null,
  vicio_qual            text check (char_length(vicio_qual) <= 200),
  restricoes_medicas    text check (char_length(restricoes_medicas) <= 1000),
  retiros_anteriores    text check (char_length(retiros_anteriores) <= 1000),

  -- Termos aceitos (obrigatórios)
  aceite_lgpd           boolean not null check (aceite_lgpd),
  aceite_atividades     boolean not null check (aceite_atividades),
  aceite_lista_espera   boolean not null check (aceite_lista_espera),

  -- Controle interno (só a equipe altera)
  status                text not null default 'aguardando'
                        check (status in ('aguardando','em_contato','confirmado','desistiu','participou')),
  observacoes_internas  text,
  atualizado_em         timestamptz,
  atualizado_por        uuid references auth.users (id) on delete set null
);

create index if not exists pre_fichas_fila_idx
  on public.pre_fichas (modalidade, status, created_at, id);

alter table public.pre_fichas enable row level security;

-- Qualquer pessoa (inclusive sem login) pode ENVIAR uma pré-ficha...
drop policy if exists "qualquer um envia pré-ficha" on public.pre_fichas;
create policy "qualquer um envia pré-ficha" on public.pre_fichas
  for insert to anon, authenticated
  with check (true);

-- ...mas só a equipe autorizada pode VER e ATUALIZAR.
drop policy if exists "equipe vê pré-fichas" on public.pre_fichas;
create policy "equipe vê pré-fichas" on public.pre_fichas
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "equipe atualiza pré-fichas" on public.pre_fichas;
create policy "equipe atualiza pré-fichas" on public.pre_fichas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Permissões por coluna: quem envia o formulário NÃO consegue definir
-- id, created_at, status nem campos internos (evita "furar a fila").
revoke all on public.pre_fichas from anon, authenticated;

grant insert (
  nome_completo, data_nascimento, estado_civil, sexo, profissao, telefone,
  responsavel_nome, responsavel_telefone,
  religiao, batizado, primeira_eucaristia, crismado, paroquia,
  participa_pastoral, pastoral_qual,
  email, instagram, facebook,
  cep, logradouro, numero, complemento, bairro, cidade, uf,
  como_conheceu, motivo, modalidade,
  possui_vicio, vicio_qual, restricoes_medicas, retiros_anteriores,
  aceite_lgpd, aceite_atividades, aceite_lista_espera
) on public.pre_fichas to anon, authenticated;

grant select on public.pre_fichas to authenticated;
grant update (status, observacoes_internas) on public.pre_fichas to authenticated;
-- Nenhuma exclusão pelo app: o histórico da fila fica preservado.

-- Registra quem/quando alterou o status ou as observações
create or replace function public.pre_fichas_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

drop trigger if exists pre_fichas_auditoria on public.pre_fichas;
create trigger pre_fichas_auditoria
  before update on public.pre_fichas
  for each row execute function public.pre_fichas_auditoria();

-- ---------------------------------------------------------------------
-- Visão da fila: posição por modalidade, por ordem de chegada.
-- security_invoker = true -> respeita o RLS (só admins enxergam).
-- ---------------------------------------------------------------------
create or replace view public.fila_espera
with (security_invoker = true) as
select
  row_number() over (partition by p.modalidade order by p.created_at, p.id) as posicao,
  p.*
from public.pre_fichas p
where p.status in ('aguardando', 'em_contato');

revoke all on public.fila_espera from anon, authenticated;
grant select on public.fila_espera to authenticated;
