import { useState } from 'react';
import { Alert, Card, Col, Form, Input, Row, message } from 'antd';
import type { FormInstance } from 'antd';
import { IdcardOutlined } from '@ant-design/icons';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { ocrApi } from '../../../lib/ocr-api';
import { useDuplicateCheck } from '../hooks/useDuplicateCheck';
import { CertUploadPreview } from './CertUploadPreview';

interface LegalRepFormValues {
  idNumber?: string;
  nameCn?: string;
  namePinyin?: string;
  idPostalCode?: string;
  idAddressCn?: string;
  idAddressEn?: string;
  phone?: string;
  email?: string;
}

/** Step2：法人（或个人客户本人）信息，通过身份证正反面上传识别姓名/身份证号/地址。
 * 校验交由 antd `Form` 承担（`form` 由父级 `ClientWizardPage` 持有并在"下一步"时调用
 * `validateFields()`），字段值改动通过 `onValuesChange` 写回 Zustand store，保持 store
 * 作为最终提交数据源不变。 */
export function StepLegalRep({ form }: { form: FormInstance<LegalRepFormValues> }) {
  const legalRepInfo = useClientWizardStore((s) => s.legalRepInfo);
  const setLegalRepInfo = useClientWizardStore((s) => s.setLegalRepInfo);
  const idCardFrontFile = useClientWizardStore((s) => s.idCardFrontFile);
  const idCardBackFile = useClientWizardStore((s) => s.idCardBackFile);
  const setIdCardFile = useClientWizardStore((s) => s.setIdCardFile);
  const clearIdCardFile = useClientWizardStore((s) => s.clearIdCardFile);
  const phone = useClientWizardStore((s) => s.phone);
  const email = useClientWizardStore((s) => s.email);
  const setContact = useClientWizardStore((s) => s.setContact);
  const markOcrFailed = useClientWizardStore((s) => s.markOcrFailed);
  // 提示条的展示态/自动隐藏定时器都挂在 store 上（而非本地 state），避免在 APPEND/OCR 失败后
  // 切换到别的向导步骤再切回来，组件重新挂载导致提示又被重新触发展示、重新计时。
  const showOcrFailedHint = useClientWizardStore((s) => s.ocrFailedHintVisible);
  const dismissOcrFailedHint = useClientWizardStore((s) => s.dismissOcrFailedHint);
  const showLockedHint = useClientWizardStore((s) => s.lockedHintVisible);
  const dismissLockedHint = useClientWizardStore((s) => s.dismissLockedHint);
  const [recognizing, setRecognizing] = useState<'front' | 'back' | null>(null);
  const { runDuplicateCheck } = useDuplicateCheck('身份证号', 'legalRep', form);

  const handleUpload = async (file: File, side: 'front' | 'back') => {
    setIdCardFile(side, file);
    // 反面不含任何可提取的结构化字段，直接跟随提交保存图片即可，跳过 OCR 识别调用，
    // 避免无意义的识别请求、以及"识别完成"这类不准确的提示语。
    if (side === 'back') {
      void message.success('身份证反面已上传');
      return;
    }
    setRecognizing(side);
    try {
      const result = await ocrApi.recognizeIdCard(file, side);
      if (result.recognized) {
        setLegalRepInfo(result.fields);
        form.setFieldsValue(result.fields);
        if (result.fields.idNumber) void runDuplicateCheck(result.fields.idNumber);
        void message.success('身份证正面识别完成，已自动填充');
      } else {
        markOcrFailed();
        void message.warning('未能自动识别，请手动填写以下字段');
      }
    } catch {
      markOcrFailed();
      void message.error('识别服务暂不可用，请手动填写');
    } finally {
      setRecognizing(null);
    }
  };

  const handleValuesChange = (changed: LegalRepFormValues) => {
    // antd 的 changed 只包含"本次刚变化"的那个字段，不能不管有没有出现在 changed 里就
    // 无条件把 phone/email 都塞进 setContact——否则未变化的那个字段会被覆盖成 undefined
    // （已修复的 bug：填了电话再填邮箱，电话会被清空）。
    const { phone: changedPhone, email: changedEmail, ...legalRepFields } = changed;
    const contactFields: { phone?: string; email?: string } = {};
    if ('phone' in changed) contactFields.phone = changedPhone;
    if ('email' in changed) contactFields.email = changedEmail;
    if (Object.keys(contactFields).length > 0) {
      setContact(contactFields);
    }
    if (Object.keys(legalRepFields).length > 0) {
      setLegalRepInfo(legalRepFields);
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
          message="该客户已存在，正在为其追加代理信息。身份证号不可变更，其余信息及本次上传的身份证图片将以最新识别/填写内容为准并覆盖更新。"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <CertUploadPreview
            file={idCardFrontFile}
            accept=".jpg,.jpeg,.png"
            uploading={recognizing === 'front'}
            uploadingText="识别中…"
            placeholderText="上传身份证人像面"
            icon={<IdcardOutlined />}
            onUpload={(file) => void handleUpload(file, 'front')}
            onRemove={() => clearIdCardFile('front')}
          />
        </Col>
        <Col span={12}>
          <CertUploadPreview
            file={idCardBackFile}
            accept=".jpg,.jpeg,.png"
            uploading={recognizing === 'back'}
            uploadingText="识别中…"
            placeholderText="上传身份证国徽面"
            icon={<IdcardOutlined />}
            onUpload={(file) => void handleUpload(file, 'back')}
            onRemove={() => clearIdCardFile('back')}
          />
        </Col>
      </Row>

      <Form<LegalRepFormValues>
        form={form}
        layout="vertical"
        initialValues={{ ...legalRepInfo, phone, email }}
        onValuesChange={handleValuesChange}
      >
        <Card
          className="form-card form-card--legal"
          variant="borderless"
          title="个人信息"
          style={{ marginBottom: 24 }}
        >
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="身份证号"
                name="idNumber"
                rules={[{ required: true, message: '请上传身份证以自动识别身份证号' }]}
                tooltip="身份证号由身份证 OCR 识别得出，不支持手动修改"
              >
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="姓名（中文）"
                name="nameCn"
                rules={[{ required: true, message: '请填写姓名（中文）' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="姓名（拼音）"
                name="namePinyin"
                rules={[{ required: true, message: '请填写姓名（拼音）' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="邮编"
                name="idPostalCode"
                rules={[{ required: true, message: '请填写邮编' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="身份证地址（中文）"
                name="idAddressCn"
                rules={[{ required: true, message: '请填写身份证地址（中文）' }]}
              >
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="身份证地址（英文）"
                name="idAddressEn"
                rules={[{ required: true, message: '请填写身份证地址（英文）' }]}
              >
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card className="form-card form-card--contact" variant="borderless" title="联系方式">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="联系电话"
                name="phone"
                rules={[{ required: true, message: '请填写联系电话' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
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
