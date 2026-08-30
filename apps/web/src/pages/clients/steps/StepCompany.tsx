import { useState } from 'react';
import { Alert, Col, Form, Input, Row, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { ocrApi } from '../../../lib/ocr-api';

/** Step1：公司信息，仅公司类型客户可见。上传营业执照后走 OCR 预填，字段全程可编辑。 */
export function StepCompany() {
  const companyInfo = useClientWizardStore((s) => s.companyInfo);
  const setCompanyInfo = useClientWizardStore((s) => s.setCompanyInfo);
  const markOcrFailed = useClientWizardStore((s) => s.markOcrFailed);
  const ocrFailedHint = useClientWizardStore((s) => s.ocrFailedHint);
  const [recognizing, setRecognizing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const uploadProps: UploadProps = {
    accept: '.jpg,.jpeg,.png,.pdf',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file) => {
      void handleUpload(file);
      return false;
    },
  };

  const handleUpload = async (file: File) => {
    setFileName(file.name);
    setRecognizing(true);
    try {
      const result = await ocrApi.recognizeBusinessLicense(file);
      if (result.recognized) {
        setCompanyInfo(result.fields);
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

      <Upload.Dragger {...uploadProps} disabled={recognizing} style={{ marginBottom: 24 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">
          {recognizing ? '识别中，请稍候…' : '点击或拖拽上传营业执照'}
        </p>
        <p className="ant-upload-hint">
          {fileName ? `已上传：${fileName}` : '支持 jpg/png/pdf，识别结果可编辑'}
        </p>
      </Upload.Dragger>

      <Form layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="统一信用代码" required>
              <Input
                value={companyInfo.creditCode}
                onChange={(e) => setCompanyInfo({ creditCode: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="公司中文名">
              <Input
                value={companyInfo.nameCn}
                onChange={(e) => setCompanyInfo({ nameCn: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="公司英文名">
              <Input
                value={companyInfo.nameEn}
                onChange={(e) => setCompanyInfo({ nameEn: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="邮编">
              <Input
                value={companyInfo.postalCode}
                onChange={(e) => setCompanyInfo({ postalCode: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="省份（英文）">
              <Input
                value={companyInfo.provinceEn}
                onChange={(e) => setCompanyInfo({ provinceEn: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="城市（英文）">
              <Input
                value={companyInfo.cityEn}
                onChange={(e) => setCompanyInfo({ cityEn: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="公司中文地址">
              <Input.TextArea
                value={companyInfo.addressCn}
                onChange={(e) => setCompanyInfo({ addressCn: e.target.value })}
                rows={2}
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="公司英文地址">
              <Input.TextArea
                value={companyInfo.addressEn}
                onChange={(e) => setCompanyInfo({ addressEn: e.target.value })}
                rows={2}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </div>
  );
}
