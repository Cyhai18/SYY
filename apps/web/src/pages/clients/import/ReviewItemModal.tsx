import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, List, Modal, Row, Select, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import {
  AGENT_COUNTRY_LABELS,
  CLIENT_TYPE_LABELS,
  type AgentCountry,
  type ClientPayload,
  type ClientType,
} from '@funtax/shared';
import { nextKey, type AgentInfoDraft } from '../../../store/client-wizard-store';
import { clientImportApi, type ImportItem } from '../../../lib/client-import-api';
import { AgentInfoEditor } from '../steps/AgentInfoEditor';

/** 代理国家 -> 国旗 emoji，与 StepShops 保持一致，代理信息卡片标题用。 */
const AGENT_COUNTRY_FLAGS: Record<AgentCountry, string> = {
  GB: '🇬🇧',
  EU: '🇪🇺',
  US: '🇺🇸',
  TR: '🇹🇷',
  CA: '🇨🇦',
};

/** 把后端 reviewFields 快照（无本地 key）转成可编辑草稿（补上本地 key）。 */
function toAgentInfoDrafts(raw: unknown): AgentInfoDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((agent: Record<string, unknown>) => ({
    ...(agent as Omit<AgentInfoDraft, 'key' | 'shops'>),
    key: nextKey(),
    shops: Array.isArray(agent.shops)
      ? (agent.shops as Record<string, unknown>[]).map((shop) => ({
          ...(shop as object),
          key: nextKey(),
          products: Array.isArray(shop.products)
            ? (shop.products as object[]).map((p) => ({ ...p, key: nextKey() }))
            : [],
        }))
      : [],
  })) as AgentInfoDraft[];
}

