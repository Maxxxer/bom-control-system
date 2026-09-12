# BOM CONTROL SYSTEM V12 — Почему в ОТБОРКЕ не все позиции «На складе» уходят после «ПРИМЕНИТЬ»

> **Режим:** Explore (только чтение). Задача: разобраться, почему при массовой отметке «Отметка получено» и нажатии «ПРИМЕНИТЬ» часть позиций со статусом **«На складе»** остаётся в листе, а их чекбоксы «сбрасываются».
> **Вывод (кратко):** «сброс чекбокса» — это **штатное поведение** (проекция всегда перезаписывает колонку чекбокса в `false`). Остаются только те строки, чьё намерение передачи **не было применено** — либо намерение не зафиксировано в очереди, либо `v12MarkReceivedByProduction` его **отклонил гейтом** (и тогда причина видна в `PENDING_EDITS.ERROR`), либо интент по `Position ID` разрешился **не в ту физическую строку** `POSITION_STATE` (дубликат/пустой `Position ID`).

---

## 1. Как вообще работает «Применить» (модель V3)

Отметка чекбокса и применение — это **два разных шага**, разнесённых по времени:

1. **Клик по чекбоксу** → `onEdit` → `v12CaptureCheckboxEdit(e, "ОТБОРКА")` (`v12_queue.js`).
   Функция **ничего не пересчитывает** — она лишь **фиксирует намерение** строкой в листе `PENDING_EDITS` (`PENDING_STATUS.PENDING`, поле `HANDOFF`, `VALUE = true`). Никакой передачи ещё не произошло.
2. **Кнопка «ПРИМЕНИТЬ»** (картинка, `v12ApplyChangesUI` → `v12ApplyChanges` → `v12DrainPendingEdits`, `v12_queue.js`) — читает очередь, схлопывает намерения по правилу **last-wins** по ключу `SOURCE|POSITION_ID|FIELD`, применяет их пакетно и **один раз** пересобирает все проекции (`v12RefreshProjections`).

Внутри применения для поля `HANDOFF` вызывается `v12ApplyPendingIntent` → `v12MarkReceivedByProduction(pid, "PICKING", true, ctx)` (`v12_handoff.js`).

---

## 2. Почему чекбокс «сбрасывается» — это НЕ баг пересборки

`v12RefreshPicking` (`v12_projections.js`) при каждой пересборке строит строку из `POSITION_STATE` и **жёстко пишет в колонку чекбокса (12) значение `false`**:

```js
row: [ ..., v12PickingDeliveryDate(...), false /* CHECKBOX */ ]
...
v12ClearBody("PICKING");
v12WriteRows("PICKING", 2, rows);   // все чекбоксы = false
v12InstallPickingCheckboxes(rows.length); // заново навешивает checkbox-валидацию
```

То есть после каждого «Применить»/полной синхронизации **все** чекбоксы в ОТБОРКЕ обнуляются, а лист пересобирается из `POSITION_STATE`. Строки, которые **успешно** переданы, из листа исчезают (в `v12RefreshPicking` фильтр: `lc !== ACTIVE` → `continue` и `v12IsChecked(RECEIVED_BY_PRODUCTION)` → `continue`). Строки, которые **не** переданы, возвращаются в лист — уже с пустым чекбоксом и тем же статусом «На складе».

**Вывод №1:** «чекбокс сбрасывается и позиция остаётся» = «намерение передачи для этой строки не привело к архивации». Это симптом, а не причина.

---

## 3. Строгий гейт передачи (`v12_handoff.js`, `v12MarkReceivedByProduction`)

Передача выполняется, только если выполнены **все** условия. Иначе возвращается `status:"blocked"` с причиной, а намерение помечается `FAILED` c текстом в колонке `PENDING_EDITS.ERROR`:

```js
const required  = toNumber(row[P.REQUIRED_QTY - 1]);
const available = toNumber(row[P.AVAILABLE_FOR_PRODUCTION - 1]);
const received  = row[P.RECEIVED_BY_PRODUCTION - 1] === true;
const validation = row[P.VALIDATION_STATUS - 1];

if (received && RECEIVED_BY_PRODUCTION_QTY >= required)
  return { status: "already" };                                   // НЕ ошибка

if (validation !== V12_CONFIG.VALIDATION_STATUS.VALID)             // «Позиция невалидна…»
  return { status: "blocked", ... };

if (available < required)                                          // «Не хватает доступного количества…»
  return { status: "blocked", ... };
```

