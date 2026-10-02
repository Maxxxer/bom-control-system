/**
 * Проверки импорта спецификации с незаполненными обязательными полями.
 *
 * Здесь закреплено правило, на котором держится правка спецификации: строка с
 * пустой моделью или сроком ИМПОРТИРУЕТСЯ, а не отбрасывается. Отброшенная строка
 * исчезла бы из дефицита, и экономист не узнал бы, что в исходном файле чего-то не
 * хватает. Вместо этого импорт помечает строку «Ошибкой данных» с перечнем
 * незаполненного, а человек дополняет её прямо в карточке.
 *
 * Фикстура `fixtures/bom-with-errors.csv` — та же форма файла, которую загружают
 * через интерфейс: разделитель `;`, три строки материала, у средней нет модели и
 * крайнего срока.
 *
 * Второй блок проверок — старый бинарный `.xls`: архив спецификаций предприятия
 * хранится именно в нём, и главное требование к поддержке формата — импорт старого
 * файла даёт ровно тот же результат, что и импорт его же в .xlsx или CSV. Иначе
 * пришлось бы держать две разные логики разбора колонок.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import XLSX from 'xlsx';

import { readBomFile } from '../src/services/bomImport/parseBomFile.js';
import { parseBomRows } from '../src/services/bomImport/parseBomRows.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Прочитать фикстуру так же, как это делает загрузка файла в интерфейсе. */
async function parseFixture(fileName: string) {
  const content = readFileSync(path.join(fixturesDir, fileName));
  const file = await readBomFile({ fileName, contentBase64: content.toString('base64') });
  return parseBomRows({ bomCode: 'BOM-WITH-ERRORS', rows: file.rows });
}

test('строка без модели и срока импортируется как «Ошибка данных»', async () => {
  const parsed = await parseFixture('bom-with-errors.csv');

  assert.equal(parsed.positions.length, 3, 'импортированы все строки материала');
  assert.equal(parsed.skipped.length, 0, 'ничего не пропущено: наименование есть у всех строк');

  const broken = parsed.positions.find((position) => position.code === 'CD-77');
  assert.ok(broken, 'строка с незаполненными полями осталась в спецификации');
  assert.equal(broken.model, '', 'модель не заполнена');
  assert.equal(broken.deadline, null, 'крайний срок не указан');
  assert.equal(broken.materialKey, 'CD-77|Vishay', 'ключ материала собран по артикулу');

  assert.equal(parsed.incomplete.length, 1, 'импорт сообщил об одной строке, требующей правки');
  const issue = parsed.incomplete[0];
  assert.equal(issue?.sourceLine, 3, 'указан номер строки в файле');
  assert.match(issue?.reason ?? '', /Модель/, 'причина называет модель');
});

test('отчёт импорта не упоминает срок поставки: его спрашивают отдельным окном', () => {
  // Срок в файле не заполнен, модель не заполнена, единицы нет. В замечание
  // попадает только то, что человек действительно дозаполняет руками.
  const rows = [
    ['Наименование', 'Модель', 'Ед.изм', 'Кол-во', 'Крайний срок поставки'],
    ['Резистор', '', 'шт', '10', ''],
  ];
  const parsed = parseBomRows({ bomCode: 'БЕЗ-СРОКА', rows });

  assert.equal(parsed.incomplete.length, 1);
  const reason = parsed.incomplete[0]?.reason ?? '';
  assert.match(reason, /Модель/, 'модель в замечании остаётся');
  assert.doesNotMatch(reason, /Крайний срок/, 'срок в замечании не упоминается');
});

test('позиция без срока, но с остальными полями, в замечания не попадает вовсе', () => {
  // Нечего дозаполнять руками: срок проставится окном после импорта. Пустая
  // строка «Не заполнено: » в отчёте была бы шумом.
  const rows = [
    ['Наименование', 'Модель', 'Ед.изм', 'Кол-во', 'Крайний срок поставки'],
    ['Резистор', 'R-1', 'шт', '10', ''],
  ];
  const parsed = parseBomRows({ bomCode: 'ТОЛЬКО-СРОК', rows });

  assert.deepEqual(parsed.incomplete, [], 'замечаний нет');
  assert.equal(parsed.missingDeadline, 1, 'но позиция без срока посчитана и попадёт в окно');
});

test('заполненные строки той же спецификации приходят без замечаний', async () => {
  const parsed = await parseFixture('bom-with-errors.csv');

  const filled = parsed.positions.filter((position) => position.code !== 'CD-77');
  assert.deepEqual(
    filled.map((position) => position.code),
    ['AB-12', 'EF-01'],
    'порядок строк сохранён',
  );
  assert.ok(
    filled.every((position) => position.model !== '' && position.deadline !== null),
    'у заполненных строк есть и модель, и срок',
  );
});

