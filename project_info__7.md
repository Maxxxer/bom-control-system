# BOM CONTROL SYSTEM V11 — Аудит соответствия обновлённому ТЗ + план корректировок

## Резюме

Текущий код (V11) построен по модели **«единая мастер-таблица MATERIAL_STATE»**: исходные данные BOM, операционные данные и физическое состояние склада смешаны в одной строке из 21 колонки. Обновлённое ТЗ требует архитектуры **SOURCE ≠ STATE ≠ VIEW**, где:

- `ORIGINAL BOM` — единственный источник потребности и резервирования;
- `POSITION_STATE` — центральное операционное состояние позиции;
- `MATERIAL_STATE` — только физическое состояние склада (`warehouseQty`), не источник потребности;
- `DEFICIT_SUMMARY`, `ОТБОРКА`, `WORKING BOM`, `DASHBOARD`, `СНАБЖЕНИЕ` — **проекции/представления**, перестраиваемые из состояния.

**Общая оценка**: соответствие **~15–20%**. Логика расчёта дефицита (`max(0, required − reserved)`) уже верна, есть части импорта/архива/Dashboard. Но отсутствуют: `POSITION_STATE`, `ОТБОРКА`, `WORKING BOM`, `СНАБЖЕНИЕ`, `BOM_REGISTRY`, `Change Engine / ChangeSet / Revision`, количественная `realDeliveryQty`, `availableForProduction`, идемпотентный `markReceivedByProduction`, `RETURN_FROM_ARCHIVE`, RBAC с новыми ролями, колонка «Модель», физический контроль склада. Есть и **прямые нарушения**, главное — `exportBOMFile()` пишет обратно в исходный BOM (ТЗ запрещает автоматически менять источник).

---

## Методология

- Сравнивались фактические файлы проекта с текстом ТЗ (пункты 1–212).
- Использовался `search_files` по ключевым идентификаторам ТЗ: `positionId`, `POSITION_STATE`, `ОТБОРКА`, `Снабжение`, `BOM_REGISTRY`, `realDeliveryQty`, `availableForProduction`, `warehouseQty`, `markReceivedByProduction`, `RESERVE_CHANGED`, `RETURN_FROM_ARCHIVE`, `PRODUCTION_HANDOFF`, `Модель`, `sourceRevision`, `overOrderedQty`, `shortDeliveryQty`, `uncoveredNeed`, `freeQty`, `PURCHASE`, `handoff`, `changeSet`, `materialKey` → **0 результатов** (все отсутствуют).
- Подтверждено наличие legacy-функций: `saveDeficitChanges()`, `archiveReceivedMaterials()`, `runFullUpdate()`, `generateMaterialId(bom, version, row)`, `computeMaterialStatus()`, `REAL_DELIVERY` (boolean), `RECEIVED` (boolean), `BOM_ROW`, `BOM_VERSION`, `RESERVED`.

---

## 1. Соответствие ключевым принципам ТЗ

| Принцип ТЗ | Текущее состояние | Статус |
|---|---|---|
| **№2** Главный принцип: SOURCE → CHANGE MANAGEMENT → POSITION_STATE → VIEW | Нет такого разделения; всё в одной таблице | ❌ |
| **№4.1** `reservedQty` — только из ORIGINAL BOM | Резерв импортируется из BOM, но хранится в `MATERIAL_STATE` и смешан с операционными данными; нет гарантии, что только BOM его источник | ⚠️ |
| **№5** Резервирование — это закрепление за позицией BOM, не склад | Понятие «физический остаток» (`warehouseQty`) отсутствует; резерв и склад не различаются | ❌ |
| **№13** `POSITION_STATE.reservedQty` = копия из BOM, BOM authoritative | `POSITION_STATE` отсутствует | ❌ |
| **№29** `MATERIAL_STATE.reservedQty` — контрольная агрегация, не источник | `MATERIAL_STATE` вообще не содержит `warehouseQty`/`freeQty`; `RESERVED` воспринимается как источник | ❌ |
| **№90** Запрет конкурирующих источников резерва | Потенциально `MATERIAL_STATE` может расходиться с BOM, механизма сверки нет | ❌ |
| **№143** Бизнес-инварианты (1–10) | Частично соблюдается только инвариант 2 (формула дефицита) | ⚠️ |
| **№204/211** Нельзя автоматически резервировать из склада | Автоматического резервирования нет, но и контроля «резерв ≤ склад» нет | ⚠️ |

