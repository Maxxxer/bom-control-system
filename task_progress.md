# Task Progress — BOM CONTROL SYSTEM V12

## Статус: V12 написана, подключена к контуру, баги закрыты, синтаксис и кросс-ссылки проверены

### Архитектура V12 (SOURCE ≠ STATE ≠ VIEW)
[ТЗ: исходный BOM — источник; POSITION_STATE — центральное состояние; MATERIAL_STATE — физ. склад; проекции — представления]

- [x] Аудит V11 → зафиксированы нарушения (единая мастер-таблица, перезапись исходников exportBOMFile, нет POSITION_STATE) → проект_info__7/__8
- [x] V12_CONFIG: листы, колонки, статусы, роли, цвета, события, К1–К7
- [x] v12_source.js: чтение исходных BOM из Drive ТОЛЬКО read (№136), BOM_REGISTRY, исключённые BOM
- [x] v12_position_state.js: POSITION_STATE + v12BuildPositionRow + ApplyComputedToRow
- [x] v12_calculate.js: единый движок — 8 количеств, supplyState/productionState/flags (чистая функция)
- [x] v12_change_engine.js: detectBOMChanges → ChangeSet → applySourceRevision, события (QUANTITY/RESERVE/DEADLINE/MATERIAL/POSITION)
- [x] v12_material_state.js: MATERIAL_STATE, агрегация резервов, контроль reserved ≤ warehouse (№30), RESERVATION_PHYSICAL_INCONSISTENCY
- [x] v12_operations.js: v12SetOrderedQty / v12SetExpectedDate / v12SetRealDeliveryQty (замена saveDeficitChanges, №34)
- [x] v12_handoff.js: v12MarkReceivedByProduction (идемпотентный, №25–27/96) + v12ReturnFromArchive (№78–82)
- [x] v12_projections.js: DEFICIT_SUMMARY, ОТБОРКА, WORKING BOM, СНАБЖЕНИЕ, DASHBOARD
- [x] v12_roles.js: RBAC — ADMIN/ECONOMIST/PROCUREMENT/WAREHOUSE/PRODUCTION/VIEWER, проверка в каждой критической функции
- [x] v12_audit.js: AUDIT_LOG с operationId/старое-новое значение/BOM/positionId
- [x] v12_sheet_service.js: индексы, листы, batch-обновление
- [x] v12_trigger.js: v12OnEdit, v12ScheduledUpdate, v12RunFullSync, v12SetBomDone
- [x] v12_controller.js: меню, v12Install, v12Diagnostic, v12ConsistencyCheck, v12RunDebug
- [x] v12_utils.js: стабильный positionId (bomId:materialKey), materialKey (К5), валидация по №8 (Код необязателен)

### Интеграция
- [x] controller.js: onOpen() → v12OnOpen() (V12 — активная система)
- [x] removeV11Triggers() существует (trigger_engine.js) — v12InstallTriggers ссылается на реальную функцию

### Найденные/исправленные баги
- [x] v12GetWarehouseQtyForPositionRow передавал индекс POSITION_STATE вместо MATERIAL_STATE → теперь v12GetWarehouseQty(materialKey) строит корректный индекс
- [x] DASHBOARD: Дата создания / Крайний срок были пустыми → заполняются через v12BuildRevisionDateMap (BOM_REVISION) и minDeadline из POSITION_STATE
- [x] DEFICIT_SUMMARY: чекбокс «Получено» (RECEIVED) откатывался (else) → теперь обрабатывается как полная реальная поставка

### Верификация
- [x] node --check по всем 15 файлам V12 — синтаксис OK
- [x] Кросс-ссылки: 95 определений / 95 вызовов v12-функций, пропущенных нет; общие хелперы (readSheetValues, batchWrite, removeV11Triggers и др.) определены

### Осталось (требует запуска в Google Apps Script)
- [ ] clasp push → v12Install → v12RunFullSync → v12RunDebug → v12ConsistencyCheck
- [ ] Решить судьбу legacy-функций controller.js (runFullUpdate/installV11) — держать как wrapper или удалить
- [ ] Заполнить V12_ROLE_MAP (email → роль) в v12_roles.js
---

## Вторая волна правок по отчёту №33 (project_info__34.md)

