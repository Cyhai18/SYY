import { useState } from 'react';
import { Alert, Card, Col, Form, Input, Row, Upload, message } from 'antd';
import { IdcardOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { ocrApi } from '../../../lib/ocr-api';

/** Step2：法人（或个人客户本人）信息，通过身份证正反面上传识别姓名/身份证号/地址。 */
export function StepLegalRep() {
  const legalRepInfo = useClientWizardStore((s) => s.legalRepInfo);
  const setLegalRepInfo = useClientWizardStore((s) => s.setLegalRepInfo);
  const phone = useClientWizardStore((s) => s.phone);
  const email = useClientWizardStore((s) => s.email);
  const setContact = useClientWizardStore((s) => s.setContact);
  const markOcrFailed = useClientWizardStore((s) => s.markOcrFailed);
  const ocrFailedHint = useClientWizardStore((s) => s.ocrFailedHint);
  const [recognizing, setRecognizing] = useState<'front' | 'back' | null>(null);

  const makeUploadProps = (side: 'front' | 'back'): UploadProps => ({
    accept: '.jpg,.jpeg,.png',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file) => {
      void handleUpload(file, side);
      return false;
    },
  });

  const handleUpload = async (file: File, side: 'front' | 'back') => {
    setRecognizing(side);
    try {
      const result = await ocrApi.recognizeIdCard(file, side);
      if (result.recognized) {
        setLegalRepInfo(result.fields);
        void message.success(`身份证${side === 'front' ? '正面' : '反面'}识别完成，已自动填充`);
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

  return (
    <div>
      {ocrFailedHint ? (
        <Alert
          type="warning"
          showIcon
          message="部分证件未能自动识别，请手动核对并补全下方信息"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Upload.Dragger {...makeUploadProps('front')} disabled={recognizing === 'front'}>
            <p className="ant-upload-drag-icon">
              <IdcardOutlined />
            </p>
            <p className="ant-upload-text">
              {recognizing === 'front' ? '识别中…' : '上传身份证人像面'}
            </p>
          </Upload.Dragger>
        </Col>
        <Col span={12}>
          <Upload.Dragger {...makeUploadProps('back')} disabled={recognizing === 'back'}>
            <p className="ant-upload-drag-icon">
              <IdcardOutlined />
            </p>
            <p className="ant-upload-text">
              {recognizing === 'back' ? '识别中…' : '上传身份证国徽面'}
            </p>
          </Upload.Dragger>
        </Col>
      </Row>

      <Card size="small" title="法人信息" style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="姓名（中文）" required>
                <Input
                  value={legalRepInfo.nameCn}
                  onChange={(e) => setLegalRepInfo({ nameCn: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="姓名（拼音）" required>
                <Input
                  value={legalRepInfo.namePinyin}
                  onChange={(e) => setLegalRepInfo({ namePinyin: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="身份证号" required>
                <Input
                  value={legalRepInfo.idNumber}
                  onChange={(e) => setLegalRepInfo({ idNumber: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="邮编">
                <Input
                  value={legalRepInfo.idPostalCode}
                  onChange={(e) => setLegalRepInfo({ idPostalCode: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="身份证地址（中文）" required>
                <Input.TextArea
                  rows={2}
                  value={legalRepInfo.idAddressCn}
                  onChange={(e) => setLegalRepInfo({ idAddressCn: e.target.value })}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="身份证地址（英文）">
                <Input.TextArea
                  rows={2}
                  value={legalRepInfo.idAddressEn}
                  onChange={(e) => setLegalRepInfo({ idAddressEn: e.target.value })}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card size="small" title="联系方式">
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="联系手机号" required>
                <Input value={phone} onChange={(e) => setContact({ phone: e.target.value })} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="邮箱">
                <Input value={email} onChange={(e) => setContact({ email: e.target.value })} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>
    </div>
  );
}
