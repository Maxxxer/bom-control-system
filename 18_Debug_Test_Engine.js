  /**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 18_Debug_Test_Engine.gs
 *
 * Диагностика и тестирование системы
 *
 * =====================================================
 */


/**
 * =====================================================
 * Главный тест V11
 * =====================================================
 */

function runV11Debug(){

  const result = {

    version:
      V11_CONFIG.VERSION,

    time:
      new Date(),

    sheets:{},

    colors:{},

    materials:{},

    errors:[]

  };


  try{

    result.sheets =
      debugCheckSheets();


    result.colors =
      debugCheckColors();


    result.materials =
      debugCheckMaterials();


  }
  catch(e){

    result.errors.push(
      e.message
    );

  }


  logSystem(
    "runV11Debug",
    "Диагностика завершена",
    result
  );


  SpreadsheetApp
    .getUi()
    .alert(
      "Диагностика V11 завершена.\n" +
      "Ошибок: "+
      result.errors.length
    );


  return result;

}





/**
 * =====================================================
 * Проверка листов
 * =====================================================
 */

function debugCheckSheets(){


  const ss =
    SpreadsheetApp
    .getActive();


  const result={};


  Object.keys(
    V11_CONFIG.SHEETS
  )
  .forEach(key=>{


    const name =
      V11_CONFIG.SHEETS[key];


    result[key] =
      ss.getSheetByName(name)
      !== null;


  });


  return result;

}






/**
 * =====================================================
 * Проверка цветов статусов
 * =====================================================
 */

function debugCheckColors(){


 const testStatuses=[


  "Не заказано",

  "Заказано частично",

  "Заказано (опаздывает)",

  "Заказано (в срок)",

  "На складе",

  "Получено производством",

  "Готов"


 ];


 const result={};



 testStatuses.forEach(status=>{


   result[status]=
     getStatusColor(status);


 });


 return result;


}







/**
 * =====================================================
 * Проверка MATERIAL_STATE
 * =====================================================
 */

function debugCheckMaterials(){


 const sheet =
 SpreadsheetApp
 .getActive()
 .getSheetByName(
   V11_CONFIG.SHEETS.MATERIAL_STATE
 );


 if(!sheet)
   throw new Error(
    "Нет MATERIAL_STATE"
   );



 const data =
 sheet
 .getDataRange()
 .getValues();



 const result={


 total:
   data.length-1,


 received:0,

 stock:0,

 deficit:0,

 partial:0,

 waiting:0


 };





 for(
  let i=1;
  i<data.length;
  i++
 ){


   const row=data[i];


   const status =
     row[
      V11_CONFIG.MATERIAL_COLUMNS.STATUS-1
     ];



   switch(status){


    case "Получено производством":

      result.received++;
      break;


    case "На складе":

      result.stock++;
      break;



    case "Не заказано":

      result.deficit++;
      break;



    case "Заказано частично":

      result.partial++;
      break;



    case "Заказано (в срок)":

    case "Заказано (опаздывает)":

      result.waiting++;
      break;


   }


 }


 return result;


}







/**
 * =====================================================
 * Тест одного материала
 * =====================================================
 */

function debugMaterial(materialId){


 const material =
   getMaterialById(
     materialId
   );


 if(!material){

   throw new Error(
    "Материал не найден: "+
    materialId
   );

 }



 return {


  row:
    material.row,


  status:
    material.values[
     V11_CONFIG.MATERIAL_COLUMNS.STATUS-1
    ],


  state:
    material.values[
     V11_CONFIG.MATERIAL_COLUMNS.STATE-1
    ]

 };


}








/**
 * =====================================================
 * Проверка пересчёта статусов
 * =====================================================
 */

function debugRecalculateMaterial(materialId){


 recalculateMaterialStatus(
   materialId
 );


 applyStatusColors();


 return debugMaterial(
   materialId
 );


}
