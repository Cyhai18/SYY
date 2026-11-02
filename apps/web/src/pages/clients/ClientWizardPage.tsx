import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Space, Steps, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { normalizeIdentifier, type ClientPayload } from '@funtax/shared';
import { useClientWizardStore } from '../../store/client-wizard-store';
import { clientsApi } from '../../lib/clients-api';
import { runWizardDuplicateCheck } from './hooks/useDuplicateCheck';
import { StepType } from './steps/StepType';
import { StepCompany } from './steps/StepCompany';
import { StepLegalRep } from './steps/StepLegalRep';
import { StepShops, type StepShopsHandle } from './steps/StepShops';
import { WIZARD_STEP, resolvePrevStep } from './wizard-steps';

/** 新建授权客户向导：注册类型 → 主体/个人信息 → 代理信息 3 个可见步骤（"公司信息"与"个人信息"互斥，合并展示为一个 tab）。 */
export function ClientWizardPage() {
  const navigate = useNavigate();
  const current = useClientWizardStore((s) => s.current);
  const setCurrent = useClientWizardStore((s) => s.setCurrent);
  const clientType = useClientWizardStore((s) => s.clientType);
  const mode = useClientWizardStore((s) => s.mode);
  const reset = useClientWizardStore((s) => s.reset);
  const [submitting, setSubmitting] = useState(false);
  const isAppend = mode === 'APPEND';
  // 校验交由各 Step 自身的 antd Form 承担，实例在此持有，"下一步"时调用 validateFields()
  const [companyForm] = Form.useForm();
  const [legalRepForm] = Form.useForm();
  const stepShopsRef = useRef<StepShopsHandle>(null);

  useEffect(() => reset, [reset]);

  const isIndividual = clientType === 'INDIVIDUAL';
  const isCompany = clientType === 'COMPANY';
  // "公司信息"（公司）与"个人信息"（个人）二选一，未选注册类型前、以及回到"注册类型"这一步时
  // 都合并展示成一个 tab，避免同时出现两个互斥步骤，也避免"已选类型但还停在注册类型步"时
  // 提前显示某个具体类型、显得可以再改却又只挂一个名字的歧义。
  const infoStepTitle =
    current === WIZARD_STEP.TYPE
      ? '公司信息/个人信息'
      : isCompany
        ? '公司信息'
        : isIndividual
          ? '个人信息'
          : '公司信息/个人信息';
  const displayItems = [{ title: '注册类型' }, { title: infoStepTitle }, { title: '代理信息' }];
  const displayCurrent =
    current >= WIZARD_STEP.AGENT_INFO ? 2 : current >= WIZARD_STEP.COMPANY ? 1 : 0;

  const goPrev = () => setCurrent(resolvePrevStep(current, clientType));

  const goNext = async () => {
    // StepType 由卡片点击跳转；证件选填；唯一标识靠 Form 校验位 + 下一步强制查重（不依赖失焦）。
    if (current === WIZARD_STEP.COMPANY) {
      try {
        await companyForm.validateFields();
      } catch {
        return;
      }
      const creditCode = companyForm.getFieldValue('creditCode') as string | undefined;
      const dup = await runWizardDuplicateCheck({
        value: creditCode ?? '',
        fieldLabel: '统一社会信用代码',
        target: 'company',
        form: companyForm,
        returnToStepOnExitAppend: WIZARD_STEP.COMPANY,
      });
      if (dup === 'blocked') return;
      if (dup === 'appended') return; // hydrateFromExisting 已跳到代理信息步
      setCurrent(isCompany ? WIZARD_STEP.AGENT_INFO : WIZARD_STEP.LEGAL_REP);
      return;
    }
    if (current === WIZARD_STEP.LEGAL_REP) {
      try {
        await legalRepForm.validateFields();
      } catch {
        return;
      }
      const idNumber = legalRepForm.getFieldValue('idNumber') as string | undefined;
      const dup = await runWizardDuplicateCheck({
        value: idNumber ?? '',
        fieldLabel: '身份证号',
        target: 'legalRep',
        form: legalRepForm,
        returnToStepOnExitAppend: WIZARD_STEP.LEGAL_REP,
      });
      if (dup === 'blocked') return;
      if (dup === 'appended') return;
      setCurrent(WIZARD_STEP.AGENT_INFO);
      return;
    }
    void handleSubmit();
  };

  const handleSubmit = async () => {
    const state = useClientWizardStore.getState();
    // clientType/phone/email/companyInfo/legalRepInfo 已在 goNext 阶段由 companyForm/legalRepForm
    // 的 validateFields() 校验通过才能到达这一步（代理信息），此处不再重复手写 if 判断兜底提示；
    // 仅保留类型收窄用的运行时兜底（理论上不会触发，仅防御异常路径直接调用 handleSubmit）。
    if (!state.clientType || !state.phone || !state.email) {
      void message.error('信息不完整，请返回上一步检查');
      return;
    }
    // "至少一条代理信息"这一约束不属于单个字段的校验规则，Form 无法承担，仍需在此单独检查。
    if (state.agentInfos.length === 0) {
      void message.error('请至少添加一条代理信息');
      return;
    }
    // 每条代理信息自身字段 + 其下店铺/产品字段的校验，交由各自的 antd Form 承担。
    try {
      await stepShopsRef.current?.validateFields();
    } catch {
      void message.error('请完善代理信息（含店铺、产品字段）');
      return;
    }
    const isCompanyType = state.clientType === 'COMPANY';
    // 客户唯一标识：公司=信用代码，个人=身份证号；与展示字段保持同值，并统一规范化。
    const uniqueIdentifier = normalizeIdentifier(
      isCompanyType ? state.companyInfo.creditCode : state.legalRepInfo.idNumber,
    );
    const payload: ClientPayload = {
      clientType: state.clientType,
      phone: state.phone,
      email: state.email,
      remark: state.remark,
      uniqueIdentifier,
      companyInfo: {
        ...(state.companyInfo as ClientPayload['companyInfo']),
        ...(isCompanyType ? { creditCode: uniqueIdentifier } : {}),
      },
      legalRepInfo: isCompanyType
        ? undefined
        : {
            nameCn: state.legalRepInfo.nameCn ?? '',
            namePinyin: state.legalRepInfo.namePinyin ?? '',
            idAddressCn: state.legalRepInfo.idAddressCn ?? '',
            ...state.legalRepInfo,
            idNumber: uniqueIdentifier,
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
        // 追加模式：只提交本次新增的代理信息，主体/个人信息按最新一次覆盖，creditCode/idNumber 由后端忽略。
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
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          className="wizard-back-btn"
          onClick={() => navigate('/clients')}
        >
          返回客户列表
        </Button>
        <Steps current={displayCurrent} items={displayItems} />
      </Card>

      <Card bordered={false} className="wizard-content-card">
        {current === WIZARD_STEP.TYPE ? <StepType /> : null}
        {current === WIZARD_STEP.COMPANY ? <StepCompany form={companyForm} /> : null}
        {current === WIZARD_STEP.LEGAL_REP ? <StepLegalRep form={legalRepForm} /> : null}
        {current === WIZARD_STEP.AGENT_INFO ? <StepShops ref={stepShopsRef} /> : null}
      </Card>

      {current > WIZARD_STEP.TYPE ? (
        <div className="wizard-footer">
          <Space>
            <Button onClick={goPrev}>上一步</Button>
            <Button type="primary" loading={submitting} onClick={() => void goNext()}>
              {current === WIZARD_STEP.AGENT_INFO ? (isAppend ? '提交追加' : '提交') : '下一步'}
            </Button>
          </Space>
          {current === WIZARD_STEP.AGENT_INFO ? (
            <Alert
              type="info"
              showIcon
              message="提交后将自动在后台生成代理证书，可在客户列表查看生成状态"
              className="wizard-footer-hint"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
