-- Foto (opcional) da conta do participante. Uma por conta, só JPEG, em tabela própria para não pesar nas listas.
create table participantes_fotos (
  participante_id bigint primary key references participantes (id) on delete cascade,
  tipo            text not null default 'image/jpeg' check (tipo = 'image/jpeg'),
  dados           bytea not null check (octet_length(dados) between 100 and 307200),
  atualizado_em   timestamptz not null default now()
);
