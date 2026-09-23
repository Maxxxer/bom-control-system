/**
 * =====================================================
 * BOM CONTROL SYSTEM V12
 *
 * FILE: v12_utils.js
 *
 * Утилиты V12: стабильный positionId, materialKey (К5),
 * валидация по ТЗ №8 (К4), нормализация значений.
 * Переиспользует generic-помощники из utils.js
 * (toNumber, normalizeMaterialId, getCurrentUser).
 * =====================================================
 */

/**
 * Построить materialKey по ТЗ №68–71 (К5).
 *
 * Ключ материала = «артикул + производитель»: если заполнен артикул (code),
 * ключ = `code|manufacturer` (это разделяет одинаковые артикулы разных
 * производителей). Если артикул пуст — fallback `name|model|manufacturer|unit`
 * (производитель включён в fallback, чтобы не склеивать разные бренды).
 */
function v12BuildMaterialKey(parts) {
  const code = String((parts && parts.code) || "").trim();
  const manufacturer = String((parts && parts.manufacturer) || "").trim();
  if (code) {
    // Артикул + производитель. Если производитель не заполнен — ключ остаётся
    // артикулом (обратная совместимость с ключами до появления производителя).
    return manufacturer ? (code + "|" + manufacturer) : code;
  }
  const name = String((parts && parts.name) || "").trim();
  const model = String((parts && parts.model) || "").trim();
  const unit = String((parts && parts.unit) || "").trim();
  // Fallback: имя|модель[|производитель]|ед.изм. Производитель добавляется
  // только если заполнен — иначе ключ совпадает с дореформенным.
  const segments = [name, model];
  if (manufacturer) {
    segments.push(manufacturer);
  }
  segments.push(unit);
  return segments.join("|");
}

/**
 * Сгенерировать уникальный positionId:
 *   bomId + ":" + materialKey, при дубликатах в рамках одного BOM —
 *   добавляется числовой суффикс (#2, #3, ...).
 * existingIds — Set уже занятых positionId в рамках этого BOM.
 */
function v12GeneratePositionId(bomId, materialKey, existingIds) {
  const bom = String(bomId || "").trim();
  const key = String(materialKey || "").trim() || "UNKNOWN";
  const base = bom + ":" + key;
  if (!existingIds || !existingIds.has(base)) {
    return base;
  }
  let n = 2;
  while (existingIds && existingIds.has(base + "#" + n)) {
    n++;
  }
  return base + "#" + n;
}

/**
 * Валидация позиции по ТЗ №8 (К4):
 * обязательны — Строка, Наименование, Модель, Ед.изм, Требуемое,
 * Зарезервировано (0 — валидный дефолт), Срок; Код — НЕ обязателен.
 */
function v12ValidatePosition(row) {
  const P = V12_CONFIG.POSITION_COLUMNS;
  const missing = {
    row: !String(row[P.BOM_ROW - 1] || "").trim(),
    name: !String(row[P.MATERIAL_NAME - 1] || "").trim(),
    model: !String(row[P.MODEL - 1] || "").trim(),
    unit: !String(row[P.UNIT - 1] || "").trim(),
    requiredQty: toNumber(row[P.REQUIRED_QTY - 1]) <= 0,
    deadline: !(row[P.DEADLINE - 1] !== "" && row[P.DEADLINE - 1] !== null && row[P.DEADLINE - 1] !== undefined)
  };
  missing.hasError = missing.row || missing.name || missing.model || missing.unit ||
    missing.requiredQty || missing.deadline;
  return { valid: !missing.hasError, missing: missing };
}

/**
 * Нормализация строки для сравнения (без регистра/пробелов).
 */
function v12Norm(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Нормализовать e-mail для сопоставления: без пробелов и в нижнем регистре.
 *
 * Зачем: права доступа (RBAC) ищут пользователя в V12_ROLE_MAP ТОЧНЫМ
 * сравнением строк. Google отдаёт адрес в нижнем регистре, а владелец мог
 * вписать его с заглавными буквами (в карте уже есть такой адрес) — тогда роль
 * не находилась, и правка «Заказано» в «Сводке дефицитов» откатывалась, хотя
 * право у роли снабженца ЕСТЬ.
 */
function v12NormalizeEmail(email) {
  return String(email === null || email === undefined ? "" : email)
    .trim()
    .toLowerCase();
}

/**
 * Похоже ли значение на e-mail (а не на «unknown» из getCurrentUser).
 */
function v12IsEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value === null || value === undefined ? "" : value).trim());
}

