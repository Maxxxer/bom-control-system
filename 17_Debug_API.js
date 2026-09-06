/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 17_Debug_API.gs
 *
 * Debug Connector API
 *
 * =====================================================
 */


/**
 * Общая диагностика системы
 */
function debugSystemStatus(){


  const result = {


    version:
    V11_CONFIG.VERSION,


    timestamp:
    new Date(),


    sheets:{},


    materials:0,


    errors:[]

  };



  try{


    Object.keys(
      V11_CONFIG.SHEETS
    )
    .forEach(key=>{


      const name =
      V11_CONFIG.SHEETS[key];


      result.sheets[key]=
      !!SpreadsheetApp
      .getActive()
      .getSheetByName(name);


    });



    const sheet =
    SpreadsheetApp
    .getActive()
    .getSheetByName(
      V11_CONFIG.SHEETS.MATERIAL_STATE
    );


    if(sheet){

      result.materials =
      sheet.getLastRow()-1;

    }


  }
  catch(e){


    result.errors.push(
      e.message
    );

  }


return result;


}






/**
 * Проверка одного материала
 */
function debugMaterial(materialId){


 const material =
 getMaterialById(
   materialId
 );


 if(!material)
 return {
   error:
   "Материал не найден"
 };


 const row =
 material.values;



 return {


 materialId:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.MATERIAL_ID-1
 ],



 status:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.STATUS-1
 ],



 state:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.STATE-1
 ],



 ordered:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.ORDERED-1
 ],



 deficit:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.DEFICIT-1
 ],



 realDelivery:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.REAL_DELIVERY-1
 ],



 received:


 row[
 V11_CONFIG.MATERIAL_COLUMNS.RECEIVED-1
 ]

 };


}






/**
 * Проверка цветов
 */
function debugColorEngine(){


 return {


 material:
 typeof colorMaterialStateRows
 ===
 "function",


 deficit:
 typeof colorDeficitSummaryRows
 ===
 "function",


 bom:
 typeof colorBOMStateRows
 ===
 "function",


 statusColor:
 typeof getStatusColor
 ===
 "function"


 };


}






/**
 * Полный тест обновления
 */
function debugFullUpdate(){


 try{


 runFullUpdate();


 return {


 success:true,


 message:
 "Обновление выполнено"


 };


 }
 catch(e){


 return {


 success:false,


 error:e.message,


 stack:e.stack


 };


 }


}

function doGet(e){


 const action =
 e.parameter.action;



 let result;



 switch(action){


 case "status":

 result =
 debugSystemStatus();

 break;



 case "colors":

 result =
 debugColorEngine();

 break;



 case "update":

 result =
 debugFullUpdate();

 break;



 default:

 result={
 error:
 "Unknown action"
 };

 }



 return ContentService
 .createTextOutput(
   JSON.stringify(result)
 )
 .setMimeType(
   ContentService.MimeType.JSON
 );


}
