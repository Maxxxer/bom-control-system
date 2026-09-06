/**
 * =====================================================
 * BOM CONTROL SYSTEM V11
 * FILE: 12_Diagnostic_Engine.gs
 * =====================================================
 */


function runV11Diagnostic(){


const checks = {


MATERIAL_STATE:
checkSheetExists(
V11_CONFIG.SHEETS.MATERIAL_STATE
),


BOM_REVISION:
checkSheetExists(
V11_CONFIG.SHEETS.BOM_REVISION
),


DEFICIT_SUMMARY:
checkSheetExists(
V11_CONFIG.SHEETS.DEFICIT_SUMMARY
),


BOM_STATE:
checkSheetExists(
V11_CONFIG.SHEETS.BOM_STATE
),


DASHBOARD:
checkSheetExists(
V11_CONFIG.SHEETS.DASHBOARD
),


EVENT_LOG:
checkSheetExists(
V11_CONFIG.SHEETS.EVENT_LOG
),


ARCHIVE:
checkSheetExists(
V11_CONFIG.SHEETS.ARCHIVE
)


};



Object.keys(checks)
.forEach(
key=>{


logSystem(

"runV11Diagnostic",

key+" = "+checks[key]

);


});


return checks;


}






function checkSheetExists(name){


return Boolean(

SpreadsheetApp
.getActive()
.getSheetByName(name)

);


}

function getCurrentUser(){


try{


const email =
Session
.getActiveUser()
.getEmail();


if(email)
return email;


return "unknown";


}
catch(error){


return "unknown";


}


}

/**
 * Создание и проверка SYSTEM_LOG
 */
function debugCreateLogSheet_(){


const ss =
SpreadsheetApp
.getActive();



let sheet =
ss.getSheetByName(
V11_CONFIG.SHEETS.SYSTEM_LOG
);



if(!sheet){


sheet =
ss.insertSheet(
V11_CONFIG.SHEETS.SYSTEM_LOG
);


}



const headers = [

"Дата",
"Тип",
"Функция",
"Пользователь",
"Сообщение",
"Данные"

];



if(sheet.getLastRow()===0){


sheet
.getRange(
1,
1,
1,
headers.length
)
.setValues([
headers
]);


}



logSystem(

"debugCreateLogSheet_",

"SYSTEM_LOG создан"

);


}