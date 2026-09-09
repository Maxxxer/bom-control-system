# BOM CONTROL SYSTEM V12 — Анализ производительности и сценарий ускорения

(Отчёт сохранён в `project_info__10.md`.)

## 1. Резюме

Главная проблема — **нелинейная деградация на «мелких» операциях**. Каждое действие (заказ, дата, поставка, передача, возврат, «Выполнено») запускает **полную пересборку всех 5 проекций** и **повторное чтение всех исходных листов с нуля**. При росте количества позиций время операции растёт линейно от объёма, а суммарная работа при чередовании операций — **квадратично** (N операций × N строк).

### Ключевые цифры (подтверждены по коду)
- `v12RefreshProjections()` / `v12RefreshAllProjections()` вызываются после **каждой** операции: `v12SetOrderedQty`, `v12SetExpectedDate`, `v12SetRealDeliveryQty`, `v12MarkReceivedByProduction`, `v12ReturnFromArchive`, `v12HandleMaterialStateEdit`, `v12SetBomDone` (9 точек).
- Один такой вызов пересобирает 5 проекций. Каждая из них делает `v12ReadSheet("POSITION_STATE")` → **полное чтение 30-колоночного листа**, `clearBody` (очистка всего тела), `writeRows` (запись всех строк).
- Итого на **одну операцию**: **5 полных чтений POSITION_STATE**, 5 очисток, 5 записей, 3×`clearDataValidations`+`setDataValidation` (чекбоксы), 1×`setConditionalFormatRules` (дашборд — дорого), 1×`setNotes`.
- Для N=40 000 позиций одна операция ≈ 5×(40 000×30) = **6 млн ячеек чтения** + ~6 млн записи + форматирование → **секунды**, и это растёт линейно с N.

## 2. Горячие точки (по убыванию эффекта)

### Г1. Полный пересчёт всех 5 проекций на каждую операцию — O(N²)
- `v12RefreshDeficitSummary/Picking/WorkingBOM/Supply/Dashboard` на каждый вызов: читают весь POSITION_STATE, очищают весь лист, пишут все строки.
- Дашборд дополнительно читает `BOM_REVISION` и `EXCLUDED_BOMS`, ставит `setConditionalFormatRules` и `setNotes`.
- **Решение**: инкрементальное обновление — точечно по `positionId`/`bomId`; форматирование ставить один раз при `v12Install`.

### Г2. Повторное чтение одних и тех же листов внутри одной операции
- `v12MarkReceivedByProduction`: строит `v12BuildPositionIndex` (полное чтение POSITION_STATE) → `v12GetPositionById` → `v12AdjustWarehouseQty` → `v12BuildMaterialIndex` (полное чтение MATERIAL_STATE) → `v12RefreshProjections` (ещё 5 чтений POSITION_STATE).
- `v12SetRealDeliveryQty` через `v12GetWarehouseQty(materialKey)` и `v12AdjustWarehouseQty` дважды строит индекс MATERIAL_STATE.
- **Решение**: читать каждый лист **один раз за операцию** (snapshot) и передавать общий `Map` во все функции.

### Г3. Пересоздание индексов в циклах
- `v12BuildMaterialIndex` / `v12BuildPositionIndex` / `v12BuildBomRegistryIndex` при каждом вызове читают лист целиком → O(N) чтений, если звать в цикле.
- **Решение**: строить индексы один раз на операцию и передавать по цепочке.

### Г4. Полная синхронизация читает ВСЕ BOM-файлы каждый раз
- `v12RunFullSync` → `v12ListSourceBOMFiles()` (обход Drive) → для каждого файла `getDataRange().getValues()` — даже если хеш не изменился.
- **Решение**: сверять `LAST_HASH` из `BOM_REGISTRY` до полного чтения; пропускать неизменённые; для CSV — по `lastUpdated`.

### Г5. Повторная установка чекбоксов и форматирования на каждом рефреше
- `v12InstallDeficitCheckboxes/Picking/Dashboard` вызываются при каждом обновлении (`clearDataValidations`+`setDataValidation`).
- `v12ApplyDashboardColors` пересоздаёт правила условного форматирования каждый раз.
- **Решение**: кэшировать структуру (rowCount/lastRow); не трогать валидации и правила, если структура не изменилась.

## 3. СЦЕНАРИЙ УСКОРЕНИЯ (поэтапный, с оценкой эффекта)

| Этап | Что делаем | Ожидаемый эффект |
|---|---|---|
| **1. Инкрементальные проекции** | Заменить `v12RefreshProjections()` на точечные `v12UpdateDeficitRow(positionId)`, `v12UpdatePickingRow(positionId)`, `v12UpdateWorkingBomRow(positionId)`, `v12UpdateSupplyMaterial(key)`, `v12UpdateDashboardBom(bomId)` | **×5–×20** (убирает O(N²)) — главный выигрыш |
| **2. Operation-context snapshot** | `v12BuildOperationContext()` — за один `readSheetValues` читает POSITION_STATE, MATERIAL_STATE, BOM_REGISTRY, BOM_REVISION, EXCLUDED_BOMS; все функции принимают `ctx` | **×2–×4** |
| **3. Переиспользование индексов** | Строить индексы один раз на операцию, не пересоздавать в циклах | **×2–×3** |
| **4. Ленивое форматирование** | `setConditionalFormatRules`, `setNotes`, `setDataValidation` — только при изменении структуры (хранить `V12_LAST_PROJECTION_SHAPE` в PropertiesService) | **×2–×5** на дашборде |
| **5. Умный full sync** | Перед чтением файла сравнивать `LAST_HASH`/`lastUpdated` с содержимым; неизменённые не читать | **×3–×10** |
| **6. Dirty-BOM для триггера** | `v12ScheduledUpdate` — обновлять только `dirty` BOM (по `BOM_REGISTRY.DIRTY`, ТЗ №98–99) | Ускоряет часовой триггер |

## 4. Целевые показатели (ТЗ №92)

| Сценарий | Сейчас (оценка, N=40k) | После этапов 1–4 | ТЗ №92 |
|---|---|---|---|
| Открытие Dashboard | несколько секунд | <1 с | <1 с |
| Заказ/дата/поставка/передача | секунды | <0.5 с | <2 с |
| Перерасчёт одного BOM | секунды | <1 с | <3 с |
| Полный sync | минуты | <30 с | <30 с |

## 5. Приоритет внедрения
1. **Этап 1** — инкрементальные проекции (критично: без него приложение деградирует с ростом числа позиций).
2. **Этап 2** — operation-context snapshot (убирает дублирующие чтения).
3. **Этап 5** — skip по хешу в full sync + dirty-флаги (убирает лишние чтения Drive/BOM).
4. **Этап 4** — ленивое форматирование (убирает дорогие `setConditionalFormatRules`/`setNotes`).
5. **Этап 3** — переиспользование индексов.

> Рекомендация: начинать с **Этапа 1** — он снимает главное узкое место. Этапы 2–5 дают дополнительное ускорение и позволяют уложиться в тайминги ТЗ №92.