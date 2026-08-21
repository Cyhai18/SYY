import { useState } from 'react';
import { Button, Card, Form, Input, Tabs, message } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { APP_NAME } from '@funtax/shared';
import { authApi } from '../lib/auth-api';
import { useAuthStore } from '../store/auth-store';
import { SendCodeButton } from '../components/SendCodeButton';
import pcLogo from '@brand/pc_logo.png';

type LoginMode = 'password' | 'code';

export function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('password');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onFinish = async (values: { phone: string; password?: string; code?: string }) => {
    setLoading(true);
    try {
      const result = await authApi.login({
        phone: values.phone,
        password: mode === 'password' ? values.password : undefined,
        code: mode === 'code' ? values.code : undefined,
      });
      setAuth(result.user, result.accessToken);
      void message.success('登录成功');
      const from = (location.state as { from?: Location })?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <img src={pcLogo} alt={APP_NAME} className="auth-logo" />
        <p className="auth-welcome">欢迎回来，登录以继续</p>
      </div>
      <Card className="auth-card">
        <Tabs
          activeKey={mode}
          onChange={(key) => setMode(key as LoginMode)}
          items={[
            { key: 'password', label: '密码登录' },
            { key: 'code', label: '验证码登录' },
          ]}
        />
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input size="large" placeholder="请输入手机号" maxLength={11} />
          </Form.Item>
          {mode === 'password' ? (
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password size="large" placeholder="请输入密码" />
            </Form.Item>
          ) : (
            <Form.Item
              name="code"
              label="验证码"
              rules={[{ required: true, message: '请输入验证码' }]}
            >
              <SendCodeButton scene="login" />
            </Form.Item>
          )}
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
        <div className="auth-footer">
          没有账号？<Link to="/register">去注册</Link>
        </div>
      </Card>
    </div>
  );
}
