# BOM CONTROL SYSTEM — разбор кода + ответы на два вопроса

> Полный отчёт сохранён в `project_info__77.md` в корне проекта. Ниже — то же содержание.

## Summary

`BOM_CONTROL_SYSTEM` — система управления обеспечением сборки (MAIR). Исторически — набор Google Apps Script (`.js`/`v12_*.js`/`sat_*.js` в корне + `REGULATIONS.md`) поверх Google Таблиц. Рядом лежит новая реализация `bom-web/`: Node.js + TypeScript + PostgreSQL (Fastify + React/Vite), npm workspaces `server`/`web`. Доменный слой новой версии — построчный перенос старой логики (`v12_utils.js` → `values.ts`, `v12_calculate.js` → `calculate.ts`, `v12_roles.js` → `permissions.ts`), поэтому «странности» прежней системы сохранены намеренно.

Роли: экономист (спецификации + реальная поставка), снабженец (заказано/ожидаемая дата), кладовщик (склад, отборка), производство (передача, «Выполнено»), наблюдатель (чтение).

## Архитектура

**Паттерн:** чистое ядро + сервисы + HTTP/UI.

```
React (web/src)  ──HTTP/JSON, cookie-сессия──►  Fastify (server/src/http)
                                                   │
                                                   ▼
                                             services/   (транзакции, права, журнал)
                                                   │
                                                   ▼
                                             domain/     (ЧИСТЫЕ функции: расчёт, валидация, ключи)
                                                   │
                                                   ▼
                                             repositories/  ──►  db/ (pg | pglite)
```

Ключевой принцип: **в базе хранится только вход, всё производное вычисляется** — `domain/position.ts::applyComputed` пересчитывает дефицит/состояния при каждом чтении (`repositories/positionMapper.ts`). В `db/schema.ts` нет колонок «дефицит»/«статус» — это осознанно, чтобы вход и расчёт не расходились.

**Стек:** Fastify, PostgreSQL (`pg`) либо встроенный `pglite` (файловый Postgres для локального запуска), `exceljs` для XLSX, scrypt-хеши паролей, React 18 + Vite, CSS без фреймворка (`styles/tokens.css` — брендбук MAIR, `styles/base.css` — каркас и **таблицы**, `styles/components.css` — элементы управления). Тесты — свой раннер `server/test/run.ts`, `npm test -w server`.

**Запуск:** `bom-web/server/src/index.ts` — создаёт БД, прогоняет идемпотентную схему, сидит демо-данные, поднимает Fastify и регистрирует маршруты: `authRoutes`, `projectionRoutes` (витрины), `positionRoutes` (операции по позиции), `handoffRoutes`, `warehouseRoutes`, `bomRoutes`, `adminRoutes`.

## Структура каталогов

```
BOM_CONTROL_SYSTEM/
├── v12_*.js, sat_*.js, utils.js, logger.js  — прежняя система (Apps Script) + SAT_SETUP/TROUBLESHOOTING
├── REGULATIONS.md                          — регламент работы = фактическое ТЗ предметной области
├── project_info__*.md                      — журнал разборов (этот — № 77)
└── bom-web/
    ├── server/src/
    │   ├── index.ts, config.ts, errors.ts
    │   ├── domain/        — ЧИСТОЕ ядро: types, constants, values, materialKeys, validation,
    │   │                    calculate, position, bomStatus, dashboard(+Text), procurement,
    │   │                    projectionsRows, projectionTypes, picking, supply, permissions
    │   ├── repositories/  — SQL: positions, positionMapper, materials, boms, users, sessions,
    │   │                    archive, auditLog, positionHistory
    │   ├── services/      — bomService, positionService, handoffService, warehouseService,
    │   │   │                projectionService, auditService, userService, authService, operationLog
    │   │   └── bomImport/ — bomColumns, parseBomFile, parseBomRows, syncBom
    │   └── http/          — server, errors, requestAuth, operationReply, routes/*
    └── web/src/
        ├── api/           — client (fetch + ApiError + postOperation), endpoints, types, adminTypes
        ├── app/           — router, navigation (единый список разделов), useLoader, useAction
        ├── session/       — SessionContext (user, can(permission))
        ├── ui/            — DataTable, EditableNumber/Date/Checkbox, Badge, StatCard, ProjectFilter,
        │                    ConfirmDialog, ToastProvider, Layout, icons, BrandMark
        ├── pages/         — Overview, Deficit, Supply, Picking, WorkingBom, Dashboard, Warehouse,
        │                    Boms(+BomCardPanel), Archive(+Panel), Admin(+UsersPanel,AuditPanel), Account, Login
        └── styles/        — tokens.css, base.css, components.css, fonts.css
```

