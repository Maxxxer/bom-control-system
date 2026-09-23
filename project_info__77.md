# BOM CONTROL SYSTEM — разбор кода + два проектных предложения

> Документ отвечает на два прикладных вопроса (правка спецификаций с ошибками и плотная вёрстка таблиц)
> и попутно фиксирует всё, что нужно знать о кодовой базе, чтобы эти вопросы решать без поиска по файлам.

## Summary

`BOM_CONTROL_SYSTEM` — система управления обеспечением сборки (MAIR). Исторически она существовала как набор
Google Apps Script (`.gs`/`.js` в корне: `v12_*.js`, `sat_*.js`, `REGULATIONS.md`) и работала в Google Таблицах.
Рядом лежит новая реализация — `bom-web/`: Node.js + TypeScript + PostgreSQL (Fastify на сервере, React + Vite в
браузере), монорепозиторий npm workspaces (`server`, `web`). Доменный слой новой версии — это построчный перенос
старой логики (`v12_utils.js` → `values.ts`, `v12_calculate.js` → `calculate.ts`,
`v12_projections.js` → `projections*`, `v12_roles.js` → `permissions.ts`), поэтому «странности» старой системы
сохранены намеренно.

Пользователи: экономист (ведёт спецификации и реальную поставку), снабженец (заказано/ожидаемая дата), кладовщик
(склад, отборка), производство (передача, «Выполнено»), наблюдатель (только чтение).

## Архитектура

**Паттерн:** трёхслойная «чистое ядро + сервисы + HTTP/UI»:

```
React (web/)  ──HTTP/JSON, cookie-сессия──►  Fastify routes (http/)
                                                │
                                                ▼
                                          services/  (транзакции, права, журнал)
                                                │
                                                ▼
                                          domain/    (ЧИСТЫЕ функции: расчёт, валидация, ключи)
                                                │
                                                ▼
                                          repositories/  ──►  db/ (pg | pglite)
```

Ключевой принцип: **в базе хранится только вход, всё производное считается** — `domain/position.ts`
(`applyComputed`) пересчитывает дефицит/состояния при каждом чтении (`repositories/positionMapper.ts`). В схеме
(`db/schema.ts`) нет ни одной колонки «дефицит» или «статус» — это осознанно, чтобы вход и расчёт не расходились.

**Стек:** Fastify, PostgreSQL (`pg`) или встроенный `pglite` (файловый Postgres для локального запуска),
`exceljs` для XLSX, scrypt-хеши паролей (`services/password.ts`), React 18 + Vite, CSS без фреймворка
(токены в `styles/tokens.css`, компоненты — `styles/components.css`, таблицы — `styles/base.css`).
Тестовый раннер собственный: `server/test/run.ts` + `npm test -w server`.

**Запуск:** `bom-web/server/src/index.ts` — создаёт БД (`createDatabase.ts`), прогоняет идемпотентную схему,
сидит демо-данные, поднимает Fastify (`http/server.ts`) и регистрирует маршруты: `authRoutes`, `projectionRoutes`
(витрины), `positionRoutes` (операции по позиции), `handoffRoutes`, `warehouseRoutes`, `bomRoutes`, `adminRoutes`.

## Структура каталогов

```
BOM_CONTROL_SYSTEM/
├── v12_*.js, sat_*.js, utils.js, logger.js   — прежняя система (Google Apps Script) + SAT_*.md инструкции
├── REGULATIONS.md                            — регламент работы в терминах старой системы (обязательные поля,
│                                               цвета строк, «что делать, если ошибка») — фактическое ТЗ предметной области
├── project_info__*.md                        — журнал предыдущих разборов (этот документ — № 77)
└── bom-web/
    ├── server/src/
    │   ├── index.ts            — точка входа: БД, схема, сиды, Fastify
    │   ├── config.ts           — PORT/DATABASE_URL/режим pglite
    │   ├── errors.ts           — ValidationError / NotFoundError / ConflictError / PermissionDeniedError
    │   ├── domain/             — ЧИСТОЕ ядро (без БД и HTTP)
    │   │   ├── types.ts        — SupplyState, ProductionState, LifecycleState, PositionIdentity, ComputationResult
    │   │   ├── constants.ts    — состояния, подписи, ЦВЕТА строк, роли, матрица прав, LIMITS, SESSION
    │   │   ├── values.ts       — разбор «грязных» значений: toNumber, toIsoDate, isChecked, norm, extractProjectCode
    │   │   ├── materialKeys.ts — buildMaterialKey / basePositionId / buildPositionId (ГЛАВНЫЙ идентификатор)
    │   │   ├── validation.ts   — validatePosition + describeMissingFields (что такое «Ошибка данных»)
    │   │   ├── calculate.ts    — арифметика дефицита и состояний
    │   │   ├── position.ts     — сущность Position, applyComputed, фильтры видимости витрин
    │   │   ├── bomStatus.ts, dashboard.ts, dashboardText.ts, procurement.ts
    │   │   ├── projectionsRows.ts, projectionTypes.ts, picking.ts, supply.ts
    │   │   └── permissions.ts  — can / requirePermission / describeAccess
    │   ├── repositories/       — SQL: positions, materials, boms, users, sessions, archive, auditLog, positionHistory
    │   ├── services/           — сценарии: bomService, positionService, handoffService, warehouseService,
    │   │   │                     projectionService, auditService, userService, authService, operationLog
    │   │   └── bomImport/      — bomColumns, parseBomFile, parseBomRows, syncBom
    │   └── http/               — server, errors, requestAuth, operationReply, routes/*
    ├── server/test/            — тесты ядра + fixtures/bom-csv-1.csv
    └── web/src/
        ├── api/                — client (fetch + ApiError), endpoints (все адреса), types, adminTypes
        ├── app/                — router, navigation (единый список разделов), useLoader, useAction
        ├── session/            — SessionContext (user, can(permission), signOut)
        ├── ui/                 — DataTable, EditableNumber/Date/Checkbox, Badge, StatCard, ProjectFilter,
        │                         ConfirmDialog, ToastProvider, Layout, icons, BrandMark
        ├── pages/              — Overview, Deficit, Supply, Picking, WorkingBom, Dashboard, Warehouse,
        │                         Boms (+BomCardPanel), Archive(+Panel), Admin(+UsersPanel, AuditPanel), Account, Login
        └── styles/             — tokens.css (брендбук MAIR), base.css (каркас + ТАБЛИЦЫ), components.css, fonts.css
```