test('колонки исходного файла распознаны по заголовкам', async () => {
  const parsed = await parseFixture('bom-with-errors.csv');

  assert.ok(parsed.foundColumns.includes('Модель'), 'колонка «Модель» найдена');
  assert.ok(
    parsed.foundColumns.includes('Крайний срок поставки'),
    'колонка «Крайний срок поставки» найдена',
  );
  assert.ok(parsed.foundColumns.includes('Зарезервировано'), 'колонка резерва найдена');
});

test('файл без обязательных колонок отклоняется с объяснением', async () => {
  const rows = [
    ['Артикул', 'Кол-во'],
    ['AB-12', '10'],
  ];
  assert.throws(
    () => parseBomRows({ bomCode: 'NO-HEADER', rows }),
    /№ п\/п.*Наименование|Наименование/s,
    'сообщение объясняет, каких колонок не хватает',
  );
});

/* ── Старый бинарный .xls ───────────────────────────────────────────── */

/** Шапка и строки спецификации для проверок формата .xls (как в реальном файле). */
const XLS_HEADERS = [
  '№ п/п',
  'Артикул',
  'Наименование',
  'Модель',
  'Ед.изм',
  'Производитель',
  'Кол-во',
  'Зарезервировано',
  'Крайний срок поставки',
];

/** Сигнатура настоящего .xls — контейнера OLE2. */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Собрать настоящий бинарный .xls (BIFF8) из строк.
 *
 * Файл собирается библиотекой записи, а не хранится в репозитории бинарником:
 * тест остаётся читаемым, а состав данных виден прямо в коде.
 */
function buildLegacyXls(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows as XLSX.CellObject[][]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Спецификация');
  const written = XLSX.write(book, { type: 'buffer', bookType: 'biff8' });
  return Buffer.isBuffer(written) ? written : Buffer.from(written as ArrayBuffer);
}

test('старый .xls читается и даёт те же позиции, что и тот же файл в CSV', async () => {
  const rows: unknown[][] = [
    XLS_HEADERS,
    [1, 'AB-12', 'Резистор', 'R-1', 'шт', 'Bosch', 10, 4, '2026-09-20'],
    [2, 'EF-01', 'Разъём', 'X-2', 'шт', 'TE', 20, 0, '2026-09-25'],
  ];

  const file = await readBomFile({
    fileName: 'СПЕЦ-001.xls',
    contentBase64: buildLegacyXls(rows).toString('base64'),
  });

  assert.equal(file.kind, 'xls', 'формат определён как старый Excel');
  const parsed = parseBomRows({ bomCode: 'СПЕЦ-001', rows: file.rows });

  assert.equal(parsed.positions.length, 2, 'обе позиции импортированы');
  assert.deepEqual(
    parsed.positions.map((position) => position.code),
    ['AB-12', 'EF-01'],
    'артикулы и порядок строк сохранены',
  );
  assert.deepEqual(
    parsed.positions.map((position) => position.requiredQty),
    [10, 20],
    'количество прочитано числом',
  );
  assert.deepEqual(
    parsed.positions.map((position) => position.deadline),
    ['2026-09-20', '2026-09-25'],
    'крайние сроки прочитаны как даты',
  );
  assert.equal(parsed.incomplete.length, 0, 'заполненные строки не требуют правки');
  assert.ok(parsed.foundColumns.includes('Кол-во'), 'колонка количества распознана');
});

test('настоящая дата в ячейке .xls приходит датой, а не числом', async () => {
  // Дата строится в местном времени: isoFromDate берёт локальный календарный день,
  // поэтому тест не зависит от часового пояса машины.
  const deadline = new Date(2026, 8, 20);
  const rows: unknown[][] = [
    XLS_HEADERS,
    [1, 'AB-12', 'Резистор', 'R-1', 'шт', 'Bosch', 10, 4, deadline],
  ];

  const file = await readBomFile({
    fileName: 'СПЕЦ-002.xls',
    contentBase64: buildLegacyXls(rows).toString('base64'),
  });
  const parsed = parseBomRows({ bomCode: 'СПЕЦ-002', rows: file.rows });

  assert.equal(
    parsed.positions[0]?.deadline,
    '2026-09-20',
    'ячейка с датой прочитана как 2026-09-20, а не как порядковый номер дня',
  );
});

