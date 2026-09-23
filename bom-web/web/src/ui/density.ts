/**
 * Плотность строк таблиц: «плотно» (по умолчанию) и «свободно».
 *
 * Зачем настройка, а не одно значение. Рабочие места — это 24" Full HD, где важнее
 * число видимых строк: чем ниже строка, тем меньше прокрутки при сверке
 * спецификации. Но за тем же экраном работают и те, кому плотная строка неудобна
 * (увеличенный системный шрифт, ноутбук с масштабированием). Поэтому высота строки
 * задана токенами (`styles/tokens.css`), а выбор хранится в браузере: он относится
 * к рабочему месту, а не к учётной записи.
 *
 * Значение применяется атрибутом `data-density` на `<html>`: CSS подхватывает его
 * одним правилом, без классов на каждой таблице.
 */

import { useCallback, useEffect, useState } from 'react';

export type Density = 'compact' | 'roomy';

/** Ключ хранения выбора. Версия в имени — чтобы смена значений не «залипала». */
const STORAGE_KEY = 'bom.density.v1';

const DEFAULT_DENSITY: Density = 'compact';

function isDensity(value: string | null): value is Density {
  return value === 'compact' || value === 'roomy';
}

/** Прочитать сохранённый выбор; по умолчанию — плотные строки. */
export function readDensity(): Density {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isDensity(stored) ? stored : DEFAULT_DENSITY;
  } catch {
    // Хранилище может быть недоступно (приватный режим) — тогда работает
    // значение по умолчанию, а не ошибка на весь экран.
    return DEFAULT_DENSITY;
  }
}

/** Применить плотность к документу. */
export function applyDensity(mode: Density): void {
  document.documentElement.dataset.density = mode;
}

/** Сохранить выбор. Неудача сохранения не мешает работе: режим уже применён. */
export function saveDensity(mode: Density): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Игнорируем: хранилище недоступно, режим остаётся на текущую сессию.
  }
}

/**
 * Применить сохранённую плотность до отрисовки приложения.
 *
 * Вызывается один раз при запуске: без этого таблица успевает отрисоваться
 * плотной и «прыгает» после чтения настройки.
 */
export function applyStoredDensity(): Density {
  const mode = readDensity();
  applyDensity(mode);
  return mode;
}

/** Текущая плотность и её переключение. */
export function useDensity(): [Density, (mode: Density) => void] {
  const [mode, setMode] = useState<Density>(() => readDensity());

  useEffect(() => {
    applyDensity(mode);
  }, [mode]);

  const change = useCallback((next: Density) => {
    setMode(next);
    saveDensity(next);
  }, []);

  return [mode, change];
}

/** Подпись режима для кнопки переключения. */
export function densityLabel(mode: Density): string {
  return mode === 'compact' ? 'Плотно' : 'Свободно';
}
