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
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
