import { Card, Col, Row, Typography } from 'antd';
import { BankOutlined, UserOutlined } from '@ant-design/icons';
import type { ClientType } from '@funtax/shared';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { brandColors } from '../../../theme';

const OPTIONS: { type: ClientType; title: string; desc: string; icon: React.ReactNode }[] = [
  {
    type: 'COMPANY',
    title: '公司',
    desc: '需上传营业执照，自动识别公司信息',
    icon: <BankOutlined style={{ fontSize: 32, color: brandColors.primary }} />,
  },
  {
    type: 'INDIVIDUAL',
    title: '个人',
    desc: '需上传身份证，自动识别个人信息',
    icon: <UserOutlined style={{ fontSize: 32, color: brandColors.primary }} />,
  },
];

/** Step0：注册类型选择。选公司会多走"公司信息"步骤，选个人直接跳到法人信息。 */
export function StepType() {
  const clientType = useClientWizardStore((s) => s.clientType);
  const setClientType = useClientWizardStore((s) => s.setClientType);
  const setCurrent = useClientWizardStore((s) => s.setCurrent);

  const handlePick = (type: ClientType) => {
    setClientType(type);
    setCurrent(type === 'COMPANY' ? 1 : 2);
  };

  return (
    <div className="wizard-step-type">
      <Typography.Title level={5} style={{ marginBottom: 24 }}>
        请选择客户注册类型
      </Typography.Title>
      <Row gutter={24} justify="center">
        {OPTIONS.map((opt) => (
          <Col key={opt.type}>
            <Card
              hoverable
              className={
                clientType === opt.type
                  ? 'wizard-type-card wizard-type-card--active'
                  : 'wizard-type-card'
              }
              onClick={() => handlePick(opt.type)}
            >
              {opt.icon}
              <Typography.Title level={4} style={{ margin: '12px 0 4px' }}>
                {opt.title}
              </Typography.Title>
              <Typography.Text type="secondary">{opt.desc}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
