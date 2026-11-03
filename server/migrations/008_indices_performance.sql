-- =====================================================================
-- 008 · Índices de performance (relatório do squad, 2026-11-03)
-- =====================================================================
-- Conferência de duplicado na inscrição (nome + nascimento das fichas ativas)
create index pre_fichas_duplicado_idx on pre_fichas (chave_local(nome_completo), data_nascimento)
  where status in ('aguardando', 'em_contato', 'confirmado');
-- Limite de inscrições por telefone/e-mail nas últimas 24 h
create index pre_fichas_created_idx on pre_fichas (created_at);
-- "Modalidades que a pessoa já fez" (área do participante)
create index pre_fichas_cpf_participou_idx on pre_fichas (cpf) where status = 'participou';
-- Índice não usado pelo planejador (a auditoria usa o índice por data)
drop index if exists pre_fichas_historico_tipo_idx;
