# BOM CONTROL SYSTEM V11 — анализ производительности

Я закончил аудит кодовой базы. Ниже — полный отчёт. Он уже сохранён в `project_info__5.md`. Важно: я нахожусь в **Explore Mode**, поэтому **не могу вносить изменения** — только исследовать и документировать. Для реализации оптимизаций переключитесь в **Act Mode** (селектор режима внизу чата); мои находки перенесутся как контекст.

---

## 🎯 Проблема в цифрах

Ваша цель: **1000 строк сводки дефицитов**, **до 200 BOM-файлов** × **до 200 позиций** ≈ **40 000 строк MATERIAL_STATE** (лимит в конфиге — 10 000, но реальная нагрузка может быть выше). Это Google Apps Script (V8) с жёсткими ограничениями:

| Ограничение | Значение |
|---|---|
| Время выполнения простого триггера | **~6 минут** |
| Время installable-триггера | 30 мин |
| Вызовы SpreadsheetApp | **20 000/сутки** |
| Чтение ячейки через getRange().getValues() | ~один «тяжёлый» вызов на диапазон |

Текущая архитектура при 40k строк **гарантированно вылетает** и в лимиты времени, и в лимиты вызовов.

## 🔥 Главные «тормоза» (ранжировано)

### 1. КРИТИЧНО — перечитание всего `MATERIAL_STATE` на каждый материал при импорте
В `import_engine.js` → `importBOM()`:
```js
const exists = findMaterialInBOM(bomName, material.row); // без индекса!
if (!exists) addMaterialFromBOM({...});                 // внутри getMaterialById без индекса
else compareMaterialChange(exists, material);           // updateMaterialState + recalc тоже без индекса
```
`findMaterialInBOM` без второго аргумента строит индекс заново → **полная перечитка листа** (40k × 21). На **одном** BOM-файле (200 позиций) это ~**400–1000 полных чтений**. На **200 файлах** — **десятки/сотни тысяч полных чтений**. Это O(n²). Самый большой убийца производительности.

### 2. КРИТИЧНО — `exportBOMFile()` пишет по ячейке
```js
if (idx.reserved !== -1) sheet.getRange(i+1, idx.reserved+1).setValue(...);
if (idx.ordered !== -1)  sheet.getRange(i+1, idx.ordered+1).setValue(...);
// ... до 6 setValue на строку
```
200 файлов × 200 строк × до 6 колонок = **до 240 000 вызовов** за один экспорт. А `exportBOMMaterialsToDrive()` вызывается в `v11ScheduledUpdate()` **каждый час** → суточная квота 20 000 вызовов исчерпывается мгновенно.

### 3. КРИТИЧНО — `refreshAfterChange()` запускает ПОЛНУЮ цепочку на каждый onEdit
Любое действие пользователя (чекбокс, изменение заказа/даты) в `v11OnEdit` вызывает:
`saveDeficitChanges → recalculateMaterials → recalculateBOMState → updateDeficitSummary → updateDashboard → applyStatusColors`
Это **5–7 полных обходов всей таблицы** ради изменения ОДНОЙ ячейки. При 40k строк — неприемлемо.

### 4. ВЫСОКО — `archiveMaterial()` читает всю историю каждый раз
Для каждого архивируемого материала вызывается `getMaterialHistory(materialId)` → **полная перечитка `MATERIAL_HISTORY`** (до 50k строк) с фильтрацией. При массовой архивации 1000 позиций — 1000 полных чтений 50k строк.

### 5. ВЫСОКО — `updateDashboard()`: per-BOM чтение + per-row setNote
- `isBOMDone(bom)` читает весь `EXCLUDED_BOMS` **для каждой** из 200 BOM → 200 полных чтений.
- `setNote()` — отдельный вызов **на каждую** строку.
- `autoResizeColumns()` — одна из самых медленных операций SpreadsheetApp.

### 6. СРЕДНЕ — `logSystem()`: appendRow на каждый вызов
Логгер пишет `sheet.appendRow()` **на каждый** вызов. В `syncAllBOM`/`refreshAfterChange` — сотни лишних вызовов и неконтролируемый рост `SYSTEM_LOG`.

