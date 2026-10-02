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
  assert.match(issue?.reason ?? '', /Крайний срок/, 'причина называет крайний срок');
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
