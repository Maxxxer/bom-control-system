/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 06_BOM_State_Engine.gs
 *
 * Расчёт состояния BOM
 *
 * VERSION:
 * 11.1.4 FINAL PATCHED
 *
 * =====================================================
 */


/**
 * =====================================================
 * Пересчёт состояния BOM
 * =====================================================
 */

function recalculateBOMState(){


try{


const ss =
SpreadsheetApp.getActive();



const materialSheet =
ss.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



const bomSheet =
ss.getSheetByName(
V11_CONFIG.SHEETS.BOM_STATE
);



if(
!materialSheet ||
!bomSheet
){

throw new Error(
"Нет MATERIAL_STATE или BOM_STATE"
);

}





const data =
materialSheet
.getDataRange()
.getValues();



if(
data.length<=1
){

return [];

}





const bomMap = {};





for(
let i=1;
i<data.length;
i++
){



const row =
data[i];



const bom =
row[
V11_CONFIG
.MATERIAL_COLUMNS
.BOM-1
];



if(!bom)
continue;




const state =
row[
V11_CONFIG
.MATERIAL_COLUMNS
.STATE-1
];



/**
 * Удалённые материалы
 * не участвуют в расчёте
 */

if(
state ===
V11_CONFIG
.MATERIAL_STATE
.REMOVED
){

continue;

}




if(!bomMap[bom]){


bomMap[bom]={


version:
row[
V11_CONFIG
.MATERIAL_COLUMNS
.BOM_VERSION-1
]
||
"V1",


total:0,


ready:0,


notOrdered:0,


partial:0,


late:0,


waiting:0,


stock:0,


received:0


};


}





const item =
bomMap[bom];



item.total++;





const required =
Number(
row[
V11_CONFIG
.MATERIAL_COLUMNS
.REQUIRED-1
]
)
||
0;



const ordered =
Number(
row[
V11_CONFIG
.MATERIAL_COLUMNS
.ORDERED-1
]
)
||
0;



const realDelivery =
Number(
row[
V11_CONFIG
.MATERIAL_COLUMNS
.REAL_DELIVERY-1
]
)
||
0;



const received =
row[
V11_CONFIG
.MATERIAL_COLUMNS
.RECEIVED-1
] === true;



const expected =
row[
V11_CONFIG
.MATERIAL_COLUMNS
.EXPECTED_DATE-1
];



const deadline =
row[
V11_CONFIG
.MATERIAL_COLUMNS
.DEADLINE_DATE-1
];





/**
 * READY
 */

if(
state ===
V11_CONFIG
.MATERIAL_STATE
.READY
){

item.ready++;

continue;

}





/**
 * Получено производством
 */

if(received){

item.received++;

continue;

}





/**
 * На складе
 */

if(
realDelivery>0
){

item.stock++;

continue;

}





/**
 * Не заказано
 */

if(
required>0 &&
ordered===0
){

item.notOrdered++;

continue;

}





/**
 * Частичный заказ
 */

if(
ordered>0 &&
ordered<required
){

item.partial++;

continue;

}





/**
 * Полный заказ
 */

if(
ordered>=required &&
required>0
){



if(
expected &&
deadline &&
new Date(expected)
>
new Date(deadline)
){

item.late++;

}

else{

item.waiting++;

}


}





}





const output=[];



Object.keys(bomMap)
.forEach(
bom=>{


const item =
bomMap[bom];



let status;



/**
 * Приоритет статусов BOM
 */

if(
item.notOrdered>0
){

status =
V11_CONFIG
.BOM_STATUS
.RED;


}

else if(
item.partial>0
){

status =
V11_CONFIG
.BOM_STATUS
.PARTIAL;


}

else if(
item.late>0
){

status =
V11_CONFIG
.BOM_STATUS
.ORANGE;


}

else if(
item.waiting>0
){

status =
V11_CONFIG
.BOM_STATUS
.YELLOW;


}

else{

status =
V11_CONFIG
.BOM_STATUS
.GREEN;


}




/**
 *
 * BOM_STATE:
 *
 * 1 BOM
 * 2 VERSION
 * 3 TOTAL_MATERIALS
 * 4 READY_MATERIALS
 * 5 STATUS
 * 6 UPDATED
 *
 */


output.push([


bom,


item.version,


item.total,


item.ready,


status,


new Date()


]);



});






/**
 * Очистка BOM_STATE
 */

if(
bomSheet.getLastRow()>1
){


bomSheet
.getRange(

2,

1,

bomSheet.getLastRow()-1,

V11_CONFIG
.COLUMN_COUNT
.BOM_STATE

)
.clearContent();


}





/**
 * Запись результата
 */

if(
output.length>0
){


bomSheet
.getRange(

2,

1,

output.length,

output[0].length

)
.setValues(output);


}




logSystem(

"recalculateBOMState",

"Обработано BOM: "
+
output.length

);



return output;



}
catch(error){


logSystem(

"recalculateBOMState",

error.message

);


return [];

}



}