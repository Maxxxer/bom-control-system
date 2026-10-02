/**
 * Корневой компонент: выбор экрана по адресу и защита от неавторизованного входа.
 *
 * Логика простая и предсказуемая: пока идёт проверка сессии — заглушка; без сессии
 * показывается только экран входа; после входа — общий каркас с навигацией и
 * запрошенным экраном. Неизвестный адрес не оставляет пользователя на пустом
 * экране: показывается объяснение и ссылка на обзор.
 */

import { LoginPage } from './pages/LoginPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { ArchivePage } from './pages/ArchivePage.js';
import { BomsPage } from './pages/BomsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DeficitPage } from './pages/DeficitPage.js';
import { PickingPage } from './pages/PickingPage.js';
import { SupplyPage } from './pages/SupplyPage.js';
import { WarehousePage } from './pages/WarehousePage.js';
import { WorkingBomPage } from './pages/WorkingBomPage.js';
import { Link, usePathname } from './app/router.js';
import { useSession } from './session/SessionContext.js';
import { BrandLockup, Layout } from './ui/Layout.js';

export function Screens({ pathname }: { pathname: string }) {
  switch (pathname) {
    case '/':
      return <OverviewPage />;
    case '/deficit':
      return <DeficitPage />;
    case '/supply':
      return <SupplyPage />;
    case '/picking':
      return <PickingPage />;
    case '/working-bom':
      return <WorkingBomPage />;
    case '/dashboard':
      return <DashboardPage />;
    case '/warehouse':
      return <WarehousePage />;
    case '/boms':
      return <BomsPage />;
    case '/archive':
      return <ArchivePage />;
    case '/admin':
      return <AdminPage />;
    case '/account':
      return <AccountPage />;
    default:
      return (
        <div className="page">
          <div className="page-head">
            <div>
              <h1>Раздел не найден</h1>
              <div className="hint">
                Такого адреса в системе нет: {pathname}. Возможно, ссылка устарела.
              </div>
            </div>
          </div>
          <div className="empty-state">
            <Link href="/" className="btn primary">
              Вернуться на обзор
            </Link>
          </div>
        </div>
      );
  }
}

export function App() {
  const { user, loading } = useSession();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-inner">
            <BrandLockup />
          </div>
        </header>
        <main className="app-main">
          <div className="empty-state">Проверяю доступ…</div>
        </main>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Layout pathname={pathname}>
      <Screens pathname={pathname} />
    </Layout>
  );
}