---

## 2. Критические нарушения ТЗ

1. **`exportBOMFile()` пишет обратно в исходные BOM-файлы** (колонки Зарезервировано/Заказано/Ожидаемая/Реальная/Статус + цвета). ТЗ **№136, №3.1** прямо запрещает: *«Исходный BOM должен сохраняться в исходном виде и не должен изменяться системой автоматически».* Это нарушение — обратная запись должна идти в **Рабочий BOM** (отдельные документы), а не в источник.
2. **`RECEIVED` — логический флаг, а не количественная операция.** ТЗ требует `receivedByProductionQty`, `realDeliveryQty` (количество, частичные поставки), `availableForProduction = reservedQty + realDeliveryQty`, проверку полной доступности и **запрет частичной передачи** (№24, №106). Сейчас достаточно поставить чекбокс → материал архивируется, без проверки полноты.
3. **`REAL_DELIVERY` — логический флаг, а не количество.** Нет `realDeliveryQty`, `shortDeliveryQty`, `overOrderedQty`, `uncoveredNeed` — все 8 канонических количеств из №14 не реализованы (кроме `deficitQty`).
4. **`generateMaterialId(bom, version, row)` — нестабильный ID.** ID зависит от версии BOM → создаются «новые» позиции при смене версии. ТЗ **№10, №150** требует стабильный `positionId (bomId + positionId)` и запрещает использовать № позиции как primary key.
5. **Нет идемпотентного `markReceivedByProduction(positionId, sourceUI)`.** ТЗ №25, №27 требует единую, идемпотентную операцию для ОТБОРКИ и Working BOM, с защитой от двойного клика (№96) и запретом второй передачи (инвариант 7).
6. **`saveDeficitChanges()` остаётся источником операционных правок** (заказ/дата). ТЗ №34 говорит, что он *«должен быть заменён специализированными обработчиками»* и не должен оставаться самостоятельным источником (№134).
7. **Нет физического контроля склада.** ТЗ №30 требует `RESERVATION_PHYSICAL_INCONSISTENCY`, если `Σ BOM.reservedQty > warehouseQty`. Отсутствует `warehouseQty` как таковой.
8. **Валидация не соответствует ТЗ №8.** Сейчас обязательны: №позиции, Код, Ед.изм, Qty>0, Срок. По ТЗ обязательны: №позиции, Наименование, **Модель**, Ед.изм, Требуемое количество, **Зарезервировано**, Срок. **Код не обязателен** (сейчас его отсутствие = «Ошибка данных»). Колонки «Модель» нет вообще.

---

## 3. Отсутствующие сущности и модули

| Сущность ТЗ | Наличие | Замечание |
|---|---|---|
| `POSITION_STATE` | ❌ | Центральная таблица операционного состояния (№12) |
| `ОТБОРКА` (Picking) | ❌ | Отдельный интерфейс (№37–42) |
| `WORKING BOM` (Рабочий BOM) | ❌ | Периодические документы на BOM (№43–46) |
| `СНАБЖЕНИЕ` (Supply) | ❌ | Агрегация материалов по BOM (№68–70) |
| `BOM_REGISTRY` | ❌ | Бом-реестр с bomId/active/dirty/sourceRevision (№54) |
| `MATERIAL_STATE` физический | ⚠️ | Есть, но модель другая — нет warehouseQty/freeQty/materialKey |
| `AUDIT_LOG` | ⚠️ | Есть `EVENT_LOG`/`SYSTEM_LOG`, но нет operationId/старых значений в структурированном виде |
| `PURCHASE_BATCH` / `PURCHASE_ALLOCATION` | ❌ | Рекомендовано к развитию (№72–73) |
| `PRODUCTION_HANDOFF` | ❌ | Сущность фиксации передачи (№77) |
| `MATERIAL_ACTIONS` с количествами | ⚠️ | Есть действия, но логические флаги вместо количеств (№18–21) |

