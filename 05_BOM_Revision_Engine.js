/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 05_BOM_Revision_Engine.gs
 *
 * Движок ревизий BOM
 *
 * VERSION:
 * 11.1.4
 *
 * =====================================================
 */


/**
 * =====================================================
 * Проверка изменений BOM
 * =====================================================
 */

function checkBOMRevision(){


  try{


    const changes =
      compareBOMVersions();



    if(
      !changes ||
      changes.length===0
    ){


      logSystem(
        "checkBOMRevision",
        "Изменений BOM нет"
      );


      return [];

    }




    changes.forEach(
      change=>{


        createBOMRevisionEvent(
          change
        );


      }
    );



    logSystem(

      "checkBOMRevision",

      "Найдено изменений: "
      +
      changes.length

    );



    return changes;



  }
  catch(error){


    logSystem(

      "checkBOMRevision",

      error.message

    );


    return [];

  }


}







/**
 * =====================================================
 * Сравнение BOM версий
 * =====================================================
 */

function compareBOMVersions(){


  const changes=[];


  /*
  
  Будет подключено к BOM импортёру.

  Формат:

  {
    type:"QTY_CHANGED",
    materialId:"",
    oldValue:0,
    newValue:0
  }

  */


  return changes;


}







/**
 * =====================================================
 * Обработка событий BOM
 * =====================================================
 */

function createBOMRevisionEvent(change){


  if(!change)
    return;



  switch(change.type){



    case "QTY_CHANGED":


      createEvent({

        eventType:
          V11_CONFIG.EVENTS.BOM_QTY_CHANGED,


        materialId:
          change.materialId,


        comment:
          "Изменено количество BOM"


      });


      processBOMQuantityChange(
        change
      );


    break;





    case "ORDER_CHANGED":


      createEvent({

        eventType:
          V11_CONFIG.EVENTS.ORDER_CHANGED,


        materialId:
          change.materialId,


        comment:
          "Изменено состояние заказа"


      });


    break;





    case "NAME_CHANGED":


      createEvent({

        eventType:
          V11_CONFIG.EVENTS.BOM_NAME_CHANGED,


        materialId:
          change.materialId,


        comment:
          "Изменено имя материала BOM"


      });


    break;





    case "ADDED":


      createEvent({

        eventType:
          V11_CONFIG.EVENTS.BOM_MATERIAL_ADDED,


        materialId:
          change.materialId,


        comment:
          "Добавлен материал BOM"


      });


    break;





    case "REMOVED":


      createEvent({

        eventType:
          V11_CONFIG.EVENTS.BOM_MATERIAL_REMOVED,


        materialId:
          change.materialId,


        comment:
          "Удалён материал BOM"


      });


    break;


  }


}








/**
 * =====================================================
 * Изменение количества BOM
 * =====================================================
 */

function processBOMQuantityChange(data){


try{


 if(
  !data ||
  !data.materialId
 ){

  throw new Error(
   "Не указан MaterialID"
  );

 }



 const material =
 getMaterialById(
  data.materialId
 );


 if(!material){

  throw new Error(
   "Материал не найден"
  );

 }



 const newQty =
 Number(
  data.newValue
 );



 if(
  isNaN(newQty) ||
  newQty<0
 ){

  throw new Error(
   "Некорректное количество"
  );

 }



 const oldQty =
 Number(
 material.values[
 V11_CONFIG.MATERIAL_COLUMNS.REQUIRED-1
 ]
 )
 ||
 0;



 updateMaterialState(

 data.materialId,

 {

 REQUIRED:
 newQty

 }

 );



 recalculateMaterialDeficit(
 data.materialId
 );




 addMaterialHistory({

 materialId:
 data.materialId,


 event:
 V11_CONFIG.EVENTS.BOM_QTY_CHANGED,


 oldValue:
 oldQty,


 newValue:
 newQty,


 comment:
 "Изменено количество BOM"

 });



}
catch(error){


 logSystem(

 "processBOMQuantityChange",

 error.message

 );


}


}









/**
 * =====================================================
 * Добавление материала из BOM
 * =====================================================
 */

function addMaterialFromBOM(material){


try{


 validateBOMMaterial(
  material
 );



 const materialId =
 generateMaterialId(

 material.bom,

 material.version,

 material.row

 );



 if(
 getMaterialById(materialId)
 ){

 return materialId;

 }



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





 sheet.appendRow([


 materialId,

 material.bom,

 material.version || "V1",

 material.row || 0,

 material.code || "",

 material.name || "",

 material.unit || "",


 Number(material.required||0),


 0,


 0,


 0,


 "",


 material.deadline || "",


 false,


 "",


 false,


 "",


 "",


 V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED,


 V11_CONFIG.MATERIAL_STATE.DEFICIT,


 new Date()


 ]);





 recalculateMaterialDeficit(
 materialId
 );





 addMaterialHistory({

 materialId,

 event:
 V11_CONFIG.EVENTS.BOM_MATERIAL_ADDED,


 comment:
 "Добавлен материал из BOM"

 });



return materialId;



}
catch(error){


logSystem(

"addMaterialFromBOM",

error.message

);


return null;


}


}









/**
 * =====================================================
 * Удаление материала из BOM
 * =====================================================
 */

function removeMaterialFromBOM(materialId){


updateMaterialState(

materialId,

{


STATE:
V11_CONFIG.MATERIAL_STATE.REMOVED,


STATUS:
V11_CONFIG.MATERIAL_STATUS.REMOVED


}

);



recalculateMaterialStatus(
materialId
);



addMaterialHistory({

materialId,


event:
V11_CONFIG.EVENTS.BOM_MATERIAL_REMOVED,


comment:
"Материал удалён из BOM"


});



}









/**
 * =====================================================
 * Восстановление материала
 * =====================================================
 */

function restoreMaterialToBOM(materialId){


updateMaterialState(

materialId,

{

STATE:
V11_CONFIG.MATERIAL_STATE.DEFICIT,


STATUS:
V11_CONFIG.MATERIAL_STATUS.NOT_ORDERED


}

);



recalculateMaterialDeficit(
materialId
);



}









/**
 * =====================================================
 * Расчёт дефицита
 * =====================================================
 */

function recalculateMaterialDeficit(materialId){


const material =
getMaterialById(
materialId
);


if(!material)
return;



const row =
material.values;



const required =
Number(
row[
V11_CONFIG.MATERIAL_COLUMNS.REQUIRED-1
]
)
||0;



const ordered =
Number(
row[
V11_CONFIG.MATERIAL_COLUMNS.ORDERED-1
]
)
||0;



const reserved =
Number(
row[
V11_CONFIG.MATERIAL_COLUMNS.RESERVED-1
]
)
||0;



const deficit =
Math.max(

required -
reserved -
ordered,

0

);



updateMaterialState(

materialId,

{

DEFICIT:
deficit

}

);



recalculateMaterialStatus(
materialId
);


}









/**
 * =====================================================
 * Проверка BOM материала
 * =====================================================
 */

function validateBOMMaterial(material){


if(!material)
throw new Error(
"Пустой BOM материал"
);



if(!material.bom)
throw new Error(
"Не указан BOM"
);



if(!material.row)
throw new Error(
"Не указан BOM_ROW"
);



}









/**
 * =====================================================
 * Генерация MaterialID
 * =====================================================
 */

function generateMaterialId(
bom,
version,
row
){


return [

String(bom).trim(),

String(version || "V1").trim(),

Number(row)

].join("|");


}