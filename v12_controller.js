/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_controller.js
 *
 * Меню, установка листов (+ кнопка «ПРИМЕНИТЬ» в верхнем левом углу
 * рабочих листов), полная синхронизация, диагностика и проверка
 * консистентности (ТЗ №160–161).
 *
 * Обратная связь пользователю — ВСПЛЫВАЮЩИМИ сообщениями в правом нижнем
 * углу окна (v12_ui.js, 3 с; ошибки — 8 с). Модальных окон в коде нет,
 * кроме ui.prompt в диалогах «Вернуть из архива» и
 * «Вернуть проект в Dashboard (снять «Выполнено»)» — там нужен ввод.
 * =====================================================
 */

/**
 * Точка входа (меню открывается при открытии таблицы).
 */
function onOpen() {
  v12OnOpen();
}

/**
 * Меню V12.
 */
function v12OnOpen() {
  // V3 — модель «Применить»: число необработанных намерений выносим в подпись
  // пункта меню, чтобы пользователь видел «есть неприменённые изменения».
  // Подпись обновляется при открытии таблицы.
  let pending = 0;
  try {
    pending = v12CountPendingEdits();
    // Обновляем и ячейку-индикатор на видном листе: пользователь видит
    // «есть неприменённые изменения» даже не открывая меню.
    v12UpdatePendingIndicator(pending);
  } catch (e) {
    pending = 0;
  }
  const applyLabel = (pending > 0)
    ? "Применить изменения (" + pending + ")"
    : "Применить изменения";

  SpreadsheetApp.getUi()
    .createMenu("BOM CONTROL V12")
    .addItem(applyLabel, "v12ApplyChangesUI")
    .addItem("♻ Пересобрать очередь (по галочкам)", "v12RebuildPendingFromCheckedUI")
    .addItem("🧹 Схлопнуть дубли очереди", "v12CompactPendingEditsUI")
    .addItem("Восстановить кнопку «Применить»", "v12InstallApplyButtonUI")
    .addItem("🔑 Мой доступ (e-mail и права)", "v12WhoAmIUI")
    .addItem("🔓 Разрешить правки в «Сводке дефицитов»", "v12AllowDeficitEditingUI")
    .addSeparator()
    // === Лоты отборки из личных файлов отборщиков ==========================
    .addItem("📦 Обработать лоты отборщиков", "v12ProcessBatchesUI")
    .addItem("🧾 Журнал лотов", "v12ShowBatchJournalUI")
    .addItem("🔓 Освободить все захваты проектов", "v12ReleaseAllClaimsUI")
    .addItem("🔐 Задать/сменить секрет отборщиков", "v12SetBatchTokenUI")
    .addItem("🛡 Поставить защиту на лист ОТБОРКА", "v12ApplyPickingSheetNoticeUI")
    .addSeparator()
    .addItem("🔄 Полная синхронизация", "v12RunFullSync")
    .addItem("📊 Обновить проекции", "v12RefreshAllProjections")
    .addSeparator()
    .addItem("↩ Вернуть из архива", "v12PromptReturnFromArchive")
    .addItem("↩ Вернуть проект в Dashboard (снять «Выполнено»)", "v12PromptUndoBomDone")
    .addSeparator()
    .addItem("🔎 Диагностика V12", "v12Diagnostic")
    .addItem("🧪 Тест V12", "v12RunDebug")
    .addItem("🧩 Проверка консистентности", "v12ConsistencyCheck")
    .addSeparator()
    .addItem("⚙ Установка V12", "v12Install")
    .addToUi();
}

/**
 * «Применить изменения» с обратной связью (V3).
 *
 * Вызывается из меню и с кнопки «ПРИМЕНИТЬ» на листе. Применяет все накопленные
 * намерения (v12ApplyChanges) и показывает сводку ВСПЛЫВАЮЩИМ сообщением в
 * правом нижнем углу окна (3 секунды) — без модальных окон.
 */
