import { useState } from 'react';
import { Alert, Card, Col, Form, Input, Row, message } from 'antd';
import type { FormInstance } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { ocrApi } from '../../../lib/ocr-api';
import { useDuplicateCheck } from '../hooks/useDuplicateCheck';
import { CertUploadPreview } from './CertUploadPreview';

interface CompanyFormValues {
  creditCode?: string;
  nameCn?: string;
  nameEn?: string;
  postalCode?: string;
  addressCn?: string;
  addressEn?: string;
  provinceEn?: string;
  cityEn?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
}

/** Step1：公司信息，仅公司类型客户可见。上传营业执照后走 OCR 预填，字段全程可编辑。
 * 校验交由 antd `Form` 承担（`form` 由父级 `ClientWizardPage` 持有并在"下一步"时调用
 * `validateFields()`），字段值改动通过 `onValuesChange` 写回 Zustand store，保持 store
 * 作为最终提交数据源不变。 */
export function StepCompany({ form }: { form: FormInstance<CompanyFormValues> }) {
  const companyInfo = useClientWizardStore((s) => s.companyInfo);
  const setCompanyInfo = useClientWizardStore((s) => s.setCompanyInfo);
  const businessLicenseFile = useClientWizardStore((s) => s.businessLicenseFile);
  const setBusinessLicenseFile = useClientWizardStore((s) => s.setBusinessLicenseFile);
  const clearBusinessLicenseFile = useClientWizardStore((s) => s.clearBusinessLicenseFile);
  const markOcrFailed = useClientWizardStore((s) => s.markOcrFailed);
  // 提示条的展示态/自动隐藏定时器都挂在 store 上（而非本地 state），避免在 APPEND/OCR 失败后
  // 切换到别的向导步骤再切回来，组件重新挂载导致提示又被重新触发展示、重新计时。
  const showOcrFailedHint = useClientWizardStore((s) => s.ocrFailedHintVisible);
  const dismissOcrFailedHint = useClientWizardStore((s) => s.dismissOcrFailedHint);
  const showLockedHint = useClientWizardStore((s) => s.lockedHintVisible);
  const dismissLockedHint = useClientWizardStore((s) => s.dismissLockedHint);
  const phone = useClientWizardStore((s) => s.phone);
  const email = useClientWizardStore((s) => s.email);
  const setContact = useClientWizardStore((s) => s.setContact);
  const [recognizing, setRecognizing] = useState(false);
  const { runDuplicateCheck } = useDuplicateCheck('统一社会信用代码', 'company', form);

  const handleUpload = async (file: File) => {
    setBusinessLicenseFile(file);
    setRecognizing(true);
    try {
      const result = await ocrApi.recognizeBusinessLicense(file);
      if (result.recognized) {
        setCompanyInfo(result.fields);
        form.setFieldsValue(result.fields);
        if (result.fields.creditCode) void runDuplicateCheck(result.fields.creditCode);
        void message.success('营业执照识别完成，已自动填充，请核对');
      } else {
        markOcrFailed();
        void message.warning('未能自动识别，请手动填写以下字段');
      }
    } catch {
      markOcrFailed();
      void message.error('识别服务暂不可用，请手动填写');
    } finally {
      setRecognizing(false);
    }
  };

  const handleValuesChange = (changed: CompanyFormValues) => {
    // antd 的 changed 只包含"本次刚变化"的那个字段，不能不管有没有出现在 changed 里就
    // 无条件把 phone/email 都塞进 setContact——否则未变化的那个字段会被覆盖成 undefined
    // （已修复的 bug：填了电话再填邮箱，电话会被清空）。
    const { phone: changedPhone, email: changedEmail, ...companyFields } = changed;
    const contactFields: { phone?: string; email?: string } = {};
    if ('phone' in changed) contactFields.phone = changedPhone;
    if ('email' in changed) contactFields.email = changedEmail;
    if (Object.keys(contactFields).length > 0) {
      setContact(contactFields);
    }
    if (Object.keys(companyFields).length > 0) {
      setCompanyInfo(companyFields);
    }
  };

  return (
    <div>
      {showOcrFailedHint ? (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={dismissOcrFailedHint}
          message="部分证件未能自动识别，请手动核对并补全下方信息"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {showLockedHint ? (
        <Alert
          type="info"
          showIcon
          closable
          onClose={dismissLockedHint}
          message="该客户已存在，正在为其追加代理信息。统一信用代码不可变更，其余信息及本次上传的营业执照将以最新识别/填写内容为准并覆盖更新。"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div style={{ marginBottom: 16 }}>
        <CertUploadPreview
          file={businessLicenseFile}
          accept=".jpg,.jpeg,.png,.pdf"
          uploading={recognizing}
          uploadingText="识别中，请稍候…"
          placeholderText="点击或拖拽上传营业执照"
          icon={<InboxOutlined />}
          onUpload={(file) => void handleUpload(file)}
          onRemove={clearBusinessLicenseFile}
        />
      </div>

      <Form<CompanyFormValues>
        form={form}
        layout="vertical"
        initialValues={{ ...companyInfo, phone, email }}
        onValuesChange={handleValuesChange}
      >
        <Card
          className="form-card form-card--legal"
          variant="borderless"
          title="公司信息"
          style={{ marginBottom: 16 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="统一社会信用代码"
                name="creditCode"
                rules={[{ required: true, message: '请上传营业执照以自动识别统一社会信用代码' }]}
                tooltip="统一社会信用代码由营业执照 OCR 识别得出，不支持手动修改"
              >
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="公司中文名"
                name="nameCn"
                rules={[{ required: true, message: '请填写公司中文名' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="公司英文名"
                name="nameEn"
                rules={[{ required: true, message: '请填写公司英文名' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="邮编"
                name="postalCode"
                rules={[{ required: true, message: '请填写邮编' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="公司中文地址"
                name="addressCn"
                rules={[{ required: true, message: '请填写公司中文地址' }]}
              >
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="公司英文地址"
                name="addressEn"
                rules={[{ required: true, message: '请填写公司英文地址' }]}
              >
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="公司所在省份（英文）" name="provinceEn">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="公司所在城市（英文）" name="cityEn">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card
          className="form-card form-card--contact"
          variant="borderless"
          title="联系方式"
          style={{ marginTop: 16 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="联系人"
                name="contactPerson"
                rules={[{ required: true, message: '请填写联系人' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="联系电话"
                name="phone"
                rules={[{ required: true, message: '请填写联系电话' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="联系邮箱"
                name="email"
                rules={[{ required: true, message: '请填写联系邮箱' }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Form>
    </div>
  );
}
