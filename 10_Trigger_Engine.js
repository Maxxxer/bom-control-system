/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 10_Trigger_Engine.gs
 * =====================================================
 */



/**
 * Установка всех триггеров V11
 */
function installV11Triggers(){


removeV11Triggers();



const ss =
SpreadsheetApp
.getActive();




/**
 * Изменения таблицы
 */
ScriptApp
.newTrigger(
"v11OnEdit"
)
.forSpreadsheet(ss)
.onEdit()
.create();





/**
 * Ежедневная проверка
 */
ScriptApp
.newTrigger(
"dailyV11Update"
)
.timeBased()
.everyHours(1)
.create();





/**
 * Архив
 */
ScriptApp
.newTrigger(
"archiveReceivedMaterials"
)
.timeBased()
.everyHours(1)
.create();




logSystem(

"installV11Triggers",

"Триггеры установлены"

);



}







/**
 * Удаление старых триггеров
 */
function removeV11Triggers(){


const triggers =
ScriptApp
.getProjectTriggers();



triggers.forEach(
trigger=>{


ScriptApp
.deleteTrigger(
trigger
);


});


}








/**
 * Главный onEdit V11
 */
function v11OnEdit(e){



try{



const sheet =
e.range.getSheet();



const name =
sheet.getName();



const row =
e.range.getRow();



const column =
e.range.getColumn();





/**
 * Сводка дефицитов
 */
if(
name ===
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
){


if(
column ===
V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY
&&
row>1
){


processSummaryCheckbox(
row
);



refreshAfterChange();



}



}







/**
 * Изменение ожидаемой даты
 */
if(
name ===
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
){


if(
column ===
V11_CONFIG.DEFICIT_COLUMNS.EXPECTED_DATE
&&
row>1
){



const id =
sheet
.getRange(
row,
1
)
.getValue();



const date =
e.range
.getValue();



eventDeliveryDateChanged(

id,

date

);



refreshAfterChange();



}



}






/**
 * Изменение BOM
 */
if(
name.startsWith(
"BOM_"
)
){


checkBOMRevision();



}





}
catch(error){



logSystem(

"v11OnEdit",

error.message

);



}



}








/**
 * Обновление после события
 */
function refreshAfterChange(){

recalculateMaterials();
recalculateBOMState();
updateDeficitSummary();
updateDashboard();
applyStatusColors();



}







/**
 * Плановое обновление
 */
function dailyV11Update(){



try{


refreshAfterChange();



}
catch(error){



logSystem(

"dailyV11Update",

error.message

);



}



}







/**
 * Защита от параллельного запуска
 */
function lockV11(){



const lock =
LockService
.getScriptLock();



lock
.waitLock(
30000
);



return lock;


}





/**
 * Безопасное выполнение
 */
function safeRun(
functionName
){



const lock =
lockV11();



try{


functionName();



}
finally{


lock.releaseLock();


}



}