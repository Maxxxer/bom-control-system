/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 03_Event_Engine.gs
 * =====================================================
 */


/**
 * Создание нового события
 *
 * Все действия системы проходят здесь
 */
function createEvent(
  eventType,
  payload
){


  const ss =
    SpreadsheetApp
      .getActive();



  const sheet =
    ss.getSheetByName(
      V11_CONFIG.SHEETS.EVENT_LOG
    );



  const eventId =
    generateEventId();



  const user =
    getCurrentUser();



  const event = {


    id:eventId,


    type:eventType,


    materialId:
      payload.materialId || "",


    bom:
      payload.bom || "",


    user:user,


    date:new Date(),


    data:payload


  };



  /**
   * Запись события
   */

  sheet.appendRow([


    event.date,


    event.id,


    event.type,


    event.materialId,


    event.bom,


    event.user,


    JSON.stringify(
      event.data
    )


  ]);



  /**
   * Запуск обработчика
   */

  processEvent(event);



}



/**
 * Генерация ID события
 */
function generateEventId(){


  return (

    "EVT-" +

    Utilities
      .getUuid()

  );


}




/**
 * Главный обработчик событий
 */
function processEvent(event){



try{


switch(event.type){



/**
 * Реальная поставка
 */
case V11_CONFIG.EVENTS.REAL_DELIVERY_CONFIRMED:


  confirmRealDelivery(
    event.materialId
  );


break;



/**
 * Отмена поставки
 */
case V11_CONFIG.EVENTS.REAL_DELIVERY_CANCELLED:


  cancelRealDelivery(
    event.materialId
  );


break;



/**
 * Получение производством
 */
case V11_CONFIG.EVENTS.MATERIAL_RECEIVED:


  confirmMaterialReceived(
    event.materialId
  );


break;



/**
 * Отмена получения
 */
case V11_CONFIG.EVENTS.MATERIAL_RECEIVED_CANCELLED:


  cancelMaterialReceived(
    event.materialId
  );


break;



/**
 * Изменение даты поставки
 */
case V11_CONFIG.EVENTS.DELIVERY_DATE_CHANGED:


  updateExpectedDeliveryDate(
    event.materialId,
    event.data.newDate
  );


break;



/**
 * Заказ материала
 */
case V11_CONFIG.EVENTS.MATERIAL_ORDERED:


  updateMaterialOrder(
    event.materialId,
    event.data.quantity
  );


break;



/**
 * Изменение BOM
 */
case V11_CONFIG.EVENTS.BOM_QTY_CHANGED:


  processBOMQuantityChange(
    event.data
  );


break;



default:


  logSystem(

    "processEvent",

    "Неизвестное событие: "+
    event.type

  );


}



}

catch(error){


 logSystem(

  "processEvent",

  error.message

 );


}



}



/**
 * Создание события поставки
 *
 * вызывается из чекбокса
 */
function eventRealDelivery(
  materialId
){


createEvent(

 V11_CONFIG.EVENTS.REAL_DELIVERY_CONFIRMED,

 {

 materialId:materialId

 }

);


}




/**
 * Отмена поставки
 */
function eventCancelRealDelivery(
materialId
){


createEvent(

 V11_CONFIG.EVENTS.REAL_DELIVERY_CANCELLED,

 {

 materialId:materialId

 }

);


}




/**
 * Получение производством
 */
function eventMaterialReceived(
materialId
){


createEvent(

V11_CONFIG.EVENTS.MATERIAL_RECEIVED,

{

materialId:materialId

}

);


}




/**
 * Отмена получения
 */
function eventCancelMaterialReceived(
materialId
){


createEvent(

V11_CONFIG.EVENTS.MATERIAL_RECEIVED_CANCELLED,

{

materialId:materialId

}

);


}




/**
 * Изменение срока поставки
 */
function eventDeliveryDateChanged(
materialId,
newDate
){


createEvent(

V11_CONFIG.EVENTS.DELIVERY_DATE_CHANGED,

{

materialId:materialId,

newDate:newDate

}

);


}




/**
 * Новый заказ
 */
function eventMaterialOrdered(
materialId,
quantity
){


createEvent(

V11_CONFIG.EVENTS.MATERIAL_ORDERED,

{

materialId:materialId,

quantity:quantity

}

);


}

/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * Запись системного события
 * =====================================================
 */


function addSystemEvent(data){


  const ss =
    SpreadsheetApp.getActive();



  const sheet =
    ss.getSheetByName(
      "EVENT_LOG"
    );


  if(!sheet){

    throw new Error(
      "Лист EVENT_LOG не найден"
    );

  }



  sheet.appendRow([


    new Date(),


    data.eventType || "",


    data.materialId || "",


    data.bom || "",


    data.comment || "",


    getCurrentUser()


  ]);



  logSystem(

    "addSystemEvent",

    data.eventType

  );


}