## Ключевые абстракции

### `Position` + `applyComputed` — `server/src/domain/position.ts`
Входные поля (`identity`: `rowNo/code/manufacturer/name/model/unit/deadline`, `quantities`: `requiredQty/reservedQty/orderedQty/realDeliveryQty/receivedQty/received`) + производный `computed` (дефицит, состояния, флаги, `valid`, `missing`). `computed` **никогда** не приходит из базы — он пересчитывается в маппере.

### `validatePosition` — `server/src/domain/validation.ts`
Обязательны: `rowNo > 0`, `name`, `model`, `unit`, `requiredQty > 0`, `deadline`. **Артикул (`code`) НЕ обязателен.** Невалидная позиция существует и видна везде, но её `productionState` не может стать «На складе» (`calculate.ts`: `valid ? READY_FOR_HANDOFF : PARTIALLY_AVAILABLE`), а вся спецификация получает статус `ERROR` (`bomStatus.ts`) — отсюда и гейт «Выполнено». Подписи — `describeMissingFields()`.

### `buildMaterialKey` / `buildPositionId` — `server/src/domain/materialKeys.ts`
`material_key` = `артикул|производитель`, а если артикула нет — `наименование|модель|производитель|ед.изм`. `position_id` = `КодBOM:material_key` (+ `#2`, `#3` при повторах). Это **единственная** связь между повторными импортами, историей (`position_history`), архивом (`archive`), журналом (`audit_log`) и складом (`materials.material_key`). **Следствие: правка `name/model/unit/code/manufacturer` меняет идентификатор позиции.**

### `applyParsedBom` — `server/src/services/bomImport/syncBom.ts`
Транзакция: upsert BOM → bump ревизии → для совпавших `position_id` только `updatePositionSpec` (операционные данные сохраняются) → вставка новых (`on conflict do nothing`) → исчезнувшие без операционных данных удаляются, с ними — помечаются `REMOVED` → `recordChanges('BOM_IMPORTED')`.

### `requirePermission` — `server/src/domain/permissions.ts` + `ROLE_PERMISSIONS`
`admin` — `*`; `economist` — `SOURCE_BOM_WRITE`, `DEADLINE`, `REAL_DELIVERY`; `procurement` — `ORDERED_QTY`, `EXPECTED_DATE`; `warehouse` — `WAREHOUSE_QTY`, `PICKING_CHECKBOX`; `production` — `PICKING_CHECKBOX`, `WORKING_BOM_CHECKBOX`, `DASHBOARD_CHECKBOX`; `viewer` — пусто.
**Важно:** `SOURCE_BOM_WRITE` сейчас применён только к импорту и удалению BOM (`bomRoutes.ts`), а в UI подписан как «Спецификации BOM (создание, импорт, **правка**)» — право на правку заявлено, точки применения в коде нет.

### `DataTable` — `web/src/ui/DataTable.tsx`
Единственная таблица системы: `Column { key, title, render, sortValue, numeric, width }`, клиентская сортировка, `rowKey`, `emptyText`, `rowBackground`. Ограничения: нет выбора строк (в «Отборке» галочка — просто колонка), нет «липких» колонок в API (класс `.sticky-left` есть в CSS, но нигде не используется), нет виртуализации и управления плотностью.

### Редактируемые ячейки — `EditableNumber/Date/Checkbox.tsx`
Контракт: `onSave → Promise<boolean>`, сервер — источник истины, при отказе поле возвращается к серверному значению, Enter/blur — сохранение, Escape — отмена, на фокусе текст выделяется целиком. **Текстового поля среди них нет** — для правки спецификации понадобится `EditableText`.

### `OperationReply` / `sendOperation`
`{ status: 'applied' | 'already' | 'blocked', reason, position }`. Отказ правил — HTTP 409, который `postOperation` в `api/client.ts` **не** считает ошибкой: тело возвращается как обычный результат. «Нельзя» — нормальный исход, а не исключение.

## Поток данных

