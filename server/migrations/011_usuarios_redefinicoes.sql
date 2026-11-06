-- "Esqueci minha senha" dos usuários do painel do acampamento (admin e equipe).
-- O link enviado por e-mail guarda só o hash do token; vale 1 hora e uma única vez.
create table usuarios_redefinicoes (
  id          text primary key,     -- hash do token enviado por e-mail
  usuario_id  bigint not null references usuarios (id) on delete cascade,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create index usuarios_redef_usuario_idx on usuarios_redefinicoes (usuario_id, criado_em desc);