## Ключевые абстракции

### `Position` + `applyComputed` — `server/src/domain/position.ts`
- **Ответственность:** позиция спецификации: входные поля (`identity`, `quantities`) + производный блок `computed`.
- **Интерфейс:** `identity.rowNo/code/manufacturer/name/model/unit/deadline`, `quantities.requiredQty/reservedQty/
  orderedQty/realDeliveryQty/receivedQty/received`, `expectedDate`, `realDeliveryDate`, `lifecycle`, `computed`.
- **Жизненный цикл:** создаётся маппером `repositories/positionMapper.ts` из строки БД; `computed` **никогда** не
  приходит из базы.
- **Используют:** все витрины (`projectionsRows.ts`), операции (`positionService.ts`), импорт (`syncBom.ts`).

### `validatePosition` — `server/src/domain/validation.ts`
- **Ответственность:** ответ на вопрос «валидна ли строка BOM». Обязательны: `rowNo > 0`, `name`, `model`, `unit`,
  `requiredQty > 0`, `deadline`. **Артикул (`code`) — НЕ обязателен** (зафиксировано в требованиях).
- **Смысл:** невалидная позиция существует, но `productionState` не может стать «На складе»
  (`calculate.ts`: `validation.valid ? READY_FOR_HANDOFF : PARTIALLY_AVAILABLE`), а `computeBomStatus` отдаёт
  BOM статус `ERROR`, если в нём есть хоть одна такая позиция (`bomStatus.ts`). Отсюда гейт «Выполнено»:
  BOM с ошибкой данных нельзя отметить выполненным.
- **Подписи полей** для пользователя — `describeMissingFields()`.

### `buildMaterialKey` / `buildPositionId` — `server/src/domain/materialKeys.ts`
- **Ответственность:** стабильный идентификатор позиции: `code|manufacturer`, а если артикула нет —
  `name|model|manufacturer|unit`. Позиция: `BOM-код:ключ` (+ `#2`, `#3` при повторах материала в одном BOM).
- **Почему это критично:** `position_id` — единственная связь между повторными импортами, историей
  (`position_history`), архивом (`archive`), журналом (`audit_log`) и складом (`materials.material_key`).
- **Следствие:** **правка `name`, `model`, `unit`, `code`, `manufacturer` меняет идентификатор позиции**
  (см. раздел «Задача 1»).

### `applyParsedBom` — `server/src/services/bomImport/syncBom.ts`
- **Ответственность:** транзакционное применение файла: upsert BOM → обновить/вставить позиции → разобраться с
  исчезнувшими → записать журнал.
- **Ключевой инвариант:** при совпадении `position_id` обновляются **только поля спецификации**
  (`updatePositionSpec`), а операционные (`ordered_qty`, `expected_date`, `real_delivery_*`, `received*`,
  `lifecycle`) сохраняются. Позиция, исчезнувшая из файла, без операционных данных **удаляется**, с ними —
  помечается `lifecycle = 'REMOVED'`.

### `requirePermission` — `server/src/domain/permissions.ts` + `ROLE_PERMISSIONS` в `constants.ts`
- **Ответственность:** проверка права на входе в сервис. `admin` — `*`; `economist` — `SOURCE_BOM_WRITE`,
  `DEADLINE`, `REAL_DELIVERY`; `procurement` — `ORDERED_QTY`, `EXPECTED_DATE`; `warehouse` — `WAREHOUSE_QTY`,
  `PICKING_CHECKBOX`; `production` — `PICKING_CHECKBOX`, `WORKING_BOM_CHECKBOX`, `DASHBOARD_CHECKBOX`; `viewer` — пусто.
- **Важно:** `SOURCE_BOM_WRITE` сейчас используется **только** на импорт и удаление BOM (`bomRoutes.ts`), в UI
  раскрывается как «Спецификации BOM (создание, импорт, правка)» — то есть право на правку спецификации уже
  заявлено, но точки применения в коде нет.

### `DataTable` — `web/src/ui/DataTable.tsx`
- **Ответственность:** единственная таблица системы: колонки-описания (`key/title/render/sortValue/numeric/width`),
  клиентская сортировка, `rowKey`, `emptyText`, `rowBackground`.
- **Ограничения, которые придётся учитывать при доработках:** нет выбора строк (в «Отборке» галочка — это просто
  колонка), нет «липких» колонок в API (класс `.sticky-left` есть только в CSS и нигде не применяется),
  нет виртуализации, нет управления плотностью, сортировка всегда сбрасывается в `null` третьим щелчком.

### Редактируемые ячейки — `EditableNumber.tsx`, `EditableDate.tsx`, `EditableCheckbox.tsx`
- **Общий контракт:** `onSave` → `Promise<boolean>`; сервер — источник истины; при отказе поле возвращается к
  серверному значению; Enter/blur — сохранение, Escape — отмена; на фокусе текст выделяется целиком.
- **Только эти три компонента** дают «правку в строке». Для правки спецификации потребуется аналог текстового поля
  (строкового), которого в системе пока нет.

### `OperationReply` / `sendOperation` — `http/operationReply.ts` + `web/src/api/client.ts`
- **Контракт:** `{ status: 'applied' | 'already' | 'blocked', reason, position }`. Отказ правил — HTTP 409,
  который клиент (`postOperation`) **не** считает ошибкой: тело ответа возвращается как обычный результат.
- **Смысл:** «нельзя» — это нормальный исход сценария, а не исключение.

## Поток данных

### Импорт спецификации (главный путь вопроса №1)
1. `BomsPage.tsx` — `<input type="file">` → `readFileAsBase64()` → `api.importBom(fileName, contentBase64)`.
2. `POST /api/boms/import` (`bomRoutes.ts`) → `authenticateWithContext` → `requirePermission(role,'SOURCE_BOM_WRITE')`.
3. `bomService.importBomFromFile` → `bomCodeFromFileName` (код BOM = имя файла без расширения и пути).
4. `readBomFile` (`parseBomFile.ts`) — XLSX через `exceljs` или CSV (разделитель по первой строке: `;`, `,`, `\t`),
   пустые строки отбрасываются, лимиты `MAX_IMPORT_BYTES = 5 МБ`, `MAX_IMPORT_ROWS = 20 000`.
