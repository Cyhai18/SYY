import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Button, Col, Collapse, DatePicker, Empty, Form, InputNumber, Row, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_COMPANIES,
  type AgentCompany,
  type AgentCountry,
} from '@funtax/shared';

import { nextKey, type AgentInfoDraft, type ShopDraft } from '../../../store/client-wizard-store';
import { ShopEditor, type ShopEditorHandle } from './ShopEditor';

/**
 * 按代理国家过滤代理公司下拉选项；代理国家在创建时已唯一确定并锁定，公司只需限定在该国家范围内。
 * 批量导入人工核对场景下，`country` 可能是后端翻译失败后留下的 `undefined`（如 Excel 里填的
 * 代理国家文字不在枚举标签范围内，见 row-validator.service.ts 的"代理国家不合法"问题），
 * 此时 `AGENT_COUNTRY_COMPANIES[country]` 会是 `undefined`，直接 `.map()` 会抛错导致整页空白，
 * 因此这里需要显式兜底为空数组，把"不合法"交给下方必填校验提示，而不是让页面崩溃。
 */
const agentCompanyOptions = (country?: AgentCountry) =>
  (country ? AGENT_COUNTRY_COMPANIES[country] : undefined)?.map((value) => ({
    value,
    label: AGENT_COMPANY_LABELS[value],
  })) ?? [];

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

interface AgentInfoFormValues {
  expectedEffectiveDate?: dayjs.Dayjs;
  agentYears?: number;
  agentCompany?: AgentCompany;
}

/** 供父级（StepShops）持有 ref 触发校验：提交前调用，自身字段 + 所有店铺（含产品）字段均会校验。 */
export interface AgentInfoEditorHandle {
  validateFields: () => Promise<void>;
}

/** 单条代理信息的表单块：代理基础信息 + 该代理信息下的多个店铺（每个店铺内含产品明细）。 */
export const AgentInfoEditor = forwardRef<
  AgentInfoEditorHandle,
  {
    agentInfo: AgentInfoDraft;
    onChange: (next: AgentInfoDraft) => void;
    /** 只读展示已存在的代理信息（APPEND 模式下），此时隐藏新增/删除操作，所有输入控件禁用。 */
    disabled?: boolean;
  }
>(function AgentInfoEditor({ agentInfo, onChange, disabled = false }, ref) {
  const [form] = Form.useForm<AgentInfoFormValues>();
  const shopRefs = useRef<Map<string, ShopEditorHandle>>(new Map());
  const [shopsError, setShopsError] = useState<string | null>(null);
  // 受控展开状态：默认全部展开；新增店铺时把新 key 一并加入，避免新面板悄悄以折叠态挂载导致
  // 用户误以为已填写；校验失败时把所有店铺都展开，确保红色错误提示不会被藏在折叠内容里看不见。
  const [activeKeys, setActiveKeys] = useState<string[]>(() => agentInfo.shops.map((s) => s.key));

  useImperativeHandle(ref, () => ({
    validateFields: async () => {
      await form.validateFields();
      if (agentInfo.shops.length === 0) {
        setShopsError('请至少添加一条店铺信息');
        throw new Error('请至少添加一条店铺信息');
      }
      setShopsError(null);
      try {
        await Promise.all(
          agentInfo.shops.map((shop) => shopRefs.current.get(shop.key)?.validateFields()),
        );
      } catch (err) {
        setActiveKeys(agentInfo.shops.map((s) => s.key));
        throw err;
      }
    },
  }));

  const update = (fields: Partial<AgentInfoDraft>) => onChange({ ...agentInfo, ...fields });
  const companyOptions = agentCompanyOptions(agentInfo.country);

  const addShop = () => {
    setShopsError(null);
    const shop = createEmptyShop();
    setActiveKeys((keys) => [...keys, shop.key]);
    update({ shops: [...agentInfo.shops, shop] });
  };
  const removeShop = (key: string) =>
    update({ shops: agentInfo.shops.filter((s) => s.key !== key) });
  const updateShop = (key: string, next: ShopDraft) =>
    update({ shops: agentInfo.shops.map((s) => (s.key === key ? next : s)) });

  return (
    <div>
      <Form<AgentInfoFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          expectedEffectiveDate: agentInfo.expectedEffectiveDate
            ? dayjs(agentInfo.expectedEffectiveDate)
            : undefined,
          agentYears: agentInfo.agentYears,
          agentCompany: agentInfo.agentCompany,
        }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="期望生效日期"
              name="expectedEffectiveDate"
              rules={[{ required: true, message: '请选择期望生效日期' }]}
            >
              <DatePicker
                style={{ width: '100%' }}
                disabled={disabled}
                disabledDate={(date) => date.isBefore(dayjs(), 'day')}
                onChange={(date) =>
                  update({ expectedEffectiveDate: date ? date.format('YYYY-MM-DD') : '' })
                }
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="代理年限"
              name="agentYears"
              rules={[{ required: true, message: '请填写代理年限' }]}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={1}
                max={20}
                disabled={disabled}
                onChange={(val) => update({ agentYears: Number(val ?? 1) })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="代理公司"
              name="agentCompany"
              rules={[{ required: true, message: '请选择代理公司' }]}
            >
              <Select<AgentCompany>
                options={companyOptions}
                disabled={disabled}
                onChange={(val) => update({ agentCompany: val })}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      {agentInfo.shops.length === 0 ? (
        <Empty
          description={
            shopsError ? <span style={{ color: '#ff4d4f' }}>{shopsError}</span> : '尚未添加店铺'
          }
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Collapse
          className="shop-collapse"
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
          items={agentInfo.shops.map((shop, index) => ({
            key: shop.key,
            // 新增店铺时该 key 不在初始 defaultActiveKey 里，Collapse 会当作折叠状态处理；
            // 而折叠面板默认不渲染内容（forceRender 默认 false），导致其 ShopEditor 的 Form
            // 从未挂载、ref 也未注册，validateFields() 会直接跳过它、放行空表单。
            // 强制渲染保证无论是否展开，Form 字段都真实存在并参与校验。
            forceRender: true,
            label: <span className="section-title section-title--shop">店铺 {index + 1}</span>,
            extra: disabled ? null : (
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
            children: (
              <ShopEditor
                ref={(handle) => {
                  if (handle) shopRefs.current.set(shop.key, handle);
                  else shopRefs.current.delete(shop.key);
                }}
                shop={shop}
                disabled={disabled}
                onChange={(next) => updateShop(shop.key, next)}
              />
            ),
          }))}
          style={{ marginBottom: 12 }}
        />
      )}
      {disabled ? null : (
        <Button
          className="add-row-btn add-row-btn--shop"
          type="text"
          icon={<PlusOutlined />}
          onClick={addShop}
        >
          新增店铺
        </Button>
      )}
    </div>
  );
});
