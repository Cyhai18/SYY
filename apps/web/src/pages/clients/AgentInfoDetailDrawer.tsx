import { useEffect, useRef, useState } from 'react';
import { Button, Card, Col, Drawer, Empty, Row, Space, Spin, Table, message } from 'antd';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  PLATFORM_LABELS,
  type AgentInfoDetail,
  type ClientDetail,
  type ShopDetail,
} from '@funtax/shared';
import { clientsApi, type UpdateAgentInfoPayload } from '../../lib/clients-api';
import { nextKey, type AgentInfoDraft, type ShopDraft } from '../../store/client-wizard-store';
import { AgentInfoEditor, type AgentInfoEditorHandle } from './steps/AgentInfoEditor';

/** 把只读的 AgentInfoDetail（含服务端 id）转成向导编辑组件可用的 AgentInfoDraft（本地 key）。 */
function toDraft(detail: AgentInfoDetail): AgentInfoDraft {
  return {
    key: nextKey(),
    country: detail.country,
    expectedEffectiveDate: detail.expectedEffectiveDate.slice(0, 10),
    agentYears: detail.agentYears,
    agentCompany: detail.agentCompany,
    shops: detail.shops.map((shop): ShopDraft => ({
      key: nextKey(),
      platform: shop.platform,
      shopId: shop.shopId,
      shopName: shop.shopName,
      shopUrl: shop.shopUrl,
      brandNames: shop.brandNames,
      mainCategoryEn: shop.mainCategoryEn,
      products: shop.products.map((p) => ({
        key: nextKey(),
        platform: p.platform,
        productNameCn: p.productNameCn,
        productNameEn: p.productNameEn,
        category: p.category,
        asinOrSku: p.asinOrSku,
        productUrl: p.productUrl,
        hasBattery: p.hasBattery,
      })),
    })),
  };
}

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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AgentInfoDraft | null>(null);
  const editorRef = useRef<AgentInfoEditorHandle>(null);

  useEffect(() => {
    if (!target) {
      setAgentInfo(null);
      setEditing(false);
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

  const startEdit = () => {
    if (!agentInfo) return;
    setDraft(toDraft(agentInfo));
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft || !target) return;
    try {
      await editorRef.current?.validateFields();
    } catch {
      return;
    }
    const payload: UpdateAgentInfoPayload = {
      expectedEffectiveDate: draft.expectedEffectiveDate,
      agentYears: draft.agentYears,
      agentCompany: draft.agentCompany,
      shops: draft.shops.map((shop) => ({
        platform: shop.platform,
        shopId: shop.shopId,
        shopName: shop.shopName,
        shopUrl: shop.shopUrl,
        brandNames: shop.brandNames,
        mainCategoryEn: shop.mainCategoryEn,
        products: shop.products.map((p) => ({
          platform: p.platform,
          productNameCn: p.productNameCn,
          productNameEn: p.productNameEn,
          category: p.category,
          asinOrSku: p.asinOrSku,
          productUrl: p.productUrl,
          hasBattery: p.hasBattery,
        })),
      })),
    };
    setSaving(true);
    try {
      const updated = await clientsApi.updateAgentInfo(
        target.clientId,
        target.agentInfoId,
        payload,
      );
      const found = updated.agentInfos.find((a) => a.id === target.agentInfoId) ?? null;
      setAgentInfo(found);
      setEditing(false);
      void message.success('保存成功');
    } catch {
      void message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      title="代理信息"
      width={640}
      destroyOnClose
      extra={
        agentInfo ? (
          editing ? (
            <Space>
              <Button onClick={() => setEditing(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void handleSave()}>
                保存
              </Button>
            </Space>
          ) : (
            <Button onClick={startEdit}>编辑</Button>
          )
        ) : null
      }
    >
      <Spin spinning={loading}>
        {!agentInfo ? (
          <Empty description={loading ? '加载中...' : '代理信息不存在'} />
        ) : editing && draft ? (
          <Card
            className="agent-card"
            variant="borderless"
            title={`${AGENT_COUNTRY_LABELS[agentInfo.country]} · 编辑代理信息（代理国家不可修改）`}
          >
            <AgentInfoEditor ref={editorRef} agentInfo={draft} onChange={setDraft} />
          </Card>
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