---

## 4. Несоответствия расчётной логики

ТЗ №15–23, №145 — единая функция `calculatePositionState(source, operational)` возвращает: `deficitQty`, `uncoveredNeed`, `overOrderedQty`, `shortDeliveryQty`, `availableForProduction`, `supplyState`, `productionState`, `flags`, `status`.

| Показатель | Формула ТЗ | Текущее состояние |
|---|---|---|
| `deficitQty` | `max(0, required − reserved)` | ✅ Реализовано (в `computeMaterialStatus`) |
| `uncoveredNeed` | `max(0, deficit − ordered)` | ❌ Отсутствует |
| `overOrderedQty` | `max(0, ordered − deficit)` | ❌ Отсутствует |
| `shortDeliveryQty` | `max(0, ordered − realDeliveryQty)` | ❌ Отсутствует (нет realDeliveryQty) |
| `availableForProduction` | `reservedQty + realDeliveryQty` | ❌ Отсутствует |
| `readyForHandoff` | `available ≥ required && VALID && ACTIVE && !received` | ❌ Отсутствует |
| supplyState | `NO_REQUIREMENT / RESERVED / NOT_ORDERED / PARTIALLY_ORDERED / ORDERED / PARTIALLY_DELIVERED / DELIVERED` | ❌ Другая модель статусов |
| productionState | `NOT_AVAILABLE / PARTIALLY_AVAILABLE / READY_FOR_HANDOFF / RECEIVED` | ❌ Другая модель |
| flags | `NORMAL / CHANGED / ... / OVER_ORDERED / SHORT_DELIVERY / RESERVATION_PHYSICAL_INCONSISTENCY` | ❌ Отсутствуют |

---

## 5. Изменение модели данных (ключевой шаг)

Сейчас всё в одной строка `MATERIAL_STATE` (21 колонка). Нужно развести на **SOURCE → POSITION_STATE → MATERIAL_STATE (физический) + VIEW**.

### 5.1 ORIGINAL BOM (источник)
Колонки (№3, №7): №позиции, Код, Наименование, **Модель**, Ед.изм, Требуемое количество, Зарезервировано, Крайний срок. Читается из Drive **только на чтение**, не перезаписывается системой. `reservedQty` — authoritative.

### 5.2 BOM_REGISTRY (№54)
`bomId`, `sourceSpreadsheetId`, `sourceSheetName`, `workingSpreadsheetId`, `active`, `completedFlag`, `sourceRevision`, `lastHash`, `lastSyncAt`, `dirty`, `updatedAt`.

### 5.3 POSITION_STATE (№12)
`bomId`, `positionId`, `sourceRevision`, `requiredQty`, `reservedQty`, `orderedQty`, `realDeliveryQty`, `expectedDate`, `deadline`, `receivedByProductionQty`, `receivedByProduction`, `receivedByProductionAt`, `receivedByProductionUser`, `validationStatus`, `lifecycleState`, `supplyState`, `productionState`, `deficitQty`, `uncoveredNeed`, `overOrderedQty`, `shortDeliveryQty`, `availableForProduction`, `flags`, `updatedAt`.

### 5.4 MATERIAL_STATE (физический, №28)
`materialKey`, `materialCode`, `name`, `model`, `unit`, `warehouseQty`, `reservedQty` (контрольная агрегация), `freeQty`, `updatedAt`.

### 5.5 Проекции
- `DEFICIT_SUMMARY` (№33)
- `ОТБОРКА` (№39)
- `WORKING BOM` (№44)
- `DASHBOARD` (№47)
- `СНАБЖЕНИЕ` (№70)

---