5. `parseBomRows` — `resolveBomColumns` находит колонки по синонимам (`№ п/п`/`Строка`, `Наименование`/`Название`,
   `Кол-во`/`Количество`/`Требуется`, …). Строка без наименования → в `skipped`. Позиция с неполными полями →
   **всё равно импортируется** и попадает в `incomplete` с текстом «Не заполнено: …».
6. `applyParsedBom` — транзакция: upsert BOM, bump ревизии, `updatePositionSpec` для известных, `insertPositions`
   для новых (`on conflict (position_id) do nothing`), удаление/пометка исчезнувших, `recordChanges`
   (`BOM_IMPORTED`).
7. Ответ `BomImportReport` → панель отчёта в `BomsPage.tsx`: «В файле строк», «Добавлено», «Обновлено»,
   «Удалено», «Помечено удалёнными», «Распознаны колонки», список `incomplete` (**обрезан до 50 строк**),
   список `skipped` (до 20).
8. Дальше — ничего. Спецификация уже в базе, отчёт можно закрыть; повторно исправить строку через UI нельзя.

### Операция по позиции (существующий образец «правки»)
1. `DeficitPage.tsx` → `EditableNumber/Date/Checkbox` → `api.setOrderedQty|setExpectedDate|setRealDelivery*|setDeadline`
   (идентификатор кодируется `encodeId` — в нём есть `:`, `|` и `#`).
2. `positionRoutes.ts` → `authenticateWithContext` → сервис.
3. `positionService` → `requirePermission` → `loadPosition` (нет позиции или `lifecycle='REMOVED'` → `blocked`)
   → сравнение с текущим значением (`already`) → `db.transaction`: `updateOperatingFields` (или
   `updatePositionSpec` для срока) + `recordChanges` (журнал + история).
4. `finish()` перечитывает позицию и отдаёт её клиенту; клиент показывает тост и `reload()`.

### Витрины
`projectionRoutes` → `projectionService` → `listPositions`/`listActivePositions` → чистые функции
`projectionsRows.ts`/`picking.ts`/`supply.ts`/`dashboard.ts` → массив именованных полей (порядок колонок задаёт
фронтенд). Фильтр по проекту — `?project=`, поиск — **клиентский** (`matchesSearch` в каждой странице),
сортировка — тоже клиентская в `DataTable`.

## Неочевидные поведения и инварианты

- **`position_id` — это производная от содержимого.** Ключ = `BOM-код:артикул|производитель` (или
  `наименование|модель|производитель|ед.изм`). Любая правка этих полей «переводит» позицию в другую; старые
  история/архив/журнал останутся за прежним ключом.
- **Повторный импорт — это upsert, а не замена.** `syncBom.ts` сохраняет операционные данные; позиция, вернувшаяся
  в файл, снимает `REMOVED` → `ACTIVE`.
- **«Ошибка данных» — не ошибка загрузки.** Строка с пустой моделью/сроком/количеством успешно импортируется,
  хранится как `ACTIVE`, видна во всех витринах, но не может быть передана производству и лишает всю спецификацию
  статуса «Скомплектован» (`bomStatus.ts` → `ERROR`, цвет `--row-gray`).
- **Крайний срок — часть спецификации, но правится через операцию.** `setDeadline` (`positionService.ts`)
  вызывает `updatePositionSpec` со **всеми** полями спецификации, взятыми из текущего состояния позиции, — то есть
  это уже готовый образец «правки одного поля спецификации» без потери операционных данных. Обратите внимание:
  `setDeadline` требует непустую дату (`allowEmpty={false}` в UI) и бросает `ValidationError`, а не возвращает
  `blocked`.
- **Хранимые количества — `numeric(14,3)`**, приводятся к `float8` в SQL (`POSITION_SELECT`), даты — к `text`
  (чтобы не «съезжали» часовые пояса). В `values.ts` дата собирается в **локальном** времени, поддерживаются
  серийные номера Excel и `ДД.ММ.ГГГГ`.
- **`trimmed()` режет любое строковое поле до `MAX_TEXT_LENGTH = 500`** — это стоит помнить, если появится
  эндпоинт правки текстовых полей спецификации.
- **Галочка «Реальная поставка» двигает склад на дельту** (`adjustWarehouseQty`), дата поставки ставится при
  первом положительном значении и сбрасывается при обнулении. Склад в расчёте дефицита **не участвует**
  (`calculate.ts`) — он контрольная книга. Это несоответствие интуиции зафиксировано в комментариях намеренно.
- **Клиентская сортировка/поиск по всем строкам витрины.** Витрины отдаются целиком («сотни строк», по комментарию
  `DataTable.tsx`), без пагинации; `LIMITS.MAX_LIST_LIMIT = 500` применяется к журналам/архиву, а не к витринам.
- **`table-scroll` ограничен `max-height: calc(100vh - 210px)`** — фиксированная магическая константа, не
  учитывающая реальную высоту шапки/фильтров/подвала на 24" Full HD.
- **`REGULATIONS.md` описывает старую систему** («ПРИМЕНИТЬ», очередь `PENDING_EDITS`, меню) — в веб-версии этого
  нет, сохранение немедленное. Но таблица обязательных полей, цвета строк и правило «Ошибка данных → экономист»
  перенесены дословно.
- **`bom-web/README.md`** — краткое описание запуска (не читалось в этом сеансе; см. раздел «Порядок чтения»).

## Модульный справочник

