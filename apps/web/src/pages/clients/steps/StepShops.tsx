import { Alert, Button, Collapse, Descriptions, Empty, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  AGENT_COUNTRY_COMPANIES,
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  PLATFORM_LABELS,
} from '@funtax/shared';
import {
  nextKey,
  useClientWizardStore,
  type AgentInfoDraft,
  type ShopDraft,
} from '../../../store/client-wizard-store';
import { AgentInfoEditor } from './AgentInfoEditor';

/** 深拷贝店铺草稿（含产品明细）并重新生成本地 key，避免与上一条代理信息共享引用/key 冲突。 */
function cloneShops(shops: ShopDraft[]): ShopDraft[] {
  return shops.map((shop) => ({
    ...shop,
    key: nextKey(),
    products: shop.products.map((product) => ({ ...product, key: nextKey() })),
  }));
}

/**
 * 新增代理信息时，默认带上上一条代理信息已填写的店铺信息，减少重复录入；
 * 若尚无上一条（第一次新增），则店铺列表为空。
 */
function createEmptyAgentInfo(prevAgentInfos: AgentInfoDraft[]): AgentInfoDraft {
  const prev = prevAgentInfos[prevAgentInfos.length - 1];
  return {
    key: nextKey(),
    country: 'GB',
    expectedEffectiveDate: '',
    agentYears: 1,
    agentCompany: AGENT_COUNTRY_COMPANIES.GB[0] ?? 'OVERSEA_WALKERS_GB',
    shops: prev ? cloneShops(prev.shops) : [],
  };
}

/** Step4：代理信息，一个客户下可添加多条代理信息，每条代理信息内含多个店铺（店铺下再含产品明细，均可多条）。 */
export function StepShops() {
  const agentInfos = useClientWizardStore((s) => s.agentInfos);
  const setAgentInfos = useClientWizardStore((s) => s.setAgentInfos);
  const mode = useClientWizardStore((s) => s.mode);
  const existingAgentCombos = useClientWizardStore((s) => s.existingAgentCombos);
  const existingAgentInfos = useClientWizardStore((s) => s.existingAgentInfos);

  const addAgentInfo = () => setAgentInfos([...agentInfos, createEmptyAgentInfo(agentInfos)]);
  const removeAgentInfo = (key: string) => setAgentInfos(agentInfos.filter((a) => a.key !== key));
  const updateAgentInfo = (key: string, next: AgentInfoDraft) =>
    setAgentInfos(agentInfos.map((a) => (a.key === key ? next : a)));

  /** 某条代理信息在校验重复时，需排除自己当前已选的组合，否则无法保留自身的选择。 */
  const usedCombosExcluding = (selfKey: string) => {
    const combos = new Set(existingAgentCombos);
    agentInfos.forEach((a) => {
      if (a.key !== selfKey) combos.add(`${a.country}:${a.agentCompany}`);
    });
    return combos;
  };

  return (
    <div>
      {mode === 'APPEND' ? (
        <>
          <Alert
            type="info"
            showIcon
            message="该客户已存在以下代理信息，不可编辑；请在下方新增本次要追加的代理信息"
            style={{ marginBottom: 12 }}
          />
          {existingAgentInfos.length > 0 ? (
            <Collapse
              items={existingAgentInfos.map((a, index) => ({
                key: `${a.country}:${a.agentCompany}`,
                label: `已有代理信息 ${index + 1}：${AGENT_COUNTRY_LABELS[a.country]} - ${AGENT_COMPANY_LABELS[a.agentCompany]}`,
                // 查重接口出于隐私考虑只返回摘要字段（见 ClientsService.checkDuplicate），
                // 这里只做摘要展示，不能借用 AgentInfoEditor/ShopEditor 渲染成看似完整实则残缺的表单。
                children: (
                  <Descriptions column={1} size="small" bordered>
                    {a.shops.map((shop, shopIndex) => (
                      <Descriptions.Item key={shopIndex} label={`店铺 ${shopIndex + 1}`}>
                        <Tag>{PLATFORM_LABELS[shop.platform]}</Tag>
                        {shop.shopName}（{shop.productCount} 个产品）
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ),
              }))}
              style={{ marginBottom: 16 }}
            />
          ) : null}
        </>
      ) : null}

      {agentInfos.length === 0 ? (
        <Empty description="尚未添加代理信息" style={{ marginBottom: 16 }} />
      ) : (
        <Collapse
          defaultActiveKey={agentInfos.map((a) => a.key)}
          items={agentInfos.map((agentInfo, index) => ({
            key: agentInfo.key,
            label: `代理信息 ${index + 1}`,
            extra: (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAgentInfo(agentInfo.key);
                }}
              />
            ),
            children: (
              <AgentInfoEditor
                agentInfo={agentInfo}
                usedCombos={usedCombosExcluding(agentInfo.key)}
                onChange={(next) => updateAgentInfo(agentInfo.key, next)}
              />
            ),
          }))}
          style={{ marginBottom: 16 }}
        />
      )}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addAgentInfo}>
        新增代理信息
      </Button>
    </div>
  );
}
