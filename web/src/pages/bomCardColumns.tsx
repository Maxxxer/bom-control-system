/**
 * Колонки карточки спецификации: правка полей спецификации прямо в строке.
 *
 * Что здесь важно и почему так:
 *   * карточка показывает ТОЛЬКО то, чем занимается экономист: описание позиции,
 *     количество, резерв и срок. Операционные поля («Заказано», «Поставлено»,
 *     «Ожидаемая поставка») и служебные («Состояние», «Жизненный цикл») убраны —
 *     у них свои рабочие экраны и свои роли, а в карточке они только шумят и
 *     отвлекают от того, что здесь правят. Состояние позиции видно по строке
 *     (цветом и значком «Ошибка данных»), а на рабочих местах — в своих колонках;
 *   * «№» и «Материал» прилипают к левому краю: колонок много, и без этого при
 *     горизонтальной прокрутке строка теряет опознаваемость (см. `DataTable`);
 *   * значение строки показано в одну линию: наименование и модель не
 *     переносятся, полный состав доступен в подсказке — так на экран помещается
 *     больше строк;
 *   * строка с «Ошибкой данных» помечена значком с перечнем незаполненных полей,
 *     а не общим «что-то не так»: экономисту нужно знать, что именно править.
 *
 * Про массовый ввод. У каждой правящейся колонки указаны `bulkField` (имя поля,
 * которое понимает массовая правка) и текст значения — благодаря этому колонка
 * участвует в выделении и вставке блока из Excel.
 */

import type { PositionDto } from '../api/types.js';
import { formatDate, formatQty } from '../format.js';
import type { Column } from '../ui/DataTable.js';
import { EditableDate } from '../ui/EditableDate.js';
import { EditableNumber } from '../ui/EditableNumber.js';
import { EditableText } from '../ui/EditableText.js';
import { materialHint, SPEC_FIELD_LABEL, type SpecFieldName } from './bomSpecFields.js';

/** Сохранение одного поля спецификации; `true` — данные изменились. */
export type SaveSpecField = (
  row: PositionDto,
  field: SpecFieldName,
  value: string | number | null,
) => Promise<boolean>;

export interface BomCardColumnsParams {
  /** Роль может править спецификацию (`SOURCE_BOM_WRITE`). */
  canEdit: boolean;
  /** Идёт запрос: поля блокируются, чтобы не слать правки пачкой. */
  busy: boolean;
  onSave: SaveSpecField;
}

/** Подсказка для поля: почему его нельзя править этой роли. */
function fieldHint(canEdit: boolean, field: SpecFieldName): string {
  const label = SPEC_FIELD_LABEL[field];
  return canEdit ? label : `${label} — правку спецификации ведёт экономист`;
}

export function buildBomCardColumns(
  params: BomCardColumnsParams,
): Array<Column<PositionDto>> {
  const editable = params.canEdit;
  const locked = !editable || params.busy;

  return [
    {
      key: 'rowNo',
      title: '№',
      numeric: true,
      width: '56px',
      sticky: true,
      sortValue: (row) => row.identity.rowNo,
      text: (row) => String(row.identity.rowNo),
      bulkField: 'rowNo',
      readOnly: !editable,
      render: (row) => (
        <EditableNumber
          value={row.identity.rowNo}
          disabled={locked}
          title={fieldHint(editable, 'rowNo')}
          onSave={(next) => params.onSave(row, 'rowNo', next)}
        />
      ),
    },
    {
      key: 'material',
      title: 'Материал',
      width: '320px',
      sticky: true,
      sortValue: (row) => `${row.identity.name} ${row.identity.model}`,
      text: (row) => row.identity.name,
      bulkField: 'name',
      readOnly: !editable,
      render: (row) => (
        <EditableText
          value={row.identity.name}
          label={SPEC_FIELD_LABEL.name}
          disabled={locked}
          title={materialHint(row)}
          onSave={(next) => params.onSave(row, 'name', next)}
        />
      ),
    },
    {
      key: 'model',
      title: 'Модель',
      width: '140px',
      sortValue: (row) => row.identity.model,
      text: (row) => row.identity.model,
      bulkField: 'model',
      readOnly: !editable,
      render: (row) => (
        <EditableText
          value={row.identity.model}
          label={SPEC_FIELD_LABEL.model}
          disabled={locked}
          title={fieldHint(editable, 'model')}
          onSave={(next) => params.onSave(row, 'model', next)}
        />
      ),
    },
    {
      key: 'code',
      title: 'Артикул',
      width: '130px',
      sortValue: (row) => row.identity.code,
      text: (row) => row.identity.code,
      bulkField: 'code',
      readOnly: !editable,
      render: (row) => (
        <EditableText
          value={row.identity.code}
          label={SPEC_FIELD_LABEL.code}
          allowEmpty
          placeholder="—"
          disabled={locked}
          title={fieldHint(editable, 'code')}
          onSave={(next) => params.onSave(row, 'code', next)}
        />
      ),
    },
    {
      key: 'manufacturer',
      title: 'Производитель',
      width: '150px',
      sortValue: (row) => row.identity.manufacturer,
      text: (row) => row.identity.manufacturer,
      bulkField: 'manufacturer',
      readOnly: !editable,
      render: (row) => (
        <EditableText
          value={row.identity.manufacturer}
          label={SPEC_FIELD_LABEL.manufacturer}
          allowEmpty
          placeholder="—"
          disabled={locked}
          title={fieldHint(editable, 'manufacturer')}
          onSave={(next) => params.onSave(row, 'manufacturer', next)}
        />
      ),
    },
    {
      key: 'unit',
      title: 'Ед.',
      width: '72px',
      sortValue: (row) => row.identity.unit,
      text: (row) => row.identity.unit,
      bulkField: 'unit',
      readOnly: !editable,
      render: (row) => (
        <EditableText
          value={row.identity.unit}
          label={SPEC_FIELD_LABEL.unit}
          disabled={locked}
          title={fieldHint(editable, 'unit')}
          onSave={(next) => params.onSave(row, 'unit', next)}
        />
      ),
    },
    {
      key: 'required',
      title: 'Нужно',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.quantities.requiredQty,
      text: (row) => formatQty(row.quantities.requiredQty),
      bulkField: 'requiredQty',
      readOnly: !editable,
      render: (row) => (
        <EditableNumber
          value={row.quantities.requiredQty}
          disabled={locked}
          title={fieldHint(editable, 'requiredQty')}
          onSave={(next) => params.onSave(row, 'requiredQty', next)}
        />
      ),
    },
    {
      key: 'reserved',
      title: 'Резерв',
      numeric: true,
      width: '96px',
      sortValue: (row) => row.quantities.reservedQty,
      text: (row) => formatQty(row.quantities.reservedQty),
      bulkField: 'reservedQty',
      readOnly: !editable,
      render: (row) => (
        <EditableNumber
          value={row.quantities.reservedQty}
          disabled={locked}
          title={fieldHint(editable, 'reservedQty')}
          onSave={(next) => params.onSave(row, 'reservedQty', next)}
        />
      ),
    },
    {
      key: 'deadline',
      title: 'Крайний срок',
      width: '116px',
      sortValue: (row) => row.identity.deadline ?? '',
      text: (row) => (row.identity.deadline ? formatDate(row.identity.deadline) : ''),
      bulkField: 'deadline',
      readOnly: !editable,
      render: (row) => (
        <EditableDate
          value={row.identity.deadline}
          allowEmpty={false}
          disabled={locked}
          title={fieldHint(editable, 'deadline')}
          onSave={(next) => params.onSave(row, 'deadline', next)}
        />
      ),
    },
  ];
}