| Файл | Назначение |
|---|---|
| `bom-web/server/src/index.ts` | Точка входа: схема, сиды, Fastify, регистрация маршрутов |
| `bom-web/server/src/domain/constants.ts` | Состояния, подписи, цвета строк, роли, матрица прав, `LIMITS`, `SESSION` |
| `bom-web/server/src/domain/values.ts` | Разбор чисел/дат/чекбоксов из «грязного» ввода (`toNumber`, `toIsoDate`, `isChecked`) |
| `bom-web/server/src/domain/materialKeys.ts` | `material_key` и `position_id` — идентичность позиции |
| `bom-web/server/src/domain/validation.ts` | Обязательные поля позиции; источник статуса «Ошибка данных» |
| `bom-web/server/src/domain/calculate.ts` | Дефицит, непокрытая потребность, состояния, флаги |
| `bom-web/server/src/domain/position.ts` | Сущность позиции, `applyComputed`, фильтры видимости |
| `bom-web/server/src/domain/bomStatus.ts` | Статус BOM и гейт «Выполнено» |
| `bom-web/server/src/domain/permissions.ts` | `can` / `requirePermission` / `describeAccess` |
| `bom-web/server/src/repositories/positions.ts` | SQL позиций: `listPositionsByBom`, `updatePositionSpec`, `updateOperatingFields`, массовая вставка/удаление |
| `bom-web/server/src/repositories/positionMapper.ts` | Единый SELECT + приведение типов в сущность `Position` |
| `bom-web/server/src/repositories/boms.ts` | Регистр спецификаций: `upsertBom`, `bumpRevision`, `setBomDone` |
| `bom-web/server/src/services/bomImport/bomColumns.ts` | Синонимы заголовков колонок спецификации |
| `bom-web/server/src/services/bomImport/parseBomFile.ts` | XLSX/CSV → таблица строк; лимиты и понятные ошибки |
| `bom-web/server/src/services/bomImport/parseBomRows.ts` | Строки → позиции; `incomplete` / `skipped` |
| `bom-web/server/src/services/bomImport/syncBom.ts` | Транзакционное применение: сохранить операционные данные |
| `bom-web/server/src/services/bomService.ts` | Импорт, список, карточка, «Выполнено», удаление BOM |
| `bom-web/server/src/services/positionService.ts` | Операции по позиции (заказано, даты, поставка, **срок = правка спецификации**) |
| `bom-web/server/src/services/operationLog.ts` | Журнал + история в одной транзакции, `AUDIT_ACTION`, `HISTORY_EVENT` |
| `bom-web/server/src/http/routes/bomRoutes.ts` | `/api/boms`, `/import`, `/:code`, `/:code/done`, `DELETE` |
| `bom-web/server/src/http/routes/positionRoutes.ts` | `/api/positions/:id` + операции, `deadline` |
| `bom-web/server/src/db/schema.ts` | Полная схема PostgreSQL (идемпотентная миграция) |
| `bom-web/web/src/ui/DataTable.tsx` | Универсальная таблица: колонки, сортировка, `rowBackground` |
| `bom-web/web/src/ui/EditableNumber/Date/Checkbox.tsx` | Правка в строке с сервером как источником истины |
| `bom-web/web/src/pages/BomsPage.tsx` | Импорт файла + отчёт (в т.ч. список «Требуют правки») |
| `bom-web/web/src/pages/BomCardPanel.tsx` | Карточка BOM: сводка и таблица позиций (только чтение) |
| `bom-web/web/src/pages/DeficitPage.tsx` | Сводка дефицитов: правка заказа/дат/срока в строке |
| `bom-web/web/src/styles/base.css` | Каркас и **стили таблиц** (плотность, sticky-шапка, зебра, `.sticky-left`) |
| `bom-web/web/src/styles/tokens.css` | Брендбук MAIR: цвета, размеры шрифтов, отступы, `--row-*` |
| `bom-web/web/src/styles/components.css` | Кнопки, поля, значки, панели, тосты, модали; `.cell-input`, `.cell-date` |

## Порядок чтения

1. `REGULATIONS.md` — предметная область, обязательные поля и логика «Ошибка данных» словами заказчика.
2. `bom-web/server/src/domain/validation.ts` + `calculate.ts` — что значит «невалидная позиция» и как это влияет на статусы.
3. `bom-web/server/src/services/bomImport/parseBomRows.ts` + `syncBom.ts` — откуда берутся ошибки и как импорт их сохраняет.
4. `bom-web/server/src/services/positionService.ts` — образец операции: права, транзакция, журнал, ответ клиенту.
5. `bom-web/web/src/pages/BomsPage.tsx` + `BomCardPanel.tsx` — где сейчас показываются ошибки (и где нет правки).
6. `bom-web/web/src/ui/DataTable.tsx` + `styles/base.css` — вся вёрстка таблиц в одном месте.

---

# Задача 1. Исправление спецификаций, загруженных с ошибками

## 1.1. Что именно сейчас невозможно (точный диагноз по коду)

| Возможность | Состояние | Где видно |
|---|---|---|
| Обнаружить ошибку | **есть** | `parseBomRows.incomplete` → `BomImportReport.incomplete` → список в `BomsPage.tsx`; `computed.valid` → значок «Ошибка данных» в `BomCardPanel.tsx`, `DeficitPage.tsx`; счётчик «С ошибками» в `DashboardPage.tsx` |
| Узнать, **чего именно не хватает** | частично | текст формирует `describeMissingFields` — «Не заполнено: Модель, Крайний срок поставки» (в отчёте импорта до 50 строк, в выгрузке витрин — нет) |
| Исправить значение | **нет** | `positionRoutes.ts` умеет только `ordered`, `expected-date`, `real-delivery`, `deadline`; текстовых полей спецификации среди них нет |
| Исправить `requiredQty` / `reservedQty` / `rowNo` | **нет** | `required_qty` и `reserved_qty` пишутся исключительно импортом (`updatePositionSpec`/`insertPositions`) |
| Исправить повторной загрузкой файла | **да, но грубо** | `syncBom.ts` обновит совпавшие позиции; при этом правка `name/model/unit/code/manufacturer` **сменит `position_id`** → появится дубль, а старая позиция либо удалится, либо уедет в `REMOVED` со всей историей |
| Удалить ошибочную строку | частично | можно только убрать строку из файла и импортировать снова (без операционных данных — удалится) |

Вывод: система **корректно диагностирует** ошибки, но лечит их только «перезаливкой исходника». Это соответствует
регламенту эпохи Google Таблиц («сообщите экономисту, он дополнит файл»), но противоречит сегодняшней роли
`SOURCE_BOM_WRITE` = «Спецификации BOM (создание, импорт, **правка**)» (`constants.ts`) — право уже сформулировано,
точки применения нет.

## 1.2. Что в коде уже готово как «задел»

1. **`updatePositionSpec(db, positionId, spec)`** (`repositories/positions.ts`) — пишет ровно поля спецификации,
   `update ... updated_at = now(), version = version + 1`, операционные данные не трогает. Это ровно та операция,
   которой не хватает.
2. **`setDeadline`** (`positionService.ts`) — работающий образец: право `DEADLINE` → загрузка позиции →
   `blocked` при `REMOVED` → `already` при том же значении → транзакция из `updatePositionSpec` + `recordChanges`.