/** NEEDS_REVIEW / FAILED 明细的人工核对表单：复用单条创建向导的代理信息编辑器，字段来自 `reviewFields` 快照。 */
export function ReviewItemModal({
  item,
  open,
  onClose,
  onSuccess,
}: {
  item: ImportItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [clientType, setClientType] = useState<ClientType>('COMPANY');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [companyInfo, setCompanyInfo] = useState<Record<string, unknown>>({});
  const [legalRepInfo, setLegalRepInfo] = useState<Record<string, unknown>>({});
  const [agentInfos, setAgentInfos] = useState<AgentInfoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    const fields = item.reviewFields ?? {};
    setClientType((fields.clientType as ClientType) ?? 'COMPANY');
    setPhone((fields.phone as string) ?? '');
    setEmail((fields.email as string) ?? '');
    setCompanyInfo((fields.companyInfo as Record<string, unknown>) ?? {});
    setLegalRepInfo((fields.legalRepInfo as Record<string, unknown>) ?? {});
    setAgentInfos(toAgentInfoDrafts(fields.agentInfos));
  }, [item, open]);

  if (!item) return null;

  const handleSubmit = async () => {
    // 客户唯一标识：公司取统一信用代码，个人取身份证号，落在 Client.uniqueIdentifier
    const uniqueIdentifier =
      clientType === 'COMPANY'
        ? ((companyInfo.creditCode as string | undefined) ?? '')
        : ((legalRepInfo.idNumber as string | undefined) ?? '');
    const payload: ClientPayload = {
      clientType,
      phone,
      email,
      uniqueIdentifier,
      // 与后端 row-validator.service.ts 保持一致：公司信息/法人信息只在对应注册类型下才提交，
      // 否则另一侧即使是空对象 `{}`，也会被 class-validator 当作"存在但字段缺失"而报必填错误。
      companyInfo: (clientType === 'COMPANY'
        ? companyInfo
        : undefined) as unknown as ClientPayload['companyInfo'],
      legalRepInfo: (clientType === 'INDIVIDUAL'
        ? legalRepInfo
        : undefined) as unknown as ClientPayload['legalRepInfo'],
      agentInfos: agentInfos.map(({ key, shops, ...rest }) => ({
        ...rest,
        shops: shops.map(({ key: shopKey, products, ...shopRest }) => ({
          ...shopRest,
          products: products.map(({ key: productKey, ...productRest }) => productRest),
        })),
      })),
    };

    setSubmitting(true);
    try {
      await clientImportApi.reviewItem(item.id, payload);
      void message.success('核对提交成功，客户已创建');
      onSuccess();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '提交失败，请检查表单');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`核对：${item.fileName}`}
      open={open}
      onCancel={onClose}
      width={960}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={() => void handleSubmit()}
        >
          提交
        </Button>,
      ]}
      destroyOnClose
    >
      {item.reviewIssues && item.reviewIssues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="以下字段需要核对"
          description={
            <List
              size="small"
              dataSource={item.reviewIssues}
              renderItem={(issue) => <List.Item>{`${issue.field}：${issue.message}`}</List.Item>}
            />
          }
        />
      ) : null}

      <Form layout="vertical" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label="注册类型" required>
              <Select
                value={clientType}
                disabled
                options={Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {/* 与新建客户向导保持一致：注册类型二选一决定展示"公司信息"或"个人信息"，二者互斥、不同时出现 */}
      {clientType === 'COMPANY' ? (
        <>
          <Form layout="vertical">
            <Card
              className="form-card form-card--legal"
              variant="borderless"
              title="公司信息"
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="统一社会信用代码" required>
                    <Input
                      value={companyInfo.creditCode as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, creditCode: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司中文名" required>
                    <Input
                      value={companyInfo.nameCn as string}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, nameCn: e.target.value })}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司英文名" required>
                    <Input
                      value={companyInfo.nameEn as string}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, nameEn: e.target.value })}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="邮编" required>
                    <Input
                      value={companyInfo.postalCode as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, postalCode: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司中文地址" required>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 2 }}
                      value={companyInfo.addressCn as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, addressCn: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司英文地址" required>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 2 }}
                      value={companyInfo.addressEn as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, addressEn: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司所在省份（英文）">
                    <Input
                      value={companyInfo.provinceEn as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, provinceEn: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="公司所在城市（英文）">
                    <Input
                      value={companyInfo.cityEn as string}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, cityEn: e.target.value })}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card
              className="form-card form-card--contact"
              variant="borderless"
              title="联系方式"
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="联系人" required>
                    <Input
                      value={companyInfo.contactPerson as string}
                      onChange={(e) =>
                        setCompanyInfo({ ...companyInfo, contactPerson: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="联系电话" required>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="联系邮箱" required>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Form>
        </>
      ) : (
        <>
          <Form layout="vertical">
            <Card
              className="form-card form-card--legal"
              variant="borderless"
              title="个人信息"
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="身份证号" required>
                    <Input
                      value={legalRepInfo.idNumber as string}
                      onChange={(e) =>
                        setLegalRepInfo({ ...legalRepInfo, idNumber: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="姓名（中文）" required>
                    <Input
                      value={legalRepInfo.nameCn as string}
                      onChange={(e) => setLegalRepInfo({ ...legalRepInfo, nameCn: e.target.value })}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="姓名（拼音）" required>
                    <Input
                      value={legalRepInfo.namePinyin as string}
                      onChange={(e) =>
                        setLegalRepInfo({ ...legalRepInfo, namePinyin: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="邮编" required>
                    <Input
                      value={legalRepInfo.idPostalCode as string}
                      onChange={(e) =>
                        setLegalRepInfo({ ...legalRepInfo, idPostalCode: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="身份证地址（中文）" required>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 2 }}
                      value={legalRepInfo.idAddressCn as string}
                      onChange={(e) =>
                        setLegalRepInfo({ ...legalRepInfo, idAddressCn: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="身份证地址（英文）" required>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 2 }}
                      value={legalRepInfo.idAddressEn as string}
                      onChange={(e) =>
                        setLegalRepInfo({ ...legalRepInfo, idAddressEn: e.target.value })
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card
              className="form-card form-card--contact"
              variant="borderless"
              title="联系方式"
              style={{ marginBottom: 16 }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="联系电话" required>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="联系邮箱" required>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Form>
        </>
      )}

      {/* 代理信息：卡片样式与新建客户向导的 StepShops 保持一致（国旗 + 国家名标题、右上角删除） */}
      <div className="agent-info-grid">
        {agentInfos.map((agentInfo, index) => (
          <Card
            key={agentInfo.key}
            className="agent-card"
            variant="borderless"
            style={{ marginBottom: 16 }}
            title={
              <span className="section-title section-title--agent">
                {agentInfo.country ? (
                  <span className="section-title__flag">
                    {AGENT_COUNTRY_FLAGS[agentInfo.country]}
                  </span>
                ) : null}
                {agentInfo.country
                  ? `${AGENT_COUNTRY_LABELS[agentInfo.country]}代理`
                  : `代理信息 ${index + 1}`}
              </span>
            }
            extra={
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => setAgentInfos(agentInfos.filter((a) => a.key !== agentInfo.key))}
              />
            }
          >
            <AgentInfoEditor
              agentInfo={agentInfo}
              onChange={(next) =>
                setAgentInfos(agentInfos.map((a) => (a.key === agentInfo.key ? next : a)))
              }
            />
          </Card>
        ))}
      </div>
    </Modal>
  );
}
