/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 13_BOM_Import_Engine.gs
 * =====================================================
 */



/**
 * Основной импорт BOM
 */
function importBOM(
bomData
){


try{


const bomName =
bomData.name;



const version =
createBOMVersion(
bomName
);



const materials =
parseBOMFile(
bomData
);



materials.forEach(
material=>{


const exists =
findMaterialInBOM(
bomName,
material.row
);



if(!exists){


addMaterialFromBOM({

bom:bomName,

version:version,

row:material.row,

code:material.code,

name:material.name,

unit:material.unit,

required:material.qty


});


}
else{


compareMaterialChange(

exists,

material

);


}


});



createEvent(

"BOM_IMPORTED",

{

bom:bomName,

version:version

}

);



refreshAfterChange();



}
catch(error){


logSystem(

"importBOM",

error.message

);


throw error;


}


}







/**
 * Создание версии BOM
 */
function createBOMVersion(
bom
){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.BOM_REVISION
);



const version =
"V"+
(
sheet.getLastRow()
);



sheet.appendRow([


new Date(),

bom,

version,

getCurrentUser()


]);



return version;


}







/**
 * Поиск материала
 */
function findMaterialInBOM(
bom,
rowNumber
){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



const data =
sheet
.getDataRange()
.getValues();



for(
let i=1;
i<data.length;
i++
){


if(

data[i]
[
V11_CONFIG.MATERIAL_COLUMNS.BOM-1
]
===bom

&&

data[i]
[
V11_CONFIG.MATERIAL_COLUMNS.BOM_ROW-1
]
===rowNumber

){


return {

id:
data[i][0],

row:
i+1,

values:
data[i]


};


}



}



return null;


}








/**
 * Проверка изменения материала
 */
function compareMaterialChange(
oldMaterial,
newMaterial
){



const oldQty =
oldMaterial.values[
V11_CONFIG.MATERIAL_COLUMNS.REQUIRED-1
];



if(
Number(oldQty)!==
Number(newMaterial.qty)
){



createEvent(

V11_CONFIG.EVENTS.BOM_QTY_CHANGED,

{

materialId:
oldMaterial.id,


oldValue:
oldQty,


newValue:
newMaterial.qty


}

);



}



const oldName =
oldMaterial.values[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_NAME-1
];



if(
oldName!==newMaterial.name
){



createEvent(

V11_CONFIG.EVENTS.BOM_NAME_CHANGED,

{

materialId:
oldMaterial.id,


oldValue:
oldName,


newValue:
newMaterial.name


}

);



}



}







/**
 * Парсинг BOM
 *
 * Подключается к вашему формату
 */
function parseBOMFile(
bomData
){



/*

Возвращает:

[
{
row:1,
code:"001-А-10",
name:"Труба",
unit:"м",
qty:10
}
]


*/



return bomData.materials;


}








/**
 * Полная синхронизация BOM
 */
function syncAllBOM(){



const files =
getAllBOMFiles();



files.forEach(
file=>{


importBOM(
file
);


});



logSystem(

"syncAllBOM",

"Все BOM синхронизированы"

);



}