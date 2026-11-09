-- Trilha: mudança/conferência da modalidade da ficha (feita por administrador ou coordenador de núcleo)
alter table pre_fichas_historico drop constraint pre_fichas_historico_tipo_check;
alter table pre_fichas_historico add constraint pre_fichas_historico_tipo_check
  check (tipo in ('inscricao', 'status', 'observacao', 'recusa', 'fim_da_fila', 'acampamento', 'preferencia', 'conjuge', 'edicao', 'modalidade'));
