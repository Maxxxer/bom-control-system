/**
 * Главный экран: что происходит в системе прямо сейчас.
 *
 * Задача экрана — за несколько секунд ответить на вопросы «есть ли работа у моей
 * роли» и «нет ли проблем с данными». Поэтому сверху сводные карточки, ниже —
 * переходы на рабочие места и перечень проблем, требующих внимания.
 */

import * as api from '../api/endpoints.js';
import { useLoader } from '../app/useLoader.js';
import { Link } from '../app/router.js';
import { useSession } from '../session/SessionContext.js';
import { StatCard } from '../ui/StatCard.js';
import { Icon, type IconName } from '../ui/icons.js';

/** Рабочие места, доступные с главного экрана. */
const WORKPLACES: Array<{ href: string; title: string; description: string; icon: IconName }> = [
  {
    href: '/deficit',
    title: 'Сводка дефицитов',
    description: 'Заказы, ожидаемые даты и реальные поставки по позициям',
    icon: 'warning',
  },
  {
    href: '/supply',
    title: 'Снабжение',
    description: 'Один материал — все проекты, где он нужен, и сроки',
    icon: 'truck',
  },
  {
    href: '/picking',
    title: 'Отборка',
    description: 'Передача готового материала производству',
    icon: 'checklist',
  },
  {
    href: '/working-bom',
    title: 'WORKING BOM',
    description: 'Что заказано, что пришло и что можно передать',
    icon: 'wrench',
  },
  {
    href: '/dashboard',
    title: 'Дашборд',
    description: 'Состояние спецификаций и отметка «Выполнено»',
    icon: 'chart',
  },
  {
    href: '/warehouse',
    title: 'Склад',
    description: 'Остатки, резервы и свободный остаток',
    icon: 'warehouse',
  },
  {
    href: '/boms',
    title: 'Спецификации',
    description: 'Импорт файлов и карточки спецификаций',
    icon: 'file',
  },
];

export function OverviewPage() {
  const { user } = useSession();
  const { data, loading, error } = useLoader('overview', api.fetchOverview);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Обзор</h1>
          <div className="hint">
            {user
              ? `${user.fullName}: доступ открыт как «${user.roleLabel}». Показаны все данные, менять можно только то, на что есть право.`
              : ''}
          </div>
        </div>
        <Link href="/account" className="btn">
          <Icon name="key" size={16} />
          Мой доступ
        </Link>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
      {loading && !data ? <div className="empty-state">Загружаю сводку…</div> : null}

      {data ? (
        <>
          <div className="grid-cards">
            <StatCard
              title="Спецификаций в работе"
              value={data.boms.total}
              note={`Завершено: ${data.boms.done}`}
            />
            <StatCard
              title="Позиций всего"
              value={data.positions.total}
              note={`Активных: ${data.positions.active}, в производстве: ${data.positions.inProduction}`}
            />
            <StatCard
              title="Не заказано"
              value={data.issues.withoutOrder}
              note="Позиции с потребностью, но без заказа"
              kind={data.issues.withoutOrder > 0 ? 'alert' : 'plain'}
            />
            <StatCard
              title="Ошибок данных"
              value={data.issues.invalidPositions}
              note="Позиции с незаполненными обязательными полями"
              kind={data.issues.invalidPositions > 0 ? 'alert' : 'plain'}
            />
          </div>

          <section className="stack">
            <h2>Состояние спецификаций</h2>
            <div className="grid-cards">
              {data.statuses.length ? (
                data.statuses.map((status) => (
                  <StatCard
                    key={status.status}
                    title={status.label}
                    value={status.count}
                    kind={status.status === 'ERROR' ? 'alert' : 'plain'}
                  />
                ))
              ) : (
                <div className="empty-state">Спецификаций пока нет</div>
              )}
            </div>
          </section>
        </>
      ) : null}

      <section className="stack">
        <h2>Рабочие места</h2>
        <div className="grid-cards">
          {WORKPLACES.map((place) => (
            <Link key={place.href} href={place.href} className="card">
              <span className="card-title">
                <Icon name={place.icon} size={16} /> {place.title}
              </span>
              <span className="card-note">{place.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
