/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_roles.js
 *
 * RBAC по ТЗ №114–117. Роли: ADMIN, ECONOMIST, PROCUREMENT,
 * WAREHOUSE, PRODUCTION, VIEWER. Каждая критическая серверная
 * функция сама проверяет права.
 *
 * Матрица прав (кто что может менять):
 *
 *   PROCUREMENT (снабженец)   — лист «Сводка дефицитов»:
 *                               «Заказано» (ORDERED_QTY),
 *                               «Ожидаемая поставка» (EXPECTED_DATE);
 *   ECONOMIST (экономист)     — «Сводка дефицитов»: чекбокс
 *                               «Реальная поставка» (REAL_DELIVERY);
 *                               правка исходных BOM (SOURCE_BOM_WRITE,
 *                               DEADLINE) — таблицы в Google Drive;
 *   WAREHOUSE (кладовщик)     — «ОТБОРКА»: чекбокс «Отметка получено»
 *                               (PICKING_CHECKBOX); физический склад
 *                               MATERIAL_STATE: «Складской остаток»
 *                               (WAREHOUSE_QTY); отправка лота отборки из
 *                               личного файла (PICKING_BATCH_SUBMIT) и захват
 *                               проекта (PICKING_CLAIM);
 *   PRODUCTION (производство) — «Dashboard»: чекбокс «Выполнено»
 *                               (DASHBOARD_CHECKBOX); «WORKING BOM»:
 *                               чекбокс передачи (WORKING_BOM_CHECKBOX);
 *                               «ОТБОРКА» (PICKING_CHECKBOX); отправка лота
 *                               отборки из личного файла (PICKING_BATCH_SUBMIT);
 *   ADMIN                     — все изменения без ограничений.
 * =====================================================
 */

/** Маппинг email → роль. Заполняется владельцем. */
const V12_ROLE_MAP = {
  // "email@example.com": V12_CONFIG.ROLES.ADMIN
  "6458771go@gmail.com":V12_CONFIG.ROLES.ECONOMIST,
  "maksim.salavei@gmail.com":V12_CONFIG.ROLES.PROCUREMENT,
  "vladimir.katsuba24@gmail.com":V12_CONFIG.ROLES.PROCUREMENT,
  "vlad1004322@gmail.com":V12_CONFIG.ROLES.PROCUREMENT,
  "Balalaikina79@gmail.com":V12_CONFIG.ROLES.WAREHOUSE,
  "lazukazip24@gmail.com":V12_CONFIG.ROLES.VIEWER,
  "polonets.maksim@gmail.com":V12_CONFIG.ROLES.ADMIN,
};

/**
 * Роль пользователя по e-mail.
 *
 * Поиск НЕ зависит от регистра и лишних пробелов: Google отдаёт адрес в нижнем
 * регистре, а владелец мог вписать его в карту как угодно (в V12_ROLE_MAP уже
 * есть адрес с заглавной буквой). Точное сравнение строк в этом случае не
 * находило роль, и пользователь терял ВСЕ права — например, снабженец не мог
 * править «Заказано» («количество заказанного») в «Сводке дефицитов».
 *
 * Сначала быстрое прямое попадание (обычный случай: адрес уже в нижнем
 * регистре), затем — поиск по нормализованным ключам карты.
 */
function v12GetUserRole(email) {
  const key = v12NormalizeEmail(email);
  if (!key) {
    return "";
  }
  if (V12_ROLE_MAP[key]) {
    return V12_ROLE_MAP[key];
  }
  const keys = Object.keys(V12_ROLE_MAP);
  for (let i = 0; i < keys.length; i++) {
    if (v12NormalizeEmail(keys[i]) === key) {
      return V12_ROLE_MAP[keys[i]];
    }
  }
  return "";
}

/**
 * Текущая роль пользователя.
 * Если роли не настроены (V12_ROLE_MAP пуст) — все пользователи имеют роль ADMIN,
 * чтобы приложение работало «из коробки». Как только владелец добавит email в
 * V12_ROLE_MAP, RBAC активируется.
 */
function v12GetCurrentUserRole() {
  if (Object.keys(V12_ROLE_MAP).length === 0) {
    return V12_CONFIG.ROLES.ADMIN;
  }
  return v12GetUserRole(v12CurrentActor());
}

