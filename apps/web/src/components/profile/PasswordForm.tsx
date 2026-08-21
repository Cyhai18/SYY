import { useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import { apiClient } from '../../lib/api-client';

/** 修改密码：已设置过密码需填原密码；仅验证码登录用户首次设置可留空原密码。 */
export function PasswordForm() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (values: {
    oldPassword?: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    setLoading(true);
    try {
      await apiClient.patch('/users/me/password', {
        oldPassword: values.oldPassword || undefined,
        newPassword: values.newPassword,
      });
      void message.success('密码已更新');
      form.resetFields();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
      <Form.Item name="oldPassword" label="原密码（未设置过密码可留空）">
        <Input.Password placeholder="首次设置密码可留空" />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label="新密码"
        rules={[
          { required: true, message: '请输入新密码' },
          { min: 8, message: '密码至少 8 位' },
        ]}
      >
        <Input.Password placeholder="请输入新密码" />
      </Form.Item>
      <Form.Item
        name="confirmPassword"
        label="确认新密码"
        dependencies={['newPassword']}
        rules={[
          { required: true, message: '请再次输入新密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('newPassword') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password placeholder="请再次输入新密码" />
      </Form.Item>
      <Form.Item style={{ marginBottom: 0 }}>
        <Button type="primary" htmlType="submit" loading={loading}>
          保存
        </Button>
      </Form.Item>
    </Form>
  );
}
