import { useEffect, useState } from 'react';
import { Card, Collapse, Descriptions, Drawer, Empty, Spin, Table, Tag, message } from 'antd';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  ATTACHMENT_TYPE_LABELS,
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  PLATFORM_LABELS,
  type AgentInfoDetail,
  type AttachmentItem,
  type ClientDetail,
  type ClientStatus,
  type ShopDetail,
} from '@funtax/shared';
import { clientsApi } from '../../lib/clients-api';
import { brandColors } from '../../theme';

const STATUS_COLOR: Record<ClientStatus, string> = {
  PENDING_REVIEW: brandColors.warning,
  APPROVED: brandColors.success,
  DISABLED: brandColors.body,
};

interface ClientDetailDrawerProps {
  clientId: string | null;
  onClose: () => void;
}

/** "查看资料"入口：以 Drawer 形式只读展示客户主体信息、法人信息、代理信息/店铺、附件。 */
export function ClientDetailDrawer({ clientId, onClose }: ClientDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ClientDetail | null>(null);

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

  const shopColumns = [
    {
      title: '平台',
      dataIndex: 'platform',
      render: (v: ShopDetail['platform']) => PLATFORM_LABELS[v],
    },
    { title: '店铺名称', dataIndex: 'shopName' },
    { title: '店铺链接', dataIndex: 'shopUrl', ellipsis: true },
    { title: '品牌', dataIndex: 'brandNames' },
    { title: '主营类目（英文）', dataIndex: 'mainCategoryEn' },
  ];

  return (
    <Drawer open={!!clientId} onClose={onClose} title="客户资料" width={720} destroyOnClose>
      <Spin spinning={loading}>
        {!detail ? (
          <Empty description={loading ? '加载中...' : '客户不存在'} />
        ) : (
          <>
            <Card bordered={false} title="基本信息">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="注册类型">
                  {CLIENT_TYPE_LABELS[detail.clientType]}
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={STATUS_COLOR[detail.status]}>
                    {CLIENT_STATUS_LABELS[detail.status]}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="联系手机号">{detail.phone}</Descriptions.Item>
                <Descriptions.Item label="邮箱">{detail.email ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="提交日期" span={2}>
                  {detail.createdAt.slice(0, 10)}
                </Descriptions.Item>
                <Descriptions.Item label="备注" span={2}>
                  {detail.remark ?? '—'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {detail.clientType === 'COMPANY' ? (
              <Card bordered={false} title="公司信息" style={{ marginTop: 16 }}>
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="统一信用代码">
                    {detail.companyInfo.creditCode}
                  </Descriptions.Item>
                  <Descriptions.Item label="公司中文名">
                    {detail.companyInfo.nameCn ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="公司英文名">
                    {detail.companyInfo.nameEn ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="中文地址" span={2}>
                    {detail.companyInfo.addressCn ?? '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="英文地址" span={2}>
                    {detail.companyInfo.addressEn ?? '—'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}

            <Card bordered={false} title="法人信息" style={{ marginTop: 16 }}>
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="姓名（中文）">
                  {detail.legalRepInfo.nameCn}
                </Descriptions.Item>
                <Descriptions.Item label="姓名（拼音）">
                  {detail.legalRepInfo.namePinyin}
                </Descriptions.Item>
                <Descriptions.Item label="身份证号">
                  {detail.legalRepInfo.idNumber}
                </Descriptions.Item>
                <Descriptions.Item label="身份证地址（中文）" span={2}>
                  {detail.legalRepInfo.idAddressCn}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card bordered={false} title="代理信息" style={{ marginTop: 16 }}>
              {detail.agentInfos.length === 0 ? (
                <Empty description="尚未录入代理信息" />
              ) : (
                <Collapse
                  defaultActiveKey={detail.agentInfos.map((a) => a.id)}
                  items={detail.agentInfos.map((agentInfo: AgentInfoDetail) => ({
                    key: agentInfo.id,
                    label: `${AGENT_COUNTRY_LABELS[agentInfo.country]} · ${AGENT_COMPANY_LABELS[agentInfo.agentCompany]}`,
                    children: (
                      <>
                        <Descriptions column={2} bordered size="small" style={{ marginBottom: 12 }}>
                          <Descriptions.Item label="生效日期">
                            {agentInfo.expectedEffectiveDate.slice(0, 10)}
                          </Descriptions.Item>
                          <Descriptions.Item label="服务截止日期">
                            {agentInfo.expiresAt.slice(0, 10)}
                          </Descriptions.Item>
                        </Descriptions>
                        <Table
                          rowKey="id"
                          size="small"
                          pagination={false}
                          dataSource={agentInfo.shops}
                          columns={shopColumns}
                        />
                      </>
                    ),
                  }))}
                />
              )}
            </Card>

            <Card bordered={false} title="附件" style={{ marginTop: 16 }}>
              {detail.attachments.length === 0 ? (
                <Empty description="暂无附件" />
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={detail.attachments}
                  columns={[
                    {
                      title: '类型',
                      dataIndex: 'type',
                      render: (v: AttachmentItem['type']) => ATTACHMENT_TYPE_LABELS[v],
                    },
                    {
                      title: '文件',
                      dataIndex: 'fileUrl',
                      render: (v: string) => (
                        <a href={v} target="_blank" rel="noreferrer">
                          查看
                        </a>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </>
        )}
      </Spin>
    </Drawer>
  );
}
