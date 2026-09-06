/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 15_Main_Controller.gs
 *
 * Главный контроллер системы
 * =====================================================
 */


/**
 * =====================================================
 * Меню
 * =====================================================
 */

function onOpen(){


SpreadsheetApp
.getUi()
.createMenu(
"BOM CONTROL V11"
)


.addItem(
"🔄 Обновить систему",
"runFullUpdate"
)


.addSeparator()


.addItem(
"📥 Импорт BOM",
"showBOMImport"
)


.addItem(
"📊 Обновить Dashboard",
"updateDashboard"
)


.addItem(
"📦 Проверить получение",
"archiveReceivedMaterials"
)


.addSeparator()


.addItem(
"🔎 Диагностика",
"runV11Diagnostic"
)


.addItem(
"🧪 Тест V11",
"runV11Debug"
)


.addItem(
"🎨 Тест цветов",
"runV11StatusTest"
)


.addSeparator()


.addItem(
"⚙ Установка V11",
"installV11"
)


.addToUi();

}



/**
 * =====================================================
 * Синхронизация Google Sheets
 * =====================================================
 */

function syncV11(){

SpreadsheetApp.flush();

Utilities.sleep(500);

}



/**
 * =====================================================
 * Полное обновление
 * =====================================================
 */


function runFullUpdate(){


const lock =
LockService
.getScriptLock();



try{


lock.waitLock(
30000
);



logSystem(
"runFullUpdate",
"Старт обновления"
);



/*
1.
Сохраняем ручные изменения
*/


syncV11();


saveDeficitChanges();



logSystem(
"runFullUpdate",
"Изменения сохранены"
);



/*
2.
Расчет материалов
*/


recalculateMaterials();



syncV11();



/*
3.
Архив полученных
*/


archiveReceivedMaterials();



syncV11();



/*
4.
Повторный расчет после архива
*/


recalculateMaterials();



syncV11();



/*
5.
Обновление дефицитов
*/


updateDeficitSummary();



syncV11();



/*
6.
Состояние BOM
*/


recalculateBOMState();



syncV11();



/*
7.
Цвета
*/


applyStatusColors();



syncV11();



/*
8.
Dashboard
*/


updateDashboard();



syncV11();



logSystem(
"runFullUpdate",
"Обновление завершено"
);



SpreadsheetApp
.getUi()
.alert(
"✅ BOM CONTROL V11 обновлена"
);



}


catch(error){


logSystem(
"runFullUpdate",
"ОШИБКА: "+error.message,
error,
"ERROR"
);



SpreadsheetApp
.getUi()
.alert(
"Ошибка:\n"+
error.message
);



}


finally{


if(lock.hasLock()){

lock.releaseLock();

}


}


}





/**
 * =====================================================
 * Импорт BOM
 * =====================================================
 */


function showBOMImport(){


SpreadsheetApp
.getUi()
.alert(
"Импорт BOM подключается к источнику данных"
);


}





/**
 * =====================================================
 * Проверка системы
 * =====================================================
 */


function fullSystemCheck(){


const result={};



result.materialState =
checkSheetExists(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



result.summary =
checkSheetExists(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



result.dashboard =
checkSheetExists(
V11_CONFIG.SHEETS.DASHBOARD
);



result.bom =
checkSheetExists(
V11_CONFIG.SHEETS.BOM_STATE
);



result.archive =
checkSheetExists(
V11_CONFIG.SHEETS.ARCHIVE
);



result.events =
checkSheetExists(
V11_CONFIG.SHEETS.EVENT_LOG
);



logSystem(
"fullSystemCheck",
"Проверка завершена",
result
);



return result;


}





/**
 * =====================================================
 * Обновление одного BOM
 * =====================================================
 */


function updateSingleBOM(bom){


if(!bom)
return;



const data =
getMaterialsByBOM(
bom
);



if(
!data ||
!data.length
){

return;

}



if(
typeof calculateSingleBOMState==="function"
){

calculateSingleBOMState(
bom,
data
);

}



recalculateBOMState();



applyStatusColors();



updateDashboard();



logSystem(
"updateSingleBOM",
"BOM обновлен: "+bom
);



}




/**
 * =====================================================
 * Восстановление системы
 * =====================================================
 */


function rebuildV11(){


logSystem(
"rebuildV11",
"Начато восстановление"
);



installV11();



syncV11();



runFullUpdate();



logSystem(
"rebuildV11",
"Восстановление завершено"
);


}