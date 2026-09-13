import { useEffect, useState } from 'react';
import { Card, ConfigProvider, Layout, Menu, Space, Typography } from 'antd';
import {
  BellOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '@funtax/shared';
import { antdTheme, brandColors } from './theme';
import pcLogo from '@brand/pc_logo.png';
import mobileLogo from '@brand/mobile_logo.png';
import { RequireAuth } from './components/RequireAuth';
import { UserMenu } from './components/UserMenu';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
import { ClientListPage } from './pages/clients/ClientListPage';
import { ClientWizardPage } from './pages/clients/ClientWizardPage';
import { ClientImportProgressPage } from './pages/clients/import/ClientImportProgressPage';
import { useAuthStore } from './store/auth-store';
import { bootstrapAuth } from './lib/auth-api';

export function App() {
  useEffect(() => {
    void bootstrapAuth();
  }, []);

  return (
    <ConfigProvider theme={antdTheme}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <AppShell>
                <ProfilePage />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/clients"
          element={
            <RequireAuth>
              <AppShell>
                <ClientListPage />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/clients/new"
          element={
            <RequireAuth>
              <AppShell>
                <ClientWizardPage />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route
          path="/clients/import/:jobId"
          element={
            <RequireAuth>
              <AppShell>
                <ClientImportProgressPage />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell>
                <Dashboard />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  if (!initialized) {
    return null;
  }
  const isClients = location.pathname.startsWith('/clients');
  const selectedKey = isClients ? 'clients' : 'home';

  return (
    <div className="app-shell">
      <header className="app-header">
        <Space size="large" align="center">
          <img className="app-logo app-logo--desktop" src={pcLogo} alt={APP_NAME} />
          <img className="app-logo app-logo--mobile" src={mobileLogo} alt={APP_NAME} />
        </Space>
        <UserMenu />
      </header>
      <Layout className="app-body">
        <Layout.Sider
          className="app-sider"
          theme="light"
          collapsible
          collapsed={collapsed}
          trigger={null}
          width={200}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ borderInlineEnd: 'none' }}
            items={[
              { key: 'home', icon: <HomeOutlined />, label: '首页', onClick: () => navigate('/') },
              {
                key: 'clients',
                icon: <TeamOutlined />,
                label: '授权客户',
                onClick: () => navigate('/clients'),
              },
            ]}
          />
          <button
            type="button"
            className="app-sider-trigger"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </Layout.Sider>
        <Layout.Content className="app-main">{children}</Layout.Content>
      </Layout>
    </div>
  );
}

/** 根据当前时段给一句问候语，比固定文案多一点"活"的感觉。 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function Dashboard() {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      <section className="app-hero">
        <Typography.Title className="app-title" level={1}>
          {getGreeting()}
          {user?.nickname ? `，${user.nickname}` : ''}
        </Typography.Title>
      </section>
      <div className="app-panel">
        <div className="dashboard-cards">
          <Card
            className="dashboard-card"
            title={
              <Space>
                <BellOutlined />
                消息通知
              </Space>
            }
          >
            <Typography.Text style={{ color: brandColors.body }}>敬请期待</Typography.Text>
          </Card>
        </div>
      </div>
    </>
  );
}
