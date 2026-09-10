I'm in **Explore Mode**, which is read-only and designed for deep codebase investigation — not for writing or implementing code. To implement this, please switch to **Act Mode** using the mode selector at the bottom of the chat.

## Status of the current change (important)

While the session was in **Act Mode** a moment ago, I managed to apply **two** of the four planned edits before the mode switched back to Explore and the write tool was hard-blocked:

✅ **Applied:**
- `v12_config.js` — схема ОТБОРКИ расширена до **13 колонок**:
  - `COLUMN_COUNT.PICKING: 12 → 13`
  - `PICKING_COLUMNS`: добавлен `EXPECTED_DATE: 11`, сдвинуты `CHECKBOX: 12`, `UPDATED_AT: 13`
  - `HEADERS.PICKING`: добавлен заголовок «Ожидаемая поставка» после «ProductionState»
- `v12_projections.js`:
  - в `v12RefreshPicking()` строка теперь пишет 13 ячеек, включая дату (`v12FormatDateOnly(r[P.EXPECTED_DATE - 1])`) в кол. 11;
  - добавлена функция `v12PickingRowColor(r)` — окраска: «На складе» → голубой (STOCK), не заказан/заказан частично → красный, заказан + приход ≤ крайнего срока → жёлтый, заказан + приход позже срока (или дата неизвестна) → оранжевый;
  - `v12ApplyPickingColors(colors)` переписана под массив цветов.

⚠️ **НЕ применено (осталось для Act Mode):**
- `_local_tests/v12_picking_schema_test.js` — ещё ожидает 12 колонок, нужно обновить под 13 и добавить проверки окраски (иначе локальный тест упадёт).
- Прогон `node _local_tests/v12_picking_schema_test.js` и `node _local_tests/v12_delivery_test.js` + `node --check` не выполнены.

**То есть код находится в промежуточном состоянии:** рабочие файлы (`v12_config.js`, `v12_projections.js`) уже изменены, а локальный тест ещё нет — его обязательно нужно привести к 13 колонкам и прогнать.

Полный план по этой доработке сохранён в `project_info__25.md` (раздел 6 — чек-лист). Он перенесётся в Act Mode как контекст.

👉 **Переключитесь в Act Mode** — я сразу обновлю `_local_tests/v12_picking_schema_test.js` под 13 колонок (+ тест окраски), прогоню оба локальных набора тестов и `node --check`, и подтвержу результат.