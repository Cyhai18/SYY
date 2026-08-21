import { useState } from 'react';
import { Button, Card, Form, Input, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { APP_NAME } from '@funtax/shared';
import { authApi } from '../lib/auth-api';
import { useAuthStore } from '../store/auth-store';
import { SendCodeButton } from '../components/SendCodeButton';
import pcLogo from '@brand/pc_logo.png';

export function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onFinish = async (values: { phone: string; code: string; password?: string }) => {
    setLoading(true);
    try {
      const result = await authApi.register(
        values.phone,
        values.code,
        values.password || undefined,
      );
      setAuth(result.user, result.accessToken);
      void message.success('注册成功');
      navigate('/', { replace: true });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <img src={pcLogo} alt={APP_NAME} className="auth-logo" />
        <p className="auth-welcome">创建账号，开始使用</p>
      </div>
      <Card className="auth-card">
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
          <Form.Item
            name="code"
            label="验证码"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <SendCodeButton scene="register" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码（可选，不设置则仅支持验证码登录）"
            rules={[{ min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password size="large" placeholder="可选，设置后支持密码登录" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              注册并登录
            </Button>
          </Form.Item>
        </Form>
        <div className="auth-footer">
          已有账号？<Link to="/login">去登录</Link>
        </div>
      </Card>
    </div>
  );
}
