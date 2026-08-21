import { useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import type { PublicUser } from '@funtax/shared';
import { apiClient } from '../../lib/api-client';
import { useAuthStore } from '../../store/auth-store';

/** 修改昵称/邮箱，与手机号/密码分开提交，避免误改全部字段。 */
export function ProfileForm({ user }: { user: PublicUser }) {
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);

  const onFinish = async (values: { nickname: string; email?: string }) => {
    setLoading(true);
    try {
      const updated = await apiClient.patch<PublicUser>('/users/me', values);
      setAuth(updated, accessToken ?? '');
      void message.success('资料已更新');
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form
      layout="vertical"
      initialValues={{ nickname: user.nickname, email: user.email ?? undefined }}
      onFinish={onFinish}
      requiredMark={false}
    >
      <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
        <Input placeholder="请输入昵称" maxLength={30} />
      </Form.Item>
      <Form.Item
        name="email"
        label="电子邮箱"
        rules={[{ type: 'email', message: '邮箱格式不正确' }]}
      >
        <Input placeholder="请输入电子邮箱" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={loading}>
          保存
        </Button>
      </Form.Item>
    </Form>
  );
}
