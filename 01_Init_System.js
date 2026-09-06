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
 * MATERIAL_STATE
 */
function getMaterialStateHeaders(){


return [

"MaterialID",

"BOM",

"Версия BOM",

"№ строки BOM",

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

"Получено производством",

"Дата получения",

"Кто получил",

"Статус",

"State",

"Последнее изменение"

];


}




/**
 * BOM_STATE
 */
function getBOMStateHeaders(){


return [

"BOM",

"Версия",

"Дата создания",

"Количество позиций",

"Позиций в дефиците",

"Незаказанные позиции",

"Последний срок поставки",

"Крайний срок",

"Статус",

"Обновлено"


];


}



/**
 * EVENT_LOG
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
 * HISTORY
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
 * ARCHIVE
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

"Последнее состояние",

"История"

];


}




/**
 * BOM_REVISION
 */
function getRevisionHeaders(){


return [

"Дата",

"BOM",

"Старая версия",

"Новая версия",

"Тип изменения",

"Материал",

"Старое значение",

"Новое значение",

"Кто изменил"

];


}





/**
 * DASHBOARD
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

"Готовность %"

];


}





/**
 * СВОДКА
 */
function getSummaryHeaders(){


return [

"MaterialID",

"BOM",

"Код материала",

"Наименование",

"Требуется",

"Заказано",

"Дефицит",

"Ожидаемая поставка",

"Крайний срок",

"Реальная поставка",

"Поступление",

"Статус"


];


}




/**
 * SYSTEM_LOG
 */
function getSystemLogHeaders(){


return [

"Дата",

"Функция",

"Ошибка",

"Пользователь"


];


}