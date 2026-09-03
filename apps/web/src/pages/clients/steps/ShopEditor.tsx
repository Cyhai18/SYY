import { Button, Col, Form, Input, Row, Select, Table } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_COMPANIES,
  AGENT_COUNTRY_LABELS,
  PLATFORM_LABELS,
  type AgentCompany,
  type AgentCountry,
} from '@funtax/shared';
import { nextKey, type ShopDraft } from '../../../store/client-wizard-store';

const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const AGENT_COUNTRY_OPTIONS = Object.entries(AGENT_COUNTRY_LABELS).map(([value, label]) => ({
  value,
  label,
}));
/** 按代理国家过滤代理公司下拉选项。 */
const agentCompanyOptions = (country: AgentCountry) =>
  AGENT_COUNTRY_COMPANIES[country].map((value) => ({ value, label: AGENT_COMPANY_LABELS[value] }));

/** 单个店铺的表单块：店铺基础信息 + 产品明细表 + 代理信息明细表（均支持多条）。 */
export function ShopEditor({
  shop,
  onChange,
}: {
  shop: ShopDraft;
  onChange: (next: ShopDraft) => void;
}) {
  const update = (fields: Partial<ShopDraft>) => onChange({ ...shop, ...fields });

  const addProduct = () =>
    update({
      products: [
        ...shop.products,
        {
          key: nextKey(),
          platform: 'AMAZON',
          productNameCn: '',
          productNameEn: '',
          category: '',
          asinOrSku: '',
          productUrl: '',
        },
      ],
    });

  const addAgent = () =>
    update({
      agentInfos: [
        ...shop.agentInfos,
        {
          key: nextKey(),
          country: 'GB',
          expectedEffectiveDate: '',
          agentYears: 1,
          agentCompany: agentCompanyOptions('GB')[0]?.value ?? 'OVERSEA_WALKERS_GB',
        },
      ],
    });

  return (
    <div>
      <Form layout="vertical">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="平台" required>
              <Select
                value={shop.platform}
                options={PLATFORM_OPTIONS}
                onChange={(v) => update({ platform: v })}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="店铺名称" required>
              <Input value={shop.shopName} onChange={(e) => update({ shopName: e.target.value })} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="店铺 ID">
              <Input value={shop.shopId} onChange={(e) => update({ shopId: e.target.value })} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="主营类目（英文）" required>
              <Input
                value={shop.mainCategoryEn}
                onChange={(e) => update({ mainCategoryEn: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="店铺链接" required>
              <Input value={shop.shopUrl} onChange={(e) => update({ shopUrl: e.target.value })} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="品牌名称（多个用逗号分隔）" required>
              <Input
                value={shop.brandNames}
                onChange={(e) => update({ brandNames: e.target.value })}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Table
        size="small"
        title={() => '产品信息'}
        pagination={false}
        dataSource={shop.products}
        rowKey="key"
        columns={[
          {
            title: '平台',
            dataIndex: 'platform',
            width: 130,
            render: (v, r) => (
              <Select
                size="small"
                style={{ width: 110 }}
                value={v}
                options={PLATFORM_OPTIONS}
                onChange={(val) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, platform: val } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '产品名称（中文）',
            dataIndex: 'productNameCn',
            render: (v, r) => (
              <Input
                size="small"
                value={v}
                onChange={(e) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, productNameCn: e.target.value } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '产品名称（英文）',
            dataIndex: 'productNameEn',
            render: (v, r) => (
              <Input
                size="small"
                value={v}
                onChange={(e) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, productNameEn: e.target.value } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '类目',
            dataIndex: 'category',
            render: (v, r) => (
              <Input
                size="small"
                value={v}
                onChange={(e) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, category: e.target.value } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: 'ASIN/SKU',
            dataIndex: 'asinOrSku',
            render: (v, r) => (
              <Input
                size="small"
                value={v}
                onChange={(e) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, asinOrSku: e.target.value } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '产品链接',
            dataIndex: 'productUrl',
            render: (v, r) => (
              <Input
                size="small"
                value={v}
                onChange={(e) =>
                  update({
                    products: shop.products.map((p) =>
                      p.key === r.key ? { ...p, productUrl: e.target.value } : p,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '',
            dataIndex: 'actions',
            width: 48,
            render: (_, r) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => update({ products: shop.products.filter((p) => p.key !== r.key) })}
              />
            ),
          },
        ]}
        footer={() => (
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addProduct}>
            新增产品
          </Button>
        )}
        style={{ marginBottom: 16 }}
      />

      <Table
        size="small"
        title={() => '代理信息'}
        pagination={false}
        dataSource={shop.agentInfos}
        rowKey="key"
        columns={[
          {
            title: '代理国家',
            dataIndex: 'country',
            width: 130,
            render: (v, r) => (
              <Select
                size="small"
                style={{ width: 110 }}
                value={v}
                options={AGENT_COUNTRY_OPTIONS}
                onChange={(val) =>
                  update({
                    agentInfos: shop.agentInfos.map((a) =>
                      a.key === r.key
                        ? { ...a, country: val, agentCompany: agentCompanyOptions(val)[0]?.value }
                        : a,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '预计生效日期',
            dataIndex: 'expectedEffectiveDate',
            render: (v, r) => (
              <Input
                size="small"
                type="date"
                value={v}
                onChange={(e) =>
                  update({
                    agentInfos: shop.agentInfos.map((a) =>
                      a.key === r.key ? { ...a, expectedEffectiveDate: e.target.value } : a,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '代理年限',
            dataIndex: 'agentYears',
            width: 100,
            render: (v, r) => (
              <Input
                size="small"
                type="number"
                min={1}
                max={20}
                value={v}
                onChange={(e) =>
                  update({
                    agentInfos: shop.agentInfos.map((a) =>
                      a.key === r.key ? { ...a, agentYears: Number(e.target.value) } : a,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '代理公司',
            dataIndex: 'agentCompany',
            width: 220,
            render: (v, r) => (
              <Select<AgentCompany>
                size="small"
                style={{ width: 200 }}
                value={v}
                options={agentCompanyOptions(r.country)}
                onChange={(val) =>
                  update({
                    agentInfos: shop.agentInfos.map((a) =>
                      a.key === r.key ? { ...a, agentCompany: val } : a,
                    ),
                  })
                }
              />
            ),
          },
          {
            title: '',
            dataIndex: 'actions',
            width: 48,
            render: (_, r) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  update({ agentInfos: shop.agentInfos.filter((a) => a.key !== r.key) })
                }
              />
            ),
          },
        ]}
        footer={() => (
          <Button type="dashed" block icon={<PlusOutlined />} onClick={addAgent}>
            新增代理
          </Button>
        )}
      />
    </div>
  );
}