3. **`validatePosition`** — готовый валидатор, которым можно проверять результат правки до сохранения.
4. **`operationLog.recordChanges`** — журнал + история позиции в ту же транзакцию, с `oldValue/newValue`.
5. **`revision` и `bom.updatedAt`** — уже есть, чтобы показать, что спецификация менялась после импорта.
6. **`HISTORY_EVENT` / `AUDIT_ACTION`** — набор констант, куда нужно добавить пару значений (например
   `SPEC_FIELD`), а не изобретать механизм.
7. **`SOURCE_BOM_WRITE`** — право, которое логично распространить на правку полей спецификации.

Ограничение, которое придётся решать осознанно: **любая правка `code/manufacturer/name/model/unit` меняет
`material_key` и `position_id`**. Варианты обхода — ниже.

## 1.3. Варианты исправления

### Вариант A (рекомендуемый) — инлайн-правка полей спецификации в карточке BOM

**Суть:** в таблице позиций `BomCardPanel.tsx` текстовые поля (`№`, артикул, наименование, модель, ед.изм,
производитель, кол-во, резерв, срок) становятся редактируемыми для роли с `SOURCE_BOM_WRITE`; строка с ошибкой
подсвечивается и под ней видно «Не заполнено: …». Сохранение — как у существующих ячеек: Enter/blur, сервер —
источник истины, отказ возвращает прежнее значение.

**Изменения по слоям:**
- UI: новый `ui/EditableText.tsx` (по образцу `EditableNumber.tsx`) + разрешение правки в `POSITION_COLUMNS`
  (`BomCardPanel.tsx`) и фильтр «только строки с ошибкой» над таблицей.
- API: `POST /api/positions/:positionId/spec` (близко к существующей схеме `positionRoutes`) **или**
  `PATCH /api/boms/:code/positions/:positionId` (ближе к REST-смыслу «спецификация правится внутри BOM»).
- Домен: `bomService.updatePositionSpecField(db, ctx, {positionId, field, value})` с `requirePermission(role,
  'SOURCE_BOM_WRITE')`, сверкой с `validatePosition` (для обязательных полей) и записью в журнал
  `field: 'SPEC.MODEL'`, `reason: 'Правка спецификации после импорта'`.
- Инварианты: считать `material_key`/`position_id` заново нельзя «молча» — см. 1.4.

**Плюсы:** точно попадает в потребность («исправить то, что не догрузилось»), использует уже существующие
механизмы, не требует менять формат файлов, каждая правка попадает в журнал с автором.
**Минусы:** нужен новый компонент ячейки, и главное — нужно определить политику по смене `position_id`.
**Оценка:** 3 новых/изменённых файла сервера + 2 файла UI (см. 1.6).

### Вариант B — «мини-визард обязательных полей» для невалидных строк

**Суть:** в отчёте импорта и в карточке BOM показывается список невалидных позиций; строка раскрывается в
небольшую форму **только с недостающими полями** (обычно 1–3 поля), с кнопкой «Сохранить и проверить».
После сохранения сервер возвращает обновлённый `computed.missing` — строка исчезает из списка, когда ошибок не
остаётся.

**Плюсы:** минимальный и однозначный UI («починить ошибку», а не «редактировать спецификацию»); не требует решать
вопрос полного редактирования; понятный аудит («исправление ошибки данных»).
**Минусы:** не помогает, когда ошибка обнаружена позже (в карточке/витрине), и не закрывает потребность
«поправить опечатку в наименовании».
**Когда выбирать:** если цель — именно «догрузить то, что не распозналось».

### Вариант C — правка спецификации пачкой: «файл правок» (CSV/XLSX с колонками `position_id` + новое значение)

**Суть:** экспорт невалидных позиций в файл → правка в Excel → импорт обратно. Импортёр правок ещё раз использует
`readBomFile` и `resolveBomColumns`, но применяет `updatePositionSpec` по `position_id`, без пересчёта ключей.

**Плюсы:** привычный инструмент (Excel), удобно при десятках ошибок; не нужен новый UI-редактор.
**Минусы:** два новых эндпоинта (экспорт/импорт правок), риск, что в файле правок поменяют `name` и снова «уедут»
ключи; лишний шаг для одной опечатки. Хорошо работает **вместе** с вариантом A.

### Вариант D — правка до применения: предпросмотр импорта

**Суть:** `parseBomFile`/`parseBomRows` уже отделены от записи в базу (`applyParsedBom`). Можно сделать двухшаговый
импорт: `POST /api/boms/preview` (без записи) → экран правки распознанных строк → `POST /api/boms/import`
с уже исправленным массивом позиций. `syncBom.applyParsedBom` принимает готовый `ParsedBom` — технически это
уже поддерживается архитектурой.

**Плюсы:** ошибки не попадают в базу вообще; идеально для «файл пришёл кривой».
**Минусы:** не помогает, когда файл уже импортирован (а именно это описано в задаче); нужен серверный «черновик»
(иначе между шагами состояние теряется при перезагрузке) или повторная загрузка файла браузером.
**Когда выбирать:** как дополнение (защита от повторения), а не как основное решение.

### Вариант E — точечное «исключение» проблемной позиции

**Суть:** разрешить помечать позицию как «исключена из проверки» (флаг `flag`, не меняя полей), чтобы спецификация
могла стать «Скомплектованной», когда ошибка в строке, которая фактически не нужна.

**Плюсы:** дешёво; снимает симптом.
**Минусы:** противоречит логике `validation.ts` («позиция с ошибкой данных не может быть передана производству») и
размывает смысл статуса `ERROR`; требует явного решения заказчика и записи причины в журнал.
**Когда выбирать:** только если это осознанное требование, а не обход отсутствия правки.

## 1.4. Технические риски, которые придётся закрыть в любом из вариантов

