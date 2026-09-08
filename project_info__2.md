# BOM Control System V11 — Аудит производительности и план оптимизации

## Резюме

Типичное обновление занимает 5–10 секунд. Главные причины — **искусственные паузы**, **поячеечная запись в лист**, **повторные полные чтения листов в циклах** и **flush внутри циклов**.

## Главные «убийцы» скорости (по убыванию)

### 1. КРИТИЧЕСКО — `syncV11()`: 500 мс сна на каждый вызов (controller.js)
```javascript
function syncV11() {
  SpreadsheetApp.flush();
  Utilities.sleep(500);   // ← 500 мс просто ждёт
}
```
`runFullUpdate` вызывает `syncV11()` **8 раз** → **4 секунды чистого сна**. Это самая большая доля из 5–10 сек.

### 2. КРИТИЧЕСКО — `batchWrite`: одна ячейка = один вызов API (sheet_service.js)
```javascript
changes.forEach((c) => {
  sheet.getRange(c.row, c.col).setValue(c.value);  // 1 вызов на ячейку
});
```
На 1000 материалов при полном пересчёте это **4000 вызовов setValue**. Изначально использовался `RangeList.setValues`, но его нет в Apps Script — пришлось исправлять, но осталась самая медленная форма. Правильно — группировать по строкам и писать `setValues`.

### 3. ОЧЕНЬ ВЫСОКО — N+1 чтение листа (`getMaterialById` без индекса)
`getMaterialById(materialId)` без `index` вызывает `buildMaterialIndex()`, который читает **весь** MATERIAL_STATE. В циклах это квадратичная деградация:
- **`saveDeficitChanges`** — на каждое изменение: полное чтение (поиск) + полное чтение (запись) + flush.
- **`archiveReceivedMaterials`** — на каждый архив: 2 чтения MATERIAL_STATE + чтение MATERIAL_HISTORY + 2 appendRow + flush.
- **`recalculateMaterialStatus`** — полное чтение на каждый вызов.

### 4. ОЧЕНЬ ВЫСОКО — `flushSheets()` внутри цикла (deficit_engine.js, archive_engine.js)
```javascript
updateMaterialState(...);
flushSheets();   // <-- в цикле! ломает батчинг
addMaterialHistory(...);
```
`SpreadsheetApp.flush()` синхронизирует всё с сервером — вызывать его в цикле крайне вредно.

### 5. ВЫСОКО — `recalculateMaterials` вызывается ДВАЖДЫ в `runFullUpdate`
```javascript
recalculateMaterials(); ... archiveReceivedMaterials(); ... recalculateMaterials();  // дубль
```

### 6. ВЫСОКО — `updateDeficitSummary` переписывает весь лист + пересоздаёт чекбоксы даже при малых изменениях.

---

## Что делает `runFullUpdate` (подсчёт при M=1000 материалов)

1. `syncV11()` ×8 → 4 сек сна.
2. `recalculateMaterials()` ×2 → 2×(1 чтение + 4000 setValue).
3. `saveDeficitChanges()` → 1 чтение + на каждое изменение 2 чтения + flush + appendRow.
4. `archiveReceivedMaterials()` → 1 чтение + на каждый архив серия вызовов + flush.
5. `updateDeficitSummary()` → 1 чтение + clearBody + writeValues + чекбоксы.
6. `applyStatusColors()` → 3 чтения + 3 setBackgrounds.
7. `updateDashboard()` → 1 чтение + write + пересоздание правил и фильтра.

Итог — **тысячи** вызовов SpreadsheetApp, из которых 4 секунды — просто sleep.

---

## План оптимизации

> ⚠️ Это план. Для реализации переключитесь в **Act Mode** (кнопка ниже).

### Этап 1 — убрать сон (самый большой выигрыш, −4 сек)
- `controller.js`: убрать `Utilities.sleep(500)` из `syncV11()`; оставить только `SpreadsheetApp.flush()` там, где реально нужно перед чтением. Убрать лишние `syncV11()` из `runFullUpdate`.

### Этап 2 — батчинг записи (главный источник API-вызовов)
- `sheet_service.js`: переписать `batchWrite`, группируя по строкам и записывая `Range.setValues` для каждой строки. Это сократит вызовы с N (ячеек) до числа строк.

### Этап 3 — убрать N+1 чтения
- `deficit_engine.js` `saveDeficitChanges`: создать `buildMaterialIndex()` один раз, прокинуть `index` в `getMaterialById`/`updateMaterialState`, убрать `flushSheets()` из цикла.
- `archive_engine.js`: собирать материалы в один проход, передавать общий индекс, flush один раз после цикла.

### Этап 4 — убрать дубль `recalculateMaterials` в `runFullUpdate`.

### Этап 5 — (опц.) `updateDeficitSummary` — не переписывать весь лист при малых изменениях.

### Этап 6 — (опц.) `color_engine.js` — обновлять только колонку статуса.

### Этап 7 — (опц.) батчировать `logSystem` и записи истории.

---

## Ожидаемый результат

Устранение сна (−4 сек) + батчинг записи + устранение N+1 должны свести обновление до **1–2 секунд** при разумном размере данных.

Полный отчёт с деталями и архитектурой сохранён в файле **`project_info__1.md`**.

---

**Важно:** Сейчас активен **Explore Mode** — я могу только анализировать и документировать, но не вносить изменения. Чтобы я реализовал эти оптимизации, переключитесь в **Act Mode** (переключатель Plan/Act внизу чата). Найденные узкие места сохранены в контексте и будут перенесены в Act Mode.