-- =====================================================================
-- 010 · Modalidade "Casais" e CPF do cônjuge na inscrição de casal
-- =====================================================================
alter table pre_fichas drop constraint pre_fichas_modalidade_check;
alter table pre_fichas add constraint pre_fichas_modalidade_check
  check (modalidade in ('mirim', 'fac', 'juvenil', 'senior', 'casais'));

alter table acampamentos drop constraint acampamentos_modalidade_check;
alter table acampamentos add constraint acampamentos_modalidade_check
  check (modalidade in ('mirim', 'fac', 'juvenil', 'senior', 'casais'));

alter table preferencias drop constraint preferencias_modalidade_check;
alter table preferencias add constraint preferencias_modalidade_check
  check (modalidade in ('mirim', 'fac', 'juvenil', 'senior', 'casais'));

-- CPF do cônjuge informado na inscrição de casal (já conferido como campista pelo servidor)
alter table pre_fichas add column conjuge_cpf text check (conjuge_cpf ~ '^\d{11}$');

-- Buscas por CPF (cônjuge campista, casal já inscrito)
create index pre_fichas_cpf_idx on pre_fichas (cpf) where cpf is not null;