## 6. План корректировок (этапы)

### Этап 0 — Подготовка (не менять логику)
- Зафиксировать текущее состояние как baseline; держать legacy-функции как wrapper (№134).
- Добавить в `config.js`: `bomId/positionId/model/warehouseQty/materialKey`, новые статусы `supplyState/productionState`, флаги.

### Этап 1 — ETL исходных BOM в новый контекст
- Создать `BOM_REGISTRY` и `readSourceBOM()` (чтение только из Drive, без обратной записи).
- Создать `POSITION_STATE` и наполнить из BOM. `reservedQty` — только из BOM. `positionId = bomId + ":" + stableKey` (например, по стабильной паре *код+имя+модель+СТРОКА-последовательность* после первого импорта, чтобы переживала смену № позиции).

### Этап 2 — Change Engine + Revision
- `detectBOMChanges(registryRow, currentSourceRows)` → `ChangeSet` (`changeSetId`, список `{positionId, field, oldValue, newValue}`).
- События: `QUANTITY_CHANGED`, `RESERVE_CHANGED`, `DEADLINE_CHANGED`, `MATERIAL_CHANGED`, `MATERIAL_REPLACED`, `POSITION_ADDED`, `POSITION_DELETED`.
- `applySourceRevision` → увеличивает `sourceRevision`, обновляет `POSITION_STATE`.

### Этап 3 — Единый расчётный движок
- `calculatePositionState(source, operational)` возвращает все 8 количеств + состояния + флаги.
- Заменить `computeMaterialStatus` на `calculatePositionState`.
- Запретить ожидаемой поставке/заказу/поставке/складу влиять на `deficitQty`.

### Этап 4 — Изменение склада (`MATERIAL_STATE`)
- Ввести `warehouseQty`. Проверка: `Σ BOM.reservedQty ≤ warehouseQty`, иначе флаг `RESERVATION_PHYSICAL_INCONSISTENCY` + аудит.
- Не менять BOM автоматически (№136, №204).

### Этап 5 — Операционные интерфейсы
- **ОТБОРКА** (№37–42): колонки из №39, фильтр BOM, чекбокс → `markReceivedByProduction`.
- **WORKING BOM** (№43–46): отдельные документы, показывают состояние из `POSITION_STATE`, только отметка получения по правам.
- **СНАБЖЕНИЕ** (№68–71): агрегация по `materialCode` (fallback `name+model+unit`).

### Этап 6 — Production Handoff (единая функция)
- `markReceivedByProduction(positionId, sourceUI)`:
  - Lock → права → чтение актуального `POSITION_STATE` → валидация → проверка `availableForProduction ≥ requiredQty` → проверка `!receivedByProduction` → фиксация → запись `receivedByProductionQty/At/User` → архив → удаление из активных представлений → обновление Working BOM → Dashboard → аудит → unlock.
  - **Идемпотентно** (№27, №96). Возврат: `RETURN_FROM_ARCHIVE` (№78–82), права + причина + аудит.

### Этап 7 — Проекции (incremental)
- `DEFICIT_SUMMARY`, `ОТБОРКА`, `WORKING BOM`, `DASHBOARD`, `СНАБЖЕНИЕ` перестраиваются из `POSITION_STATE`.
- Обновлять **только затронутые** проекции (№157–158), не полный sync на каждую операцию.

### Этап 8 — Dashboard
- Колонки №47: BOM, Статус/прогресс, Позиций, Позиций собрано, Даты, Выполнено.
- `progress = collectedPositions / totalPositions × 100`.
- «Готов к производству» только если `collectedPositions === totalValidPositions` (№52).
- «Выполнено» — единственное редактируемое, проверка `status === READY_FOR_PRODUCTION`, пишет в `BOM_REGISTRY.completedFlag` (№53, №116).

### Этап 9 — RBAC (№114–117)
- Роли: `ADMIN`, `ECONOMIST`, `PROCUREMENT`, `WAREHOUSE`, `PRODUCTION`, `VIEWER`.
- Каждая критическая серверная функция сама проверяет права (№115).