### 7. СРЕДНЕ — `MATERIAL_STATE` читается ~5 раз в одном `runFullUpdate`
`recalculateMaterials` → `archiveReceivedMaterials` → `updateDeficitSummary` → `recalculateBOMState` → `colorMaterialStateRows` — каждый **заново** читает один и тот же лист. При 40k строк это ~200k ячеек каждый раз.

## 🧩 Неочевидные причины (что вас удивит)

- **`_bomStateCache` — модульная переменная.** В GAS каждое меню/триггер — новый контекст, кэш не переживает вызовов. `updateDashboard`, вызванный отдельно, заново запускает `recalculateBOMState()`. Скрытый источник двойного пересчёта.
- **`recalculateMaterials()` пишет `UPDATED` для ВСЕХ строк**, даже если ничего не изменилось → «мигание» дат и запись 40k ненужных ячеек.
- **`saveDeficitChanges()` + `updateDeficitSummary()`** — двойная запись с риском потери ручного ввода между шагами.
- **`batchWrite()` уже хороший** (группирует по строкам в непрерывные диапазоны), но он **не используется** в горячих путях (`exportBOMFile`, `isBOMDone/setBOMDone`).
- **`createDeliveryCheckboxes()`** чистит и пересоздаёт валидации на **все** строки до `lastRow`, даже пустые.

## ✅ Рекомендуемый план оптимизации (для Act Mode)

1. **Единый контекст/кэш на операцию** — построить `{ materialIndex, bomCache, excludedMap, ... }` **один раз** в начале `runFullUpdate`/`syncAllBOM` и передавать во все движки. Убрать все `buildMaterialIndex()` внутри циклов.
2. **Переписать `importBOM`** — индекс один раз на весь `syncAllBOM`; `getMaterialById(id, index)` / `findMaterialInBOM(bom, row, index)` с переданным индексом; накапливать записи и писать батчем.
3. **Батчевый экспорт** — вместо 6 `setValue()` на строку → собирать колонки и писать `setValues()` **одной операцией на файл**.
4. **Точечный onEdit** — вместо полного `refreshAfterChange()` пересчитывать только затронутый BOM, либо дебаунсить полный пересчёт.
5. **Кэшировать `EXCLUDED_BOMS`** — читать один раз, передавать как `Map<bom, done>`.
6. **Батчевая история/события** — накапливать строки и писать одним `writeValues()`, а не N `appendRow()`.
7. **Читать `MATERIAL_STATE` один раз** в `runFullUpdate` и передавать данные в `recalculateMaterials`/`updateDeficitSummary`/`recalculateBOMState`/`archiveReceivedMaterials`.
8. **Убрать/упростить `autoResizeColumns` и `setNote`** — ноты только для строк с `missingItems`, реже.
9. **Буферизовать `logSystem`** — писать батчем в конце операции или отключать INFO на время массовых операций.
10. **`recalculateMaterials`** — не трогать `UPDATED` для строк без реальных изменений.

## 📖 Порядок чтения для старта оптимизации

1. `import_engine.js` + `bom_engine.js` — самый горячий путь
2. `material_service.js` — индекс/CRUD, куда добавить кэш
3. `trigger_engine.js` — где `refreshAfterChange`
4. `export_engine.js` — главный источник превышения квот
5. `dashboard_engine.js` / `archive_engine.js` — per-BOM / per-material чтения
6. `status_engine.js` / `deficit_engine.js` / `bom_state_engine.js` — дублирующиеся чтения

---

**Итог:** код логически корректен, но оптимизирован под малые объёмы. Для заявленных 200 BOM × 200 позиций он не пройдёт ни по времени, ни по квоте. Расстановка приоритетов: сначала — индекс и импорт (пункт 1–2), затем экспорт (пункт 3), затем onEdit (пункт 4). Это закроет 90% проблем с производительностью.

Чтобы внести изменения, переключитесь в **Act Mode** — я передам все находки как контекст.