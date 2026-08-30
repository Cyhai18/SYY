import { Button, Collapse, Empty } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { nextKey, useClientWizardStore, type ShopDraft } from '../../../store/client-wizard-store';
import { ShopEditor } from './ShopEditor';

function createEmptyShop(): ShopDraft {
  return {
    key: nextKey(),
    platform: 'AMAZON',
    shopName: '',
    shopUrl: '',
    brandNames: '',
    mainCategoryEn: '',
    products: [],
    agentInfos: [],
  };
}

/** Step3：店铺信息，一个客户下可添加多个店铺，每个店铺内含产品/代理明细（同样可多条）。 */
export function StepShops() {
  const shops = useClientWizardStore((s) => s.shops);
  const setShops = useClientWizardStore((s) => s.setShops);

  const addShop = () => setShops([...shops, createEmptyShop()]);
  const removeShop = (key: string) => setShops(shops.filter((s) => s.key !== key));
  const updateShop = (key: string, next: ShopDraft) =>
    setShops(shops.map((s) => (s.key === key ? next : s)));

  return (
    <div>
      {shops.length === 0 ? (
        <Empty description="尚未添加店铺" style={{ marginBottom: 16 }} />
      ) : (
        <Collapse
          defaultActiveKey={shops.map((s) => s.key)}
          items={shops.map((shop, index) => ({
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