1. **Смена `position_id` при правке `code`/`manufacturer`/`name`/`model`/`unit`.** Три стратегии:
   - **(1) Заморозить ключ** — правки текстовых полей сохраняются, `material_key`/`position_id` остаются прежними.
     Просто, история не рвётся, но: складской остаток (`materials.material_key`) останется привязан к старому
     описанию, а следующий импорт того же файла создаст **новую** позицию под новым ключом (потому что ключ
     считается из файла). Смягчение: при правке считать «новый желаемый ключ» и показывать предупреждение
     «после правки строка не совпадёт с исходным файлом».
   - **(2) Пересчитать ключ (миграция позиции)** — в транзакции: вычислить новый `material_key`/`position_id`,
     проверить конфликт, перенести `position_id` в `position_history`, `archive`, `audit_log` и объединить/пересчитать
     `materials`. Честно, но это уже операция уровня «перенос сущности», и её нужно проектировать вместе с ручным
     складом (`warehouseService`).
   - **(3) Запретить правку ключевых полей** — редактировать можно только `requiredQty`, `reservedQty`, `rowNo`,
     `deadline` (и, при желании, `code`/`manufacturer` — потому что они не входят в проверку обязательных полей,
     но входят в ключ; это как раз те поля, где ошибки чаще всего). Тогда `name/model/unit` правятся только файлом.
   **Рекомендация:** начать с (1) как самого дешёвого и предсказуемого, явно предупредив в UI, и отдельным решением
   вынести (3) как «правило политики» — набор разрешённых к правке полей в `constants.ts`, чтобы его можно было
   менять без переписывания сервиса.
2. **Конфликт с повторным импортом.** После ручной правки следующая загрузка того же файла перезапишет поле
   (`updatePositionSpec` вызывается для всех совпавших ключей). Нужно либо предупреждать в отчёте импорта
   («обновлено вручную: N, значения перезаписаны»), либо не перезаписывать поля, изменённые вручную, — для этого
   нужен признак «правилось вручную» (например, `audit_log`-запрос по позиции или колонка-флаг).
3. **Валидация на сервере обязательна.** `requiredQty` уже приходит из `toQty` (отрицательное → 0), даты — через
   `toIsoDate`. Для `rowNo`/`requiredQty` нужно решить, разрешать ли промежуточное «невалидное» состояние
   (например, `deadline = null`): с точки зрения `validatePosition` это законно и является ровно тем, что нужно
   лечить, — значит, сервер должен принимать пустые обязательные поля и **не** блокировать сохранение.
4. **Права.** Правка спецификации — это `SOURCE_BOM_WRITE` (экономист, админ). Кладовщик/снабженец/производство
   получают отказ 403; в UI поля должны быть `disabled` с поясняющим `title` (как это сделано для «Крайний срок»).
5. **Аудит.** Каждое поле — отдельная запись: `field: 'SPEC.MODEL'`, `oldValue`/`newValue`, `reason`, плюс
   `historyEvent`, чтобы правка была видна в истории позиции. Тогда на вопрос «откуда взялась модель» есть ответ.
6. **Производительность.** `updatePositionSpec` — один `UPDATE` по `position_id` (уникальный индекс), транзакция
   из одного-двух запросов; для инлайн-правки этого достаточно без оптимизаций.

## 1.5. Что показывать пользователю (минимальный UX)

- В карточке BOM — переключатель «Показать только строки с ошибкой» и счётчик «Требуют правки: N»
  (данные уже есть: `computed.valid`, `computed.missing`, `aggregate.errors`).
- Под строкой с ошибкой — текст из `describeMissingFields(computed.missing)` (сейчас `PositionDto.computed`
  отдаёт `valid`, но **не** отдаёт `missing` — в `web/src/api/types.ts` его нужно добавить в контракт).
- Рядом с каждой правкой — подсказка «изменено вручную», если `updated_at` позиции позже `boms.updated_at`
  последнего импорта (или если по позиции есть запись журнала с типом правки спецификации).
- После сохранения — тост «Изменение сохранено» (как в `DeficitPage.tsx`) и обновление **и** карточки, **и**
  списка BOM (счётчик «Ошибок данных»/«С ошибками» должен уменьшиться).

## 1.6. Чек-лист реализации варианта A (MVP)

- [ ] `server/src/domain/constants.ts` — список полей, разрешённых к правке (`EDITABLE_SPEC_FIELDS`), и цвет/флаг
      «правилось вручную», если понадобится.
- [ ] `server/src/services/bomService.ts` — `updateSpecField(db, ctx, {positionId, field, value})`:
      `requirePermission(ctx.role,'SOURCE_BOM_WRITE')` → `findPositionByPositionId` → `lifecycle==='REMOVED'` →
      `blocked` → нормализация значения (`trimmed` / `toQty` / `toIsoDate`) → `db.transaction` → `updatePositionSpec`
      (пересобирая `PositionSpec` из текущего состояния) → `recordChanges`.
- [ ] `server/src/http/routes/positionRoutes.ts` (или `bomRoutes.ts`) — `POST /api/positions/:positionId/spec`,
      ответ через `sendOperation` (тот же контракт `applied|already|blocked`).
- [ ] `server/src/services/operationLog.ts` — `AUDIT_ACTION.SPEC_FIELD`, `HISTORY_EVENT.SPEC_FIELD`.
- [ ] `web/src/api/endpoints.ts` — `setSpecField(positionId, field, value)`.
- [ ] `web/src/api/types.ts` — добавить `computed.missing` в `PositionDto`.
- [ ] `web/src/ui/EditableText.tsx` — по образцу `EditableNumber.tsx` (`editing`, `error`, `busy`, Enter/Escape/blur).
- [ ] `web/src/pages/BomCardPanel.tsx` — редактируемые колонки, фильтр «только с ошибкой», счётчик.
- [ ] `web/src/styles/components.css` — `input.cell-text` (ширина, моноширинный/обычный шрифт) по образцу
      `.cell-input`/`.cell-date`.
- [ ] Тест: правка обязательного поля снимает `computed.valid === false`; операционные данные (`orderedQty`,
      `expectedDate`, `realDeliveryQty`, `received`) после правки не меняются; в журнале появляется запись.

---

# Задача 2. Компактная однострочная вёрстка таблиц под 24" Full HD (1920×1080)

## 2.1. Что есть сейчас (измерения по коду)

- `--fs-sm: 12.5px`, `--fs-xs: 11.5px`, `--fs-md: 13.5px` (`tokens.css`), `body { line-height: 1.5 }`.
- `table.data`: `font-size: var(--fs-sm)`; `th, td { padding: 8px 10px; vertical-align: top; }` (`base.css`).
- Ячейки материалов **двухстрочные**: наименование + вторая строка `model · code · manufacturer` классом `mono muted`
  (11.5px) — так сделано в `DeficitPage`, `PickingPage`, `WorkingBomPage`, `BomCardPanel`, `SupplyPage`.
- Шапка `th` — `sticky`, прописной Oswald 11.5px, `border-bottom: 2px` (≈ 30–32px).
- Контейнер `.table-scroll { max-height: calc(100vh - 210px); overflow: auto; }` — «на глаз», не привязан к реальной
  высоте шапки/навигации/подвала; **шапка страницы и фильтры тоже участвуют в скролле страницы**, а не только таблица.