### Импорт спецификации (путь вопроса №1)
1. `BomsPage.tsx` → `<input type="file">` → `readFileAsBase64()` → `api.importBom(fileName, contentBase64)`.
2. `POST /api/boms/import` → `authenticateWithContext` → `requirePermission(role, 'SOURCE_BOM_WRITE')`.
3. `bomService.importBomFromFile` → `bomCodeFromFileName` (код BOM = имя файла без расширения).
4. `readBomFile` — XLSX через `exceljs` или CSV (разделитель по первой строке: `;`, `,`, `\t`); лимиты `MAX_IMPORT_BYTES = 5 МБ`, `MAX_IMPORT_ROWS = 20 000`; пустые строки отбрасываются.
5. `parseBomRows` → `resolveBomColumns` ищет колонки по синонимам (`№ п/п`/`Строка`, `Наименование`/`Название`, `Кол-во`/`Количество`/`Требуется`, …). Строка без наименования → `skipped`. **Позиция с неполными обязательными полями импортируется** и попадает в `incomplete` («Не заполнено: …») — «иначе дефицит по этим строкам просто исчезнет из отчётов».
6. `applyParsedBom` — транзакция (см. выше).
7. Ответ `BomImportReport` → панель отчёта: «В файле строк / Добавлено / Обновлено / Удалено / Помечено удалёнными / Распознаны колонки» + списки `incomplete` (**обрезан до 50**) и `skipped` (до 20).
8. **Дальше — ничего.** Исправить строку через UI нельзя.

### Операция по позиции (существующий образец «правки»)
`DeficitPage.tsx` → `api.setOrderedQty|setExpectedDate|setRealDelivery*|setDeadline` (`encodeId` — в id есть `:`, `|`, `#`) → `positionRoutes.ts` → `positionService`: `requirePermission` → `loadPosition` (нет позиции или `REMOVED` → `blocked`) → сравнение (`already`) → `db.transaction` из `updateOperatingFields` (или `updatePositionSpec` для срока) + `recordChanges` → `finish()` возвращает позицию, клиент показывает тост и `reload()`.

### Витрины
`projectionRoutes` → `projectionService` → `listPositions`/`listActivePositions` → чистые функции `projectionsRows/picking/supply/dashboard.ts` → массив именованных полей (порядок колонок задаёт фронтенд). Фильтр `?project=` — серверный, поиск и сортировка — **клиентские**. Витрины отдаются целиком, без пагинации.

## Неочевидные поведения и инварианты

- **`position_id` — производная от содержимого.** Правка ключевых полей «переводит» позицию в другую; история/архив/журнал остаются за прежним ключом.
- **Повторный импорт — upsert, а не замена.** Операционные данные сохраняются; вернувшаяся в файл позиция снимает `REMOVED` → `ACTIVE`.
- **«Ошибка данных» — не ошибка загрузки.** Строка живёт как `ACTIVE`, видна во всех витринах, но не передаётся производству и лишает спецификацию статуса «Скомплектован» (цвет `--row-gray`).
- **Крайний срок — часть спецификации, но правится через операцию.** `setDeadline` вызывает `updatePositionSpec` со ВСЕМИ полями спецификации из текущего состояния — это готовый образец «правки одного поля спецификации» без потери операционных данных. Требует непустую дату (`allowEmpty={false}`) и бросает `ValidationError`, а не возвращает `blocked`.
- **Хранимые количества — `numeric(14,3)`** и приводятся к `float8` в SQL; даты — к `text` (часовые пояса). `values.ts` собирает даты в локальном времени, поддерживает серийные номера Excel и `ДД.ММ.ГГГГ`.
- **`trimmed()` режет любое текстовое поле до 500 символов** (`MAX_TEXT_LENGTH`).
- **Галочка «Реальная поставка» двигает склад на дельту** (`adjustWarehouseQty`). Склад в расчёте дефицита НЕ участвует — он контрольная книга, а не источник доступности.
- **`table-scroll { max-height: calc(100vh - 210px) }`** — магическая константа (важно для вопроса №2).
- **`REGULATIONS.md` описывает старую систему** («ПРИМЕНИТЬ», очередь, меню) — в веб-версии этого нет, сохранение немедленное. Но обязательные поля, цвета строк и правило «Ошибка данных → экономист» перенесены дословно.
- **Инлайн-стиль `rowBackground` перебивает зебру** — это уже так работает, менять не нужно.