Плюс отдельно: `if (!pos) return { status:"blocked", reason:"Позиция не найдена" }`.

---

## 4. Ключевой логический вывод

«На складе» — это отображение `PRODUCTION_STATE === READY_FOR_HANDOFF`
(`v12ProductionStatusDisplay` в `v12_projections.js`).

А `READY_FOR_HANDOFF` в расчётном движке (`v12_calculate.js`) выставляется **ровно теми же условиями**, что проверяет гейт:

```js
productionState = received            ? RECEIVED
                : required <= 0       ? NOT_AVAILABLE
                : availableForProduction >= required
                    ? (validation.valid ? READY_FOR_HANDOFF : PARTIALLY_AVAILABLE)
                    : availableForProduction > 0 ? PARTIALLY_AVAILABLE : NOT_AVAILABLE;
```

То есть `READY_FOR_HANDOFF` ⟺ `valid === true` **и** `availableForProduction >= required`.
А колонки `VALIDATION_STATUS`, `PRODUCTION_STATE`, `AVAILABLE_FOR_PRODUCTION` в `POSITION_STATE` **всегда записываются вместе** одной функцией `v12ApplyComputedToRow` (`v12_position_state.js`).

**Из этого следует:**
> Если строка в `POSITION_STATE` действительно «На складе» (`READY_FOR_HANDOFF`), то оба первых гейта (`validation` и `available < required`) она пройти **обязана**. Значит, «застрять» она может только если:
> **(A)** её намерение вообще не попало в очередь (не зафиксировано при клике), **или**
> **(B)** интент был зафиксирован, но разрешился **в другую физическую строку** `POSITION_STATE` (дубликат `Position ID`) → передалась «невидимая» строка-дубликат, а видимая осталась, **или**
> **(C)** причина отклонения видна в `PENDING_EDITS.ERROR` (частный случай B: «Позиция не найдена»).

Отдельно: пересборка проекции всегда показывает строки **из `POSITION_STATE`** с теми же колонками, которые читает гейт. Поэтому строка **не может** одновременно показывать «На складе» в пересобранном листе и отклоняться гейтом «невалидна/не хватает количества» — если только её производные колонки не рассогласованы (устаревшие данные, см. §6.4).

---

## 5. Механизм (B): дубликат `Position ID` — самая вероятная системная причина

`v12BuildPositionIndex` (`v12_sheet_service.js`) строит `Map<positionId, {row, values}>`:

```js
index.set(id, { row: i + 1, values: rows[i] });
```

Если в `POSITION_STATE` есть **две строки с одинаковым `Position ID`**, в индексе остаётся **только последняя** (`Map.set` перезаписывает). Что происходит при «Применить»:

1. Гейт вызывает `v12GetPositionById(pid, index)` → всегда попадает в **последнюю** строку с этим id.
2. Первое применение **архивирует именно её** (`v12ArchivePosition`: `RECEIVED_BY_PRODUCTION=true`, `LIFECYCLE_STATE=ARCHIVED`) → из ОТБОРКИ уходит **одна** из двух.
3. Видимая «первая» строка-дубликат остаётся `ACTIVE` и `READY_FOR_HANDOFF` → **остаётся в листе со статусом «На складе»** и сброшенным чекбоксом.
4. Любое **повторное** применение по этому же `pid` снова попадает в уже архивированную строку → `{status:"already"}` (не `blocked`) → счётчик «применено» растёт, но **видимая строка так и не уходит никогда**.

Это в точности совпадает с симптомом: «не все уходят, некоторые сбрасывают чекбокс и остаются со статусом „На складе“, повтор не помогает».

**Косвенное подтверждение, что дубликаты реальны и о них знали:**
- `v12ConsistencyCheck` (`v12_controller.js`) прямо ищет дубликаты:
  ```js
  if (report.positionIds.size !== nonEmptyIdCount)
    report.errors.push("Обнаружены дубликаты positionId");
  ```
- В отчёте `project_info__9.md` отмечено: при одинаковом `materialKey` в одном BOM суффикс `#2/#3` «назначается по порядку обхода — может „плыть“».

**Как возникают дубликаты строк (два реальных пути в коде):**

