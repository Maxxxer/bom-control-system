/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 09_Archive_Engine.gs
 *
 * Архив материалов
 *
 * =====================================================
 */


/**
 * =====================================================
 * Архивирование одного материала
 * =====================================================
 */

function archiveMaterial(materialId){


const material =
getMaterialById(materialId);



if(!material){

throw new Error(
"Материал не найден: "+materialId
);

}



const row =
material.values;



const archive =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.ARCHIVE
);



if(!archive){

throw new Error(
"Нет листа ARCHIVE"
);

}



const history =
getMaterialHistory(
materialId
);



archive.appendRow([


new Date(),


row[
V11_CONFIG.MATERIAL_COLUMNS.BOM-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.BOM_VERSION-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_CODE-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_NAME-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.REQUIRED-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.REAL_DELIVERY_DATE-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.RECEIVED_DATE-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.RECEIVED_USER-1
],


V11_CONFIG.MATERIAL_STATE.ARCHIVED,


JSON.stringify(history)


]);



/*
 После записи в архив
 меняем состояние
*/


updateMaterialState(

materialId,

{

STATE:
V11_CONFIG.MATERIAL_STATE.ARCHIVED,


STATUS:
V11_CONFIG.MATERIAL_STATUS.ARCHIVED


}

);



SpreadsheetApp.flush();



createEvent(

V11_CONFIG.EVENTS.MATERIAL_ARCHIVED,

{

materialId:materialId,

comment:
"Материал отправлен в архив"

}

);



}





/**
 * =====================================================
 * История материала
 * =====================================================
 */

function getMaterialHistory(materialId){


const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_HISTORY
);



if(!sheet)
return [];



const data =
sheet
.getDataRange()
.getValues();



const result=[];



for(
let i=1;
i<data.length;
i++
){


if(
data[i][1]===materialId
){


result.push({

date:data[i][0],

event:data[i][2],

old:data[i][3],

new:data[i][4],

user:data[i][5],

comment:data[i][6]

});


}


}



return result;


}





/**
 * =====================================================
 * Добавление истории
 * =====================================================
 */

function addMaterialHistory(data){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_HISTORY
);



if(!sheet)
return;



sheet.appendRow([


new Date(),


data.materialId || "",


data.event || "",


data.oldValue || "",


data.newValue || "",


getCurrentUser(),


data.comment || ""


]);



}





/**
 * =====================================================
 * Автоматический архив
 *
 * безопасная версия
 * =====================================================
 */

function archiveReceivedMaterials(){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



if(!sheet)
return;



const data =
sheet
.getDataRange()
.getValues();



const archiveList=[];



/*
 Сначала собираем ID
 ничего не меняем
*/


for(
let i=1;
i<data.length;
i++
){


const row=data[i];



const received =
row[
V11_CONFIG.MATERIAL_COLUMNS.RECEIVED-1
] === true;



const state =
row[
V11_CONFIG.MATERIAL_COLUMNS.STATE-1
];



const id =
row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_ID-1
];



if(
received &&
id &&
state !==
V11_CONFIG.MATERIAL_STATE.ARCHIVED
){

archiveList.push(id);


}


}



/*
 Теперь архивируем
 после окончания чтения
*/


archiveList.forEach(id=>{


archiveMaterial(id);



});



SpreadsheetApp.flush();



logSystem(

"archiveReceivedMaterials",

"Архивировано материалов: "+
archiveList.length

);



}