/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 02_Menu.gs
 * =====================================================
 */


/**
 * Создание меню при открытии таблицы
 */
function onOpen(){


  SpreadsheetApp
    .getUi()

    .createMenu(
      "BOM CONTROL V11"
    )


    // Система

    .addItem(
      "⚙ Инициализация V11",
      "initV11"
    )


    .addSeparator()



    // BOM

    .addItem(
      "📄 Проверить изменения BOM",
      "checkBOMRevision"
    )


    .addItem(
      "🔄 Обновить BOM состояния",
      "recalculateBOMState"
    )



    .addSeparator()



    // Материалы

    .addItem(
      "📦 Пересчитать материалы",
      "recalculateMaterials"
    )


    .addItem(
      "📋 Обновить сводку дефицитов",
      "updateDeficitSummary"
    )



    .addSeparator()



    // Dashboard

    .addItem(
      "📊 Обновить Dashboard",
      "updateDashboard"
    )



    .addSeparator()



    // Диагностика

    .addItem(
      "🔍 Проверка системы",
      "systemDiagnostics"
    )


    .addItem(
      "📝 Создать DEBUG_LOG",
      "createDebugLog"
    )


    .addToUi();


}



/**
 * Быстрый запуск полного обновления
 */
function fullV11Refresh(){


  try{


    recalculateMaterials();


    recalculateBOMState();


    updateDeficitSummary();


    updateDashboard();



    logSystem(

      "fullV11Refresh",

      "OK"

    );



  }
  catch(error){


    logSystem(

      "fullV11Refresh",

      error.message

    );


    throw error;

  }


}




/**
 * Диагностика структуры системы
 */
function systemDiagnostics(){


  const ss =
    SpreadsheetApp
      .getActive();



  let result=[];



  Object
    .values(
      V11_CONFIG.SHEETS
    )
    .forEach(
      sheetName=>{


        const sheet =
          ss.getSheetByName(
            sheetName
          );


        result.push({

          sheet:
            sheetName,


          exists:
            !!sheet,


          rows:
            sheet ?
            sheet.getLastRow()
            :
            0

        });


      });



  const message =
    result
      .map(
        x=>

        x.sheet+
        " : "+
        (
          x.exists
          ?
          "OK"
          :
          "НЕТ"
        )

      )
      .join("\n");



  SpreadsheetApp
    .getUi()
    .alert(
      "Диагностика V11\n\n"+
      message
    );


}




/**
 * Создание DEBUG_LOG
 */
function createDebugLog(){


  const ss =
    SpreadsheetApp
      .getActive();



  let sheet =
    ss.getSheetByName(
      "DEBUG_LOG"
    );



  if(!sheet){


    sheet =
      ss.insertSheet(
        "DEBUG_LOG"
      );



    sheet
      .appendRow([

        "Дата",

        "Функция",

        "Сообщение"

      ]);

  }



  sheet
    .appendRow([

      new Date(),

      "createDebugLog",

      "DEBUG включен"

    ]);



}



/**
 * Запись системных ошибок
 */
function logSystem(
  functionName,
  message
){


  const ss =
    SpreadsheetApp
      .getActive();



  const sheet =
    ss.getSheetByName(
      V11_CONFIG.SHEETS.SYSTEM_LOG
    );



  if(!sheet)
    return;



  sheet.appendRow([


    new Date(),


    functionName,


    message,


    getCurrentUser()


  ]);


}