- **Путь 1 — двойной проход по одному BOM за одну синхронизацию.** `v12RunFullSync` (`v12_trigger.js`) строит `positionsByBom` **один раз** до цикла:
  ```js
  const positionsByBom = v12BuildPositionsByBomIndex(posData);
  ...
  files.forEach(file => { const source = v12ReadSourceBOM(file); v12SyncBOM(source, positionIndex, registryIndex, positionsByBom); });
  ```
  `v12SyncBOM` → `v12GetPositionsByBom(reg.bomId, idx, positionsByBom)` **предпочитает `byBom`** (`v12_position_state.js`):
  ```js
  if (byBom) return byBom.get(v12Norm(bomId)) || new Map();
  ```
  А `v12PersistNewPositions` (`v12_position_state.js`) обновляет **только `positionIndex`**, но **НЕ `positionsByBom`**. Значит, если один и тот же `bomId` (одно и то же имя BOM — `v12UpsertSourceBOM` матчит реестр **по имени**) встречается в цикле дважды, второй проход получит **пустой/устаревший** `existing` → все материалы сочтутся новыми → `POSITION_ADDED` → те же `positionId` **допишутся ещё раз** → дубликаты.
  Такое возможно, если в папке Drive лежат **два файла с одинаковым именем BOM** (например, `.csv` и таблица с тем же базовым именем, или копия файла).
- **Путь 2 — «плавающий» суффикс `#n`.** При перестановке строк BOM (сортировка по `row` в `v12DetectBOMChanges`) суффиксы `#2/#3` у одинаковых `materialKey` могут «поехать», и один id на короткое время может не найти пары — но это скорее даёт churn, чем стабильный дубликат.

---

## 6. Прочие причины, которые тоже приводят к «осталась строка»

### 6.1 Намерение не зафиксировано (A / capture)
`v12CaptureCheckboxEdit` (`v12_queue.js`) пропускает строку, если:
- редактируемый диапазон не задевает колонку 12 (`col > column || lastCol < column → return false`); тогда `onEdit` для ОТБОРКИ уходит в ветку `v12RevertEdit(e)` — правка откатывается;
- в колонке A (`POSITION_ID`) пусто: `if (!positionId) continue;` → намерение не создаётся, строка никогда не уйдёт.

Если у позиции в `Position ID` пусто (или он не совпадает ни с одной строкой `POSITION_STATE`), чекбокс «не сработает» молча — строка останется.

### 6.2 last-wins «отмена»
`v12ResolvePendingIntents` (`v12_queue.js`) схлопывает по ключу `SOURCE|pid|FIELD` и берёт **последнее** значение. Для чекбоксных полей `value=false` означает **отмену** — в `v12DrainPendingEdits` такой интент пропускается:
```js
if (v12IsBooleanPendingField(it.field) && !it.value) return; // отмена — ничего не делаем
```
То есть если по строке после `true` появился `false` (сняли галочку / диапазонное переключение), передача не выполнится.

### 6.3 Гонка с часовым синком
`v12ScheduledUpdate` (раз в час, `v12_trigger.js`) выполняет `v12RunFullSync` → `v12RefreshAllProjections`, что **пересобирает ОТБОРКУ** и обнуляет все чекбоксы. Намерения при этом сохраняются (они в очереди), но визуально галочки «слетают». Если пользователь после этого отмечает заново не все строки — часть намерений окажется «cancel» либо отсутствует.

### 6.4 Устаревшие производные колонки `POSITION_STATE`
`v12RefreshPicking` **копирует** `PRODUCTION_STATE`/`AVAILABLE_FOR_PRODUCTION` из `POSITION_STATE` и **не пересчитывает** их. Если строку в `POSITION_STATE` правили/мигрировали так, что `VALIDATION_STATUS`/`AVAILABLE_FOR_PRODUCTION` не согласованы с `PRODUCTION_STATE` (легаси-данные, ручные правки в обход кода, сдвиг колонок при миграции схемы `v12MigratePositionSchema`), лист покажет «На складе», а гейт отклонит как «невалидна»/«не хватает количества». Признак: колонка «Доступно для производства» в ОТБОРКЕ < «Требуется», но статус «На складе».

### 6.5 Лок занят
`v12DrainPendingEdits` берёт лок неблокирующе:
```js
const lock = acquireScriptLock({ tryOnly: true, timeoutMs: 5000 });
if (!lock) { ... return { drained: 0, skipped: true }; }
```
Если в этот момент лок держит часовой синк или другое применение — сработает тост «Система занята — повторите через несколько секунд», и **ничего не применится**. Обычно это отсекает всю пачку, а не «часть», но стоит держать в виду.

