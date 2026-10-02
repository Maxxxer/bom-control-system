/**
 * Фильтр по проекту и поиск по строке таблицы.
 *
 * Широкие витрины трудно читать целиком, поэтому на каждом рабочем месте есть
 * отбор по проекту (он же код спецификации) и быстрый поиск по тому, что видно в
 * строке: модель, код, наименование, производитель.
 *
 * Поиск выполняется на клиенте по уже загруженным строкам — результат виден сразу
 * при вводе, без обращения к серверу.
 */

interface ProjectFilterProps {
  projects: string[];
  value: string;
  onChange: (next: string) => void;
  /** Показать поле поиска по строкам. */
  search?: string;
  onSearchChange?: (next: string) => void;
  /** Сколько строк отобрано из всего. */
  shownCount?: number;
  totalCount?: number;
}

export function ProjectFilter({
  projects,
  value,
  onChange,
  search,
  onSearchChange,
  shownCount,
  totalCount,
}: ProjectFilterProps) {
  return (
    <div className="row">
      <div className="field">
        <label htmlFor="project-filter">Проект</label>
        <select
          id="project-filter"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Все проекты</option>
          {projects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </div>

      {onSearchChange ? (
        <div className="field">
          <label htmlFor="search-filter">Поиск</label>
          <input
            id="search-filter"
            type="text"
            value={search ?? ''}
            placeholder="Модель, артикул, наименование"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      ) : null}

      {shownCount !== undefined && totalCount !== undefined ? (
        <div className="muted">
          Показано строк: {shownCount} из {totalCount}
        </div>
      ) : null}
    </div>
  );
}
