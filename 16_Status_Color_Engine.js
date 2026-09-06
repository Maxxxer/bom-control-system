/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 16_Status_Color_Engine.gs
 *
 * Цветовое оформление
 *
 * Приоритет:
 *
 * Получено производством
 * ↓
 * На складе
 * ↓
 * Не заказано
 * ↓
 * Заказано частично
 * ↓
 * Заказано (опаздывает)
 * ↓
 * Заказано (в срок)
 * ↓
 * Готов
 *
 * =====================================================
 */


function applyStatusColors(){

  colorMaterialStateRows();

  colorDeficitSummaryRows();

  colorBOMStateRows();

}



/**
 * =====================================================
 * MATERIAL_STATE
 * =====================================================
 */


function colorMaterialStateRows(){


const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.MATERIAL_STATE
);



if(!sheet)
return;



const lastRow =
sheet.getLastRow();



const lastColumn =
sheet.getLastColumn();



if(lastRow<2)
return;



const range =
sheet.getRange(
2,
1,
lastRow-1,
lastColumn
);



const data =
range.getValues();



const colors =
data.map(row=>{


const received =
row[
V11_CONFIG.MATERIAL_COLUMNS.RECEIVED-1
] === true;



const stock =
row[
V11_CONFIG.MATERIAL_COLUMNS.REAL_DELIVERY-1
] === true;



const status =
row[
V11_CONFIG.MATERIAL_COLUMNS.STATUS-1
];



let color;



if(received){

color =
V11_CONFIG.COLORS.RECEIVED;

}


else if(stock){

color =
V11_CONFIG.COLORS.STOCK;

}


else{


color =
getStatusColor(status);


}



return Array(lastColumn)
.fill(color);



});



range.setBackgrounds(colors);


}





/**
 * =====================================================
 * DEFICIT_SUMMARY
 * =====================================================
 */


function colorDeficitSummaryRows(){


const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
);



if(!sheet)
return;



const lastRow =
sheet.getLastRow();



const lastColumn =
sheet.getLastColumn();



if(lastRow<2)
return;



const range =
sheet.getRange(
2,
1,
lastRow-1,
lastColumn
);



const data =
range.getValues();



const colors =
data.map(row=>{


const ordered =
Number(row[
V11_CONFIG.DEFICIT_COLUMNS.ORDERED-1
]||0);



const deficit =
Number(row[
V11_CONFIG.DEFICIT_COLUMNS.DEFICIT-1
]||0);



const expected =
row[
V11_CONFIG.DEFICIT_COLUMNS.EXPECTED_DATE-1
];



const deadline =
row[
V11_CONFIG.DEFICIT_COLUMNS.DEADLINE_DATE-1
];



const realDelivery =
row[
V11_CONFIG.DEFICIT_COLUMNS.REAL_DELIVERY-1
] === true;



const status =
row[
V11_CONFIG.DEFICIT_COLUMNS.STATUS-1
];



let color;



if(status==="Получено производством"){

color =
V11_CONFIG.COLORS.RECEIVED;


}

else if(realDelivery){

color =
V11_CONFIG.COLORS.STOCK;


}

else if(
deficit>0 &&
ordered===0
){

color =
V11_CONFIG.COLORS.RED;


}

else if(
deficit>0 &&
ordered>0
){

color =
V11_CONFIG.COLORS.RED;


}

else if(
expected &&
deadline &&
new Date(expected)>
new Date(deadline)
){

color =
V11_CONFIG.COLORS.ORANGE;


}

else{


color =
getStatusColor(status);


}



return Array(lastColumn)
.fill(color);



});



range.setBackgrounds(colors);


}





/**
 * =====================================================
 * BOM_STATE
 * =====================================================
 */


function colorBOMStateRows(){


const sheet =
SpreadsheetApp
.getActive()
.getSheetByName(
V11_CONFIG.SHEETS.BOM_STATE
);



if(!sheet)
return;



const lastRow =
sheet.getLastRow();



const lastColumn =
sheet.getLastColumn();



if(lastRow<2)
return;



const range =
sheet.getRange(
2,
1,
lastRow-1,
lastColumn
);



const data =
range.getValues();



const colors =
data.map(row=>{


/*
 I колонка STATUS
 */

const status =
row[8];



return Array(lastColumn)
.fill(
getStatusColor(status)
);



});



range.setBackgrounds(colors);


}






/**
 * =====================================================
 * Общий справочник цветов
 * =====================================================
 */


function getStatusColor(status){


  if(!status)
    return "#FFFFFF";


  status = String(status).trim();


  switch(status){


    // 🔴 Красная зона
    case "Не заказано":
    case "Есть незаказанный материал":
    case "Есть незаказанные материалы":
    case "Заказано частично":
    case "Частично заказан":

      return V11_CONFIG.COLORS.RED;



    // 🟠 Просрочка
    case "Заказано (опаздывает)":
    case "Поставка позже срока":
    case "Просрочено":

      return V11_CONFIG.COLORS.ORANGE;



    // 🟡 Ожидание поставки
    case "Заказано (в срок)":
    case "Ожидается поставка":
    case "Ожидается поставка ":
    case "WAITING":

      return V11_CONFIG.COLORS.YELLOW;



    // 🔵 Склад
    case "На складе":
    case "STOCK":

      return V11_CONFIG.COLORS.STOCK;



    // 🟢 Получено
    case "Получено":
    case "Получено производством":
    case "RECEIVED":

      return V11_CONFIG.COLORS.RECEIVED;



    // 🟢 Готово
    case "Готов":
    case "Готов к производству":
    case "READY":

      return V11_CONFIG.COLORS.READY;



    default:

      return "#FFFFFF";

  }

}