test('повреждённый .xls отклоняется с понятным сообщением, а не падает', async () => {
  const garbage = Buffer.from('这不是 Excel 文件, это просто текст', 'utf8');

  await assert.rejects(
    () => readBomFile({ fileName: 'битый.xls', contentBase64: garbage.toString('base64') }),
    /не похож на старый Excel/,
    'файл без сигнатуры OLE2 отвергается ДО разбора, а не импортируется как пустой',
  );
});

test('файл .xls с верной сигнатурой, но битым содержимым тоже не проходит молча', async () => {
  // Реальный контейнер OLE2, внутри которого не таблица. Разбор в мягком режиме
  // обязан быть перехвачен, иначе импорт сообщил бы «успех» с нулём позиций.
  const broken = Buffer.concat([OLE2_SIGNATURE, Buffer.alloc(512, 0x41)]);

  await assert.rejects(
    () => readBomFile({ fileName: 'битый.xls', contentBase64: broken.toString('base64') }),
    /Не удалось прочитать файл \.xls|В файле Excel нет ни одного листа|Файл \.xls пуст/,
    'битое содержимое не превращается в успешный импорт пустой спецификации',
  );
});

test('неизвестное расширение по-прежнему отклоняется со списком поддерживаемых', async () => {
  await assert.rejects(
    () => readBomFile({ fileName: 'спецификация.pdf', contentBase64: 'JVBERi0=' }),
    /\.xls, \.xlsx и \.csv/,
    'сообщение перечисляет форматы, которые система понимает',
  );
});

/* ── Боевые заголовки предприятия ──────────────────────────────────── */

/*
 * Ниже — заголовки из настоящих файлов, из-за которых колонки не подтягивались.
 * Проверки закрепляют именно их, а не выдуманные: при смене формата выгрузки
 * тесты покажут, какое слово перестало распознаваться.
 */

test('заголовок «Описание №2208-2211» распознан как наименование', () => {
  const rows = [
    ['Описание №2208-2211', 'Модель', 'Произв-тель', 'Артикул', 'ед.изм', 'К-во'],
    ['Авт. выключатель', 'NXB-63 2/3p С 6kA', 'CHINT', '814165', 'шт.', '3'],
  ];
  const parsed = parseBomRows({ bomCode: 'ЭЛЕКТРИКА', rows });

  assert.equal(parsed.positions.length, 1);
  const position = parsed.positions[0];
  assert.equal(position?.name, 'Авт. выключатель', 'описание стало наименованием');
  assert.equal(position?.model, 'NXB-63 2/3p С 6kA', 'модель прочитана');
  assert.equal(position?.manufacturer, 'CHINT', 'сокращение «Произв-тель» прочитано');
  assert.equal(position?.code, '814165', 'артикул прочитан');
  assert.equal(position?.unit, 'шт.', 'ед. изм в другом регистре прочитана');
  assert.equal(position?.requiredQty, 3, '«К-во» распознано как количество');
  assert.deepEqual(parsed.ignoredColumns, [], 'ни одна колонка не потеряна');
});

test('заголовок «Наименование 2206» распознан по началу строки', () => {
  const rows = [
    ['Наименование 2206', 'Модель', 'Производитель', 'Артикул', 'Кол-во'],
    ['Вентиль Rotalock', 'BC-VR-1 1/4-1 1/8', 'Becool', '', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'ГИДРАВЛИКА', rows });

  const position = parsed.positions[0];
  assert.equal(position?.name, 'Вентиль Rotalock', 'суффикс с номером проекта не мешает');
  assert.equal(position?.requiredQty, 2, 'количество прочитано');
  assert.deepEqual(parsed.ignoredColumns, [], 'ни одна колонка не потеряна');
});

test('«Обозначение» считается моделью, а «К-ВО» — количеством', () => {
  const rows = [
    ['Наименование 2206', 'Обозначение', 'К-ВО'],
    ['Муфта медная', '3/4х1/2', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'МОДЕЛЬ', rows });

  const position = parsed.positions[0];
  assert.equal(position?.model, '3/4х1/2', 'обозначение сохранено как модель');
  assert.equal(position?.requiredQty, 2, '«К-ВО» в верхнем регистре распознано');
  assert.deepEqual(parsed.ignoredColumns, []);
});

