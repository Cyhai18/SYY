import { useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import type { PublicUser } from '@funtax/shared';
import { apiClient } from '../../lib/api-client';
import { useAuthStore } from '../../store/auth-store';
import { SendCodeButton } from '../SendCodeButton';

/** 换绑手机号：新手机号 + 发到新手机号的验证码，校验通过后立即生效。 */
export function PhoneForm({ currentPhone }: { currentPhone: string }) {
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);

  const onFinish = async (values: { phone: string; code: string }) => {
    setLoading(true);
    try {
      const updated = await apiClient.patch<PublicUser>('/users/me/phone', values);
      setAuth(updated, accessToken ?? '');
      void message.success('手机号已更新');
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
      <Form.Item label="当前手机号">
        <Input value={currentPhone} disabled />
      </Form.Item>
      <Form.Item
        name="phone"
        label="新手机号"
        rules={[
          { required: true, message: '请输入新手机号' },
          { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
        ]}
      >
        <Input placeholder="请输入新手机号" maxLength={11} />
      </Form.Item>
      <Form.Item name="code" label="验证码" rules={[{ required: true, message: '请输入验证码' }]}>
        <SendCodeButton scene="bind-phone" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={loading}>
          保存
        </Button>
      </Form.Item>
    </Form>
  );
}
