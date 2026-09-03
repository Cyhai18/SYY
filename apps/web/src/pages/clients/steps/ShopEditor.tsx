import { Button, Col, Form, Input, Row, Select, Table } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { PLATFORM_LABELS } from '@funtax/shared';
import { nextKey, type ShopDraft } from '../../../store/client-wizard-store';

const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** 单个店铺的表单块：店铺基础信息 + 产品明细表（支持多条）。 */
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
      />
    </div>
  );
}
