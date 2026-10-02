/**
 * Снимки экранов интерфейса через Chrome DevTools Protocol.
 *
 * Нужен для проверки вёрстки глазами: «статус обрезается» и «текст наезжает на
 * соседнюю колонку» невозможно поймать тестами — это видно только на картинке.
 * Запускается вручную: node tools/shoot.mjs http://127.0.0.1:8080
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const APP = process.argv[2] ?? 'http://127.0.0.1:8080';
const OUT = 'tools/shots';
const CDP = 'http://127.0.0.1:9222';

const VIEWPORTS = [
  { name: '24fhd', width: 1920, height: 1080 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];

/** Снимки: для каждой ширины свой набор экранов, чтобы не плодить файлы. */
const PLAN = [
  { path: '/deficit', at: ['24fhd', 'laptop', 'tablet', 'phone'] },
  { path: '/warehouse', at: ['24fhd', 'phone'] },
  { path: '/picking', at: ['24fhd', 'phone'] },
  { path: '/boms', at: ['24fhd', 'phone'] },
];

mkdirSync(OUT, { recursive: true });

const version = await (await fetch(`${CDP}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const waiting = new Map();

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const pending = waiting.get(message.id);
  if (pending) {
    waiting.delete(message.id);
    if (message.error) {
      pending.reject(new Error(JSON.stringify(message.error)));
    } else {
      pending.resolve(message.result);
    }
  }
};

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

async function evaluate(expression) {
  const result = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  return result.result?.value;
}

async function settle(ms = 900) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Вход выполняется тем же запросом, что и на экране: cookie ставится на origin.
await send('Page.navigate', { url: `${APP}/login` }, sessionId);
await settle(1200);
const logged = await evaluate(`
  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin12345' }),
  }).then((r) => r.status)
`);
console.log('login status:', logged);

const report = [];

for (const item of PLAN) {
  for (const viewportName of item.at) {
    const viewport = VIEWPORTS.find((v) => v.name === viewportName);
    await send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 820,
      },
      sessionId,
    );
    await send('Page.navigate', { url: `${APP}${item.path}` }, sessionId);
    await settle(1600);

    const metrics = await evaluate(`
      (() => {
        const doc = document.documentElement;
        // Самая широкая таблица на экране: её переполнение и есть проблема.
        const scrollers = [...document.querySelectorAll('.table-scroll')];
        const worst = scrollers.reduce(
          (acc, node) => Math.max(acc, node.scrollWidth - node.clientWidth),
          0,
        );
        // Ячейки, содержимое которых шире самой ячейки: признак наложения.
        const spilling = [...document.querySelectorAll('td, th')].filter((cell) => {
          if (getComputedStyle(cell).overflow !== 'visible') return false;
          return cell.scrollWidth > cell.clientWidth + 1;
        }).length;
        return {
          docOverflowX: doc.scrollWidth - doc.clientWidth,
          tableOverflowX: worst,
          tables: scrollers.length,
          spillingCells: spilling,
        };
      })()
    `);

    const file = `${OUT}/${viewport.name}${item.path.replace(/\//g, '-')}.png`;
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(file, JSON.stringify(metrics));
    report.push({ viewport: viewport.name, path: item.path, ...metrics });
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await send('Target.closeTarget', { targetId });
socket.close();
console.log('готово');