## Модульный справочник

| Файл | Назначение |
|---|---|
| `bom-web/server/src/index.ts` | Точка входа: схема, сиды, Fastify, маршруты |
| `server/src/domain/constants.ts` | Состояния, подписи, цвета строк, роли, матрица прав, `LIMITS`, `SESSION` |
| `server/src/domain/values.ts` | Разбор чисел/дат/чекбоксов (`toNumber`, `toIsoDate`, `isChecked`) |
| `server/src/domain/materialKeys.ts` | `material_key` и `position_id` — идентичность позиции |
| `server/src/domain/validation.ts` | Обязательные поля; источник «Ошибки данных» |
| `server/src/domain/calculate.ts` | Дефицит, непокрытая потребность, состояния, флаги |
| `server/src/domain/position.ts` | Сущность позиции, `applyComputed`, фильтры видимости |
| `server/src/domain/bomStatus.ts` | Статус BOM и гейт «Выполнено» |
| `server/src/repositories/positions.ts` | `listPositionsByBom`, **`updatePositionSpec`**, `updateOperatingFields`, массовые вставка/удаление |
| `server/src/repositories/positionMapper.ts` | Единый SELECT + приведение к `Position` |
| `server/src/repositories/boms.ts` | `upsertBom`, `bumpRevision`, `setBomDone` |
| `server/src/services/bomImport/bomColumns.ts` | Синонимы заголовков колонок |
| `server/src/services/bomImport/parseBomFile.ts` | XLSX/CSV → таблица строк, лимиты, понятные ошибки |
| `server/src/services/bomImport/parseBomRows.ts` | Строки → позиции; `incomplete`/`skipped` |
| `server/src/services/bomImport/syncBom.ts` | Применение импорта с сохранением операционных данных |
| `server/src/services/bomService.ts` | Импорт, список, карточка, «Выполнено», удаление BOM |
| `server/src/services/positionService.ts` | Операции по позиции; **`setDeadline` = правка спецификации** |
| `server/src/services/operationLog.ts` | Журнал + история одной транзакцией, `AUDIT_ACTION`, `HISTORY_EVENT` |
| `server/src/http/routes/bomRoutes.ts` | `/api/boms`, `/import`, `/:code`, `/:code/done`, `DELETE` |
| `server/src/http/routes/positionRoutes.ts` | `/api/positions/:id` + операции |
| `server/src/db/schema.ts` | Полная идемпотентная схема |
| `web/src/ui/DataTable.tsx` | Универсальная таблица |
| `web/src/ui/EditableNumber/Date/Checkbox.tsx` | Правка в строке |
| `web/src/pages/BomsPage.tsx` | Импорт + отчёт (список «Требуют правки») |
| `web/src/pages/BomCardPanel.tsx` | Карточка BOM (только чтение) |
| `web/src/pages/DeficitPage.tsx` | Сводка дефицитов: правка в строке |
| `web/src/styles/base.css` | Каркас + стили таблиц (плотность, sticky, зебра) |
| `web/src/styles/tokens.css` | Брендбук MAIR: цвета, шрифты, отступы, `--row-*` |
| `web/src/styles/components.css` | Кнопки, поля, значки, панели; `.cell-input`, `.cell-date` |

## Порядок чтения

1. `REGULATIONS.md` — предметная область словами заказчика.
2. `server/src/domain/validation.ts` + `calculate.ts` — что значит «невалидная позиция».
3. `server/src/services/bomImport/parseBomRows.ts` + `syncBom.ts` — откуда ошибки и как импорт их сохраняет.
4. `server/src/services/positionService.ts` — образец операции (права, транзакция, журнал, ответ).
5. `web/src/pages/BomsPage.tsx` + `BomCardPanel.tsx` — где ошибки показываются и где нет правки.
6. `web/src/ui/DataTable.tsx` + `styles/base.css` — вся вёрстка таблиц.

---

# Задача 1. Исправление спецификаций, загруженных с ошибками

## 1.1. Точный диагноз по коду

