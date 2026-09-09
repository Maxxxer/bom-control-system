Отчёт сохранён в `project_info__7.md`. Ниже — аудит соответствия обновлённому ТЗ и план корректировок.

---

# BOM CONTROL SYSTEM V11 — аудит соответствия обновлённому ТЗ

## Резюме
Текущий код построен по модели «единая мастер-таблица MATERIAL_STATE»: данные BOM, операционные данные и физическое состояние склада смешаны в одной строке из 21 колонки. Обновлённое ТЗ требует архитектуры **SOURCE ≠ STATE ≠ VIEW**:
- `ORIGINAL BOM` — единственный источник потребности и резервирования;
- `POSITION_STATE` — центральное операционное состояние позиции;
- `MATERIAL_STATE` — только физическое состояние склада (`warehouseQty`);
- `DEFICIT_SUMMARY`, `ОТБОРКА`, `WORKING BOM`, `DASHBOARD`, `СНАБЖЕНИЕ` — проекции/представления.

**Общая оценка соответствия: ~15–20%.** Формула дефицита `max(0, required − reserved)` уже верна, есть части импорта/архива/Dashboard. Но отсутствует большинство сущностей и операций ТЗ, и есть прямые нарушения.

## Факты (поиск по коду)
Поиск по `positionId`, `POSITION_STATE`, `ОТБОРКА`, `Снабжение`, `BOM_REGISTRY`, `realDeliveryQty`, `availableForProduction`, `warehouseQty`, `markReceivedByProduction`, `RESERVE_CHANGED`, `RETURN_FROM_ARCHIVE`, `PRODUCTION_HANDOFF`, `Модель`, `sourceRevision`, `overOrderedQty`, `shortDeliveryQty`, `uncoveredNeed`, `freeQty`, `PURCHASE`, `handoff`, `changeSet`, `materialKey` → **0 результатов**. Все конструкции отсутствуют.

## Критические нарушения
1. **`exportBOMFile()` пишет обратно в исходные BOM-файлы** (Зарезервировано/Заказано/Ожидаемая/Реальная/Статус + цвета). ТЗ №3.1 и №136 запрещают автоматически менять источник. Запись должна идти в **Рабочий BOM**, а не в исходник.
2. **`RECEIVED` — логический флаг, а не количественная операция.** Нет `realDeliveryQty` (частичные поставки), `availableForProduction`, проверки полной доступности и **запрета частичной передачи** (№24, №106). Сейчас чекбокс → архив, без проверки полноты.
3. **`REAL_DELIVERY` — флаг, а не количество.** Нет `shortDeliveryQty`, `overOrderedQty`, `uncoveredNeed` — из 8 канонических количеств (№14) реализован только `deficitQty`.
4. **`generateMaterialId(bom, version, row)` — нестабильный ID** (зависит от версии). ТЗ №10, №150 требуют стабильный `positionId`, № позиции нельзя использовать как primary key.
5. **Нет идемпотентного `markReceivedByProduction(positionId, sourceUI)`** — нет защиты от двойного клика (№96), нет единой операции для ОТБОРКИ и Working BOM (№25–27).
6. **`saveDeficitChanges()` остаётся источником операционных правок** — ТЗ №34 требует заменить его специализированными обработчиками (№134).
7. **Нет физического контроля склада** — `warehouseQty` отсутствует, нет `RESERVATION_PHYSICAL_INCONSISTENCY` (№30).
8. **Валидация не соответствует №8.** Сейчас обязательны: №позиции, Код, Ед.изм, Qty>0, Срок. По ТЗ: №позиции, Наименование, **Модель**, Ед.изм, Требуемое количество, **Зарезервировано**, Срок. `Код` **не обязателен** (сейчас его отсутствие = «Ошибка данных»). Колонки `Модель` нет.

## Отсутствующие сущности
`POSITION_STATE` ❌ · `ОТБОРКА` ❌ · `WORKING BOM` ❌ · `СНАБЖЕНИЕ` ❌ · `BOM_REGISTRY` ❌ · `PURCHASE_BATCH/ALLOCATION` ❌ · `PRODUCTION_HANDOFF` ❌ · `AUDIT_LOG` с operationId ⚠️ · `MATERIAL_STATE` физический ⚠️ (другая модель).

