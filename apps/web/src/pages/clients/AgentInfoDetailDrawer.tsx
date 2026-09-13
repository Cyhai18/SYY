import { useEffect, useState } from 'react';
import { Card, Col, Drawer, Empty, Row, Spin, Table, message } from 'antd';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  PLATFORM_LABELS,
  type AgentInfoDetail,
  type ClientDetail,
  type ShopDetail,
} from '@funtax/shared';
import { clientsApi } from '../../lib/clients-api';

interface AgentInfoDetailDrawerProps {
  /** 目标客户 id + 代理信息 id；均为空时抽屉关闭 */
  target: { clientId: string; agentInfoId: string } | null;
  onClose: () => void;
}

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

const shopColumns = [
  {
    title: '平台',
    dataIndex: 'platform',
    render: (v: ShopDetail['platform']) => PLATFORM_LABELS[v],
  },
  { title: '店铺名', dataIndex: 'shopName' },
  { title: '店铺链接', dataIndex: 'shopUrl', ellipsis: true },
  { title: '品牌名称', dataIndex: 'brandNames' },
  { title: '主营产品类目', dataIndex: 'mainCategoryEn' },
  { title: '店铺 ID', dataIndex: 'shopId', render: (v?: string) => v ?? '—' },
];

const productColumns = [
  { title: '产品名称（中文）', dataIndex: 'productNameCn', render: (v?: string) => v ?? '—' },
  { title: '产品名称（英文）', dataIndex: 'productNameEn', render: (v?: string) => v ?? '—' },
  { title: '产品所属类目', dataIndex: 'category', render: (v?: string) => v ?? '—' },
  { title: 'ASIN码/商品ID', dataIndex: 'asinOrSku', render: (v?: string) => v ?? '—' },
  { title: '产品链接', dataIndex: 'productUrl', ellipsis: true, render: (v?: string) => v ?? '—' },
  { title: '是否带电', dataIndex: 'hasBattery', render: (v?: boolean) => (v ? '是' : '否') },
];

/** 客户列表页代理信息子表格各行"查看"入口：只读展示单条代理信息（含店铺明细），样式对齐新增客户向导的代理信息卡片。 */
export function AgentInfoDetailDrawer({ target, onClose }: AgentInfoDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [agentInfo, setAgentInfo] = useState<AgentInfoDetail | null>(null);

  useEffect(() => {
    if (!target) {
      setAgentInfo(null);
      return;
    }
    setLoading(true);
    clientsApi
      .get(target.clientId)
      .then((detail: ClientDetail) => {
        const found = detail.agentInfos.find((a) => a.id === target.agentInfoId) ?? null;
        setAgentInfo(found);
      })
      .catch(() => void message.error('代理信息加载失败'))
      .finally(() => setLoading(false));
  }, [target]);

  return (
    <Drawer open={!!target} onClose={onClose} title="代理信息" width={640} destroyOnClose>
      <Spin spinning={loading}>
        {!agentInfo ? (
          <Empty description={loading ? '加载中...' : '代理信息不存在'} />
        ) : (
          <>
            <Card
              className="agent-card"
              variant="borderless"
              title={`${AGENT_COUNTRY_LABELS[agentInfo.country]} · ${AGENT_COMPANY_LABELS[agentInfo.agentCompany]}`}
            >
              <Row gutter={16}>
                <InfoItem label="代理国家" value={AGENT_COUNTRY_LABELS[agentInfo.country]} />
                <InfoItem label="代理公司" value={AGENT_COMPANY_LABELS[agentInfo.agentCompany]} />
                <InfoItem label="代理年限" value={`${agentInfo.agentYears} 年`} />
                <InfoItem label="生效日期" value={agentInfo.expectedEffectiveDate.slice(0, 10)} />
                <InfoItem label="服务截止日期" value={agentInfo.expiresAt.slice(0, 10)} />
              </Row>
            </Card>

            <Card
              className="form-card clients-table-card shop-card"
              variant="borderless"
              title="店铺信息"
              style={{ marginTop: 16, overflow: 'visible' }}
            >
              {agentInfo.shops.length === 0 ? (
                <Empty description="尚未录入店铺" />
              ) : (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={agentInfo.shops}
                  columns={shopColumns}
                  scroll={{ x: 'max-content' }}
                  expandable={{
                    rowExpandable: (shop) => shop.products.length > 0,
                    expandedRowRender: (shop) => (
                      <div className="client-agent-subtable-wrap">
                        <Table
                          className="client-agent-subtable"
                          rowKey="id"
                          size="small"
                          pagination={false}
                          dataSource={shop.products}
                          columns={productColumns}
                          scroll={{ x: 'max-content' }}
                        />
                      </div>
                    ),
                  }}
                />
              )}
            </Card>
          </>
        )}
      </Spin>
    </Drawer>
  );
}