| Возможность | Состояние | Где видно |
|---|---|---|
| Обнаружить ошибку | **есть** | `parseBomRows.incomplete` → отчёт в `BomsPage.tsx`; `computed.valid` → значок «Ошибка данных» в `BomCardPanel.tsx`/`DeficitPage.tsx`; счётчик «С ошибками» в `DashboardPage.tsx` |
| Узнать, **чего не хватает** | частично | текст из `describeMissingFields` («Не заполнено: Модель, Крайний срок поставки»), но в отчёте импорта до 50 строк, а в `PositionDto` поле `computed.missing` вообще не отдаётся |
| Исправить значение | **нет** | `positionRoutes.ts` умеет только `ordered`, `expected-date`, `real-delivery`, `deadline` |
| Исправить `requiredQty`/`reservedQty`/`rowNo` | **нет** | пишутся исключительно импортом |
| Исправить повторной загрузкой файла | да, но грубо | `syncBom.ts` обновит совпавшие ключи, но правка `name/model/unit/code/manufacturer` **сменит `position_id`** → дубль + старая позиция в `REMOVED` со всей историей |
| Удалить ошибочную строку | частично | только убрать строку из файла и импортировать заново |

**Вывод:** система корректно диагностирует ошибки, но лечит их только «перезаливкой исходника» — это регламент эпохи Google Таблиц («сообщите экономисту»). При этом право `SOURCE_BOM_WRITE` уже сформулировано как «создание, импорт, **правка**».

## 1.2. Что уже готово как «задел»

1. **`updatePositionSpec(db, positionId, spec)`** — пишет ровно поля спецификации, `updated_at = now(), version = version + 1`, операционные данные не трогает. Это ровно та операция, которой не хватает.
2. **`setDeadline`** — работающий образец: право → загрузка → `blocked` при `REMOVED` → `already` при том же значении → транзакция `updatePositionSpec` + `recordChanges`.
3. **`validatePosition`** — готовый валидатор для проверки результата правки.
4. **`operationLog.recordChanges`** — журнал + история позиции в ту же транзакцию (`oldValue`/`newValue`).
5. **`revision`, `bom.updatedAt`** — для показа «спецификация менялась после импорта».
6. **`AUDIT_ACTION` / `HISTORY_EVENT`** — достаточно добавить пару значений.
7. **`SOURCE_BOM_WRITE`** — право, которое логично распространить на правку полей.

Ограничение, которое придётся решить осознанно: **правка `code/manufacturer/name/model/unit` меняет `material_key` и `position_id`**.

## 1.3. Варианты

### Вариант A (рекомендуемый) — инлайн-правка полей спецификации в карточке BOM
В таблице позиций `BomCardPanel.tsx` поля (`№`, артикул, наименование, модель, ед.изм, производитель, кол-во, резерв, срок) становятся редактируемыми для роли с `SOURCE_BOM_WRITE`; строка с ошибкой подсвечена и показывает «Не заполнено: …». Сохранение — как у существующих ячеек (Enter/blur, сервер — источник истины, отказ возвращает прежнее значение).

- UI: новый `ui/EditableText.tsx` по образцу `EditableNumber.tsx` + фильтр «только строки с ошибкой» и счётчик.
- API: `POST /api/positions/:positionId/spec` (близко к `positionRoutes`) либо `PATCH /api/boms/:code/positions/:positionId`.
- Сервис: `updateSpecField(db, ctx, {positionId, field, value})` — `requirePermission(role,'SOURCE_BOM_WRITE')` → `findPositionByPositionId` → `REMOVED` → `blocked` → нормализация (`trimmed`/`toQty`/`toIsoDate`) → транзакция `updatePositionSpec` (пересобирая `PositionSpec` из текущего состояния) → `recordChanges`.

**Плюсы:** точно в потребность, использует существующие механизмы, формат файлов не меняется, каждая правка в журнале с автором. **Минусы:** новый компонент ячейки + нужно определить политику по `position_id`.

### Вариант B — мини-визард обязательных полей
В отчёте импорта и в карточке — список невалидных позиций; строка раскрывается в форму **только с недостающими полями** (обычно 1–3) с кнопкой «Сохранить и проверить». Сервер возвращает обновлённый `computed.missing`; когда ошибок не осталось — строка уходит из списка.
**Плюсы:** минимальный и однозначный UI («починить ошибку», а не «редактировать спецификацию»), ясный аудит. **Минусы:** не закрывает потребность «поправить опечатку в наименовании». **Когда:** если цель — только «догрузить нераспознанное».

