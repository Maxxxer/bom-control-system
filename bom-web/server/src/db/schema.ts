/**
 * Схема базы данных (PostgreSQL). Единственный источник правды для структуры.
 *
 * Все операторы идемпотентны (`if not exists`), поэтому миграция безопасно
 * выполняется при каждом запуске сервера.
 *
 * Соответствие прежней системе:
 *   POSITION_STATE   → bom_positions (входные поля + жизненный цикл);
 *   MATERIAL_STATE   → materials;
 *   BOM_REGISTRY     → boms (+ признак «Выполнено» вместо EXCLUDED_BOMS);
 *   ARCHIVE          → archive;
 *   AUDIT_LOG        → audit_log;
 *   MATERIAL_HISTORY → position_history.
 *
 * Производные величины (дефицит, состояния, доступность) в базе НЕ хранятся:
 * они вычисляются доменным слоем из количеств. Это исключает рассогласование,
 * которое неизбежно при одновременном хранении входа и расчёта.
 */

/** Операторы создания схемы. Выполняются по порядку. */
export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists users (
     id            bigserial primary key,
     login         text not null unique,
     full_name     text not null default '',
     role          text not null,
     password_hash text not null,
     is_active     boolean not null default true,
     created_at    timestamptz not null default now(),
     updated_at    timestamptz not null default now()
   )`,

  `create table if not exists sessions (
     token_hash text primary key,
     user_id    bigint not null references users(id) on delete cascade,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,
  `create index if not exists sessions_user_idx on sessions(user_id)`,
  `create index if not exists sessions_expires_idx on sessions(expires_at)`,

  `create table if not exists boms (
     id          bigserial primary key,
     code        text not null unique,
     name        text not null,
     source_note text not null default '',
     revision    integer not null default 1,
     is_done     boolean not null default false,
     done_at     timestamptz,
     created_at  timestamptz not null default now(),
     created_by  text not null default '',
     updated_at  timestamptz not null default now()
   )`,
  `create index if not exists boms_is_done_idx on boms(is_done)`,

  `create table if not exists bom_positions (
     id                 bigserial primary key,
     bom_id             bigint not null references boms(id) on delete cascade,
     position_id        text not null unique,
     material_key       text not null,
     row_no             numeric(14,3) not null default 0,
     code               text not null default '',
     manufacturer       text not null default '',
     name               text not null default '',
     model              text not null default '',
     unit               text not null default '',
     required_qty       numeric(14,3) not null default 0,
     reserved_qty       numeric(14,3) not null default 0,
     ordered_qty        numeric(14,3) not null default 0,
     real_delivery_qty  numeric(14,3) not null default 0,
     real_delivery_date date,
     expected_date      date,
     deadline           date,
     received_qty       numeric(14,3) not null default 0,
     received           boolean not null default false,
     received_at        timestamptz,
     received_by        text not null default '',
     lifecycle          text not null default 'ACTIVE',
     updated_at         timestamptz not null default now(),
     version            integer not null default 1
   )`,
  `create index if not exists positions_bom_idx on bom_positions(bom_id)`,
  `create index if not exists positions_material_idx on bom_positions(material_key)`,
  `create index if not exists positions_lifecycle_idx on bom_positions(lifecycle)`,

  `create table if not exists materials (
     id            bigserial primary key,
     material_key  text not null unique,
     code          text not null default '',
     manufacturer  text not null default '',
     name          text not null default '',
     model         text not null default '',
     unit          text not null default '',
     warehouse_qty numeric(14,3) not null default 0,
     updated_at    timestamptz not null default now()
   )`,

  `create table if not exists archive (
     id           bigserial primary key,
     position_id  text not null,
     bom_id       text not null,
     bom_name     text not null default '',
     row_no       numeric(14,3) not null default 0,
     code         text not null default '',
     manufacturer text not null default '',
     name         text not null default '',
     model        text not null default '',
     unit         text not null default '',
     qty          numeric(14,3) not null default 0,
     received_at  timestamptz,
     received_by  text not null default '',
     source_ui    text not null default '',
     comment      text not null default '',
     created_at   timestamptz not null default now()
   )`,
  `create index if not exists archive_position_idx on archive(position_id)`,

  `create table if not exists audit_log (
     id           bigserial primary key,
     operation_id text not null,
     actor        text not null default '',
     action       text not null,
     bom_id       text not null default '',
     position_id  text not null default '',
     field        text not null default '',
     old_value    text not null default '',
     new_value    text not null default '',
     reason       text not null default '',
     created_at   timestamptz not null default now()
   )`,
  `create index if not exists audit_position_idx on audit_log(position_id)`,
  `create index if not exists audit_created_idx on audit_log(created_at)`,

  `create table if not exists position_history (
     id          bigserial primary key,
     position_id text not null,
     event       text not null,
     old_value   text not null default '',
     new_value   text not null default '',
     actor       text not null default '',
     comment     text not null default '',
     created_at  timestamptz not null default now()
   )`,
  `create index if not exists history_position_idx on position_history(position_id)`,
];
