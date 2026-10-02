/**
 * Запуск приложения.
 *
 * Порядок провайдеров важен: сообщения об ошибках показываются через уведомления,
 * поэтому провайдер уведомлений должен быть внешним по отношению к сессии. Если
 * поменять их местами, ошибка входа останется без видимого сообщения.
 *
 * Стили подключены здесь, а не в разметке: так порядок слоёв (шрифты → токены →
 * базовые → компоненты) гарантирован и не зависит от порядка тегов в HTML.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { App } from './App.js';
import { SessionProvider } from './session/SessionContext.js';
import { ToastProvider } from './ui/ToastProvider.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден контейнер приложения #root');
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