### Вариант C — «файл правок» (экспорт/импорт пачки)
Экспорт невалидных позиций в CSV/XLSX с `position_id` + новыми значениями → правка в Excel → импорт, применяющий `updatePositionSpec` по `position_id` (без пересчёта ключей). Импортёр переиспользует `readBomFile`/`resolveBomColumns`.
**Плюсы:** привычный Excel, удобно при десятках ошибок. **Минусы:** два новых эндпоинта; риск снова поменять `name` и «уехать» по ключам; лишний шаг для одной опечатки. Хорош **вместе** с A.

### Вариант D — предпросмотр импорта (правка до применения)
`parseBomFile`/`parseBomRows` уже отделены от записи (`applyParsedBom` принимает готовый `ParsedBom`), поэтому двухшаговый импорт технически поддерживается: `POST /api/boms/preview` (без записи) → экран правки → `POST /api/boms/import` с исправленным массивом.
**Плюсы:** ошибки не попадают в базу вообще. **Минусы:** не помогает, когда файл уже импортирован (а это описанный случай); нужно серверное хранение черновика либо повторная загрузка файла. **Когда:** как защита от повторения, не как основное решение.

### Вариант E — «исключить позицию из проверки»
Разрешить помечать строку как исключённую (флаг, поля не меняются), чтобы спецификация могла стать «Скомплектованной».
**Плюсы:** дёшево. **Минусы:** противоречит `validation.ts` («позиция с ошибкой данных не может быть передана производству»), размывает смысл `ERROR`. Только как осознанное требование.

## 1.4. Риски, которые нужно закрыть в любом варианте

1. **Смена `position_id`.** Три стратегии: **(1) заморозить ключ** (правки сохраняются, ключ не пересчитывается — просто, история не рвётся; минус: складской остаток остаётся за старым описанием, а следующий импорт того же файла создаст новую позицию под новым ключом → смягчение: показывать «строка не совпадёт с исходным файлом»); **(2) пересчитать ключ** (миграция `position_id` в `position_history`, `archive`, `audit_log`, пересчёт `materials` — честно, но это операция уровня «перенос сущности»); **(3) запретить правку ключевых полей** (`requiredQty`, `reservedQty`, `rowNo`, `deadline`; при желании — `code`/`manufacturer`, т.к. они не обязательны, но входят в ключ). **Рекомендация:** начать с (1), а список разрешённых полей вынести в `constants.ts` как политику.
2. **Конфликт с повторным импортом.** Следующая загрузка того же файла перезапишет ручную правку. Нужно либо предупреждать в отчёте импорта, либо не перезаписывать вручную изменённые поля (признак — запись в журнале/флаг).
3. **Валидация на сервере обязательна**, но она должна **разрешать** пустые обязательные поля — иначе лечить ошибку будет нельзя.
4. **Права:** `SOURCE_BOM_WRITE` (экономист, админ); остальным — `disabled` с поясняющим `title`, как у «Крайнего срока».
5. **Аудит:** отдельная запись на каждое поле (`field: 'SPEC.MODEL'`, `oldValue`/`newValue`, `reason`, `historyEvent`).
6. **Производительность:** один `UPDATE` по уникальному `position_id` — оптимизации не нужны.

## 1.5. Минимальный UX
Переключатель «Показать только строки с ошибкой» + счётчик «Требуют правки: N» (данные уже есть: `computed.valid`, `computed.missing`, `aggregate.errors`); под строкой — текст из `describeMissingFields` (нужно добавить `computed.missing` в `PositionDto`); пометка «изменено вручную», если `updated_at` позиции позже `boms.updated_at`; после сохранения — тост и обновление и карточки, и списка BOM (счётчик «С ошибками» должен уменьшиться).

## 1.6. Чек-лист варианта A (MVP)
- [ ] `constants.ts` — `EDITABLE_SPEC_FIELDS` (политика разрешённых к правке полей).
- [ ] `bomService.ts` — `updateSpecField(...)` с правами, `blocked`/`already`, нормализацией, `updatePositionSpec` + `recordChanges`.
- [ ] `positionRoutes.ts` (или `bomRoutes.ts`) — `POST /api/positions/:positionId/spec` через `sendOperation`.
- [ ] `operationLog.ts` — `AUDIT_ACTION.SPEC_FIELD`, `HISTORY_EVENT.SPEC_FIELD`.
- [ ] `web/src/api/endpoints.ts` — `setSpecField(positionId, field, value)`.
- [ ] `web/src/api/types.ts` — добавить `computed.missing`.
- [ ] `web/src/ui/EditableText.tsx`.
- [ ] `BomCardPanel.tsx` — редактируемые колонки, фильтр «только с ошибкой», счётчик.
- [ ] `components.css` — `input.cell-text` по образцу `.cell-input`/`.cell-date`.
- [ ] Тест: правка снимает `computed.valid === false`; операционные данные не меняются; в журнале есть запись.