- Каркас: `.app-header` (`--header-height: 64px` в токенах, фактически ~66px + 3px оранжевая граница),
  `.app-nav a` — `padding: 11px 12px 9px` + `border-bottom: 3px` (~42px), `.app-main` — `padding: 20px 20px 28px`
  и `gap: 20px`, `.page-head` — `padding: 18px 22px` + подсказка `.hint` (до 92ch, обычно 2 строки по 12.5px),
  `.row` фильтров — поле `select` высотой `--control-height: 34px` + подпись,
  `.action-bar` — `padding: 10px 14px` (~54px), `.app-footer` — `padding: 14px` (~46px).
- Числовые ячейки уже `font-variant-numeric: tabular-nums` + моноширинный шрифт (`td.num`) — это правильная основа
  для плотной вёрстки, её нужно сохранить.
- Зебра (`tbody tr:nth-child(even)`) и `rowBackground` (цвета состояний) уже есть; `--row-*` совпадают с
  `COLORS` на сервере.

**Сколько строк влезает сейчас (расчёт для 1920×1080, масштаб 100%):**

| Элемент | Высота |
|---|---|
| Шапка приложения | ~69px |
| Навигация | ~42px |
| `main` padding + gap до таблицы | ~20 + 20 (page-head) + 20 (row фильтр) + 20 (action-bar) |
| `page-head` (заголовок 32px + 2 строки подсказки + padding 18×2) | ~100px |
| Фильтры (подпись 11.5 + поле 34 + gap) | ~56px |
| Панель действий | ~54px |
| Шапка таблицы | ~32px |
| Итого «съедено» сверху | ~470px |
| **Доступно таблице** | **~610px** (ограничение `calc(100vh - 210px)` = 870px не срабатывает, первым кончается вьюпорт) |
| Высота строки: 1-строчная ячейка (18.75px + 16px padding + 1px) | ~36px |
| Высота строки: 2-строчная ячейка материала (18.75 + 17.25 + 16 + 1) | ~53px, реально **~60–70px** (перенос длинных наименований) |

**Вывод:** сейчас на экран попадает примерно **9–11 двустрочных строк** или **16–17 однострочных**. Основные
потери: (1) двустрочная ячейка материала, (2) щедрые вертикальные padding и `gap: 20px` между блоками,
(3) двустрочная подсказка в `page-head`, (4) фиксированные ~470px на шапку/фильтры/панели.

## 2.2. Варианты

### Вариант 1 (база, рекомендую первым) — режим плотности через CSS-переменные

**Суть:** перевести все размеры «строки таблицы» на токены и добавить переключатель плотности
(`compact` / `normal`) на `<body>` или `.app-shell`, с сохранением выбора в `localStorage`.

Черновик токенов (значения — предложение, не код):

```
--table-fs: 12.5px → 11.5px          /* --fs-sm → компактный размер */
--table-cell-py: 8px → 3px            /* padding: var(--table-cell-py) 8px */
--table-row-gap: 20px → 12px          /* gap в .page */
--table-head-h: 32px → 26px
```

Дополнительно: `table.data td { vertical-align: middle }` вместо `top` (для однострочных ячеек разницы нет, но
двухстрочные начинают «центрироваться» и выглядеть плотнее).

**Ожидаемый эффект:** ~36px → **24–26px** на однострочную строку, **+40–45 % строк** на экране.
**Плюсы:** одно место правок, ничего не ломает, обратимо; поддерживает и «читающий» режим для тех, кто работает на
маленьком мониторе.
**Минусы:** сам по себе не увеличивает объём информации — строки всё ещё двухстрочные.

### Вариант 2 — «одна строка = одна строка» (однострочные ячейки с второстепенной информацией в подсказке)

**Суть:** там, где сейчас явно два `<div>`, оставить один: наименование в основной строке, а
`модель · артикул · производитель` убрать в `title` (tooltip) **той же** ячейки. Для таблиц типа «Материал»
использовать моноширинный шрифт в одну строку: `Наименование · Модель · Артикул`.