function v12ApplyChangesUI() {
  const result = v12ApplyChanges();
  const applied = (result && typeof result.drained === "number") ? result.drained : 0;
  const failed = (result && typeof result.failed === "number") ? result.failed : 0;
  // Намерения БЕЗ автора (onEdit не получил e-mail), на которые у нажавшего нет
  // права: НЕ теряются — остаются в очереди и ждут того, у кого право есть.
  const awaiting = (result && typeof result.awaitingAuthor === "number") ? result.awaitingAuthor : 0;
  if (result && result.skipped) {
    v12Toast("Система занята — повторите через несколько секунд.");
  } else if (result && result.error) {
    v12Toast("Ошибка применения: " + result.error, V12_UI.TOAST_SECONDS_ERROR);
  } else if (failed > 0) {
    v12Toast("Применено: " + applied + ", не применено: " + failed +
      " (см. PENDING_EDITS, колонка «Ошибка»)", V12_UI.TOAST_SECONDS_ERROR);
  } else if (awaiting > 0) {
    v12Toast("Ждут применения под своим аккаунтом: " + awaiting +
      " (у вас нет права на это поле). Применено: " + applied, V12_UI.TOAST_SECONDS_ERROR);
  } else if (applied > 0) {
    v12Toast("Применено изменений: " + applied);
  } else {
    v12Toast("Неприменённых изменений нет");
  }
  return result;
}

/**
 * «Пересобрать очередь» (пункт меню) с обратной связью.
 *
 * Приводит множество HANDOFF-намерений листа PENDING_EDITS к каноническому виду
 * по ФАКТИЧЕСКИ стоящим галочкам ОТБОРКИ и WORKING BOM: схлопывает возможные
 * дубли и ДОБИРАЕТ отмеченные позиции, по которым не пришло событие onEdit
 * (Google «глотает» всплески при массовой отметке). Так лист очереди становится
 * точным отражением отмеченных галочек ещё ДО нажатия «Применить».
 *
 * В норме вызывается автоматически при каждой правке чекбокса
 * (см. v12CaptureCheckboxEdit → v12ReconcilePendingHandoffs); пункт меню нужен
 * для ручного контроля и для случая, когда последнее событие onEdit было
 * потеряно платформой.
 *
 * Возвращает { added, pending } либо null, если очередь занята.
 */