test('отсутствие колонки «№ п/п» не мешает: номер берётся по порядку', () => {
  const rows = [
    ['Наименование 2206', 'Обозначение', 'К-ВО'],
    ['Виброопора', 'BR0100', '4'],
    ['Заглушка медная', '2 1/8', '1'],
  ];
  const parsed = parseBomRows({ bomCode: 'БЕЗ-НОМЕРОВ', rows });

  assert.deepEqual(
    parsed.positions.map((position) => position.rowNo),
    [1, 2],
    'строки пронумерованы по порядку в файле',
  );
});

test('пустой или нулевой номер в файле заменяется порядковым', () => {
  // Номер строки в карточке не редактируется, поэтому битое значение из файла
  // оставило бы позицию «Ошибкой данных» навсегда — без возможности починить.
  const rows = [
    ['№ п/п', 'Наименование', 'Модель', 'Ед.изм', 'Кол-во'],
    ['', 'Резистор', 'R-1', 'шт', '10'],
    ['0', 'Конденсатор', 'C-9', 'шт', '5'],
    ['3', 'Разъём', 'X-2', 'шт', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'БИТЫЕ-НОМЕРА', rows });

  assert.deepEqual(
    parsed.positions.map((position) => position.rowNo),
    [1, 2, 3],
    'негодные номера заменены порядковыми, годный из файла сохранён',
  );
  assert.equal(
    parsed.positions.filter((position) => position.rowNo === 0).length,
    0,
    'ни одна позиция не осталась с недопустимым номером',
  );
});

test('шапка находится и ниже первой строки (файл с титулом)', () => {
  const rows = [
    ['ЗАО «Пример»', '', '', ''],
    ['Спецификация на 2206 год', '', '', ''],
    ['', '', '', ''],
    ['Наименование', 'Модель', 'Ед.изм', 'Кол-во'],
    ['Муфта медная', '3/4х1/2', 'шт', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'С-ТИТУЛОМ', rows });

  assert.equal(parsed.positions.length, 1, 'строка материала найдена под титулом');
  assert.equal(parsed.positions[0]?.name, 'Муфта медная');
  assert.equal(parsed.positions[0]?.requiredQty, 2);
});

test('нераспознанные колонки перечисляются в отчёте, а не теряются молча', () => {
  const rows = [
    ['Наименование', 'Модель', 'Кол-во', 'Примечание', 'Позиция в плане'],
    ['Муфта медная', '3/4х1/2', '2', 'по чертежу 123', 'стр. 7'],
  ];
  const parsed = parseBomRows({ bomCode: 'С-ЛИШНИМИ', rows });

  assert.deepEqual(
    parsed.ignoredColumns,
    ['Примечание', 'Позиция в плане'],
    'лишние столбцы названы, чтобы человек увидел потерю данных',
  );
  assert.equal(parsed.positions.length, 1, 'данные при этом импортированы');
});

test('две похожие колонки: берётся одна, вторая попадает в отчёт', () => {
  const rows = [
    ['Наименование', 'Наименование материала', 'Кол-во'],
    ['Муфта медная', 'дубль', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'С-ДУБЛЕМ', rows });

  assert.equal(parsed.positions[0]?.name, 'Муфта медная', 'принята первая подходящая колонка');
  assert.deepEqual(
    parsed.ignoredColumns,
    ['Наименование материала'],
    'вторая не подставилась молча — она названа в отчёте',
  );
});

test('пустые столбцы не считаются нераспознанными', () => {
  const rows = [
    ['Наименование', 'Модель', 'Кол-во', '', '  '],
    ['Муфта медная', '3/4х1/2', '2', '', ''],
  ];
  const parsed = parseBomRows({ bomCode: 'С-ПУСТЫМИ', rows });

  assert.deepEqual(parsed.ignoredColumns, [], 'пустые заголовки не мусят отчёт');
});

test('отчёт считает позиции без срока — по нему показывается окно ввода даты', () => {
  const rows = [
    ['Наименование', 'Модель', 'Ед.изм', 'Кол-во', 'Крайний срок поставки'],
    ['Муфта медная', '3/4х1/2', 'шт', '2', ''],
    ['Муфта медная 2"', '1/2', 'шт', '1', '20.09.2026'],
    ['Заглушка', '2 1/8', 'шт', '3', ''],
  ];
  const parsed = parseBomRows({ bomCode: 'СРОК', rows });

  assert.equal(parsed.missingDeadline, 2, 'две позиции остались без срока');
});

