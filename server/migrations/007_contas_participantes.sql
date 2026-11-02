-- =====================================================================
-- 007 · Contas dos participantes (entrar com CPF ou e-mail e senha)
--   - a pessoa cria a conta, faz a inscrição, acompanha e edita os dados;
--   - contas antigas podem ser importadas sem senha: a pessoa cria a senha
--     pelo "Esqueci minha senha" (link enviado ao e-mail cadastrado).
-- =====================================================================
create table participantes (
  id               bigint generated always as identity primary key,
  cpf              text not null check (cpf ~ '^\d{11}$'),
  email            text not null check (email = lower(email) and char_length(email) <= 200),
  nome             text check (char_length(nome) <= 150),
  data_nascimento  date,
  senha_hash       text,                 -- null = conta importada que ainda não criou a senha
  dados            jsonb,                -- últimos dados do formulário (para editar/reaproveitar)
  importado        boolean not null default false,
  criado_em        timestamptz not null default now(),
  ultimo_login     timestamptz
);
create unique index participantes_cpf_uk on participantes (cpf);
create unique index participantes_email_uk on participantes (email);

create table participantes_sessoes (
  id               text primary key,     -- hash do token do cookie
  participante_id  bigint not null references participantes (id) on delete cascade,
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz not null
);
create index participantes_sessoes_part_idx on participantes_sessoes (participante_id);

create table participantes_redefinicoes (
  id               text primary key,     -- hash do token enviado por e-mail
  participante_id  bigint not null references participantes (id) on delete cascade,
  criado_em        timestamptz not null default now(),
  expira_em        timestamptz not null,
  usado_em         timestamptz
);
create index participantes_redef_part_idx on participantes_redefinicoes (participante_id, criado_em desc);

alter table pre_fichas
  add column participante_id bigint references participantes (id) on delete set null,
  add column cpf text check (cpf ~ '^\d{11}$');
create index pre_fichas_participante_idx on pre_fichas (participante_id);

alter table pre_fichas_historico drop constraint pre_fichas_historico_tipo_check;
alter table pre_fichas_historico add constraint pre_fichas_historico_tipo_check
  check (tipo in ('inscricao', 'status', 'observacao', 'recusa', 'fim_da_fila', 'acampamento', 'preferencia', 'conjuge', 'edicao'));
