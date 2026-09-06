/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 *
 * FILE:
 * 17_V11_Status_Test.gs
 *
 * Тест цветовой логики статусов
 *
 * =====================================================
 */


function runV11StatusTest(){


  const testName =
    "runV11StatusTest";


  logSystem(
    testName,
    "Проверка цветов статусов"
  );



  const tests = [


    {
      status:"Не заказано",
      expected:"#F4CCCC"
    },


    {
      status:"Заказано частично",
      expected:"#F4CCCC"
    },


    {
      status:"Заказано (опаздывает)",
      expected:"#F4B183"
    },


    {
      status:"Заказано (в срок)",
      expected:"#FFF2CC"
    },


    {
      status:"Ожидается поставка",
      expected:"#FFF2CC"
    },


    {
      status:"На складе",
      expected:"#9FC5E8"
    },


    {
      status:"Получено производством",
      expected:"#B6D7A8"
    },


    {
      status:"Готов",
      expected:"#D9EAD3"
    }


  ];



  let errors = 0;



  tests.forEach(test=>{


    const result =
      getStatusColor(
        test.status
      );


    if(result !== test.expected){


      errors++;


      logSystem(
        testName,
        "ОШИБКА: "+
        test.status+
        " ожидался "+
        test.expected+
        " получен "+
        result,
        {},
        "ERROR"
      );


    }
    else{


      logSystem(
        testName,
        "OK: "+
        test.status+
        " = "+
        result
      );


    }


  });



  logSystem(
    testName,
    "Тест статусов завершён. Ошибок: "+errors
  );



  SpreadsheetApp
  .getUi()
  .alert(
    "Тест статусов завершён\n\nОшибок: "+
    errors
  );


}