function v12RebuildPendingFromCheckedUI() {
  let added;
  try {
    added = v12ReconcilePendingHandoffs();
  } catch (e) {
    logSystem("v12RebuildPendingFromCheckedUI", e.message, e, "ERROR");
    flushSystemLog();
    v12Toast("Не удалось пересобрать очередь: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  }
  if (added === null) {
    v12Toast("Очередь занята (идёт применение/синхронизация) — повторите через несколько секунд.");
    return null;
  }
  const pending = v12CountPendingEdits();
  v12UpdatePendingIndicator(pending);
  v12Toast("Очередь пересобрана: дополнено " + added +
    ", всего в очереди " + pending + " намерений");
  return { added: added, pending: pending };
}

/**
 * «Схлопнуть дубли очереди» — гигиена после канала без потерь.
 *
 * Если лок не удавалось взять (шла синхронизация или чужое применение), захват
 * правки писался напрямую через appendRow, поэтому по одному ключу
 * SOURCE|POSITION_ID|FIELD могло появиться несколько строк. Эта операция
 * оставляет действующей последнюю и гасит предыдущие.
 */
function v12CompactPendingEditsUI() {
  let removed;
  try {
    removed = v12CompactPendingEdits();
  } catch (e) {
    logSystem("v12CompactPendingEditsUI", e.message, e, "ERROR");
    flushSystemLog();
    v12Toast("Не удалось схлопнуть дубли: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  } finally {
    flushSystemLog();
  }
  const pending = v12CountPendingEdits();
  v12UpdatePendingIndicator(pending);
  v12Toast(removed > 0
    ? ("Схлопнуто дублей: " + removed + ", в очереди " + pending + " намерений")
    : "Дублей в очереди нет");
  return { removed: removed, pending: pending };
}

/**
 * «Обработать лоты отборщиков» — применить все накопленные лоты ОДНИМ сливом.
 *
 * Нужно, когда лот остался в статусе PENDING: при приёме был занят лок (шла
 * синхронизация или чужое применение). Дежурный триггер делает то же самое
 * каждые 5 минут; пункт меню — для немедленного контроля администратором.
 */
function v12ProcessBatchesUI() {
  let result;
  try {
    v12ExpireStaleClaims();
    result = v12DrainPendingEdits();
    v12RecoverStuckBatches();
  } catch (e) {
    logSystem("v12ProcessBatchesUI", e.message, e, "ERROR");
    v12Toast("Не удалось обработать лоты: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  } finally {
    v12FlushAudit();
    flushSystemLog();
  }
  const applied = (result && typeof result.drained === "number") ? result.drained : 0;
  if (result && result.skipped) {
    v12Toast("Система занята — повторите через несколько секунд.");
  } else if (applied > 0) {
    v12Toast("Лоты применены. Позиций передано: " + applied);
  } else {
    v12Toast("Неприменённых лотов нет");
  }
  return result;
}

/**
 * «Журнал лотов» — сводка по последним лотам отборки.
 */
function v12ShowBatchJournalUI() {
  const batches = v12CollectBatches(20);
  if (!batches.length) {
    v12Toast("Лотов отборки пока нет");
    return [];
  }
  const lines = batches.map(function (b) {
    return (b.batchId || "?") + " | " + (b.project || "-") + " | " +
      (b.actor || "-") + " | " + v12BatchStatusDisplay(b.status) +
      " | " + b.applied + "/" + b.total +
      (b.failed ? (" (не применено: " + b.failed + ")") : "");
  });
  logSystem("v12ShowBatchJournalUI",
    "Журнал последних лотов:\n" + lines.join("\n"), "INFO");
  flushSystemLog();
  v12Toast("Лотов за период: " + batches.length +
    ". Подробности — в SYSTEM_LOG и на листе PICKING_BATCHES");
  return batches;
}

/**
 * «Освободить все захваты проектов» (для ADMIN).
 *
 * Захваты — строго мягкие: применяются, чтобы показать отборщику «проект уже
 * отбирает X». Если заявка осталась от прошлого периода, администратор снимает
 * все сразу, не дожидаясь TTL.
 */
function v12ReleaseAllClaimsUI() {
  const released = v12ReleaseAllClaims();
  v12Toast(released > 0
    ? ("Освобождено захватов: " + released)
    : "Активных захватов нет");
  return released;
}

/**
 * Поставить «мягкую защиту» на лист ОТБОРКА и надпись-подсказку в A1.
 *
 * ВАЖНО: защита именно МЯГКАЯ (setWarningOnly), а не запрет. Пересборку листа
 * делает v12RefreshPicking() при пересчёте проекций, а такой пересчёт в
 * триггере исполняется от имени автора правки — жёсткая защита с удалением
 * редакторов остановила бы и саму проекцию, и лист перестал бы обновляться.
 * Поэтому здесь только предупреждение + текстовая подсказка.
 */
function v12ApplyPickingSheetNotice() {
  const sheet = v12GetSheetByKey("PICKING");
  if (!sheet) {
    return { ok: false, reason: "Лист ОТБОРКА не найден" };
  }
  let warned = false;
  if (typeof sheet.protect === "function" &&
      typeof sheet.getProtections === "function") {
    const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    const prot = (existing && existing.length) ? existing[0] : sheet.protect();
    if (prot) {
      if (typeof prot.setDescription === "function") {
        prot.setDescription(
          "Рабочее место отборщиков перенесено в личные файлы. " +
          "Правки здесь не сохраняются — откройте свой файл отбора.");
      }
      if (typeof prot.setWarningOnly === "function") {
        prot.setWarningOnly(true);
        warned = true;
      }
    }
  }
  if (typeof sheet.getRange === "function") {
    sheet.getRange(1, 1).setValue("Витрина. Рабочее место — личный файл отбора.");
  }
  return { ok: true, warningOnly: warned };
}

/**
 * Пункт меню «Поставить защиту на лист ОТБОРКА» с обратной связью.
 */
function v12ApplyPickingSheetNoticeUI() {
  let res;
  try {
    res = v12ApplyPickingSheetNotice();
  } catch (e) {
    logSystem("v12ApplyPickingSheetNoticeUI", e.message, e, "ERROR");
    flushSystemLog();
    v12Toast("Не удалось поставить защиту: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  }
  if (!res || !res.ok) {
    v12Toast("Не удалось: " + ((res && res.reason) || "неизвестная ошибка"),
      V12_UI.TOAST_SECONDS_ERROR);
    return res;
  }
  v12Toast(res.warningOnly
    ? "Лист ОТБОРКА помечен как витрина (защита-предупреждение поставлена)"
    : "Лист ОТБОРКА помечен как витрина (защита недоступна в этом окружении)");
  return res;
}

/**
 * Установка V12: создать листы, снять старые триггеры, поставить новые.
 */
function v12Install() {
  const lock = acquireScriptLock();
  try {
    v12EnsureAllSheets();
    v12InstallTriggers();
    // Кнопка «Применить» в верхнем левом углу рабочих листов.
    v12InstallApplyButton();
    // Мягкая защита листа ОТБОРКА + надпись «витрина»: рабочее место отборщика
    // перенесено в его личный файл, а мастерский лист остаётся для ADMIN и отчётов.
    v12ApplyPickingSheetNotice();
    logSystem("v12Install", "V12 установлена", "INFO");
    v12Toast("Скрипт выполнен: V12 установлена, кнопка «" + V12_UI.BUTTON_LABEL + "» поставлена");
  } catch (error) {
    logSystem("v12Install", error.message, error, "ERROR");
    v12Toast("Ошибка установки V12: " + error.message, V12_UI.TOAST_SECONDS_ERROR);
  } finally {
    lock.releaseLock();
    v12FlushAudit();
    flushSystemLog();
  }
}

/**
 * Диагностика V12: наличие листов, количество позиций/BOM.
 */
function v12Diagnostic() {
  const result = {
    version: V12_CONFIG.VERSION,
    timestamp: new Date(),
    sheets: {},
    positions: 0,
    boms: 0,
    errors: []
  };
  try {
    Object.keys(V12_CONFIG.SHEETS).forEach(function (key) {
      result.sheets[key] = Boolean(SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS[key]));
    });
    const posSheet = SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS.POSITION_STATE);
    if (posSheet) {
      result.positions = Math.max(0, posSheet.getLastRow() - 1);
    }
    const bomSheet = SpreadsheetApp.getActive().getSheetByName(V12_CONFIG.SHEETS.BOM_REGISTRY);
    if (bomSheet) {
      result.boms = Math.max(0, bomSheet.getLastRow() - 1);
    }
    // Очередь правок (Вариант D): число необработанных намерений.
    result.pendingEdits = v12CountPendingEdits();
    // Транспорт лотов отборщиков (V13): состояние канала приёма.
    result.pendingBatches = v12CountPendingBatches();
    result.activeClaims = v12CollectActiveClaims().length;
    result.syncInProgress = v12IsSyncInProgress();
    result.tokenConfigured = !!v12GetBatchToken();
  } catch (e) {
    result.errors.push(e.message);
  }
  return result;
}

/**
 * Проверка консистентности (ТЗ №160–161):
 * BOM_REGISTRY ↔ POSITION_STATE ↔ DEFICIT_SUMMARY ↔ ОТБОРКА ↔ WORKING BOM ↔ Dashboard ↔ Архив.
 */
function v12ConsistencyCheck() {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const positionData = v12ReadSheet("POSITION_STATE");
  const registryData = v12ReadSheet("BOM_REGISTRY");
  const B = V12_CONFIG.BOM_REGISTRY_COLUMNS;

  const report = {
    registryBoms: new Set(),
    positionBoms: new Set(),
    positionIds: new Set(),
    errors: [],
    info: []
  };

  for (let i = 1; i < registryData.length; i++) {
    const id = normalizeMaterialId(registryData[i][B.BOM_ID - 1]);
    if (id) {
      report.registryBoms.add(id);
    }
  }

  for (let i = 1; i < positionData.length; i++) {
    const r = positionData[i];
    const pid = normalizeMaterialId(r[P.POSITION_ID - 1]);
    const bomId = normalizeMaterialId(r[P.BOM_ID - 1]);
    if (pid) {
      report.positionIds.add(pid);
    }
    if (bomId) {
      report.positionBoms.add(bomId);
    }
  }

  // BOM из позиций, отсутствующие в реестре
  report.positionBoms.forEach(function (bomId) {
    if (!report.registryBoms.has(bomId)) {
      report.errors.push("BOM " + bomId + " есть в POSITION_STATE, но отсутствует в BOM_REGISTRY");
    }
  });

  // BOM из реестра без позиций — это НОРМАЛЬНО (новый BOM или все позиции
  // отфильтрованы): не ошибка, а информационная заметка.
  report.registryBoms.forEach(function (bomId) {
    if (!report.positionBoms.has(bomId)) {
      report.info.push("BOM " + bomId + " есть в BOM_REGISTRY, но пока без позиций");
    }
  });

  // Дубликаты positionId: число уникальных ID сравниваем с числом НЕПУСТЫХ ID
  // (иначе строки с пустым Position ID давали бы ложное «обнаружены дубликаты»).
  const nonEmptyIdCount = positionData.slice(1).filter(function (r) {
    return normalizeMaterialId(r[P.POSITION_ID - 1]);
  }).length;
  if (report.positionIds.size !== nonEmptyIdCount) {
    report.errors.push("Обнаружены дубликаты positionId");
  }

  // === Проверки канала лотов отборщиков (V13) ===============================
  // 1) Лоты, застрявшие в статусе PENDING: их должен был добить дежурный дренаж.
  const batches = v12CollectBatches(50);
  const pendingBatches = batches.filter(function (b) {
    return b.status === V12_CONFIG.PICKING_BATCH_STATUS.PENDING;
  });
  if (pendingBatches.length) {
    report.info.push("Лоты в обработке (PENDING): " + pendingBatches.length +
      " — " + pendingBatches.map(function (b) { return b.batchId; }).join(", "));
  }

  // 2) Захваты проектов с истёкшим сроком: нужно снять их пометкой EXPIRED.
  const expired = v12ExpireStaleClaims();
  if (expired > 0) {
    report.info.push("Снято просроченных захватов проектов: " + expired);
  }

  // 3) ВАЖНО (конфликт A7, решение — «оставить как есть, но показывать»):
  //    физический склад МОЖЕТ быть меньше суммарной потребности по материалу.
  //    v12RecalculateWarehouseConsistency() уже вычисляет такие несоответствия,
  //    но раньше результат никем не читался. Теперь показываем их в отчёте,
  //    чтобы о дефиците склада узнавали, а не выясняли случайно.
  try {
    const inconsistencies = v12RecalculateWarehouseConsistency();
    (inconsistencies || []).forEach(function (inc) {
      report.errors.push("Материал " + inc.materialKey +
        ": потребность (резерв) " + inc.reservedQty +
        " больше склада " + inc.warehouseQty);
    });
  } catch (e) {
    report.info.push("Проверка склада не выполнена: " + e.message);
  }

  return report;
}

/**
 * Диалог возврата позиции из архива (ТЗ №78–82).
 * Запрашивает Position ID и причину, вызывает v12ReturnFromArchive.
 */
function v12PromptReturnFromArchive() {
  const ui = SpreadsheetApp.getUi();
  const idResponse = ui.prompt("Возврат из архива", "Position ID позиции:", ui.ButtonSet.OK_CANCEL);
  if (idResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const positionId = String(idResponse.getResponseText() || "").trim();
  if (!positionId) {
    v12Toast("Position ID не указан");
    return;
  }
  const reasonResponse = ui.prompt("Возврат из архива", "Причина возврата:", ui.ButtonSet.OK_CANCEL);
  if (reasonResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const reason = String(reasonResponse.getResponseText() || "").trim();
  const result = v12ReturnFromArchive(positionId, reason);
  if (result && result.status === "returned") {
    v12Toast("Позиция возвращена из архива: " + positionId);
  } else {
    v12Toast("Не удалось вернуть: " + ((result && result.reason) || "неизвестная ошибка"),
      V12_UI.TOAST_SECONDS_ERROR);
  }
}

/**
 * Диалог отмены «Выполнено» для BOM (возврат проекта в активный Dashboard).
 *
 * V3: чекбокс «Выполнено» обрабатывается очередью, а после применения
 * выполненный BOM УХОДИТ из Dashboard (хранится в EXCLUDED_BOMS), поэтому снять
 * галочку прямо в дашборде больше нельзя — строки там уже нет. Эта функция
 * возвращает проект в работу: спрашивает BOM ID, снимает флаг «Выполнено» и
 * пересобирает Dashboard, где проект появляется снова.
 *
 * Право — то же, что и на отметку: DASHBOARD_CHECKBOX (производство и админ).
 */
function v12PromptUndoBomDone() {
  const role = v12GetCurrentUserRole();
  if (!v12CanEditField(role, "DASHBOARD_CHECKBOX")) {
    v12Toast("Нет права отменять «Выполнено» для роли '" + role + "'", V12_UI.TOAST_SECONDS_ERROR);
    return;
  }
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt("Вернуть проект в Dashboard",
    "BOM ID выполненного проекта:", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  const bomId = normalizeMaterialId(response.getResponseText());
  if (!bomId) {
    v12Toast("BOM ID не указан");
    return;
  }
  let result;
  try {
    result = v12SetBomDone(bomId, false);
  } catch (e) {
    logSystem("v12PromptUndoBomDone", e.message, e, "ERROR");
    v12Toast("Не удалось вернуть проект: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return;
  } finally {
    v12FlushAudit();
    flushSystemLog();
  }
  if (result && result.status === "applied") {
    v12Toast("Проект возвращён в Dashboard: " + bomId);
  } else if (result && result.status === "already") {
    v12Toast("Проект не отмечен как выполненный: " + bomId);
  } else {
    v12Toast("Не удалось вернуть проект: " + ((result && result.reason) || "неизвестная ошибка"),
      V12_UI.TOAST_SECONDS_ERROR);
  }
}

/**
 * Тест V12: прогон расчётного движка на типовых сценариях.
 */
function v12RunDebug() {
  const report = {
    version: V12_CONFIG.VERSION,
    time: new Date(),
    tests: [],
    errors: []
  };

  // Сценарий 1: дефицит = required − reserved (ТЗ)
  report.tests.push(v12Assert("Дефицит: required=10, reserved=3", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 0)
    });
    return r.deficitQty === 7;
  }));

  // Сценарий 2: заказ ≥ дефицита → supplyState ORDERED
  report.tests.push(v12Assert("SupplyState: ordered=7, deficit=7 → ORDERED", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 0,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.supplyState === V12_CONFIG.SUPPLY_STATE.ORDERED;
  }));

  // Сценарий 3: availableForProduction = reserved + realDelivery (К1)
  report.tests.push(v12Assert("availableForProduction = 3 + 5 = 8", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 5,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.availableForProduction === 8;
  }));

  // Сценарий 4: readyForHandoff, когда available >= required и не передано
  report.tests.push(v12Assert("readyForHandoff при available=8, required=10 — false", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 3, orderedQty: 7, realDeliveryQty: 5,
      expectedDate: "2026-08-15", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 3, 7)
    });
    return r.readyForHandoff === false;
  }));

  // Сценарий 5: readyForHandoff при available >= required
  report.tests.push(v12Assert("readyForHandoff при reserved=10 — true", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 10, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 10, 0)
    });
    return r.readyForHandoff === true;
  }));

  // Сценарий 6: валидация по №8 — Код необязателен, Модель обязательна
  report.tests.push(v12Assert("Валидация №8: без Кода, но с Моделью — валидна", function () {
    const r = v12CalculatePositionState({
      requiredQty: 10, reservedQty: 0, orderedQty: 0, realDeliveryQty: 0,
      expectedDate: "", deadline: "2026-09-01", receivedByProduction: false,
      receivedByProductionQty: 0, warehouseQty: 0,
      row: v12TestRow(10, 0, 0)
    });
    return r.valid === true;
  }));

  report.errors = report.tests.filter(function (t) { return !t.pass; })
    .map(function (t) { return t.name; });

  const summary = "Тест V12 завершён.\nВсего: " + report.tests.length +
    "\nОшибок: " + report.errors.length +
    (report.errors.length ? "\n\n" + report.errors.join("\n") : "");
  logSystem("v12RunDebug", summary, report, report.errors.length ? "WARNING" : "INFO");
  // Вместо модального окна — краткая всплывашка; полный отчёт — в SYSTEM_LOG.
  v12Toast("Тест V12: ошибок " + report.errors.length + " из " + report.tests.length +
    (report.errors.length ? " — подробности в SYSTEM_LOG" : ""));
  return report;
}

