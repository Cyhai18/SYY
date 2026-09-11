import { useEffect, useState } from 'react';
import { Button, Card, Space, Steps, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { ClientPayload } from '@funtax/shared';
import { useClientWizardStore } from '../../store/client-wizard-store';
import { clientsApi } from '../../lib/clients-api';
import { StepType } from './steps/StepType';
import { StepCompany } from './steps/StepCompany';
import { StepLegalRep } from './steps/StepLegalRep';
import { StepShops } from './steps/StepShops';
import { WIZARD_STEP, resolvePrevStep } from './wizard-steps';

const STEP_ITEMS = [
  { title: '注册类型' },
  { title: '主体信息' },
  { title: '法人信息' },
  { title: '代理信息' },
];

/** 新建授权客户向导：4 步流程，个人客户跳过"主体信息"。全程走 Zustand store，最后一次性提交。 */
export function ClientWizardPage() {
  const navigate = useNavigate();
  const current = useClientWizardStore((s) => s.current);
  const setCurrent = useClientWizardStore((s) => s.setCurrent);
  const clientType = useClientWizardStore((s) => s.clientType);
  const mode = useClientWizardStore((s) => s.mode);
  const reset = useClientWizardStore((s) => s.reset);
  const [submitting, setSubmitting] = useState(false);
  const isAppend = mode === 'APPEND';

  useEffect(() => reset, [reset]);

  const isIndividual = clientType === 'INDIVIDUAL';
  const isCompany = clientType === 'COMPANY';
  // 公司客户不再采集法人信息，隐藏该 tab；个人客户维持原逻辑跳过"主体信息"
  const displayItems = isIndividual
    ? STEP_ITEMS.filter((_, i) => i !== WIZARD_STEP.COMPANY)
    : isCompany
      ? STEP_ITEMS.filter((_, i) => i !== WIZARD_STEP.LEGAL_REP)
      : STEP_ITEMS;
  const displayCurrent = isIndividual
    ? current >= WIZARD_STEP.LEGAL_REP
      ? current - 1
      : current
    : isCompany
      ? current >= WIZARD_STEP.AGENT_INFO
        ? current - 1
        : current
      : current;

  const goPrev = () => setCurrent(resolvePrevStep(current, clientType));

  const goNext = () => {
    // StepType（current === WIZARD_STEP.TYPE）由卡片点击直接跳转，goNext 不会在该步被调用（footer 按钮仅在 current > 0 时渲染）
    if (current === WIZARD_STEP.COMPANY) {
      // 公司客户从"主体信息"直接跳到"代理信息"，不再经过"法人信息"
      setCurrent(isCompany ? WIZARD_STEP.AGENT_INFO : WIZARD_STEP.LEGAL_REP);
      return;
    }
    if (current === WIZARD_STEP.LEGAL_REP) {
      setCurrent(WIZARD_STEP.AGENT_INFO);
      return;
    }
    void handleSubmit();
  };

  const handleSubmit = async () => {
    const state = useClientWizardStore.getState();
    if (!state.clientType) {
      void message.error('请先选择注册类型');
      return;
    }
    if (!state.phone) {
      void message.error('请填写联系手机号');
      return;
    }
    if (!state.email) {
      void message.error('请填写邮箱');
      return;
    }
    if (state.clientType === 'COMPANY' && !state.companyInfo.contactPerson) {
      void message.error('请填写联系人');
      return;
    }
    if (state.clientType === 'INDIVIDUAL') {
      const l = state.legalRepInfo;
      if (!l.nameCn || !l.namePinyin || !l.idNumber || !l.idAddressCn) {
        void message.error('请完善法人信息');
        return;
      }
    }
    if (state.agentInfos.length === 0) {
      void message.error('请至少添加一条代理信息');
      return;
    }
    const isCompanyType = state.clientType === 'COMPANY';
    const payload: ClientPayload = {
      clientType: state.clientType,
      phone: state.phone,
      email: state.email,
      remark: state.remark,
      companyInfo: {
        creditCode: state.companyInfo.creditCode ?? '',
        ...state.companyInfo,
      },
      legalRepInfo: isCompanyType
        ? undefined
        : {
            nameCn: state.legalRepInfo.nameCn ?? '',
            namePinyin: state.legalRepInfo.namePinyin ?? '',
            idNumber: state.legalRepInfo.idNumber ?? '',
            idAddressCn: state.legalRepInfo.idAddressCn ?? '',
            ...state.legalRepInfo,
          },
      agentInfos: state.agentInfos.map((a) => ({
        country: a.country,
        expectedEffectiveDate: a.expectedEffectiveDate,
        agentYears: a.agentYears,
        agentCompany: a.agentCompany,
        shops: a.shops.map((shop) => ({
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
      })),
    };

    setSubmitting(true);
    try {
      if (state.mode === 'APPEND' && state.existingClientId) {
        // 追加模式：只提交本次新增的代理信息，主体/法人信息按最新一次覆盖，creditCode/idNumber 由后端忽略。
        await clientsApi.appendAgentInfo(
          state.existingClientId,
          {
            email: payload.email,
            remark: payload.remark,
            companyInfo: payload.companyInfo,
            legalRepInfo: payload.legalRepInfo,
            agentInfos: payload.agentInfos,
          },
          {
            businessLicenseFile: state.businessLicenseFile,
            idCardFrontFile: state.idCardFrontFile,
            idCardBackFile: state.idCardBackFile,
          },
        );
        void message.success('代理信息追加成功');
      } else {
        await clientsApi.create(payload, {
          businessLicenseFile: state.businessLicenseFile,
          idCardFrontFile: state.idCardFrontFile,
          idCardBackFile: state.idCardBackFile,
        });
        void message.success('客户创建成功');
      }
      reset();
      navigate('/clients');
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '提交失败，请检查表单');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="client-wizard-page">
      <Card bordered={false} className="wizard-steps-card">
        <Steps current={displayCurrent} items={displayItems} />
      </Card>

      <Card bordered={false} className="wizard-content-card">
        {current === WIZARD_STEP.TYPE ? <StepType /> : null}
        {current === WIZARD_STEP.COMPANY ? <StepCompany /> : null}
        {current === WIZARD_STEP.LEGAL_REP ? <StepLegalRep /> : null}
        {current === WIZARD_STEP.AGENT_INFO ? <StepShops /> : null}
      </Card>

      {current > WIZARD_STEP.TYPE ? (
        <div className="wizard-footer">
          <Space>
            <Button onClick={goPrev}>上一步</Button>
            <Button type="primary" loading={submitting} onClick={() => void goNext()}>
              {current === WIZARD_STEP.AGENT_INFO ? (isAppend ? '提交追加' : '提交') : '下一步'}
            </Button>
          </Space>
        </div>
      ) : null}
    </div>
  );
}