/**
 * АНОНИМНЫЙ ключ текущего пользователя (не раскрывает личность).
 *
 * Нужен там, где платформа принципиально не отдаёт e-mail: в исполнении по
 * установленному onEdit-триггеру `Session.getActiveUser().getEmail()` для
 * чужого (не владельца скрипта) аккаунта возвращает пустую строку — это
 * документированное ограничение («script runs without that user's
 * authorization»). Ключ же платформа отдаёт всегда: он уникален для
 * пользователя, но личности не раскрывает, поэтому по нему можно разложить
 * ОБЩИЙ реестр «кто есть кто» (см. v12RememberDeclaredUserEmail).
 *
 * Возвращает ключ или "" (недоступен).
 */
function v12GetAnonymousUserKey() {
  try {
    return String(Session.getTemporaryActiveUserKey() || "").trim();
  } catch (e) {
    return "";
  }
}

/**
 * Ключ записи общего реестра «анонимный ключ → e-mail».
 */
function v12UserEmailRegistryKey(anonymousKey) {
  return V12_CONFIG.SETTINGS.USER_EMAIL_REGISTRY_PREFIX + String(anonymousKey || "").trim();
}

/**
 * Запомнить e-mail пользователя в ОБЩЕМ реестре скрипта по его анонимному ключу.
 *
 * Зачем второй носитель, если есть свойства пользователя. Свойства
 * пользователя доступны «текущему ИЛИ ЭФФЕКТИВНОМУ пользователю»: в
 * исполнении по установленному onEdit-триггеру эффективный пользователь —
 * владелец таблицы, поэтому личная настройка экономиста в триггере не видна и
 * права снова не определялись (галочка «Реальная поставка» откатывалась).
 * Реестр живёт в свойствах СКРИПТА (видны всем исполнениям) и не раскрывает
 * личность: ключ — анонимный.
 *
 * Записи старше TTL не используются: анонимный ключ платформа меняет раз в
 * 30 дней, поэтому протухшая запись просто перестаёт находиться.
 */
function v12RememberDeclaredUserEmail(email) {
  const value = v12NormalizeEmail(email);
  const key = v12GetAnonymousUserKey();
  if (!value || !key) {
    return "";
  }
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props) {
      return "";
    }
    props.setProperty(v12UserEmailRegistryKey(key), value);
    props.setProperty(v12UserEmailRegistryKey(key) + "|AT", String(new Date().getTime()));
  } catch (e) {
    return "";
  }
  return value;
}

/**
 * E-mail из ОБЩЕГО реестра по анонимному ключу текущего пользователя.
 *
 * Возвращает нормализованный e-mail или "" (записи нет либо она протухла).
 */
function v12GetRegisteredUserEmail() {
  const key = v12GetAnonymousUserKey();
  if (!key) {
    return "";
  }
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props) {
      return "";
    }
    const value = v12NormalizeEmail(props.getProperty(v12UserEmailRegistryKey(key)));
    if (!value) {
      return "";
    }
    const ttlDays = toNumber(V12_CONFIG.SETTINGS.USER_EMAIL_REGISTRY_TTL_DAYS);
    if (ttlDays > 0) {
      const at = toNumber(props.getProperty(v12UserEmailRegistryKey(key) + "|AT"));
      if (!at || (new Date().getTime() - at) > ttlDays * 24 * 60 * 60 * 1000) {
        return "";
      }
    }
    return value;
  } catch (e) {
    return "";
  }
}

/**
 * E-mail, который пользователь указал САМ.
 *
 * Порядок:
 *   1) свойство ПОЛЬЗОВАТЕЛЯ (V12_USER_EMAIL) — быстрый путь, работает в
 *      исполнении от имени самого пользователя (меню, кнопка «ПРИМЕНИТЬ»);
 *   2) ОБЩИЙ реестр по анонимному ключу — путь для onEdit-триггера, где
 *      свойства пользователя принадлежат владельцу таблицы, а e-mail
 *      пользователя платформа не отдаёт.
 *
 * Мастер использует тот же приём, что и сателлит отборщика: когда системный
 * e-mail недоступен, актор указывается явно — и права проверяются по нему.
 *
 * Возвращает нормализованный e-mail или "" (не указан/недоступно).
 */
