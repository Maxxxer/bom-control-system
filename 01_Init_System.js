/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 01_Init_System.gs
 * =====================================================
 */


/**
 * Главная функция инициализации
 */
function initV11(){


  const ss =
    SpreadsheetApp
      .getActive();



  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.MATERIAL_STATE,
    getMaterialStateHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.BOM_STATE,
    getBOMStateHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.EVENT_LOG,
    getEventHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.MATERIAL_HISTORY,
    getHistoryHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.ARCHIVE,
    getArchiveHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.BOM_REVISION,
    getRevisionHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.DASHBOARD,
    getDashboardHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.DEFICIT_SUMMARY,
    getSummaryHeaders()
  );


  createSheetIfMissing(
    ss,
    V11_CONFIG.SHEETS.SYSTEM_LOG,
    getSystemLogHeaders()
  );


  SpreadsheetApp
    .getUi()
    .alert(
      "BOM CONTROL V11 установлен"
    );


}



/**
 * Создание листа
 */
function createSheetIfMissing(
  ss,
  name,
  headers
){


  let sheet =
    ss.getSheetByName(name);



  if(!sheet){


    sheet =
      ss.insertSheet(name);


  }



  if(
    sheet.getLastRow()===0
  ){


    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues(
        [headers]
      );


    sheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setFontWeight(
        "bold"
      );


  }



}



/**
 * MATERIAL_STATE (21 колонок)
 */
function getMaterialStateHeaders(){


return [

"MaterialID",

"BOM",

"Версия BOM",

"Строка BOM",

"Код материала",

"Наименование",

"Ед.изм",

"Требуется",

"Зарезервировано",

"Заказано",

"Дефицит",

"Ожидаемая поставка",

"Крайний срок",

"Реальная поставка",

"Дата реальной поставки",

"Получено",

"Дата получения",

"Кто получил",

"Статус",

"State",

"Обновлено"

];


}




/**
 * BOM_STATE (11 колонок)
 */
function getBOMStateHeaders(){


return [

"BOM",

"Версия",

"Дата создания",

"Позиций",

"Дефицит",

"Незаказано",

"Последняя поставка",

"Крайний срок",

"Статус",

"Готовность",

"Обновлено"


];


}



/**
 * EVENT_LOG (7 колонок)
 */
function getEventHeaders(){


return [

"Дата",

"Event ID",

"Тип события",

"MaterialID",

"BOM",

"Пользователь",

"Данные"

];


}



/**
 * HISTORY (7 колонок)
 */
function getHistoryHeaders(){


return [

"Дата",

"MaterialID",

"Событие",

"Старое значение",

"Новое значение",

"Пользователь",

"Комментарий"

];


}




/**
 * ARCHIVE (11 колонок)
 */
function getArchiveHeaders(){


return [

"Дата архивации",

"BOM",

"Версия",

"Код материала",

"Наименование",

"Количество",

"Дата поставки",

"Дата получения",

"Кто отметил",

"Состояние",

"История"

];


}




/**
 * BOM_REVISION (4 колонки)
 */
function getRevisionHeaders(){


return [

"Дата создания",

"BOM",

"Версия",

"Создал"

];


}




/**
 * DASHBOARD (9 колонок)
 */
function getDashboardHeaders(){


return [

"BOM",

"Статус",

"Дата создания",

"Позиций",

"Дефицит",

"Незаказано",

"Последняя поставка",

"Крайний срок",

"Готовность"

];


}




/**
 * DEFICIT_SUMMARY (11 колонок)
 */
function getSummaryHeaders(){


return [

"MaterialID",

"BOM",

"Код",

"Наименование",

"Требуется",

"Заказано",

"Дефицит",

"Ожидаемая поставка",

"Крайний срок",

"Реальная поставка",

"Статус"


];


}




/**
 * SYSTEM_LOG (5 колонок)
 */
function getSystemLogHeaders(){


return [

"Дата",

"Функция",

"Сообщение",

"Уровень",

"Данные"

];


}
