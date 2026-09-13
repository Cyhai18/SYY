import { useEffect, useState } from 'react';
import { Card, Col, Drawer, Empty, Image, Row, Spin, Tag, message } from 'antd';
import {
  ATTACHMENT_TYPE_LABELS,
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  type AttachmentItem,
  type ClientDetail,
  type ClientStatus,
} from '@funtax/shared';
import { clientsApi } from '../../lib/clients-api';
import { apiClient } from '../../lib/api-client';
import { brandColors } from '../../theme';

const STATUS_COLOR: Record<ClientStatus, string> = {
  NORMAL: brandColors.success,
  PENDING_RENEWAL: brandColors.warning,
  PENDING_REVIEW: brandColors.body,
};

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

interface ClientDetailDrawerProps {
  clientId: string | null;
  onClose: () => void;
}

/** 只读展示一个字段：label + value，样式与向导表单项对齐（不可编辑，故不用 Form.Item）。 */
function InfoItem({
  label,
  value,
  span = 8,
}: {
  label: string;
  value: React.ReactNode;
  span?: number;
}) {
  return (
    <Col span={span}>
      <div className="info-item">
        <div className="info-item__label">{label}</div>
        <div className="info-item__value">{value ?? '—'}</div>
      </div>
    </Col>
  );
}

/** "查看资料"入口：以 Drawer 形式只读展示客户基本信息、联系方式、附件，样式对齐新增客户向导；
 * 代理信息不再在此展示，改为在客户列表代理信息子表格的各行单独"查看"（见 AgentInfoDetailDrawer）。 */
export function ClientDetailDrawer({ clientId, onClose }: ClientDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!clientId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    clientsApi
      .get(clientId)
      .then(setDetail)
      .catch(() => void message.error('客户详情加载失败'))
      .finally(() => setLoading(false));
  }, [clientId]);

  // 附件图片需要走鉴权下载接口（GET /api/files/...，需带 Authorization 头），
  // 不能像普通 <img src> 那样直接用后端返回的相对路径 fileUrl，否则会被当作前端路由解析。
  // 这里按 blob 拉取后转成对象 URL 供 <Image> 展示，卸载/切换客户时统一 revoke 避免内存泄漏。
  useEffect(() => {
    if (!detail) return;
    const imageAttachments = detail.attachments.filter((a) => IMAGE_EXT_RE.test(a.fileUrl));
    let cancelled = false;
    const urls: Record<string, string> = {};
    Promise.all(
      imageAttachments.map(async (attachment) => {
        try {
          const { blob } = await apiClient.getBinary(`/files/${attachment.fileUrl}`);
          urls[attachment.id] = URL.createObjectURL(blob);
        } catch {
          // 单张图片加载失败不影响其余附件展示
        }
      }),
    ).then(() => {
      if (!cancelled) setImageUrls(urls);
    });
    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [detail]);

  // 非图片附件（如 PDF）同样要走鉴权下载接口，不能直接 <a href> 跳转（拿不到 Authorization 头）。
  const handleOpenAttachment = async (fileUrl: string) => {
    try {
      const { blob } = await apiClient.getBinary(`/files/${fileUrl}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      void message.error('文件打开失败');
    }
  };

  return (
    <Drawer open={!!clientId} onClose={onClose} title="客户资料" width={720} destroyOnClose>
      <Spin spinning={loading}>
        {!detail ? (
          <Empty description={loading ? '加载中...' : '客户不存在'} />
        ) : (
          <>
            <Card
              className="form-card form-card--legal"
              variant="borderless"
              title={detail.clientType === 'COMPANY' ? '公司信息' : '个人信息'}
            >
              <Row gutter={16}>
                <InfoItem label="注册类型" value={CLIENT_TYPE_LABELS[detail.clientType]} />
                <InfoItem
                  label="状态"
                  value={
                    <Tag color={STATUS_COLOR[detail.status]}>
                      {CLIENT_STATUS_LABELS[detail.status]}
                    </Tag>
                  }
                />
                <InfoItem label="提交日期" value={detail.createdAt.slice(0, 10)} />
                {detail.clientType === 'COMPANY' ? (
                  <>
                    <InfoItem label="统一社会信用代码" value={detail.companyInfo.creditCode} />
                    <InfoItem label="公司中文名" value={detail.companyInfo.nameCn} />
                    <InfoItem label="公司英文名" value={detail.companyInfo.nameEn} />
                    <InfoItem label="公司中文地址" value={detail.companyInfo.addressCn} span={24} />
                    <InfoItem label="公司英文地址" value={detail.companyInfo.addressEn} span={24} />
                    <InfoItem label="公司所在省份（英文）" value={detail.companyInfo.provinceEn} />
                    <InfoItem label="公司所在城市（英文）" value={detail.companyInfo.cityEn} />
                    <InfoItem label="邮编" value={detail.companyInfo.postalCode} span={8} />
                  </>
                ) : detail.legalRepInfo ? (
                  <>
                    <InfoItem label="身份证号" value={detail.legalRepInfo.idNumber} />
                    <InfoItem label="姓名（中文）" value={detail.legalRepInfo.nameCn} />
                    <InfoItem label="姓名（拼音）" value={detail.legalRepInfo.namePinyin} />
                    <InfoItem
                      label="身份证地址（中文）"
                      value={detail.legalRepInfo.idAddressCn}
                      span={24}
                    />
                    <InfoItem
                      label="身份证地址（英文）"
                      value={detail.legalRepInfo.idAddressEn}
                      span={24}
                    />
                    <InfoItem label="邮编" value={detail.legalRepInfo.idPostalCode} />
                  </>
                ) : null}
                <InfoItem label="备注" value={detail.remark} span={24} />
              </Row>
            </Card>

            <Card
              className="form-card form-card--contact"
              variant="borderless"
              title="联系方式"
              style={{ marginTop: 16 }}
            >
              <Row gutter={16}>
                {detail.clientType === 'COMPANY' ? (
                  <InfoItem label="联系人" value={detail.companyInfo.contactPerson} span={8} />
                ) : null}
                <InfoItem
                  label="联系电话"
                  value={detail.phone}
                  span={detail.clientType === 'COMPANY' ? 8 : 12}
                />
                <InfoItem
                  label="联系邮箱"
                  value={detail.email}
                  span={detail.clientType === 'COMPANY' ? 8 : 12}
                />
              </Row>
            </Card>

            <Card className="form-card" variant="borderless" title="附件" style={{ marginTop: 16 }}>
              {detail.attachments.length === 0 ? (
                <Empty description="暂无附件" />
              ) : (
                <Image.PreviewGroup>
                  <Row gutter={16}>
                    {detail.attachments.map((attachment: AttachmentItem) => (
                      <Col span={8} key={attachment.id}>
                        <div className="attachment-item">
                          <div className="attachment-item__label">
                            {ATTACHMENT_TYPE_LABELS[attachment.type]}
                          </div>
                          {IMAGE_EXT_RE.test(attachment.fileUrl) ? (
                            <Image
                              src={imageUrls[attachment.id]}
                              placeholder
                              width="100%"
                              height={120}
                              style={{ objectFit: 'cover', borderRadius: 8 }}
                            />
                          ) : (
                            <a
                              onClick={(e) => {
                                e.preventDefault();
                                void handleOpenAttachment(attachment.fileUrl);
                              }}
                              href="#"
                            >
                              查看文件
                            </a>
                          )}
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Image.PreviewGroup>
              )}
            </Card>
          </>
        )}
      </Spin>
    </Drawer>
  );
}
