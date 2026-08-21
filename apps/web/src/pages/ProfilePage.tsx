import { Avatar, Card, Col, Row, Space, Typography } from 'antd';
import { ROLE_LABELS } from '@funtax/shared';
import { useAuthStore } from '../store/auth-store';
import { brandColors } from '../theme';
import { ProfileForm } from '../components/profile/ProfileForm';
import { PhoneForm } from '../components/profile/PhoneForm';
import { PasswordForm } from '../components/profile/PasswordForm';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const initial = user.nickname?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="profile-page">
      <Card className="profile-header-card">
        <Space size="large" align="center">
          <Avatar size={64} style={{ backgroundColor: brandColors.primary, fontSize: 24 }}>
            {initial}
          </Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {user.nickname}
            </Typography.Title>
            <Typography.Text type="secondary">{ROLE_LABELS[user.role]}</Typography.Text>
          </div>
        </Space>
      </Card>

      <Row gutter={[16, 16]} className="profile-grid">
        <Col xs={24} md={12}>
          <Card title="基础资料" bordered={false} className="profile-card">
            <ProfileForm user={user} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="更换手机号" bordered={false} className="profile-card">
            <PhoneForm currentPhone={user.phone} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="修改密码" bordered={false} className="profile-card">
            <PasswordForm />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
