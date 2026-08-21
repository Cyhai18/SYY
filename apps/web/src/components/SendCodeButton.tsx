import { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Space, message } from 'antd';
import type { SmsScene } from '@funtax/shared';
import { authApi } from '../lib/auth-api';

const RESEND_SECONDS = 60;

interface SendCodeButtonProps {
  scene: SmsScene;
  value?: string;
  onChange?: (value: string) => void;
}

/** 验证码输入框 + 发送按钮：60s 倒计时防重复点击，手机号取同一表单的 `phone` 字段。 */
export function SendCodeButton({ scene, value, onChange }: SendCodeButtonProps) {
  const form = Form.useFormInstance();
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const handleSend = async () => {
    const phone = form?.getFieldValue('phone') as string | undefined;
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      void message.error('请先输入正确的手机号');
      return;
    }
    setSending(true);
    try {
      await authApi.sendCode(phone, scene);
      void message.success('验证码已发送，1 分钟内有效');
      setCountdown(RESEND_SECONDS);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        size="large"
        placeholder="请输入验证码"
        maxLength={6}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <Button
        size="large"
        loading={sending}
        disabled={countdown > 0}
        onClick={() => void handleSend()}
      >
        {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
      </Button>
    </Space.Compact>
  );
}
