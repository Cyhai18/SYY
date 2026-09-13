import { useEffect, useState } from 'react';
import { Modal, Spin, Upload } from 'antd';
import { DeleteOutlined, EyeOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/**
 * 营业执照/身份证上传控件：未上传时展示拖拽上传区；上传完成后改为展示图片缩略图，
 * 并提供"查看"（弹窗放大预览）与"删除"（清空重新上传）两个操作 icon，替代原来只显示文件名的纯文字提示。
 */
export function CertUploadPreview({
  file,
  accept,
  disabled = false,
  uploading = false,
  uploadingText = '识别中…',
  placeholderText,
  icon,
  onUpload,
  onRemove,
}: {
  file: File | null;
  accept: string;
  disabled?: boolean;
  uploading?: boolean;
  uploadingText?: string;
  placeholderText: string;
  icon: ReactNode;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (file) {
    return (
      <div className="cert-upload-preview">
        {previewUrl ? (
          <img src={previewUrl} alt={file.name} className="cert-upload-preview__img" />
        ) : (
          <div className="cert-upload-preview__file-name">{file.name}</div>
        )}
        {uploading ? (
          <div className="cert-upload-preview__loading-mask">
            <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: '#fff' }} spin />} />
            <span className="cert-upload-preview__loading-text">{uploadingText}</span>
          </div>
        ) : (
          <div className="cert-upload-preview__mask">
            {previewUrl ? (
              <EyeOutlined
                className="cert-upload-preview__icon"
                title="查看"
                onClick={() => setPreviewOpen(true)}
              />
            ) : null}
            {!disabled ? (
              <DeleteOutlined
                className="cert-upload-preview__icon"
                title="删除"
                onClick={onRemove}
              />
            ) : null}
          </div>
        )}
        {previewUrl ? (
          <Modal
            open={previewOpen}
            footer={null}
            onCancel={() => setPreviewOpen(false)}
            width="min(85vw, 1200px)"
            centered
          >
            <img src={previewUrl} alt={file.name} style={{ width: '100%' }} />
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <Upload.Dragger
      accept={accept}
      maxCount={1}
      showUploadList={false}
      disabled={disabled || uploading}
      beforeUpload={(f) => {
        onUpload(f);
        return false;
      }}
      className="upload-dragger-compact"
    >
      <p className="ant-upload-drag-icon">{icon}</p>
      <p className="ant-upload-text">{uploading ? uploadingText : placeholderText}</p>
    </Upload.Dragger>
  );
}
