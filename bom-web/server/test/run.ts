/**
 * Точка входа тестов. Запуск: `npm test` (tsx test/run.ts).
 *
 * Каждый файл .test.ts сам регистрирует проверки через `node:test`; здесь они
 * собираются в один прогон, поэтому состав набора виден в одном месте.
 */

import './values.test.js';
import './keys.test.js';
import './calculate.test.js';
import './procurement.test.js';
import './position.test.js';
import './specFields.test.js';
import './bomImport.test.js';
import './projections.test.js';
import './dashboard.test.js';
import './permissions.test.js';