### Этап 10 — Аудит
- `AUDIT_LOG` с `operationId`, полями из №109–113. `operationId` группирует связанные изменения (№195).

### Этап 11 — Файловая структура (№131)
- Переименовать/сгруппировать в: `01_Config.gs … 27_Debug_Test_Engine.gs` — после аудита текущего проекта, не ломая clasp-путь (корень `rootDir`).

### Этап 12 — Производительность (№91–94, №157–159)
- `read → Maps → calculate in-memory → batch setValues`. Батчи `getValues/setValues`, запрет `getRange().setValue()` в циклах.
- `dirty BOM` (№98): часовой триггер пересчитывает только dirty; Dashboard открытие → только dirty BOM (№99).
- Целевые: Dashboard < 1 с, изменение заказа/даты/поставки/передача < 2 с, пересчёт BOM < 3 с, полный sync < 30 с (№92). Достижимо за счёт `POSITION_STATE` (не пересчитывать всё из нескольких таблиц при каждом открытии) и incremental-обновления проекций.

---

## 7. Тестирование (ТЗ №120–128)

Обязательные тесты (минимум): нулевой дефицит; материал на складе без резервирования; `RESERVE_CHANGED`; частичный/полный резерв; заказ; частичная/полная поставка; частичная/полная доступность; передача из ОТБОРКИ и из Working BOM; синхронизация двух интерфейсов (№127 — 1 handoff, 1 архив); повторная передача; архив; возврат и восстановление `DEFICIT_SUMMARY`/`ОТБОРКИ`; увеличение/уменьшение потребности; изменение срока; замена материала; добавление/удаление позиции; конфликт активного заказа; изменение полученной позиции; ревизия; ChangeSet; физическое несоответствие резерва и склада (№126). Добавить в `runV11Debug()` консистентность `BOM↔POSITION_STATE↔DEFICIT↔ОТБОРКА↔Working BOM↔Dashboard↔Archive` (№160–161).

---

## 8. Итоговая таблица соответствия (выборочно)

| Пункт ТЗ | Требование | Статус |
|---|---|---|
| 2 | SOURCE ≠ STATE ≠ VIEW | ❌ |
| 12 | POSITION_STATE | ❌ |
| 15–23 | 8 количеств + readyForHandoff | ⚠️ только deficitQty |
| 25/27 | markReceivedByProduction, идемпотентность | ❌ |
| 28–31 | MATERIAL_STATE физический + контроль | ❌ |
| 33/39/44/47 | DEFICIT / ОТБОРКА / WORKING BOM / DASHBOARD | ❌ (кроме текущего DASHBOARD, но неверной структуры) |
| 54 | BOM_REGISTRY | ❌ |
| 68–71 | СНАБЖЕНИЕ | ❌ |
| 78–82 | RETURN_FROM_ARCHIVE | ❌ |
| 114–117 | RBAC | ⚠️ частично, роли другие |
| 136/204 | Не менять источник | ❌ (exportBOMFile пишет в источник) |
| 157–159 | Incremental update | ❌ |

---

## 9. Риски и рекомендации

- **Риск**: сохранить legacy-логику одновременно с новой — конфликт источников. Рекомендуется **поэтапный переход**, где legacy-функции становятся wrapper'ами поверх новой архитектуры (№134) и не считаются источником истины.
- **Риск**: `exportBOMFile` продолжит перезаписывать исходные BOM. Рекомендуется **сразу отключить** обратную запись в источник и перенаправить в Рабочий BOM.
- **Риск**: `generateMaterialId` версионный. Рекомендуется ввести `positionId` со стабильным ключом и миграцией текущих ID.
- **Рекомендация**: начать с Этапа 1–3 (источник → POSITION_STATE → единый расчёт), затем интерфейсы. Производительность (Этап 12) заложить сразу через `POSITION_STATE` + dirty-флаги, чтобы не пересчитывать всё на каждую операцию.

---
