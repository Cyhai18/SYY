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
  const reset = useClientWizardStore((s) => s.reset);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => reset, [reset]);

  const isIndividual = clientType === 'INDIVIDUAL';
  const displayItems = isIndividual ? STEP_ITEMS.filter((_, i) => i !== 1) : STEP_ITEMS;
  const displayCurrent = isIndividual && current >= 2 ? current - 1 : current;

  const goPrev = () => {
    if (current === 2 && isIndividual) {
      setCurrent(0);
    } else {
      setCurrent(current - 1);
    }
  };

  const goNext = () => {
    // Step0（current === 0）由卡片点击直接跳转，goNext 不会在该步被调用（footer 按钮仅在 current > 0 时渲染）
    if (current === 1) {
      setCurrent(2);
      return;
    }
    if (current === 2) {
      setCurrent(3);
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
    if (state.agentInfos.length === 0) {
      void message.error('请至少添加一条代理信息');
      return;
    }
    const payload: ClientPayload = {
      clientType: state.clientType,
      phone: state.phone,
      email: state.email,
      remark: state.remark,
      companyInfo: {
        creditCode: state.companyInfo.creditCode ?? '',
        ...state.companyInfo,
      },
      legalRepInfo: {
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
      await clientsApi.create(payload, {
        businessLicenseFile: state.businessLicenseFile,
        idCardFrontFile: state.idCardFrontFile,
        idCardBackFile: state.idCardBackFile,
      });
      void message.success('客户创建成功');
      reset();
      navigate('/clients');
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '创建失败，请检查表单');
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
        {current === 0 ? <StepType /> : null}
        {current === 1 ? <StepCompany /> : null}
        {current === 2 ? <StepLegalRep /> : null}
        {current === 3 ? <StepShops /> : null}
      </Card>

      {current > 0 ? (
        <div className="wizard-footer">
          <Space>
            <Button onClick={goPrev}>上一步</Button>
            <Button type="primary" loading={submitting} onClick={() => void goNext()}>
              {current === 3 ? '提交' : '下一步'}
            </Button>
          </Space>
        </div>
      ) : null}
    </div>
  );
}
