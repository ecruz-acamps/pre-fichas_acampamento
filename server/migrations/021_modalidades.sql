-- Modalidades cadastráveis (nome, faixa de idade, estado civil, ordem). As 5 de sempre entram como padrão.
-- "senior" e "casais" têm regras próprias no sistema (ver shared/util.js): para elas só se edita nome, idades mínimas, ordem e se estão ativas.
create table modalidades (
  valor      text primary key check (valor ~ '^[a-z][a-z0-9_]{1,19}$'),
  rotulo     text not null check (char_length(rotulo) between 1 and 40),
  regra      text not null default 'idade' check (regra in ('idade', 'senior', 'casais')),
  idade_min  integer not null check (idade_min between 0 and 120),
  idade_max  integer not null check (idade_max between 0 and 200),
  casado     boolean not null default false,        -- só casado(a)/união estável (regra "idade")
  ordem      integer not null default 0,
  ativa      boolean not null default true,         -- inativa: não aparece para novas inscrições/edições, mas os registros antigos continuam
  criado_em  timestamptz not null default now(),
  check (idade_min <= idade_max)
);
insert into modalidades (valor, rotulo, regra, idade_min, idade_max, casado, ordem) values
  ('mirim',   'Mirim',   'idade',  7,  13, false, 1),
  ('fac',     'FAC',     'idade', 13,  18, false, 2),
  ('juvenil', 'Juvenil', 'idade', 18,  30, false, 3),
  ('senior',  'Sênior',  'senior', 30, 200, false, 4),
  ('casais',  'Casais',  'casais', 18, 200, true,  5);

-- as listas fixas nas tabelas viram chave estrangeira para a lista cadastrada
alter table pre_fichas   drop constraint pre_fichas_modalidade_check;
alter table acampamentos drop constraint acampamentos_modalidade_check;
alter table preferencias drop constraint preferencias_modalidade_check;
alter table pre_fichas   add constraint pre_fichas_modalidade_fk   foreign key (modalidade) references modalidades (valor) on update cascade;
alter table acampamentos add constraint acampamentos_modalidade_fk foreign key (modalidade) references modalidades (valor) on update cascade;
alter table preferencias add constraint preferencias_modalidade_fk foreign key (modalidade) references modalidades (valor) on update cascade;
