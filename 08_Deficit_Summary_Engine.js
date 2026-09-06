/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 08_Deficit_Summary_Engine.gs
 *
 * Сводка дефицитов
 *
 * FINAL STABLE VERSION
 *
 * =====================================================
 */


/**
 * =====================================================
 * Обновление сводки дефицитов
 * =====================================================
 */

function updateDeficitSummary(){


const ss =
SpreadsheetApp.getActive();



const source =
ss.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



const target =
ss.getSheetByName(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



if(!source || !target){

throw new Error(
"Нет MATERIAL_STATE или DEFICIT_SUMMARY"
);

}



/*
 Сохраняем чекбоксы
*/

const oldCheckbox={};



const oldLastRow =
target.getLastRow();



if(oldLastRow>1){


const oldData =
target
.getRange(
2,
1,
oldLastRow-1,
11
)
.getValues();



oldData.forEach(row=>{


const id =
row[
V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID-1
];


if(id){

oldCheckbox[id] =
row[
V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY-1
] === true;

}


});


}





const data =
source
.getDataRange()
.getValues();



const result=[];



for(let i=1;i<data.length;i++){


const row=data[i];



const materialId =
row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_ID-1
];



if(!materialId)
continue;



/*
 Полученные материалы убираем
*/

if(
row[
V11_CONFIG.MATERIAL_COLUMNS.RECEIVED-1
] === true
){

continue;

}




const required =
parseNumber(
row[
V11_CONFIG.MATERIAL_COLUMNS.REQUIRED-1
]
);



const ordered =
parseNumber(
row[
V11_CONFIG.MATERIAL_COLUMNS.ORDERED-1
]
);



const deficit =
Math.max(
required-ordered,
0
);



const expected =
row[
V11_CONFIG.MATERIAL_COLUMNS.EXPECTED_DATE-1
] || "";



const deadline =
row[
V11_CONFIG.MATERIAL_COLUMNS.DEADLINE_DATE-1
] || "";



let status;



if(ordered<=0){


status =
V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED;


}
else if(
ordered < required
){


status =
V11_CONFIG.MATERIAL_STATUS.PARTIAL_ORDER;


}
else if(
expected &&
deadline &&
new Date(expected)>new Date(deadline)
){


status =
V11_CONFIG.MATERIAL_STATUS.ORDERED_LATE;


}
else{


status =
V11_CONFIG.MATERIAL_STATUS.ORDERED_ON_TIME;


}





result.push([


materialId,


row[
V11_CONFIG.MATERIAL_COLUMNS.BOM-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_CODE-1
],


row[
V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_NAME-1
],


required,


ordered,


deficit,


expected,


deadline,


oldCheckbox[materialId] || false,


status


]);


}





/*
 Очистка старых данных
*/

const rowsToClear =
target.getLastRow()-1;



if(rowsToClear>0){


target
.getRange(
2,
1,
rowsToClear,
11
)
.clearContent();


}





/*
 Запись
*/

if(result.length){


target
.getRange(
2,
1,
result.length,
11
)
.setValues(result);


}



createDeliveryCheckboxes();



SpreadsheetApp.flush();



logSystem(

"updateDeficitSummary",

"Материалов в сводке: "+result.length

);



}





/**
 * =====================================================
 * Безопасное число
 * =====================================================
 */


function parseNumber(value){


if(value===null || value==="")
return 0;



if(typeof value==="number")
return value;



const result =
String(value)
.replace(",",".")
.match(/[\d.]+/);



return result
?
Number(result[0])
:
0;


}






/**
 * =====================================================
 * Сохранение ручных изменений
 *
 * Заказано
 * Даты
 *
 * =====================================================
 */


function saveDeficitChanges(){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



if(!sheet)
return;



SpreadsheetApp.flush();



const lastRow =
sheet.getLastRow();



if(lastRow<2)
return;




const data =
sheet
.getRange(
2,
1,
lastRow-1,
11
)
.getValues();



let changed=0;




for(let i=0;i<data.length;i++){


const row=data[i];



const materialId =
row[
V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID-1
];



if(!materialId)
continue;




const ordered =
parseNumber(
row[
V11_CONFIG.DEFICIT_COLUMNS.ORDERED-1
]
);



const expected =
row[
V11_CONFIG.DEFICIT_COLUMNS.EXPECTED_DATE-1
] || "";



const deadline =
row[
V11_CONFIG.DEFICIT_COLUMNS.DEADLINE_DATE-1
] || "";





const material =
getMaterialById(
materialId
);



if(!material)
continue;




const old =
material.values;



const oldOrdered =
parseNumber(
old[
V11_CONFIG.MATERIAL_COLUMNS.ORDERED-1
]
);



const oldExpected =
old[
V11_CONFIG.MATERIAL_COLUMNS.EXPECTED_DATE-1
] || "";



const oldDeadline =
old[
V11_CONFIG.MATERIAL_COLUMNS.DEADLINE_DATE-1
] || "";





if(

oldOrdered===ordered &&

String(oldExpected)===String(expected) &&

String(oldDeadline)===String(deadline)

){

continue;

}





updateMaterialState(

materialId,

{

ORDERED:ordered,

EXPECTED_DATE:expected,

DEADLINE_DATE:deadline

}

);



SpreadsheetApp.flush();



if(
typeof addMaterialHistory==="function"
){


addMaterialHistory({

materialId:materialId,

event:
"DEFICIT_SUMMARY_UPDATE",

oldValue:
JSON.stringify({

ordered:oldOrdered,

expected:oldExpected,

deadline:oldDeadline

}),


newValue:
JSON.stringify({

ordered:ordered,

expected:expected,

deadline:deadline

}),


comment:
"Изменение через сводку дефицитов"

});


}



changed++;



}



SpreadsheetApp.flush();



logSystem(

"saveDeficitChanges",

"Изменено материалов: "+changed

);



}





/**
 * =====================================================
 * Чекбоксы
 * =====================================================
 */


function createDeliveryCheckboxes(){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



if(!sheet)
return;



const rows =
sheet.getLastRow()-1;



if(rows<=0)
return;




sheet
.getRange(
2,
V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY,
rows,
1
)
.setDataValidation(

SpreadsheetApp
.newDataValidation()
.requireCheckbox()
.build()

);



}






/**
 * =====================================================
 * Обработка поставки
 * =====================================================
 */


function processSummaryCheckbox(row){



const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



if(!sheet)
return;




const materialId =
sheet
.getRange(
row,
V11_CONFIG.DEFICIT_COLUMNS.MATERIAL_ID
)
.getValue();



if(!materialId)
return;




const checked =
sheet
.getRange(
row,
V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY
)
.getValue();




if(checked===true){


confirmRealDelivery(materialId);



}
else{


cancelRealDelivery(materialId);


}



}





/**
 * =====================================================
 * Полное обновление
 * =====================================================
 */


function refreshDeficitStatus(){


saveDeficitChanges();



SpreadsheetApp.flush();


Utilities.sleep(500);



recalculateMaterials();



SpreadsheetApp.flush();



updateDeficitSummary();



SpreadsheetApp.flush();



recalculateBOMState();



applyStatusColors();



updateDashboard();



logSystem(

"refreshDeficitStatus",

"Статусы обновлены"

);



}