function v12GetDeclaredUserEmail() {
  try {
    const props = PropertiesService.getUserProperties();
    if (props) {
      const own = v12NormalizeEmail(props.getProperty(V12_CONFIG.SETTINGS.USER_EMAIL_PROPERTY));
      if (own) {
        return own;
      }
    }
  } catch (e) {
    // Свойства пользователя недоступны — остаётся общий реестр.
  }
  return v12GetRegisteredUserEmail();
}

/**
 * Сохранить e-mail, указанный пользователем. Пустой e-mail удаляет запись.
 *
 * Пишем ОБА носителя: свойство пользователя (быстрый путь и исполнение от имени
 * пользователя) и общий реестр по анонимному ключу (путь onEdit-триггера, где
 * свойство пользователя принадлежит владельцу таблицы и не видно).
 *
 * Возвращает сохранённое (нормализованное) значение.
 */
function v12SetDeclaredUserEmail(email) {
  const value = v12NormalizeEmail(email);
  let props = null;
  try {
    props = PropertiesService.getUserProperties();
  } catch (e) {
    props = null;
  }
  if (props) {
    if (!value) {
      props.deleteProperty(V12_CONFIG.SETTINGS.USER_EMAIL_PROPERTY);
    } else {
      props.setProperty(V12_CONFIG.SETTINGS.USER_EMAIL_PROPERTY, value);
    }
  }
  if (value) {
    v12RememberDeclaredUserEmail(value);
  }
  return value;
}

/**
 * Пользователь НЕ определён (нет e-mail ни из системы, ни из настроек).
 *
 * «unknown» — служебная подстановка getCurrentUser(), она означает то же самое:
 * личность не установлена, проверять права по ней нельзя.
 */
function v12IsUnknownActor(email) {
  const who = v12NormalizeEmail(email);
  return !who || who === "unknown";
}

/**
 * Код проекта (агрегата) из имени BOM: часть до первого разделителя —
 * пробела, дефиса или нижнего подчёркивания.
 * Примеры: «1234.АБВ-5678 Щит» -> «1234.АБВ»; «1234 АБВ» -> «1234»;
 * «1234_АБВ» -> «1234». Пустое/отсутствующее имя -> "".
 */
function v12ExtractBomProjectCode(bomName) {
  return String(bomName || "").split(/[\s\-_]/)[0].trim();
}

/**
 * Единый нормализатор даты. Приводит любое значение к Date или null.
 *
 * Поддерживает:
 *   - Date;
 *   - число: 0/пусто → null; серийный номер даты Sheets (дни от 1899-12-30,
 *     примерно 1..2958465) → дата; крупное число → миллисекунды (timestamp);
 *   - строку: ""→null; «dd.MM.yyyy» → дата; ISO/иное → new Date, если валидна.
 *
 * ВАЖНО: без этого числовой серийный номер даты (например, 46 000)
 * трактовался бы как миллисекунды и давал 01.01.1970.
 */
function v12ToDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Число ИЛИ числовая строка. Числовая строка важна: серийный номер даты
  // Sheets может прийти как текст ("46290") — иначе new Date("46290") вернул
  // бы год 46290 (отображение «01.01.46290»).
  let num = null;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    num = Number(value.trim());
  }
  if (num !== null) {
    if (!isFinite(num) || num === 0) {
      return null;
    }
    // Серийный номер даты Google Sheets (дни от 1899-12-30).
    if (num > 0 && num < 2958466) {
      const d = new Date(1899, 11, 30);
      d.setDate(d.getDate() + Math.floor(num));
      return d;
    }
    const dn = new Date(num);
    return isNaN(dn.getTime()) ? null : dn;
  }

  const s = String(value).trim();
  if (!s) {
    return null;
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Безопасное приведение к дате (для сравнения в расчётах).
 * Возвращает timestamp (число) или исходную строку, если дата не распознана.
 */
function v12DateValue(value) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }
  const d = v12ToDate(value);
  if (d) {
    return d.getTime();
  }
  return String(value).trim();
}

/**
 * Привести значение ячейки-чекбокса к boolean.
 *
 * onEdit может отдать значение чекбокса как boolean (true/false), так и
 * строкой ("TRUE"/"FALSE", "true"/"false", "1"/"0" и локализованные формы).
 * Строгое сравнение `=== true` в этом случае ложно, из-за чего отметка
 * «Реальная поставка»/«Получено» не применяется, а состояние чекбокса
 * «сбрасывается» при пересборке проекции (сводка дефицитов остаётся).
 */
function v12IsChecked(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value === null || value === undefined || value === "") {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const s = String(value).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" ||
    s === "истина" || s === "да";
}
