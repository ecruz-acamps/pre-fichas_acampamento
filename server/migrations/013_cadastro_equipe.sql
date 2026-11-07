-- Cadastro dos usuários do painel (coordenadores e equipe) feito pela própria pessoa.
-- Quem se cadastra fica "pendente": sem acesso nenhum até um administrador liberar (papel e núcleos).
alter table usuarios
  add column pendente         boolean not null default false,
  add column email_confirmado boolean not null default true,       -- usuários criados pelo admin já nascem confirmados
  add column solicitado_em    timestamptz;
alter table usuarios add constraint usuarios_pendente_sem_acesso check (not pendente or not ativo);

-- Link de confirmação do e-mail (guarda só o hash do token; vale 24 h, uma vez)
create table usuarios_confirmacoes (
  id          text primary key,
  usuario_id  bigint not null references usuarios (id) on delete cascade,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create index usuarios_confirmacoes_usuario_idx on usuarios_confirmacoes (usuario_id);