---

# Задача 2. Компактная однострочная вёрстка под 24" Full HD (1920×1080)

## 2.1. Что есть сейчас (измерения по коду)
- `--fs-sm: 12.5px`, `--fs-xs: 11.5px`, `line-height: 1.5`; `table.data { font-size: var(--fs-sm) }`, `th, td { padding: 8px 10px; vertical-align: top }`.
- Ячейки «Материал» и «Спецификация» **двухстрочные** (вторая строка — `mono muted` 11.5px) в `DeficitPage`, `PickingPage`, `WorkingBomPage`, `BomCardPanel`, `SupplyPage` (в `SupplyPage` ещё и `.cell-lines` со списком проектов).
- `--header-height: 64px` (шапка ~69px), навигация ~42px, `.app-main { padding: 20px 20px 28px; gap: 20px }`, `.page-head { padding: 18px 22px }` + `.hint` до 92ch (обычно 2 строки), фильтры (`--control-height: 34px`) ~56px, `.action-bar` ~54px, подвал ~46px, шапка таблицы ~32px.
- `.table-scroll { max-height: calc(100vh - 210px) }` — «на глаз».

**Расчёт для 1920×1080 (масштаб 100 %):** сверху «съедается» ~470px, таблице остаётся **~610px** (лимит `calc(100vh - 210px)` = 870px не срабатывает — первым кончается вьюпорт). Однострочная строка ~36px, двухстрочная — 53px теоретически и **60–70px** фактически (переносы длинных наименований). Итого **9–11 строк** на экране.

Основные потери: (1) двухстрочные ячейки, (2) `padding` 8px и `gap: 20px`, (3) двухстрочная подсказка `page-head`, (4) фиксированные ~470px на шапку/фильтры/панели.

## 2.2. Варианты

### Вариант 1 (база) — режим плотности через CSS-переменные
Перевести размеры строки таблицы в токены и добавить переключатель `compact`/`normal` (на `<body>`/`.app-shell`, выбор в `localStorage`): `--table-fs 12.5→11.5px`, `--table-cell-py 8→3px`, `gap 20→12px`, шапка 32→26px, `td { vertical-align: middle }`.
**Эффект:** 36 → **24–26px**, +40–45 % строк. **Плюсы:** одна точка правок, обратимо. **Минусы:** строки всё ещё двухстрочные.

### Вариант 2 — «одна строка = одна строка»
Убрать вторые `<div>`: наименование в основной строке, `модель · артикул · производитель` — в `title` ячейки (или вынести в **отдельные колонки**, см. вариант 5). Колонку «Спецификация» свести к `код проекта` + `ревизия` (имя BOM — в `title`). Для `.cell-lines` в «Снабжении» — первые 1–2 строки + «ещё N».
**Эффект:** гарантированно однострочные строки → 26–28px, ~19–21 строка; вместе с вариантом 1 — **24–25**. **Плюсы:** это и есть ответ на «максимум информации одной строкой»; ничего не теряется безвозвратно. **Минусы:** нужно пройтись по 5 страницам.

### Вариант 3 — «липкие» первые колонки
Включить неиспользуемый `.sticky-left` (класс уже есть в `base.css`) для «№» и «Материала»/«Спецификации»; расширить `Column` полем `sticky?: boolean`.
**Плюсы:** почти бесплатно. **Минусы:** нужен `background` у sticky-ячеек, аккуратно совместить с зеброй и `rowBackground`.

### Вариант 4 — пагинация или виртуализация
Витрины сейчас приходят и рендерятся целиком. Пагинация (25/50/100) — дёшево и ускоряет отклик, но добавляет клик; виртуализация сохраняет «одну длинную таблицу», но требует переписать `DataTable` (обычная `<table>`).
**Совет:** делать только при реальных жалобах; с вариантами 1–2 не конфликтует.