/**
 * Вспомогательный assert.
 */
function v12Assert(name, fn) {
  let pass = false;
  let error = "";
  try {
    pass = fn() === true;
  } catch (e) {
    error = e.message;
  }
  return { name: name, pass: pass, error: error };
}

/**
 * «Мой доступ» — показать, кем определён пользователь и что ему разрешено.
 *
 * Зачем это в меню. Права доступа (RBAC) считаются по e-mail, а платформа не
 * всегда отдаёт адрес чужого (не владельца) аккаунта: снабженец видел, что
 * введённое «Заказано» откатывается, и это выглядело как «нет доступа на
 * правку». Здесь пользователь видит определённый e-mail, роль и полный список
 * разрешённых полей; если e-mail не определён — может указать его один раз
 * (он сохранится в его личных настройках и будет использоваться для проверки
 * прав так же, как в личном файле отборщика).
 */
function v12WhoAmIUI() {
  const detected = v12DetectUserEmail();
  const declared = v12GetDeclaredUserEmail();
  const ui = SpreadsheetApp.getUi();

  let email = detected;
  // E-mail не определён системой и не указан вручную — спрашиваем и запоминаем.
  if (!email || !v12IsEmailLike(email)) {
    const response = ui.prompt(
      "Мой доступ",
      "Система не смогла определить ваш e-mail (так бывает, когда скрипт " +
      "запущен не под владельцем таблицы).\nВведите ваш рабочий e-mail — он " +
      "сохранится в ваших настройках и будет использоваться для проверки прав " +
      "доступа:",
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) {
      return null;
    }
    email = v12SetDeclaredUserEmail(response.getResponseText());
    if (!email) {
      v12Toast("E-mail не указан — права определить нельзя.");
      return null;
    }
  }

  const access = v12DescribeUserAccess(email);
  const allowedText = access.allowed.length
    ? access.allowed.join("; ")
    : "нет прав на правку (обратитесь к владельцу системы)";
  const summary = "Ваш доступ:" +
    "\n  e-mail: " + access.email +
    (declared && declared === access.email ? " (указан вручную)" : "") +
    "\n  роль: " + (access.role || "не найдена в списке ролей") +
    "\n  можно править: " + allowedText;

  logSystem("v12WhoAmIUI", summary, "INFO");
  flushSystemLog();
  // Toast — узкая полоса; полный текст всегда есть в SYSTEM_LOG.
  v12Toast("Ваш e-mail: " + access.email + " · роль: " +
    (access.role || "нет") + " · полей доступно: " + access.allowed.length);
  return access;
}

