/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE: 07_Dashboard_Engine.gs
 *
 * Dashboard Engine
 *
 * =====================================================
 */


/**
 * =====================================================
 * Обновление Dashboard
 * =====================================================
 */

function updateDashboard(){


  const ss =
    SpreadsheetApp.getActive();


  const source =
    ss.getSheetByName(
      V11_CONFIG.SHEETS.BOM_STATE
    );


  const dashboard =
    ss.getSheetByName(
      V11_CONFIG.SHEETS.DASHBOARD
    );



  if(!source || !dashboard){

    throw new Error(
      "Нет BOM_STATE или Dashboard"
    );

  }



  const data =
    source
    .getDataRange()
    .getValues();



  /*
   Очистка старых данных
  */

  if(
    dashboard.getLastRow()>1
  ){

    dashboard
    .getRange(
      2,
      1,
      dashboard.getLastRow()-1,
      dashboard.getLastColumn()
    )
    .clearContent();

  }



  if(data.length<=1){

    logSystem(
      "updateDashboard",
      "Нет данных BOM"
    );

    return;

  }



  const rows =
    data
    .slice(1)
    .map(r=>{


      return [

        // BOM
        r[0],

        // STATUS
        r[8],

        // VERSION
        r[1],

        // Количество материалов
        r[3],

        // Дефицит
        r[4],

        // Не заказано
        r[5],

        // Последняя поставка
        r[6],

        // Дедлайн
        r[7],

        // Обновлено
        r[10]

      ];


    });



  dashboard
  .getRange(
    2,
    1,
    rows.length,
    rows[0].length
  )
  .setValues(rows);



  applyDashboardColors();



  dashboard
  .autoResizeColumns(
    1,
    9
  );



  setupDashboardFilter();



  logSystem(

    "updateDashboard",

    "Dashboard обновлен: "+rows.length

  );


}





/**
 * =====================================================
 * Цвета Dashboard
 * =====================================================
 */


function applyDashboardColors(){


 const sheet =
 SpreadsheetApp
 .getActive()
 .getSheetByName(
   V11_CONFIG.SHEETS.DASHBOARD
 );



 if(!sheet)
 return;



 const lastRow =
 sheet.getLastRow();



 if(lastRow<2)
 return;



 const range =
 sheet.getRange(
   2,
   2,
   lastRow-1,
   1
 );



 const rules=[];



 const addRule=(text,color)=>{


 rules.push(

 SpreadsheetApp
 .newConditionalFormatRule()
 .whenTextContains(text)
 .setBackground(color)
 .setRanges([range])
 .build()

 );


 };



 addRule(
 "Не заказано",
 V11_CONFIG.COLORS.RED
 );


 addRule(
 "Частично",
 V11_CONFIG.COLORS.RED
 );


 addRule(
 "Просрочка",
 V11_CONFIG.COLORS.ORANGE
 );


 addRule(
 "Опаздывает",
 V11_CONFIG.COLORS.ORANGE
 );


 addRule(
 "Ожидается",
 V11_CONFIG.COLORS.YELLOW
 );


 addRule(
 "На складе",
 V11_CONFIG.COLORS.STOCK
 );


 addRule(
 "Получено",
 V11_CONFIG.COLORS.RECEIVED
 );


 addRule(
 "Готов",
 V11_CONFIG.COLORS.READY
 );



 sheet
 .setConditionalFormatRules(
   rules
 );



}






/**
 * =====================================================
 * Фильтр Dashboard
 * =====================================================
 */


function setupDashboardFilter(){


 const sheet =
 SpreadsheetApp
 .getActive()
 .getSheetByName(
   V11_CONFIG.SHEETS.DASHBOARD
 );



 if(!sheet)
 return;



 if(sheet.getLastRow()<2)
 return;



 if(sheet.getFilter()){

   sheet
   .getFilter()
   .remove();

 }



 sheet
 .getRange(
   1,
   1,
   sheet.getLastRow(),
   9
 )
 .createFilter();



}






/**
 * =====================================================
 * Получение BOM строки
 * =====================================================
 */


function getDashboardBOM(bom){


 const sheet =
 SpreadsheetApp
 .getActive()
 .getSheetByName(
   V11_CONFIG.SHEETS.DASHBOARD
 );



 if(!sheet)
 return null;



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
    data[i][0]===bom
   ){

     return data[i];

   }


 }



 return null;


}