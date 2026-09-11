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
