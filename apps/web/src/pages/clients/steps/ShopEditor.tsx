import { forwardRef, useImperativeHandle } from 'react';
import { Button, Checkbox, Col, Form, Input, Row, Select, Table } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { PLATFORM_LABELS, type Platform } from '@funtax/shared';
import { nextKey, type ShopDraft } from '../../../store/client-wizard-store';

const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** 供父级（AgentInfoEditor）持有 ref 触发校验：提交/下一步前调用，未通过则 reject 并在对应字段下标红。 */
export interface ShopEditorHandle {
  validateFields: () => Promise<void>;
}

interface ProductFormValues {
  productNameCn?: string;
  productNameEn?: string;
  category?: string;
  asinOrSku?: string;
  productUrl?: string;
  hasBattery?: boolean;
}

interface ShopFormValues {
  platform?: Platform;
  shopName?: string;
  shopUrl?: string;
  brandNames?: string;
  mainCategoryEn?: string;
  shopId?: string;
  products?: Record<string, ProductFormValues>;
}

/** 单个店铺的表单块：店铺基础信息 + 产品明细表（支持多条）。校验交由 antd `Form` 承担，
 * 产品明细每行以 `products.<本地key>.<字段>` 命名挂在同一个 Form 上，新增/删除行时对应
 * `Form.Item` 自动挂载/卸载注册，无需手动维护校验状态。 */
export const ShopEditor = forwardRef<
  ShopEditorHandle,
  {
    shop: ShopDraft;
    onChange: (next: ShopDraft) => void;
    /** 只读展示已存在的店铺（APPEND 模式下），此时隐藏新增/删除操作，所有输入控件禁用。 */
    disabled?: boolean;
  }
>(function ShopEditor({ shop, onChange, disabled = false }, ref) {
  const [form] = Form.useForm<ShopFormValues>();

  useImperativeHandle(ref, () => ({
    validateFields: () => form.validateFields().then(() => undefined),
  }));

  const addProduct = () =>
    onChange({
      ...shop,
      products: [
        ...shop.products,
        {
          key: nextKey(),
          // 产品平台复用店铺所在平台，不再单独维护，见下方表格列注释
          platform: shop.platform,
          productNameCn: '',
          productNameEn: '',
          category: '',
          asinOrSku: '',
          productUrl: '',
          hasBattery: false,
        },
      ],
    });

  /** 每次任意字段变化后，直接从 Form 读取全量值重建 shop 对象回传父级，Zustand store 仍是最终数据源。 */
  const handleValuesChange = () => {
    const all = form.getFieldsValue(true);
    const { products: productsByKey, ...topFields } = all;
    const nextProducts = shop.products.map((p) => ({
      ...p,
      ...(productsByKey?.[p.key] ?? {}),
      // 产品平台不单独维护，跟随店铺平台一起联动
      platform: topFields.platform ?? p.platform,
    }));
    onChange({ ...shop, ...topFields, products: nextProducts });
  };

  const initialProducts = Object.fromEntries(
    shop.products.map((p) => [
      p.key,
      {
        productNameCn: p.productNameCn,
        productNameEn: p.productNameEn,
        category: p.category,
        asinOrSku: p.asinOrSku,
        productUrl: p.productUrl,
        hasBattery: p.hasBattery,
      },
    ]),
  );

  return (
    <div>
      <Form<ShopFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          platform: shop.platform,
          shopName: shop.shopName,
          shopUrl: shop.shopUrl,
          brandNames: shop.brandNames,
          mainCategoryEn: shop.mainCategoryEn,
          shopId: shop.shopId,
          products: initialProducts,
        }}
        onValuesChange={handleValuesChange}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="店铺所在平台"
              name="platform"
              rules={[{ required: true, message: '请选择店铺所在平台' }]}
            >
              <Select options={PLATFORM_OPTIONS} disabled={disabled} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="店铺名"
              name="shopName"
              rules={[{ required: true, message: '请填写店铺名' }]}
            >
              <Input disabled={disabled} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="店铺链接"
              name="shopUrl"
              rules={[{ required: true, message: '请填写店铺链接' }]}
            >
              <Input disabled={disabled} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="品牌名称（多个使用逗号分隔、无则填店铺名）"
              name="brandNames"
              rules={[{ required: true, message: '请填写品牌名称' }]}
            >
              <Input disabled={disabled} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="主营产品类目（英文）"
              name="mainCategoryEn"
              rules={[{ required: true, message: '请填写主营产品类目（英文）' }]}
            >
              <Input disabled={disabled} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="店铺 ID" name="shopId">
              <Input disabled={disabled} />
            </Form.Item>
          </Col>
        </Row>

        <div className="product-section">
          <div className="product-section__title section-title section-title--product">
            产品信息
          </div>
          <Table
            className="product-table"
            pagination={false}
            dataSource={shop.products}
            rowKey="key"
            scroll={{ x: 'max-content' }}
            columns={[
              // 产品平台已改为复用"店铺所在平台"（见上方店铺表单），不再单独展示/编辑，故注释掉此列
              {
                title: '产品名称（中文）',
                dataIndex: 'productNameCn',
                width: 220,
                render: (_v, r) => (
                  <Form.Item name={['products', r.key, 'productNameCn']} noStyle>
                    <Input disabled={disabled} />
                  </Form.Item>
                ),
              },
              {
                title: '产品名称（英文）',
                dataIndex: 'productNameEn',
                width: 220,
                render: (_v, r) => (
                  <Form.Item name={['products', r.key, 'productNameEn']} noStyle>
                    <Input disabled={disabled} />
                  </Form.Item>
                ),
              },
              {
                title: '产品所属类目',
                dataIndex: 'category',
                width: 220,
                render: (_v, r) => (
                  <Form.Item name={['products', r.key, 'category']} noStyle>
                    <Input disabled={disabled} />
                  </Form.Item>
                ),
              },
              {
                title: 'ASIN码/商品ID',
                dataIndex: 'asinOrSku',
                width: 220,
                // 与前 3 列（产品名称中/英文、类目）保持一致宽度，输入体验统一
                render: (_v, r) => (
                  <Form.Item name={['products', r.key, 'asinOrSku']} noStyle>
                    <Input disabled={disabled} />
                  </Form.Item>
                ),
              },
              {
                title: '产品链接',
                dataIndex: 'productUrl',
                width: 320,
                render: (_v, r) => (
                  <Form.Item name={['products', r.key, 'productUrl']} noStyle>
                    <Input disabled={disabled} />
                  </Form.Item>
                ),
              },
              {
                title: '是否带电',
                dataIndex: 'hasBattery',
                width: 90,
                align: 'center',
                render: (_v, r) => (
                  <Form.Item
                    name={['products', r.key, 'hasBattery']}
                    valuePropName="checked"
                    noStyle
                  >
                    <Checkbox disabled={disabled} />
                  </Form.Item>
                ),
              },
              ...(disabled
                ? []
                : [
                    {
                      title: '',
                      dataIndex: 'actions',
                      width: 48,
                      render: (_: unknown, r: ShopDraft['products'][number]) => (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() =>
                            onChange({
                              ...shop,
                              products: shop.products.filter((p) => p.key !== r.key),
                            })
                          }
                        />
                      ),
                    },
                  ]),
            ]}
            footer={
              disabled
                ? undefined
                : () => (
                    <Button
                      className="add-row-btn add-row-btn--product"
                      type="text"
                      icon={<PlusOutlined />}
                      onClick={addProduct}
                    >
                      新增产品
                    </Button>
                  )
            }
          />
        </div>
      </Form>
    </div>
  );
});
