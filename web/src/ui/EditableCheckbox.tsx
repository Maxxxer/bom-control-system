/**
 * Галочка в строке таблицы с немедленным применением.
 *
 * Используется для отметок «Реальная поставка» и «Передать производству». Галочка
 * переключается сразу, а если сервер откажет по правилам, она возвращается в
 * исходное состояние — пользователь не остаётся с ложным впечатлением, что
 * действие выполнено.
 */

import { useEffect, useState } from 'react';

interface EditableCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  title: string;
  onSave: (next: boolean) => Promise<boolean>;
}

export function EditableCheckbox({ checked, disabled, title, onSave }: EditableCheckboxProps) {
  const [state, setState] = useState(checked);
  const [busy, setBusy] = useState(false);

  // Состояние сервера — источник истины: после отказа галочка снимется сама.
  useEffect(() => {
    setState(checked);
  }, [checked]);

  const toggle = async (): Promise<void> => {
    if (disabled || busy) {
      return;
    }
    const next = !state;
    setState(next);
    setBusy(true);
    try {
      const applied = await onSave(next);
      if (!applied) {
        setState(checked);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <input
      type="checkbox"
      checked={state}
      disabled={disabled || busy}
      title={title}
      aria-label={title}
      onChange={() => void toggle()}
    />
  );
}