---

## 7. Как подтвердить причину (диагностика)

1. **`PENDING_EDITS`** — колонки `Статус` и **`Ошибка`**: строки `FAILED` содержат точную причину (`Позиция не найдена` / `Позиция невалидна…` / `Не хватает доступного количества…`). Это прямой ответ.
2. **Тост после применения** (`v12ApplyChangesUI`): «Применено: X, не применено: Y (см. PENDING_EDITS, колонка «Ошибка»)».
3. **`SYSTEM_LOG`** — ошибки `v12MarkReceivedByProduction` (в т.ч. блоки по правам/исключения).
4. **Меню «🧩 Проверка консистентности»** (`v12ConsistencyCheck`): ошибка **«Обнаружены дубликаты positionId»** подтверждает §5.
5. **Ручная проверка дубликатов:** в `POSITION_STATE` найти строки с одинаковым `Position ID` (колонка 1) — если такие есть, симптом объяснён.
6. **Сверка колонок** у «застрявшей» строки: `Валидация`, `ProductionState`, `Доступно для производства` vs `Требуется` — если «На складе», но доступно < требуется, это §6.4.

---

## 8. Ключевые файлы и функции (карта причин)

| Файл / функция | Роль в проблеме |
|---|---|
| `v12_queue.js` → `v12CaptureCheckboxEdit` | Фиксация намерения; пропускает строки без `Position ID`, не задевающие колонку 12 |
| `v12_queue.js` → `v12ResolvePendingIntents` | last-wins; `VALUE=false` = отмена (передача не выполняется) |
| `v12_queue.js` → `v12DrainPendingEdits` | Пакетное применение; `tryOnly`-лок (скип), пересборка проекций один раз |
| `v12_handoff.js` → `v12MarkReceivedByProduction` | **Строгий гейт**: невалидна / не хватает доступного / не найдена |
| `v12_projections.js` → `v12RefreshPicking` | **Всегда пишет `false` в чекбокс**; фильтрует `ACTIVE` и `!received` |
| `v12_projections.js` → `v12ProductionStatusDisplay` | `READY_FOR_HANDOFF → «На складе»` |
| `v12_calculate.js` → `v12CalculatePositionState` | `READY_FOR_HANDOFF ⟺ valid && available≥required` (те же условия, что гейт) |
| `v12_sheet_service.js` → `v12BuildPositionIndex` | `Map.set` перезаписывает → при дубликатах `Position ID` остаётся последняя строка |
| `v12_controller.js` → `v12ConsistencyCheck` | Ищет дубликаты `positionId` |
| `v12_change_engine.js` / `v12_source.js` / `v12_trigger.js` | `v12RunFullSync`/`v12SyncBOM` — потенциальный источник дубликатов (см. §5, Путь 1) |

---

## 9. Итоговый ответ

- **Сброс чекбокса** — штатно: `v12RefreshPicking` всегда перезаписывает колонку 12 в `false`, а «Отметка получено» — это лишь триггер, состояние живёт в `PENDING_EDITS` и `POSITION_STATE`.
- **Позиция остаётся «На складе»**, потому что её передача **не применилась**. Так как «На складе» ⟺ `valid && available ≥ required` (ровно условия гейта), для по-настоящему готовой строки гейт пройти обязан — значит, намерение либо **не зафиксировано** (пустой `Position ID` / правка не по колонке 12), либо **разрешилось в другую физическую строку** `POSITION_STATE` — что бывает при **дубликате `Position ID`** (`v12BuildPositionIndex` оставляет только последнюю строку; повторное применение всегда бьёт в уже архивированную и возвращает `already`).
- **Точную причину** конкретной «застрявшей» строки всегда пишет система: колонка **`Ошибка`** в `PENDING_EDITS` + тост «не применено: N» + `SYSTEM_LOG`. Для системной проверки — меню **«Проверка консистентности»** (дубликаты `positionId`).

**Наиболее вероятный первопричинный дефект:** дубликаты строк `POSITION_STATE` с одинаковым `Position ID` (усиливается тем, что `v12PersistNewPositions` не обновляет `positionsByBom`, а `v12GetPositionsByBom` предпочитает устаревший `byBom`). Вторичные — пропуск намерения при пустом `Position ID`, отмена last-wins и устаревшие производные колонки.