## Несоответствия расчётов
| Показатель | Формула ТЗ | Сейчас |
|---|---|---|
| `deficitQty` | `max(0, required−reserved)` | ✅ |
| `uncoveredNeed` | `max(0, deficit−ordered)` | ❌ |
| `overOrderedQty` | `max(0, ordered−deficit)` | ❌ |
| `shortDeliveryQty` | `max(0, ordered−realDeliveryQty)` | ❌ |
| `availableForProduction` | `reservedQty + realDeliveryQty` | ❌ |
| `readyForHandoff` | `available≥required && VALID && ACTIVE && !received` | ❌ |
| supplyState / productionState / flags | №85–87 | ❌ другая модель |

## План корректировок (этапы)
- **Этап 0** — baseline, legacy-функции как wrapper (№134), новые поля/статусы/флаги в конфиг.
- **Этап 1** — `BOM_REGISTRY` + `readSourceBOM()` (только чтение), `POSITION_STATE`, наполнение из BOM, `reservedQty` только из BOM, стабильный `positionId`.
- **Этап 2** — Change Engine: `detectBOMChanges` → `ChangeSet` → `applySourceRevision`; события `QUANTITY_CHANGED`, `RESERVE_CHANGED`, `DEADLINE_CHANGED`, `MATERIAL_CHANGED`, `MATERIAL_REPLACED`, `POSITION_ADDED`, `POSITION_DELETED`.
- **Этап 3** — единый движок `calculatePositionState(source, operational)`: все 8 количеств + состояния + флаги; заменить `computeMaterialStatus`.
- **Этап 4** — `MATERIAL_STATE` физический: `warehouseQty`, контроль `Σ BOM.reservedQty ≤ warehouseQty` → `RESERVATION_PHYSICAL_INCONSISTENCY` (не менять BOM).
- **Этап 5** — интерфейсы: `ОТБОРКА`, `WORKING BOM`, `СНАБЖЕНИЕ`.
- **Этап 6** — единая идемпотентная `markReceivedByProduction(positionId, sourceUI)` + `RETURN_FROM_ARCHIVE` (права + причина + аудит).
- **Этап 7** — проекции из `POSITION_STATE`, обновляются только затронутые (incremental, №157–158).
- **Этап 8** — Dashboard: BOM, Статус/прогресс, Позиций, Позиций собрано, Даты, Выполнено; `progress = collected/total×100`; «Готов к производству» только при `collected === total`; `Выполнено` → `BOM_REGISTRY.completedFlag`.
- **Этап 9** — RBAC: `ADMIN, ECONOMIST, PROCUREMENT, WAREHOUSE, PRODUCTION, VIEWER`; каждая критическая функция сама проверяет права.
- **Этап 10** — `AUDIT_LOG` с `operationId`, старым/новым значением, BOM, positionId.
- **Этап 11** — группировка файлов под `01_Config.gs … 27_Debug_Test_Engine.gs`.
- **Этап 12** — производительность: `read → Maps → in-memory → batch setValues`; `dirty BOM`; тайминги из №92.

## Тестирование (№120–128)
Нужны тесты: нулевой дефицит; склад без резервирования; `RESERVE_CHANGED`; частичный/полный резерв; заказ; частичная/полная поставка; частичная/полная доступность; передача из ОТБОРКИ и Working BOM; **синхронизация двух интерфейсов (№127 — 1 handoff, 1 архив)**; повторная передача; архив; возврат; увеличение/уменьшение потребности; изменение срока; замена материала; добавление/удаление позиции; физическое несоответствие (№126). В `runV11Debug()` — консистентность `BOM↔POSITION_STATE↔DEFICIT↔ОТБОРКА↔Working BOM↔Dashboard↔Archive` (№160–161).

## Риски и рекомендации
- **Сразу отключить** обратную запись `exportBOMFile` в источник — перенаправить в Рабочий BOM.
- Ввести `positionId` со стабильным ключом и миграцией текущих `bom|version|row` ID.
- Начать с Этапов 1–3 (источник → POSITION_STATE → единый расчёт), затем интерфейсы. Производительность заложить сразу через `POSITION_STATE` + dirty-флаги.

---

Это **анализ и план** — я в **Explore Mode**, поэтому не вносил изменений в код. Для реализации переключитесь в **Act Mode**; план и находки перенесутся как контекст. Первый приоритет — отключить перезапись исходных BOM (`exportBOMFile`) и ввести `POSITION_STATE` с `positionId`, так как это фундамент всей новой архитектуры.