### Вариант 5 — настраиваемый состав колонок (профили)
Кнопка «Колонки» с галочками, выбор в `localStorage`. Дефолт — как сейчас; «компактный профиль» — только ключевые колонки.
**Плюсы:** максимум гибкости, у каждой роли своё (снабженцу — «Заказано»/«Ожидаемая поставка», кладовщику — «Доступно»/«Состояние»). **Минусы:** усложняет `DataTable`, много комбинаций для проверки.

### Вариант 6 — «выиграть ~250px у каркаса» (лучший эффект/риск)
1. **Подсказки `page-head` — сворачиваемые** (одна строка + «?»): ~50–70px.
2. **`main` `gap 20→12px`, `padding 20→14px`** (3 промежутка): ~30px.
3. **Фильтры и панель действий — в строку заголовка** (сейчас три блока по ~54–56px): ~50px.
4. **Заменить `calc(100vh - 210px)`** на честный flex-каркас (`app-main { min-height: 0 }`, `.table-scroll { flex: 1 1 auto; min-height: 0 }`).
5. **Подвал** (~46px) на рабочих экранах свернуть.
6. **Шапка + навигация (69+42=111px)** — в плотном режиме свести меню в одну линию: ~45px.

**Итог:** ~610px → **~850–900px** под таблицу; вместе с вариантами 1–2 — **~30–35 строк** вместо ~10.

## 2.3. Сводная оценка (1920×1080)

| Состояние | Высота строки | Строк на экране |
|---|---|---|
| Как сейчас | 60–70px | **9–11** |
| Вариант 6 (каркас) | 60–70px | ~13 |
| Вариант 1 (плотность) | 36→26px | ~23 |
| Вариант 1 + 2 | 22–26px | ~27–30 |
| Вариант 1 + 2 + 6 | 22–26px | **~33–38** |

## 2.4. Ограничения, которые нельзя нарушить
- **Цвета строк** (`rowBackground`, `--row-*`) — часть предметной области, описаны в регламенте; сохранить.
- **`tabular-nums` + моноширинные числа** (`td.num`) — оставить, иначе колонки «съезжают».
- **11.5px — нижняя граница комфорта**; ниже (10.5px) только для второстепенных подписей.
- **Кнопка сортировки в `th`** сейчас без padding — в плотном режиме оставить `padding: 0 2px`, иначе зона нажатия станет слишком мелкой.
- **`title` не заменяет текст** для ключевых полей (по модели/артикулу ищут) → «однострочность» через отдельные колонки + профиль (вариант 5), а не через отказ от информации.
- **Фокус-стили** (`outline` 2px) при вертикальном padding 3px могут «наезжать» — уменьшить `outline-offset` до 0.

---

## Итоговые рекомендации (кратко)

**Задача 1.** Диагностика уже есть, не хватает только записи. Делать **вариант A** (инлайн-правка в карточке BOM) на базе `updatePositionSpec` + `recordChanges`, стартуя с политики **«ключ позиции не меняется»** и явным предупреждением в UI. Дополнительно: отдать `computed.missing` в `PositionDto`, фильтр «только строки с ошибкой», запись журнала на каждое поле. Вариант B — как упрощённый первый шаг, C — для массового ремонта, D — защита от повторения проблемы.

**Задача 2.** Порядок по «эффект/риск»: **вариант 6** (каркас: сворачиваемые подсказки, уменьшение `gap`/`padding`, объединение фильтров и панели действий, flex-каркас вместо `calc(100vh - 210px)`) → **вариант 1** (токены плотности + переключатель) → **вариант 2** (однострочные ячейки, `ellipsis` + `title`) → **вариант 3** (`sticky-left`). Итог: с 9–11 строк до **27–38** на экране 1920×1080 при сохранении цветов состояний и моноширинных чисел.

---

Отчёт сохранён в файл `project_info__77.md` в корне проекта. Готов углубиться в любой пункт — например, детально расписать контракт эндпоинта правки спецификации или расчёт по конкретной странице (`DeficitPage`/`SupplyPage`), либо предложить конкретный набор значений токенов плотности с учётом того, какие колонки реально нужны каждой роли.

> Замечание по режиму: я работаю в **Explore Mode** — могу только анализировать и документировать. Чтобы реализовать правку спецификаций или плотную вёрстку, переключитесь в **Act Mode** (переключатель режима внизу чата) — результаты этого разбора перенесутся как контекст.