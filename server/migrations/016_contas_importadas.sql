-- Contas criadas na importação de fichas: usuário = CPF e senha inicial = CPF (a pessoa pode trocar depois).
--  - e-mail passa a ser opcional (fichas antigas podem não ter; único quando preenchido)
--  - senha_inicial: a senha ainda é o CPF (o hash é gravado no primeiro acesso, para a importação ser rápida)
--  - importada_lote: de qual importação veio a conta (para "Desfazer" apagar também as contas não usadas)
alter table participantes alter column email drop not null;
alter table participantes
  add column senha_inicial  boolean not null default false,
  add column importada_lote text;
create index participantes_lote_idx on participantes (importada_lote) where importada_lote is not null;
