/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 14_System_Setup.gs
 * =====================================================
 */



/**
 * Главная установка V11
 */
function installV11(){


const ss =
SpreadsheetApp
.getActive();



try{


createAllSheets();



createMaterialStateHeader();



createBOMRevisionHeader();



createDeficitSummaryHeader();



createBOMStateHeader();



createDashboardHeader();



createHistoryHeader();



createEventLogHeader();



createSystemLogHeader();



createArchiveHeader();



formatV11Sheets();



installV11Triggers();



debugCreateLogSheet_();



runV11Diagnostic();




SpreadsheetApp
.getUi()
.alert(
"BOM Control System V11 установлена"
);



}
catch(error){



SpreadsheetApp
.getUi()
.alert(
"Ошибка установки V11: "+
error.message
);



logSystem(

"installV11",

error.message

);


}



}









/**
 * Создание всех листов
 */
function createAllSheets(){



const ss =
SpreadsheetApp
.getActive();



Object.values(
V11_CONFIG.SHEETS
)
.forEach(
name=>{


if(
!ss.getSheetByName(name)
){


ss.insertSheet(name);


}



});


}








/**
 * MATERIAL_STATE
 */
function createMaterialStateHeader(){



createHeader(

V11_CONFIG.SHEETS.MATERIAL_STATE,

[


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


]

);


}









/**
 * BOM Revision
 */
function createBOMRevisionHeader(){


createHeader(

V11_CONFIG.SHEETS.BOM_REVISION,


[

"Дата создания",

"BOM",

"Версия",

"Создал"

]


);


}








/**
 * Сводка
 */
function createDeficitSummaryHeader(){


createHeader(

V11_CONFIG.SHEETS.DEFICIT_SUMMARY,


[

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


]

);


}








/**
 * BOM State
 */
function createBOMStateHeader(){


createHeader(

V11_CONFIG.SHEETS.BOM_STATE,


[

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


]

);



}








/**
 * Dashboard
 */
function createDashboardHeader(){


createHeader(

V11_CONFIG.SHEETS.DASHBOARD,


[

"BOM",

"Статус",

"Дата создания",

"Позиций",

"Дефицит",

"Незаказано",

"Последняя поставка",

"Крайний срок",

"Готовность"

]

);


}








/**
 * История
 */
function createHistoryHeader(){


createHeader(

V11_CONFIG.SHEETS.MATERIAL_HISTORY,


[

"Дата",

"MaterialID",

"Событие",

"Старое значение",

"Новое значение",

"Пользователь",

"Комментарий"

]


);


}








/**
 * Event Log
 */
function createEventLogHeader(){


createHeader(

V11_CONFIG.SHEETS.EVENT_LOG,


[

"Дата",

"Event",

"MaterialID",

"BOM",

"Пользователь",

"Данные"

]


);


}








/**
 * System Log
 */
function createSystemLogHeader(){


createHeader(

V11_CONFIG.SHEETS.SYSTEM_LOG,


[

"Дата",

"Тип",

"Функция",

"Пользователь",

"Сообщение",

"Данные"


]


);


}








/**
 * Архив
 */
function createArchiveHeader(){


createHeader(

V11_CONFIG.SHEETS.ARCHIVE,


[

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

]


);


}








/**
 * Универсальное создание заголовка
 */
function createHeader(
sheetName,
headers
){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
sheetName
);



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
.setValues([
headers
]);


}


}








/**
 * Форматирование
 */
function formatV11Sheets(){


Object.values(
V11_CONFIG.SHEETS
)
.forEach(
name=>{


const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
name
);



if(sheet){


sheet
.setFrozenRows(1);



sheet
.getRange(
1,
1,
1,
sheet.getLastColumn()
)
.setFontWeight(
"bold"
);


}



});


}