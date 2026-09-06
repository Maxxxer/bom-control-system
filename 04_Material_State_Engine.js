/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 04_Material_State_Engine.gs
 *
 * Material State Engine
 *
 * VERSION:
 * 11.1.3
 *
 * Compatible:
 * 11_Config.gs FINAL RELEASE
 *
 * =====================================================
 */


/**
 * =====================================================
 * Нормализация MaterialID
 * =====================================================
 */

function normalizeMaterialId(value){

  if(
    value === null ||
    value === undefined
  ){
    return "";
  }


  return String(value)
    .trim();

}




/**
 * =====================================================
 * Числовая нормализация
 * =====================================================
 */

function parseMaterialNumber(value){

  if(
    value === null ||
    value === undefined ||
    value === ""
  ){
    return 0;
  }


  if(
    typeof value === "number"
  ){
    return value;
  }


  const result =
    String(value)
    .replace(",",".")
    .match(/-?\d+(\.\d+)?/);


  return result
    ? Number(result[0])
    : 0;

}





/**
 * =====================================================
 * Проверка колонки
 * =====================================================
 */

function getMaterialColumn(key){


  if(
    !V11_CONFIG ||
    !V11_CONFIG.MATERIAL_COLUMNS
  ){

    throw new Error(
      "Нет MATERIAL_COLUMNS"
    );

  }



  return V11_CONFIG
    .MATERIAL_COLUMNS[key]
    || null;

}





/**
 * =====================================================
 * Получение материала
 * =====================================================
 */

