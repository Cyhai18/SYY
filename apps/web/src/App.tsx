import { useEffect, useState } from 'react';
import { Alert, Button, ConfigProvider, Space, Typography } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';
import { APP_NAME, type HealthResponse } from '@funtax/shared';
import { antdTheme } from './theme';
import pcLogo from '@brand/pc_logo.png';
import mobileLogo from '@brand/mobile_logo.png';
import { RequireAuth } from './components/RequireAuth';
import { UserMenu } from './components/UserMenu';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
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
  if (!initialized) {
    return null;
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <img className="app-logo app-logo--desktop" src={pcLogo} alt={APP_NAME} />
        <img className="app-logo app-logo--mobile" src={mobileLogo} alt={APP_NAME} />
        <UserMenu />
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">{APP_NAME} · 跨境卖家税务 SaaS</footer>
    </div>
  );
}

function Dashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checkApi = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as HealthResponse;
      setHealth(payload);
    } catch {
      setHealth(null);
      setError('API 未启动或暂时不可达。可先单独打开本页确认前端骨架。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void checkApi();
  }, []);

  return (
    <>
      <section className="app-hero">
        <p className="app-kicker">跨境税务 SaaS</p>
        <Typography.Title className="app-title" level={1}>
          {APP_NAME} 控制台
        </Typography.Title>
        <p className="app-copy">
          当前仅提供可访问的 index 页，用于确认 React + Vite + Ant Design 与 NestJS
          工作区已连通。客户画像与申报能力尚未实现。
        </p>
      </section>
      <div className="app-panel">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {health ? (
            <Alert
              type="success"
              showIcon
              message="API 健康检查通过"
              description={`${health.service} · ${health.status} · ${health.timestamp}`}
            />
          ) : null}
          {error ? (
            <Alert type="warning" showIcon message="API 暂未连通" description={error} />
          ) : null}
          <Button type="primary" loading={loading} onClick={() => void checkApi()}>
            重新检查 API
          </Button>
        </Space>
      </div>
    </>
  );
}