test('в файле без колонки срока безсрочных позиций столько же, сколько всего', () => {
  // Именно такой случай у боевых файлов предприятия: колонки срока нет вовсе,
  // и интерфейс должен предложить ввести дату один раз для всей спецификации.
  const rows = [
    ['Наименование 2206', 'Модель', 'Кол-во'],
    ['Виброопора', 'BR0100', '4'],
    ['Заглушка медная', '2 1/8', '1'],
  ];
  const parsed = parseBomRows({ bomCode: 'БЕЗ-СРОКА', rows });

  assert.equal(parsed.missingDeadline, 2);
  assert.equal(parsed.missingDeadline, parsed.positions.length, 'срока нет ни у кого');
});

test('во всех строках срок есть — предлагать ввод нечего', () => {
  const rows = [
    ['Наименование', 'Модель', 'Кол-во', 'Крайний срок поставки'],
    ['Муфта медная', '3/4х1/2', '2', '20.09.2026'],
  ];
  const parsed = parseBomRows({ bomCode: 'С-СРОКОМ', rows });

  assert.equal(parsed.missingDeadline, 0, 'окно ввода даты не показывается зря');
});

/* ── «Ед.изм» и «Ед. изм» — одна и та же колонка ───────────────────── */

test('написание единицы измерения не влияет: точка, пробел и регистр равнозначны', () => {
  const variants = [
    'Ед.изм',
    'Ед. изм',
    'ед.изм',
    'ед. изм',
    'ЕД. ИЗМ',
    'ЕД.ИЗМ',
    'Ед.изм.',
    'Ед изм',
  ];

  for (const header of variants) {
    const parsed = parseBomRows({
      bomCode: 'ЕД-ИЗМ',
      rows: [
        ['Наименование', 'Модель', header, 'Кол-во'],
        ['Муфта медная', '3/4х1/2', 'шт', '2'],
      ],
    });
    assert.equal(parsed.positions[0]?.unit, 'шт', `«${header}» распознана как единица`);
    assert.deepEqual(parsed.ignoredColumns, [], `«${header}» не попала в нераспознанные`);
  }
});

test('обе колонки «Ед.изм» и «Ед. изм» — это одна колонка, а не неизвестный столбец', () => {
  const parsed = parseBomRows({
    bomCode: 'ЕД-ДВАЖДЫ',
    rows: [
      ['Наименование', 'Модель', 'Ед.изм', 'Ед. изм', 'Кол-во'],
      ['Муфта медная', '3/4х1/2', 'шт', 'кг', '2'],
    ],
  });

  assert.equal(parsed.positions[0]?.unit, 'шт', 'берётся значение первой колонки');
  assert.deepEqual(
    parsed.ignoredColumns,
    [],
    'вторая не похожа на потерянные данные — это повтор того же поля',
  );
  assert.deepEqual(
    parsed.duplicateColumns,
    [{ header: 'Ед. изм', sameAs: 'Ед.изм' }],
    'повтор назван прямо в отчёте: видно, что в файле две одинаковые колонки',
  );
});

test('при двух одинаковых колонках побеждает написанная точно как синоним', () => {
  // Порядок в файле не должен решать, чьё значение попадёт в систему: иначе
  // перестановка столбцов молча меняла бы спецификацию. Выигрывает та колонка,
  // заголовок которой совпадает с синонимом буква в букву (`Ед.изм`), а не запись
  // `Ед. изм` через пробел.
  const rows = [
    ['Наименование', 'Модель', 'Ед. изм', 'Ед.изм', 'Кол-во'],
    ['Муфта медная', '3/4х1/2', 'кг', 'шт', '2'],
  ];
  const parsed = parseBomRows({ bomCode: 'ЕД-ОБРАТНЫЙ', rows });

  assert.equal(parsed.positions[0]?.unit, 'шт', 'взята колонка «Ед.изм»');
  assert.deepEqual(parsed.ignoredColumns, [], 'второй столбец — повтор, а не потерянные данные');
  assert.deepEqual(
    parsed.duplicateColumns,
    [{ header: 'Ед. изм', sameAs: 'Ед.изм' }],
    'повтор назван в отчёте',
  );
});

test('позиции без единицы измерения попадают в список на правку', () => {
  // Регрессия на реальные файлы предприятия: колонки «Ед.изм» там может не быть
  // вовсе, и это должно быть видно, а не молча пройти.
  const rows = [
    ['Наименование 2206', 'Обозначение', 'К-ВО'],
    ['Виброопора', 'BR0100', '4'],
  ];
  const parsed = parseBomRows({ bomCode: 'БЕЗ-ЕДИНИЦЫ', rows });

  assert.equal(parsed.positions[0]?.unit, '');
  assert.equal(parsed.incomplete.length, 1);
  assert.match(parsed.incomplete[0]?.reason ?? '', /Ед\.изм/, 'причина называет единицу измерения');
});