function getMaterialById(materialId){


  const sheet =
    SpreadsheetApp
    .getActive()
    .getSheetByName(
      V11_CONFIG.SHEETS.MATERIAL_STATE
    );


  if(!sheet){

    throw new Error(
      "Нет листа MATERIAL_STATE"
    );

  }



  const id =
    normalizeMaterialId(
      materialId
    );


  if(!id)
    return null;




  const data =
    sheet
    .getDataRange()
    .getValues();



  const idColumn =
    getMaterialColumn(
      "MATERIAL_ID"
    ) - 1;



  for(
    let i=1;
    i<data.length;
    i++
  ){


    if(
      normalizeMaterialId(
        data[i][idColumn]
      )
      === id
    ){

      return {

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
 * =====================================================
 * Проверка существования
 * =====================================================
 */

function materialExists(materialId){

  return (
    getMaterialById(materialId)
    !== null
  );

}





/**
 * =====================================================
 * Обновление материала
 * =====================================================
 */

function updateMaterialState(
  materialId,
  changes
){


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




  Object.keys(changes)
  .forEach(key=>{


    const column =
      getMaterialColumn(key);



    if(column){

      sheet
      .getRange(
        material.row,
        column
      )
      .setValue(
        changes[key]
      );

    }


  });





  const updated =
    getMaterialColumn(
      "UPDATED"
    );


  if(updated){

    sheet
    .getRange(
      material.row,
      updated
    )
    .setValue(
      new Date()
    );

  }



}
/**
 * =====================================================
 * Безопасное добавление истории
 * =====================================================
 */

function safeAddMaterialHistory(data){


  if(
    typeof addMaterialHistory === "function"
  ){

    addMaterialHistory(data);

  }

}





/**
 * =====================================================
 * Безопасное добавление события
 * =====================================================
 */

function safeAddSystemEvent(data){


  if(
    typeof addSystemEvent === "function"
  ){

    addSystemEvent(data);

  }

}






/**
 * =====================================================
 * Реальная поставка на склад
 * =====================================================
 */

function confirmRealDelivery(materialId){



  updateMaterialState(

    materialId,

    {

      REAL_DELIVERY:true,

      REAL_DELIVERY_DATE:
        new Date()

    }

  );



  recalculateMaterialStatus(
    materialId
  );




  safeAddMaterialHistory({

    materialId,

    event:
      V11_CONFIG.EVENTS
      .REAL_DELIVERY_CONFIRMED,


    comment:
      "Материал поступил на склад"


  });



}






/**
 * =====================================================
 * Отмена реальной поставки
 * =====================================================
 */

function cancelRealDelivery(materialId){



  updateMaterialState(

    materialId,

    {

      REAL_DELIVERY:false,

      REAL_DELIVERY_DATE:
        V11_CONFIG.DEFAULTS.DATE

    }

  );



  recalculateMaterialStatus(
    materialId
  );




  safeAddSystemEvent({

    eventType:
      V11_CONFIG.EVENTS
      .REAL_DELIVERY_CANCELLED,


    materialId,


    comment:
      "Отменена реальная поставка"


  });



}







/**
 * =====================================================
 * Получение материал производством
 * =====================================================
 */

function confirmMaterialReceived(materialId){



  updateMaterialState(

    materialId,

    {


      RECEIVED:true,


      RECEIVED_DATE:
        new Date(),


      RECEIVED_USER:
        getCurrentUserSafe()


    }

  );



  recalculateMaterialStatus(
    materialId
  );




  safeAddMaterialHistory({

    materialId,


    event:
      V11_CONFIG.EVENTS
      .MATERIAL_RECEIVED,


    comment:
      "Материал получен производством"


  });



}







/**
 * =====================================================
 * Безопасный пользователь
 * =====================================================
 */

function getCurrentUserSafe(){


  try{


    if(
      typeof getCurrentUser === "function"
    ){

      return getCurrentUser();

    }


  }
  catch(e){}



  return Session
    .getActiveUser()
    .getEmail()
    ||
    "";

}







/**
 * =====================================================
 * Отмена получения
 * =====================================================
 */

function cancelMaterialReceived(materialId){



  updateMaterialState(

    materialId,

    {


      RECEIVED:false,


      RECEIVED_DATE:
        V11_CONFIG.DEFAULTS.DATE,


      RECEIVED_USER:
        V11_CONFIG.DEFAULTS.TEXT


    }

  );



  recalculateMaterialStatus(
    materialId
  );



  safeAddMaterialHistory({

    materialId,


    event:
      V11_CONFIG.EVENTS
      .MATERIAL_RECEIVED_CANCELLED,


    comment:
      "Отменено получение материала"


  });



}








/**
 * =====================================================
 * Изменение даты поставки
 * =====================================================
 */

function updateExpectedDeliveryDate(

  materialId,

  newDate

){



  updateMaterialState(

    materialId,

    {


      EXPECTED_DATE:
        newDate


    }

  );



  recalculateMaterialStatus(
    materialId
  );




  safeAddSystemEvent({

    eventType:
      V11_CONFIG.EVENTS
      .DELIVERY_DATE_CHANGED,


    materialId,


    comment:
      "Изменена ожидаемая дата поставки"


  });



}








/**
 * =====================================================
 * Изменение заказа
 * =====================================================
 */

function updateMaterialOrder(

 materialId,

 quantity

){



 const old =
   getMaterialById(materialId);



 const oldValue =
   old
   ?
   old.values[
     V11_CONFIG
     .MATERIAL_COLUMNS
     .ORDERED-1
   ]
   :
   0;




 updateMaterialState(

  materialId,

  {


    ORDERED:
      Number(quantity)


  }

 );




 recalculateMaterialStatus(
   materialId
 );




 safeAddSystemEvent({

   eventType:
     V11_CONFIG.EVENTS
     .ORDER_CHANGED,


   materialId,


   comment:
     "Количество заказа изменено: "+
     oldValue+
     " → "+
     quantity


 });



}







/**
 * =====================================================
 * Архивирование материала
 * =====================================================
 */

function archiveMaterial(materialId){



 updateMaterialState(

  materialId,

  {


    STATUS:
      V11_CONFIG
      .MATERIAL_STATUS
      .ARCHIVED,


    STATE:
      V11_CONFIG
      .MATERIAL_STATE
      .ARCHIVED


  }

 );




 safeAddMaterialHistory({

    materialId,


    event:
      V11_CONFIG.EVENTS
      .MATERIAL_ARCHIVED,


    comment:
      "Материал архивирован"


 });



}








/**
 * =====================================================
 * Удаление материала из системы
 * =====================================================
 */

function removeMaterial(materialId){



 updateMaterialState(

  materialId,

  {


    STATUS:
      V11_CONFIG
      .MATERIAL_STATUS
      .REMOVED,


    STATE:
      V11_CONFIG
      .MATERIAL_STATE
      .REMOVED


  }

 );




 safeAddMaterialHistory({

    materialId,


    event:
      V11_CONFIG.EVENTS
      .MATERIAL_REMOVED,


    comment:
      "Материал удален"


 });



}
/**
 * =====================================================
 * Главный пересчет статуса материала
 * =====================================================
 */

function recalculateMaterialStatus(materialId){



  const material =
    getMaterialById(
      materialId
    );



  if(!material){

    return;

  }





  const row =
    material.values;





  const C =
    V11_CONFIG
    .MATERIAL_COLUMNS;





  /**
   * Получаем значения
   */

  const required =
    parseMaterialNumber(
      row[C.REQUIRED-1]
    );



  const ordered =
    parseMaterialNumber(
      row[C.ORDERED-1]
    );



  const received =
    row[C.RECEIVED-1] === true;



  const stock =
    row[C.REAL_DELIVERY-1] === true;



  const expected =
    row[C.EXPECTED_DATE-1];



  const deadline =
    row[C.DEADLINE_DATE-1];



  const oldStatus =
    row[C.STATUS-1];



  const oldState =
    row[C.STATE-1];





  /**
   * Дефицит
   */

  const deficit =
    Math.max(
      required - ordered,
      0
    );





  let status;
  let state;







  /**
   * =====================================================
   * 1. Архив
   * =====================================================
   */

  if(
    oldStatus ===
    V11_CONFIG
    .MATERIAL_STATUS
    .ARCHIVED
  ){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .ARCHIVED;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .ARCHIVED;


  }





  /**
   * =====================================================
   * 2. Удален
   * =====================================================
   */

  else if(

    oldStatus ===
    V11_CONFIG
    .MATERIAL_STATUS
    .REMOVED

  ){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .REMOVED;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .REMOVED;


  }





  /**
   * =====================================================
   * 3. Нет потребности
   * =====================================================
   */

  else if(

    required <= 0

  ){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .NO_REQUIREMENT;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .NO_REQUIREMENT;


  }






  /**
   * =====================================================
   * 4. Получено производством
   * =====================================================
   */

  else if(received){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .RECEIVED;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .RECEIVED;


  }






  /**
   * =====================================================
   * 5. На складе
   * =====================================================
   */

  else if(stock){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .STOCK;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .STOCK;


  }






  /**
   * =====================================================
   * 6. Не заказано
   * =====================================================
   */

  else if(

    ordered <= 0 &&
    required > 0

  ){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .NOT_ORDERED;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .DEFICIT;


  }






  /**
   * =====================================================
   * 7. Частичный заказ
   * =====================================================
   */

  else if(

    ordered > 0 &&
    ordered < required

  ){


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .PARTIAL_ORDER;


    state =
      V11_CONFIG
      .MATERIAL_STATE
      .PARTIAL_ORDER;


  }







  /**
   * =====================================================
   * 8. Полный заказ
   * =====================================================
   */

  else if(

    ordered >= required &&
    required > 0

  ){



    let late =
      false;



    if(

      expected &&
      deadline

    ){


      late =
        new Date(expected)
        >
        new Date(deadline);


    }





    if(late){


      status =
        V11_CONFIG
        .MATERIAL_STATUS
        .ORDERED_LATE;



      state =
        V11_CONFIG
        .MATERIAL_STATE
        .WAITING_LATE;



    }

    else{


      status =
        V11_CONFIG
        .MATERIAL_STATUS
        .ORDERED_ON_TIME;



      state =
        V11_CONFIG
        .MATERIAL_STATE
        .WAITING;


    }


  }







  /**
   * =====================================================
   * 9. Готов
   * =====================================================
   */

  else{


    status =
      V11_CONFIG
      .MATERIAL_STATUS
      .READY;



    state =
      V11_CONFIG
      .MATERIAL_STATE
      .READY;


  }







  /**
   * =====================================================
   * Запись результата
   * =====================================================
   */

  updateMaterialState(

    materialId,

    {

      DEFICIT:
        deficit,


      STATUS:
        status,


      STATE:
        state

    }

  );








  /**
   * =====================================================
   * Лог изменения статуса
   * =====================================================
   */

  if(

    oldStatus &&
    oldStatus !== status

  ){


    safeAddSystemEvent({

      eventType:
        V11_CONFIG
        .EVENTS
        .STATUS_CHANGED,


      materialId,


      comment:

        oldStatus+
        " → "+
        status


    });


  }






  /**
   * =====================================================
   * История изменения состояния
   * =====================================================
   */

  if(

    oldState &&
    oldState !== state

  ){


    safeAddMaterialHistory({

      materialId,


      event:
        "STATE_CHANGED",


      oldValue:
        oldState,


      newValue:
        state,


      comment:
        "Изменено внутреннее состояние"


    });


  }



}
/**
 * =====================================================
 * Безопасное преобразование числа
 * =====================================================
 */

function parseMaterialNumber(value){


  const n =
    Number(value);



  if(
    isNaN(n)
  ){

    return 0;

  }


  return n;

}







/**
 * =====================================================
 * Проверка системной блокировки
 * =====================================================
 */

function isMaterialEngineLocked(){


  const props =
    PropertiesService
    .getScriptProperties();



  return (

    props.getProperty(
      V11_CONFIG
      .SYSTEM_STATE
      .RECALCULATING
    )
    ===
    "true"

  );

}







/**
 * =====================================================
 * Установка блокировки
 * =====================================================
 */

function setMaterialEngineLock(flag){


  const props =
    PropertiesService
    .getScriptProperties();



  props.setProperty(

    V11_CONFIG
    .SYSTEM_STATE
    .RECALCULATING,

    String(flag)

  );


}








/**
 * =====================================================
 * Полный пересчет материалов
 * =====================================================
 */

function recalculateMaterials(){



  if(
    isMaterialEngineLocked()
  ){


    safeAddSystemEvent({

      eventType:
        V11_CONFIG
        .EVENTS
        .SYSTEM_ERROR,


      comment:
        "Попытка запуска пересчета во время блокировки"


    });


    return;


  }






  setMaterialEngineLock(true);





  try{


    const sheet =

      SpreadsheetApp
      .getActive()
      .getSheetByName(

        V11_CONFIG
        .SHEETS
        .MATERIAL_STATE

      );




    if(!sheet){


      throw new Error(
        "Нет листа MATERIAL_STATE"
      );


    }







    const data =

      sheet
      .getDataRange()
      .getValues();






    const idColumn =

      V11_CONFIG
      .MATERIAL_COLUMNS
      .MATERIAL_ID
      -
      1;






    let counter = 0;






    for(
      let i = 1;
      i < data.length;
      i++
    ){



      const id =
        data[i][idColumn];



      if(id){


        recalculateMaterialStatus(
          id
        );


        counter++;


      }


    }







    safeSystemLog(

      "recalculateMaterials",

      "Пересчитано материалов: "
      +
      counter,

      "INFO"

    );





  }


  catch(error){



    safeSystemLog(

      "recalculateMaterials",

      error.message,

      "ERROR"

    );



    safeAddSystemEvent({

      eventType:
        V11_CONFIG
        .EVENTS
        .SYSTEM_ERROR,


      comment:
        error.message


    });



    throw error;


  }



  finally{


    setMaterialEngineLock(false);


  }



}








/**
 * =====================================================
 * Системный лог
 * =====================================================
 */

function safeSystemLog(

  functionName,

  message,

  level

){



  if(
    typeof logSystem === "function"
  ){


    logSystem(

      functionName,

      message,

      level

    );


    return;

  }






  if(

    !V11_CONFIG
    .SETTINGS
    .ENABLE_LOGGING

  ){

    return;

  }






  const sheet =

    SpreadsheetApp
    .getActive()
    .getSheetByName(

      V11_CONFIG
      .SHEETS
      .SYSTEM_LOG

    );





  if(!sheet){

    return;

  }







  sheet.appendRow([


    new Date(),


    functionName,


    message,


    level || "INFO",


    ""



  ]);



}








/**
 * =====================================================
 * Получение состояния материала
 * =====================================================
 */

function getMaterialState(materialId){



  const material =
    getMaterialById(
      materialId
    );



  if(!material){

    return null;

  }




  const row =
    material.values;




  const C =
    V11_CONFIG
    .MATERIAL_COLUMNS;




  return {


    id:
      materialId,


    status:
      row[C.STATUS-1],


    state:
      row[C.STATE-1],


    required:
      row[C.REQUIRED-1],


    ordered:
      row[C.ORDERED-1],


    deficit:
      row[C.DEFICIT-1],


    received:
      row[C.RECEIVED-1],


    stock:
      row[C.REAL_DELIVERY-1]



  };


}








/**
 * =====================================================
 * Проверка состояния движка
 * =====================================================
 */

function getMaterialEngineStatus(){



  return {


    recalculating:

      isMaterialEngineLocked(),


    version:

      V11_CONFIG.VERSION,


    schema:

      V11_CONFIG.SCHEMA_VERSION


  };


}



/**
 * =====================================================
 * Принудительный сброс блокировки
 * =====================================================
 */

function resetMaterialEngineLock(){



  setMaterialEngineLock(false);



  safeSystemLog(

    "resetMaterialEngineLock",

    "Блокировка движка снята вручную",

    "WARNING"

  );


}