- В `DeficitPage`/`PickingPage`/`WorkingBomPage` — колонка «Материал» становится `ellipsis`-строкой
  (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis` на обёртке с `title`), а вторая строка с
  моделью/кодом/производителем — **отдельная колонка**, показываемая по желанию (см. вариант 5).
- Колонку «Спецификация» (сейчас `bomName` + «проект: …») свести к одной строке: `код проекта` + `ревизия`
  моноширинно, имя BOM — в `title`.
- В `SupplyPage` блок «Проекты и сроки» (`.cell-lines`, до N строк) — самый «многострочный» в системе; для него
  компактный режим должен показывать **первые 1–2 строки + «ещё N»** (или одну строку с суммой и `title` со списком).

**Ожидаемый эффект:** строки становятся гарантированно однострочными → **26–28px**, ~19–21 строка на экран при
текущем каркасе, до **24–25** вместе с вариантом 1.
**Плюсы:** это и есть ответ на «уместить максимум информации одной строкой»; ничего не скрывается безвозвратно —
подсказки и отдельные колонки.
**Минусы:** нужно пройтись по 5 страницам; `title` неудобен на тачскрине (но целевые экраны — десктопы 24").

### Вариант 3 — «липкие» первые колонки и ужатая шапка

**Суть:** включить уже описанный в CSS, но неиспользуемый `sticky-left` (`base.css` содержит
`table.data th.sticky-left, table.data td.sticky-left`) для колонок «№» и «Материал»/«Спецификация». Горизонтальная
прокрутка появляется при большом числе колонок — и тогда пользователь не теряет контекст строки.

**Плюсы:** фактически бесплатно (класс есть, `DataTable` можно расширить полем `sticky?: boolean` у колонки).
**Минусы:** требует `background` у sticky-ячеек (иначе просвечивают); мелочь, но нужно аккуратно совместить с
`rowBackground` и зеброй.

### Вариант 4 — пагинация или виртуализация

**Суть:** сейчас витрины приходят целиком и рендерятся целиком (`DataTable` без пагинации; комментарий в коде —
«строк в витрине сотни»).

- **Пагинация** («25 / 50 / 100 строк») — дешевле всего, сразу улучшает отзывчивость, но добавляет клик
  в рабочий процесс.
- **Виртуализация** (рендерить только видимые строки) — сохраняет «одну длинную таблицу» и ускоряет отрисовку
  на 1000+ строк, но требует переписать `DataTable` (сейчас он отдаёт обычную `<table>`).

**Совет:** плотная вёрстка и виртуализация — независимые улучшения; начинать с вариантов 1–2, а виртуализацию
делать, только если появятся реальные жалобы на прокрутку/скорость.

### Вариант 5 — настраиваемый состав колонок (профили)

**Суть:** кнопка «Колонки» с галочками; выбор хранится в `localStorage` на пользователя/раздел. Дефолт — всё,
как сейчас; «компактный профиль» — только ключевые колонки.

**Плюсы:** максимальная гибкость; разные роли видят своё (снабженцу — «Заказано»/«Ожидаемая поставка», кладовщику —
«Доступно»/«Состояние»).
**Минусы:** сложнее `DataTable` (нужен список скрытых ключей + меню), тестировать надо каждую комбинацию;
риск, что пользователи «спрячут» нужное.

### Вариант 6 — «выиграть 250px у каркаса» (наибольший эффект при минимальном риске кода)

Здесь нет новой функциональности — только косметика, но именно она отдаёт экран таблице:

1. **Подсказки `page-head` — сворачиваемые** (одна строка + «?» → раскрыть). Сейчас `.hint` — до 92ch, обычно
   2 строки у каждой страницы: это ~19px × 2 и пара десятков пикселей `padding`. Экономия **~50–70px**.
2. **`main` `gap: 20px → 12px`, `padding: 20px → 14px`** (`--gap-lg = 20px`). Между `page-head`, фильтром,
   `action-bar` и таблицей — 3 промежутка: экономия **~30px**.
3. **Панель действий и фильтры — в одну строку с заголовком** (сейчас это три отдельных блока по ~54px и ~56px).
   У `PickingPage`/`WorkingBomPage` `action-bar` можно сделать частью `page-head` справа: экономия **~50px**.
4. **`table-scroll` `max-height: calc(100vh - 210px)`** заменить на честный `flex`-каркас
   (`app-main { min-height: 0 }`, `.table-scroll { flex: 1 1 auto; min-height: 0 }`), чтобы таблица забирала **всю**
   оставшуюся высоту, а не угаданные 210px. На 1080p это плюс к вместимости, а на ноутбуке — минус «мертвой зоны».
5. **Подвал `.app-footer`** (~46px) на рабочих экранах не нужен — свернуть или показывать только на «Обзоре».
6. **`--header-height: 64px`**: шапка и навигация — самое «дорогое» место по вертикали после таблицы
   (`69 + 42 = 111px`). В плотном режиме меню можно сделать одной строкой без второй полосы (логотип + пункты
   в одной линии) — экономия **~45px**.

**Итог варианта 6:** ~610px → **~850–900px** под таблицу. Вместе с вариантами 1–2 это
**~30–35 строк на экран** вместо нынешних ~10.

## 2.3. Сводная оценка (1920×1080, масштаб 100 %)

| Состояние | Высота строки | Строк на экране |
|---|---|---|
| Как сейчас (двухстрочные ячейки) | 60–70px | **9–11** |
| Вариант 6 (каркас) | 60–70px | ~13 |
| Вариант 1 (плотность) | 36→26px | ~23 |
| Вариант 1 + 2 (однострочные) | 22–26px | ~27–30 |
| Вариант 1 + 2 + 6 | 22–26px | **~33–38** |

## 2.4. Ограничения, которые нельзя нарушить

- **Цвет строк** (`rowBackground`, `--row-*`) — часть предметной области (регламент описывает значение цветов);
  плотная вёрстка не должна их убирать или делать неразличимыми (зебра + цвет состояния конфликтуют: сейчас
  `rowBackground` перебивает зебру инлайн-стилем — это уже так работает, менять не нужно).
- **`tabular-nums` + моноширинные числа** (`td.num`) — оставить: без них колонки «съезжают» и таблица читается хуже.
- **Доступность:** 11.5px — нижняя граница комфорта; идти ниже (10.5px из `--fs-2xs`) можно только для
  второстепенных подписей и колонок. Интерактивные элементы (сортировка в `th`) в плотном режиме должны сохранить
  зону нажатия (в `base.css` кнопка сортировки уже без padding — при уменьшении строки она станет совсем мелкой;
  стоит оставить `padding: 0 2px`).
- **`title` вместо текста не заменяет текст** для ключевых полей (модель, артикул — по ним ищут). Поэтому
  «однострочность» лучше делать через **отдельные колонки + скрытие по профилю** (вариант 5), а не через полный
  отказ от информации.
- **Фокус-стили** (`.cell-input`, `:focus-visible { outline: 2px solid var(--mair-orange) }`) в очень плотных
  строках могут «наезжать» друг на друга — при `padding` 3px по вертикали лучше уменьшить `outline-offset` до 0.

---

## Итоговые рекомендации (коротко)

**Задача 1.** Диагностика в системе уже есть, не хватает только записи. Делать **вариант A** (инлайн-правка полей
спецификации в карточке BOM) на базе `updatePositionSpec` + `recordChanges`, стартуя с политики
**«ключ позиции не меняется»** (правки `name/model/unit/code/manufacturer` сохраняются без пересчёта
`material_key`/`position_id`, с явным предупреждением в UI). Дополнительно: отдавать `computed.missing` в
`PositionDto`, добавить фильтр «только строки с ошибкой» и запись журнала на каждое поле. Вариант B (мини-визард
обязательных полей) — как упрощённый первый шаг, вариант C (файл правок) — как средство массового ремонта,
вариант D (предпросмотр импорта) — как защита от повторения проблемы.

**Задача 2.** Порядок работ по соотношению «эффект / риск»: **вариант 6** (каркас: сворачиваемые подсказки,
уменьшение `gap`/`padding`, объединение фильтров и панели действий, честный `flex`-каркас вместо
`calc(100vh - 210px)`) → **вариант 1** (токены плотности + переключатель) → **вариант 2** (однострочные ячейки,
`ellipsis` + `title`, второстепенные поля в отдельные колонки) → **вариант 3** (`sticky-left` для «№» и
«Материала»). Итог: с 9–11 строк до 27–38 строк на экране 1920×1080 при сохранении цветов состояний и моноширинных
чисел.
