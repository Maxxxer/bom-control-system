/**
 * Ячейки, которые повторяются на рабочих местах: материал и спецификация.
 *
 * Зачем отдельный модуль: одни и те же две ячейки нужны в сводке дефицитов,
 * отборке, WORKING BOM и снабжении, и раньше они были свёрстаны в каждой странице
 * по-своему — двухстрочно, с моделью и артикулом под наименованием. Из-за этого
 * строка занимала вдвое больше высоты, а рабочие места рассчитаны на 24" Full HD,
 * где важно число видимых строк.
 *
 * Теперь значение показано ОДНОЙ строкой: длинный текст обрезается многоточием, а
 * полный состав (модель, артикул, производитель, проект) доступен в подсказке
 * `title`. Информация не теряется — она перестаёт растягивать строку по высоте.
 */

interface MaterialCellProps {
  name: string;
  model: string;
  code?: string;
  manufacturer?: string;
}

/** Материал: наименование, модель и артикул в одну строку. */
export function MaterialCell({ name, model, code, manufacturer }: MaterialCellProps) {
  const head = [name, model].filter(Boolean).join(' · ');
  const details = [
    code ? `артикул: ${code}` : '',
    manufacturer ? `производитель: ${manufacturer}` : '',
  ].filter(Boolean);
  const title = [head, ...details].filter(Boolean).join(' · ');
  return (
    <span className="cell-single wide" title={title}>
      {head}
      {code ? <span className="cell-rest muted"> · {code}</span> : null}
    </span>
  );
}

interface BomCellProps {
  bomName: string;
  projectCode?: string;
}

/** Спецификация: имя спецификации и код проекта в одну строку. */
export function BomCell({ bomName, projectCode }: BomCellProps) {
  return (
    <span
      className="cell-single narrow mono"
      title={projectCode ? `${bomName} (проект: ${projectCode})` : bomName}
    >
      {bomName}
      {projectCode ? <span className="cell-rest muted"> · {projectCode}</span> : null}
    </span>
  );
}

interface ProjectLinesProps {
  /** Строки «проект — количество, срок». */
  lines: string[];
  /** Сколько строк показывать до сворачивания. */
  visible?: number;
}

/**
 * Перечень проектов в одну строку.
 *
 * В «Снабжении» один материал нужен нескольким проектам, и полный список
 * растягивал строку на десяток линий. Показываем первые строки и счётчик
 * остальных: сводка «сколько всего заказывать» остаётся на экране, а подробности
 * — в подсказке.
 */
export function ProjectLines({ lines, visible = 1 }: ProjectLinesProps) {
  if (!lines.length) {
    return <span className="muted">—</span>;
  }
  const shown = lines.slice(0, visible);
  const rest = lines.length - shown.length;
  return (
    <span className="cell-single" title={lines.join('\n')}>
      {shown.join('; ')}
      {rest > 0 ? <span className="cell-rest muted"> · ещё {rest}</span> : null}
    </span>
  );
}