/**
 * Проверка: есть ли у роли право на действие/поле.
 * Поля/действия задаются строками-ключами (см. матрицу в шапке файла).
 *
 * Неизвестная роль (в т.ч. e-mail не из V12_ROLE_MAP) прав не имеет —
 * принцип «запрещено, если не разрешено явно».
 */
function v12CanEditField(role, action) {
  const R = V12_CONFIG.ROLES;
  const allowed = {
    // Экономист: чекбокс «Реальная поставка» в «Сводке дефицитов»
    // + правка исходных BOM.
    [R.ECONOMIST]: ["SOURCE_BOM_WRITE", "DEADLINE", "REAL_DELIVERY"],
    // Снабженец: только «Заказано» и «Ожидаемая поставка» «Сводки дефицитов».
    [R.PROCUREMENT]: ["ORDERED_QTY", "EXPECTED_DATE"],
    // Кладовщик: чекбокс «Отметка получено» «ОТБОРКИ» + «Складской остаток»
    // + отправка лота отборки из личного файла + захват проекта.
    [R.WAREHOUSE]: ["WAREHOUSE_QTY", "PICKING_CHECKBOX", "PICKING_BATCH_SUBMIT", "PICKING_CLAIM"],
    // Производство: чекбокс «Выполнено» Dashboard + передача из WORKING BOM/ОТБОРКИ
    // + отправка лота отборки из личного файла.
    [R.PRODUCTION]: ["PICKING_CHECKBOX", "WORKING_BOM_CHECKBOX", "DASHBOARD_CHECKBOX", "PICKING_BATCH_SUBMIT"],
    [R.ADMIN]: ["*"],
    [R.VIEWER]: []
  };
  const set = allowed[role] || [];
  return set.indexOf("*") !== -1 || set.indexOf(action) !== -1;
}

/**
 * Принудительная проверка права. Бросает ошибку, если нет доступа.
 */
function v12RequireRole(role, action) {
  if (!v12CanEditField(role, action)) {
    const user = v12CurrentActor();
    throw new Error("Недостаточно прав для роли '" + role + "' на действие '" + action + "' (пользователь: " + user + ")");
  }
}

/**
 * Человеческие подписи прав (действие -> что именно разрешено править).
 * Используются диагностикой «Мой доступ» и сообщениями об отказе в правке.
 */
const V12_EDITABLE_FIELDS = [
  { action: "ORDERED_QTY", label: "«Заказано» в «Сводке дефицитов»" },
  { action: "EXPECTED_DATE", label: "«Ожидаемая поставка» в «Сводке дефицитов»" },
  { action: "REAL_DELIVERY", label: "галочка «Реальная поставка» в «Сводке дефицитов»" },
  { action: "DEADLINE", label: "«Крайний срок поставки»" },
  { action: "SOURCE_BOM_WRITE", label: "исходные BOM (Google Drive)" },
  { action: "WAREHOUSE_QTY", label: "«Складской остаток» (MATERIAL_STATE)" },
  { action: "PICKING_CHECKBOX", label: "галочка «Отметка получено» в «ОТБОРКЕ»" },
  { action: "WORKING_BOM_CHECKBOX", label: "галочка передачи в «WORKING BOM»" },
  { action: "DASHBOARD_CHECKBOX", label: "галочка «Выполнено» в «Dashboard»" },
  { action: "PICKING_BATCH_SUBMIT", label: "отправка лота отборки из личного файла" },
  { action: "PICKING_CLAIM", label: "захват проекта в отборке" }
];

/**
 * Человеческая подпись поля по ключу действия (для сообщений об отказе).
 */
function v12FieldLabel(action) {
  for (let i = 0; i < V12_EDITABLE_FIELDS.length; i++) {
    if (V12_EDITABLE_FIELDS[i].action === action) {
      return V12_EDITABLE_FIELDS[i].label;
    }
  }
  return action;
}

/**
 * Что доступно пользователю: { email, role, allowed: [подписи полей] }.
 *
 * Единый источник для диагностики «Мой доступ»: владелец (и любой пользователь)
 * сразу видит, под каким адресом он определён и какие поля ему разрешены.
 */
function v12DescribeUserAccess(email) {
  const who = v12NormalizeEmail(email);
  const role = v12GetUserRole(who);
  const allowed = [];
  V12_EDITABLE_FIELDS.forEach(function (def) {
    if (v12CanEditField(role, def.action)) {
      allowed.push(def.label);
    }
  });
  return { email: who, role: role, allowed: allowed };
}
