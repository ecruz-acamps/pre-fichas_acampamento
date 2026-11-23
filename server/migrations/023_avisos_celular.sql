-- Avisos no celular (Web Push): o participante recebe um aviso quando a situação da pré-ficha muda.
-- Ligado/desligado pelo administrador (Configurações → Área do participante). O aviso não leva dado pessoal.

-- Chaves VAPID do acampamento (geradas uma vez, na primeira inicialização). A privada só fica no banco.
create table push_chaves (
  id        boolean primary key default true check (id),
  publica   text not null,
  privada   text not null,
  criado_em timestamptz not null default now()
);

-- Cada aparelho em que a pessoa aceitou receber avisos.
create table push_inscricoes (
  id              bigint generated always as identity primary key,
  participante_id bigint not null references participantes (id) on delete cascade,
  endpoint        text not null unique check (char_length(endpoint) between 20 and 1000),
  p256dh          text not null check (char_length(p256dh) between 20 and 200),
  auth            text not null check (char_length(auth) between 10 and 100),
  criado_em       timestamptz not null default now(),
  ultimo_envio    timestamptz,
  falhas          integer not null default 0
);
create index push_inscricoes_part_idx on push_inscricoes (participante_id);

-- Qualquer mudança de status (tela da ficha, recusa, registro no acampamento, desistência…) avisa o servidor,
-- que decide se manda o aviso. Só o id da ficha vai na notificação do banco.
create function avisar_mudanca_status() returns trigger language plpgsql as $$
begin
  if new.participante_id is not null and new.status is distinct from old.status then
    perform pg_notify('ficha_status', new.id::text);
  end if;
  return new;
end $$;
create trigger pre_fichas_avisar_status after update of status on pre_fichas
  for each row execute function avisar_mudanca_status();