/**
 * Снять жёсткую защиту с листа «Сводка дефицитов».
 *
 * Лист — рабочее место снабженца: он должен уметь вводить «Заказано» и
 * «Ожидаемую поставку». Если владелец (или прежняя настройка) поставил на лист
 * жёсткую защиту, снабженец физически не может править ячейки — Google
 * показывает «защищённый диапазон», и это тоже выглядит как «нет доступа».
 *
 * Функция удаляет ЛЮБЫЕ защиты этого листа (уровня листа и диапазонов).
 * Выполнять её должен владелец/админ — удалить защиту может только тот, кто
 * владеет защитой.
 *
 * Возвращает { removed, error? }.
 */
function v12AllowDeficitEditing() {
  const sheet = v12GetSheetByKey("DEFICIT_SUMMARY");
  let removed = 0;
  if (typeof sheet.getProtections !== "function") {
    return { removed: 0, error: "Защита листов недоступна в этом окружении" };
  }
  const types = [
    SpreadsheetApp.ProtectionType.SHEET,
    SpreadsheetApp.ProtectionType.RANGE
  ];
  types.forEach(function (type) {
    let protections = [];
    try {
      protections = sheet.getProtections(type) || [];
    } catch (e) {
      protections = [];
    }
    protections.forEach(function (prot) {
      try {
        prot.remove();
        removed++;
      } catch (e) {
        logSystem("v12AllowDeficitEditing", e.message, e, "WARNING");
      }
    });
  });
  logSystem("v12AllowDeficitEditing",
    "Снято защит с листа «Сводка дефицитов»: " + removed, "INFO");
  flushSystemLog();
  return { removed: removed };
}

