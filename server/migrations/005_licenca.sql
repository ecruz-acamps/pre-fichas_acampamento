-- =====================================================================
-- 005 · Ativação do sistema por chave
-- Enquanto não for ativado, o painel mostra só a tela de ativação e o
-- formulário público não aceita inscrições.
-- (A chave em si nunca é gravada: só o identificador interno dela.)
-- =====================================================================
create table licenca (
  id           boolean primary key default true check (id),
  ativada_em   timestamptz,
  ativada_por  bigint references usuarios (id) on delete set null,
  chave_id     text check (char_length(chave_id) <= 20),
  origem       text check (origem in ('painel', 'cli'))
);
insert into licenca (id) values (true);