- [x] B-12: `utils.js :: toNumber` — корректный разбор разделителей («1,234.56» → 1234.56 и т.п.)
- [x] C-4: `v12RevertEdit` — диапазон без `oldValue` больше не «молчит» (лог WARNING)
- [x] P-6: `v12HandlePickingRangeEdit` — колонка Position ID читается одной выборкой
- [x] P-7: `v12RefreshProjections` — POSITION_STATE читается один раз; harvest принимает `posData`
- [x] Регрессионный тест `_local_tests/v12_audit_fixes2_test.js` (B-12, C-4, P-7), зарегистрирован в `_tmp_run.js`
- [x] Верификация: `node --check` 20 файлов / 0 ошибок; 4 набора тестов PASSED
- [x] Документация: `project_info__35.md`
- [ ] Осознанно оставлено (проектные решения, не дефекты): B-2, B-3, B-4, B-5, B-6, B-10, B-11, C-3, P-8, P-9 — см. project_info__35.md
---

## Этапы 7–9: транспорт лотов отборки, личный файл отборщика, тесты, документация

- [x] Мастер: `v12_batches.js` — лоты (`PICKING_BATCHES`), мягкий захват проекта (`PICKING_CLAIMS`), идемпотентность по `BATCH_ID`, применение ТОЛЬКО своей партии (`v12ApplyBatch(batchId)`)
- [x] Мастер: `v12_webapp.js` — `doPost`/`doGet`: действия `rows`, `submit`, `status`, `claim`, `release`, `pickers`, `health`; проверка секрета и роли; флаг «идёт синхронизация»
- [x] Мастер: схема — `PENDING_EDIT_COLUMNS` += `BATCH_ID`, `PROJECT` (12); новые листы `PICKING_BATCHES` (12), `PICKING_CLAIMS` (6); статусы `PENDING/APPLIED/PARTIAL/FAILED`, `ACTIVE/RELEASED/EXPIRED`
- [x] Мастер: RBAC — `PICKING_BATCH_SUBMIT` (WAREHOUSE/PRODUCTION), `PICKING_CLAIM`
- [x] Мастер: меню — «🔐 Задать/сменить секрет отборщиков», «🛡 Поставить защиту на лист ОТБОРКА»
- [x] Очередь: при занятом локе намерение фиксируется атомарной дозаписью (`appendRow`) — отметка отборщика не теряется (этап 7a)
- [x] Сателлит (7 модулей + манифест): `sat_config.js`, `sat_api.js`, `sat_sheet.js`, `sat_refresh.js`, `sat_submit.js`, `sat_menu.js`, `sat_install.js`, `sat_appsscript.json`
- [x] Сателлит: обновление НЕ трогает колонку галочек (пишет 1–12); галочки привязаны к `Position ID`; свой фильтр B1; своя кнопка «ПРИМЕНИТЬ»
- [x] Сателлит исключён из выгрузки в мастер (`.claspignore`: `sat_*.js`, `sat_appsscript.json`, `SAT_*.md`, `_local_tests/**`, `_tmp_*`)
- [x] Документация сателлита: `SAT_README.md`, `SAT_SETUP.md`, `SAT_TROUBLESHOOTING.md`
- [x] Пользовательская документация: `REGULATIONS.md`, раздел 10 «Отборка в личном файле»
- [x] Тесты: `_local_tests/v12_batches_test.js` (B1–B8), `_local_tests/sat_gate_test.js` (S1–S9), обновлён F7 в `_local_tests/v12_queue_capture_fix_test.js`; прогон `_tmp_run.js` расширен
- [x] Верификация: `node --check` — 24 файла / 0 ошибок; 18 наборов тестов — все PASSED
- [x] Итоговый отчёт: `project_info__72.md` (что сделано, контракт транспорта, состав файлов, ручные шаги, что осталось)
- [ ] Требует Google Apps Script (ручные шаги владельца): `clasp push` мастера → «⚙ Установка V12» → «🔐 Задать/сменить секрет отборщиков» → развернуть веб-приложение с доступом «любой пользователь Google» → `V12_ROLE_MAP` → раздать личные файлы отборщикам
- [ ] Осознанно вне рамок: политика физической выдачи (A7), массовый откат лота по `BATCH_ID`, отложенное применение пачки лотов