/**
 * Пункт меню «Разрешить правки в «Сводке дефицитов»» с обратной связью.
 */
function v12AllowDeficitEditingUI() {
  let result;
  try {
    result = v12AllowDeficitEditing();
  } catch (e) {
    logSystem("v12AllowDeficitEditingUI", e.message, e, "ERROR");
    v12Toast("Не удалось снять защиту: " + e.message, V12_UI.TOAST_SECONDS_ERROR);
    return null;
  } finally {
    flushSystemLog();
  }
  if (result.error) {
    v12Toast(result.error, V12_UI.TOAST_SECONDS_ERROR);
  } else if (result.removed > 0) {
    v12Toast("Защита снята (снято: " + result.removed + "). Снабжение может править «Заказано».");
  } else {
    v12Toast("Лист «Сводка дефицитов» не защищён — правки может вводить любой, у кого есть доступ к таблице.");
  }
  return result;
}

/**
 * Строка POSITION_STATE для тестов (только необходимые поля валидации).
 */
function v12TestRow(required, reserved, ordered) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const row = new Array(V12_CONFIG.COLUMN_COUNT.POSITION_STATE).fill("");
  row[P.BOM_ROW - 1] = 1;
  row[P.MATERIAL_NAME - 1] = "Тестовый материал";
  row[P.MODEL - 1] = "M-1";
  row[P.UNIT - 1] = "шт";
  row[P.REQUIRED_QTY - 1] = required;
  row[P.RESERVED_QTY - 1] = reserved;
  row[P.ORDERED_QTY - 1] = ordered;
  row[P.DEADLINE - 1] = "2026-09-01";
  return row;
}
