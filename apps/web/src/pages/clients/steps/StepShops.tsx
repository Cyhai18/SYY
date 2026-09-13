import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Button, Card, Empty, Popover } from 'antd';
import { CheckCircleFilled, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { AGENT_COUNTRY_COMPANIES, AGENT_COUNTRY_LABELS, type AgentCountry } from '@funtax/shared';
import {
  nextKey,
  useClientWizardStore,
  type AgentInfoDraft,
  type ShopDraft,
} from '../../../store/client-wizard-store';
import { AgentInfoEditor, type AgentInfoEditorHandle } from './AgentInfoEditor';

/** 代理国家 -> 国旗 emoji，选择器里配合中文名一起展示，更醒目直观。 */
const AGENT_COUNTRY_FLAGS: Record<AgentCountry, string> = {
  GB: '🇬🇧',
  EU: '🇪🇺',
  US: '🇺🇸',
  TR: '🇹🇷',
  CA: '🇨🇦',
};

/** 深拷贝店铺草稿（含产品明细）并重新生成本地 key，避免与上一条代理信息共享引用/key 冲突。 */
function cloneShops(shops: ShopDraft[]): ShopDraft[] {
  return shops.map((shop) => ({
    ...shop,
    key: nextKey(),
    products: shop.products.map((product) => ({ ...product, key: nextKey() })),
  }));
}

/**
 * 新增指定国家的代理信息：代理国家一旦选定即锁定，代理公司默认取该国家下第一家，
 * 并带上上一条代理信息已填写的店铺信息，减少重复录入。
 */
function createAgentInfoForCountry(
  country: AgentCountry,
  prevAgentInfos: AgentInfoDraft[],
): AgentInfoDraft {
  const prev = prevAgentInfos[prevAgentInfos.length - 1];
  return {
    key: nextKey(),
    country,
    expectedEffectiveDate: '',
    agentYears: 1,
    agentCompany: AGENT_COUNTRY_COMPANIES[country][0],
    shops: prev ? cloneShops(prev.shops) : [],
  };
}

/** 供父级（ClientWizardPage）持有 ref 触发校验：提交前调用，会校验所有代理信息（含其下店铺/产品）字段。 */
export interface StepShopsHandle {
  validateFields: () => Promise<void>;
}

/** Step4：代理信息，一个客户下可添加多条代理信息，每条代理信息内含多个店铺（店铺下再含产品明细，均可多条）。 */
export const StepShops = forwardRef<StepShopsHandle>(function StepShops(_props, ref) {
  const agentInfos = useClientWizardStore((s) => s.agentInfos);
  const setAgentInfos = useClientWizardStore((s) => s.setAgentInfos);
  const existingAgentInfos = useClientWizardStore((s) => s.existingAgentInfos);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cardRefs = useRef<Partial<Record<AgentCountry, HTMLDivElement | null>>>({});
  const agentInfoRefs = useRef<Map<string, AgentInfoEditorHandle>>(new Map());

  useImperativeHandle(ref, () => ({
    validateFields: async () => {
      await Promise.all(agentInfos.map((a) => agentInfoRefs.current.get(a.key)?.validateFields()));
    },
  }));

  const removeAgentInfo = (key: string) => setAgentInfos(agentInfos.filter((a) => a.key !== key));
  const updateAgentInfo = (key: string, next: AgentInfoDraft) =>
    setAgentInfos(agentInfos.map((a) => (a.key === key ? next : a)));

  /**
   * 每个代理国家只能有一条代理信息，可选列表里需要剔除/禁用两类国家：
   * - `sessionCountries`：本次向导会话里新增的国家，对应下方有可编辑的卡片，点击可定位过去；
   * - `existingCountries`：追加模式下该客户数据库里已有的国家（`checkDuplicate` 返回的
   *   `existingAgentInfos`），本次会话未新增对应卡片，选择器里直接禁用并标注"（已存在）"，
   *   不可点击、也无处可定位；重复组合仍由后端 `appendAgentInfo` 兜底校验并报错，双重保险。
   */
  const sessionCountries = new Set<AgentCountry>(agentInfos.map((a) => a.country));
  const existingCountries = new Set<AgentCountry>(existingAgentInfos.map((a) => a.country));
  const allCountries = Object.keys(AGENT_COUNTRY_LABELS) as AgentCountry[];

  const addAgentInfo = (country: AgentCountry) => {
    setAgentInfos([...agentInfos, createAgentInfoForCountry(country, agentInfos)]);
    setPickerOpen(false);
  };

  /** 侧边浮动按钮里点击已存在的国家：不重复新增，而是滚动定位到对应卡片。 */
  const locateAgentInfo = (country: AgentCountry) => {
    setPickerOpen(false);
    requestAnimationFrame(() => {
      cardRefs.current[country]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handlePickerSelect = (country: AgentCountry) => {
    if (existingCountries.has(country)) return;
    if (sessionCountries.has(country)) {
      locateAgentInfo(country);
    } else {
      addAgentInfo(country);
    }
  };

  const countryPicker = (
    <div className="agent-country-picker">
      {allCountries.map((country) => {
        const alreadyExists = existingCountries.has(country);
        const addedThisSession = sessionCountries.has(country);
        return (
          <Button
            key={country}
            block
            disabled={alreadyExists}
            className={addedThisSession ? 'agent-country-picker__item--added' : undefined}
            onClick={() => handlePickerSelect(country)}
          >
            <span className="agent-country-picker__flag">{AGENT_COUNTRY_FLAGS[country]}</span>
            {AGENT_COUNTRY_LABELS[country]}
            {alreadyExists ? '（已存在）' : null}
            {addedThisSession ? (
              <CheckCircleFilled className="agent-country-picker__check" />
            ) : null}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div>
      {agentInfos.length === 0 ? (
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          <Empty description="尚未添加代理信息" style={{ marginBottom: 16 }} />
          <Popover
            trigger="click"
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            placement="bottom"
            content={countryPicker}
          >
            <Button type="primary" icon={<PlusOutlined />}>
              新增代理信息
            </Button>
          </Popover>
        </div>
      ) : (
        <div className="agent-info-grid">
          {agentInfos.map((agentInfo) => (
            <div
              key={agentInfo.key}
              ref={(el) => {
                cardRefs.current[agentInfo.country] = el;
              }}
            >
              <Card
                className="agent-card"
                variant="borderless"
                title={
                  <span className="section-title section-title--agent">
                    <span className="section-title__flag">
                      {AGENT_COUNTRY_FLAGS[agentInfo.country]}
                    </span>
                    {AGENT_COUNTRY_LABELS[agentInfo.country]}代理
                  </span>
                }
                extra={
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => removeAgentInfo(agentInfo.key)}
                  />
                }
              >
                <AgentInfoEditor
                  ref={(handle) => {
                    if (handle) agentInfoRefs.current.set(agentInfo.key, handle);
                    else agentInfoRefs.current.delete(agentInfo.key);
                  }}
                  agentInfo={agentInfo}
                  onChange={(next) => updateAgentInfo(agentInfo.key, next)}
                />
              </Card>
            </div>
          ))}
        </div>
      )}
      {agentInfos.length > 0 ? (
        <Popover
          trigger="click"
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          placement="left"
          content={countryPicker}
        >
          <Button
            className="agent-info-fab"
            type="primary"
            shape="circle"
            size="large"
            icon={<PlusOutlined />}
          />
        </Popover>
      ) : null}
    </div>
  );
});
