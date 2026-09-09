import { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Input, List, Modal, Row, Select, Upload, message } from 'antd';
import { InboxOutlined, PlusOutlined } from '@ant-design/icons';
import { CLIENT_TYPE_LABELS, type ClientPayload, type ClientType } from '@funtax/shared';
import { nextKey, type AgentInfoDraft } from '../../../store/client-wizard-store';
import { clientImportApi, type ImportItem } from '../../../lib/client-import-api';
import { AgentInfoEditor } from '../steps/AgentInfoEditor';

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
  const [businessLicenseFile, setBusinessLicenseFile] = useState<File | null>(null);
  const [idCardFrontFile, setIdCardFrontFile] = useState<File | null>(null);
  const [idCardBackFile, setIdCardBackFile] = useState<File | null>(null);
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
    setBusinessLicenseFile(null);
    setIdCardFrontFile(null);
    setIdCardBackFile(null);
  }, [item, open]);

  if (!item) return null;

  const addAgentInfo = () =>
    setAgentInfos([
      ...agentInfos,
      {
        key: nextKey(),
        country: 'GB',
        expectedEffectiveDate: '',
        agentYears: 1,
        agentCompany: 'OVERSEA_WALKERS_GB',
        shops: [],
      },
    ]);

  const handleSubmit = async () => {
    const payload: ClientPayload = {
      clientType,
      phone,
      email: email || undefined,
      companyInfo: companyInfo as unknown as ClientPayload['companyInfo'],
      legalRepInfo: legalRepInfo as unknown as ClientPayload['legalRepInfo'],
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
      await clientImportApi.reviewItem(item.id, payload, {
        businessLicenseFile,
        idCardFrontFile,
        idCardBackFile,
      });
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

      <Form layout="vertical">
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label="注册类型" required>
              <Select
                value={clientType}
                onChange={setClientType}
                options={Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={9}>
            <Form.Item label="联系手机号" required>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Form.Item>
          </Col>
          <Col span={9}>
            <Form.Item label="邮箱">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {clientType === 'COMPANY' ? (
        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="统一信用代码" required>
                <Input
                  value={companyInfo.creditCode as string}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, creditCode: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="公司中文名">
                <Input
                  value={companyInfo.nameCn as string}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, nameCn: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="公司英文名">
                <Input
                  value={companyInfo.nameEn as string}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, nameEn: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Upload.Dragger
                accept=".jpg,.jpeg,.png,.pdf"
                maxCount={1}
                showUploadList
                beforeUpload={(file) => {
                  setBusinessLicenseFile(file);
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">重新上传营业执照（可选，不上传则保留原字段）</p>
              </Upload.Dragger>
            </Col>
          </Row>
        </Form>
      ) : null}

      <Form layout="vertical" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
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
                onChange={(e) => setLegalRepInfo({ ...legalRepInfo, namePinyin: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="身份证号" required>
              <Input
                value={legalRepInfo.idNumber as string}
                onChange={(e) => setLegalRepInfo({ ...legalRepInfo, idNumber: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Upload.Dragger
              accept=".jpg,.jpeg,.png"
              maxCount={1}
              beforeUpload={(file) => {
                setIdCardFrontFile(file);
                return false;
              }}
            >
              <p className="ant-upload-text">重新上传身份证正面（可选）</p>
            </Upload.Dragger>
          </Col>
          <Col span={12}>
            <Upload.Dragger
              accept=".jpg,.jpeg,.png"
              maxCount={1}
              beforeUpload={(file) => {
                setIdCardBackFile(file);
                return false;
              }}
            >
              <p className="ant-upload-text">重新上传身份证反面（可选）</p>
            </Upload.Dragger>
          </Col>
        </Row>
      </Form>

      {agentInfos.map((agentInfo, index) => (
        <div key={agentInfo.key} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{`代理信息 ${index + 1}`}</div>
          <AgentInfoEditor
            agentInfo={agentInfo}
            onChange={(next) =>
              setAgentInfos(agentInfos.map((a) => (a.key === agentInfo.key ? next : a)))
            }
          />
        </div>
      ))}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addAgentInfo}>
        新增代理信息
      </Button>
    </Modal>
  );
}
