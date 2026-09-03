import { Button, Col, Collapse, Empty, Form, Input, Row, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_COMPANIES,
  AGENT_COUNTRY_LABELS,
  type AgentCompany,
  type AgentCountry,
} from '@funtax/shared';
import { nextKey, type AgentInfoDraft, type ShopDraft } from '../../../store/client-wizard-store';
import { ShopEditor } from './ShopEditor';

const AGENT_COUNTRY_OPTIONS = Object.entries(AGENT_COUNTRY_LABELS).map(([value, label]) => ({
  value,
  label,
}));
/** 按代理国家过滤代理公司下拉选项。 */
const agentCompanyOptions = (country: AgentCountry) =>
  AGENT_COUNTRY_COMPANIES[country].map((value) => ({ value, label: AGENT_COMPANY_LABELS[value] }));

function createEmptyShop(): ShopDraft {
  return {
    key: nextKey(),
    platform: 'AMAZON',
    shopName: '',
    shopUrl: '',
    brandNames: '',
    mainCategoryEn: '',
    products: [],
  };
}

/** 单条代理信息的表单块：代理基础信息 + 该代理信息下的多个店铺（每个店铺内含产品明细）。 */
export function AgentInfoEditor({
  agentInfo,
  onChange,
}: {
  agentInfo: AgentInfoDraft;
  onChange: (next: AgentInfoDraft) => void;
}) {
  const update = (fields: Partial<AgentInfoDraft>) => onChange({ ...agentInfo, ...fields });

  const addShop = () => update({ shops: [...agentInfo.shops, createEmptyShop()] });
  const removeShop = (key: string) =>
    update({ shops: agentInfo.shops.filter((s) => s.key !== key) });
  const updateShop = (key: string, next: ShopDraft) =>
    update({ shops: agentInfo.shops.map((s) => (s.key === key ? next : s)) });

  return (
    <div>
      <Form layout="vertical">
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label="代理国家" required>
              <Select
                value={agentInfo.country}
                options={AGENT_COUNTRY_OPTIONS}
                onChange={(val) =>
                  update({ country: val, agentCompany: agentCompanyOptions(val)[0]?.value })
                }
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="预计生效日期" required>
              <Input
                type="date"
                value={agentInfo.expectedEffectiveDate}
                onChange={(e) => update({ expectedEffectiveDate: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="代理年限" required>
              <Input
                type="number"
                min={1}
                max={20}
                value={agentInfo.agentYears}
                onChange={(e) => update({ agentYears: Number(e.target.value) })}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="代理公司" required>
              <Select<AgentCompany>
                value={agentInfo.agentCompany}
                options={agentCompanyOptions(agentInfo.country)}
                onChange={(val) => update({ agentCompany: val })}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {agentInfo.shops.length === 0 ? (
        <Empty description="尚未添加店铺" style={{ marginBottom: 16 }} />
      ) : (
        <Collapse
          defaultActiveKey={agentInfo.shops.map((s) => s.key)}
          items={agentInfo.shops.map((shop, index) => ({
            key: shop.key,
            label: shop.shopName || `店铺 ${index + 1}`,
            extra: (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  removeShop(shop.key);
                }}
              />
            ),
            children: <ShopEditor shop={shop} onChange={(next) => updateShop(shop.key, next)} />,
          }))}
          style={{ marginBottom: 16 }}
        />
      )}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addShop}>
        新增店铺
      </Button>
    </div>
  );
}
