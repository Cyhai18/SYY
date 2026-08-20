import { useEffect, useState } from 'react';
import { Alert, Button, ConfigProvider, Space, Tag, Typography } from 'antd';
import { APP_NAME, type HealthResponse } from '@funtax/shared';
import { antdTheme } from './theme';
import pcLogo from '@brand/pc_logo.jpg';
import mobileLogo from '@brand/mobile_logo.jpg';

export function App() {
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
    <ConfigProvider theme={antdTheme}>
      <div className="app-shell">
        <header className="app-header">
          <img className="app-logo app-logo--desktop" src={pcLogo} alt={APP_NAME} />
          <img className="app-logo app-logo--mobile" src={mobileLogo} alt={APP_NAME} />
          <Tag color="processing">骨架已就绪</Tag>
        </header>
        <main className="app-main">
          <section className="app-hero">
            <p className="app-kicker">跨境税务 SaaS</p>
            <Typography.Title className="app-title" level={1}>
              {APP_NAME} 控制台骨架
            </Typography.Title>
            <p className="app-copy">
              当前仅提供可访问的 index 页，用于确认 React + Vite + Ant Design 与 NestJS
              工作区已连通。鉴权、客户画像与申报能力尚未实现。
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
        </main>
        <footer className="app-footer">FunTax · 仅框架，不含业务模块</footer>
      </div>
    </ConfigProvider>
  );
}
