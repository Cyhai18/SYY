import { useEffect, useRef } from 'react';
import { Modal, message } from 'antd';
import type { FormInstance } from 'antd';
import { clientsApi } from '../../../lib/clients-api';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { resolvePrevStep } from '../wizard-steps';

/**
 * `StepCompany`（统一信用代码）与 `StepLegalRep`（身份证号）共用的查重逻辑。
 * 统一信用代码/身份证号两个输入框禁止手动编辑，只能由证件 OCR 识别得出，因此查重只会在
 * OCR 识别成功后触发一次（各自 `handleUpload` 里调用），不再需要 onBlur + 防抖。
 * 命中已存在客户时弹窗提示，确认后切到"追加代理信息"模式，并把命中客户的 companyInfo/
 * legalRepInfo/联系方式（联系电话、邮箱）回填到当前表单；取消则退回上一步，方便用户重新核对/上传证件。
 *
 * @param fieldLabel 用于弹窗/提示文案的字段名，如"统一信用代码"/"身份证号"。
 * @param target 命中后应把哪一份信息回填到当前表单：'company' 对应 StepCompany，'legalRep' 对应 StepLegalRep。
 * @param form 当前 Step 持有的 antd Form 实例，命中后用于回填已存在客户的信息。
 */
// 命中"归属他人"拦截后需要强制清空的字段名：按 target 区分，与 StepCompany/StepLegalRep
// 的 Form.Item name 一一对应（不含 phone/email，联系方式是共享字段，不随证件识别清空）。
const EMPTY_FIELDS_BY_TARGET: Record<'company' | 'legalRep', Record<string, undefined>> = {
  company: {
    creditCode: undefined,
    nameCn: undefined,
    nameEn: undefined,
    postalCode: undefined,
    addressCn: undefined,
    addressEn: undefined,
    provinceEn: undefined,
    cityEn: undefined,
  },
  legalRep: {
    idNumber: undefined,
    nameCn: undefined,
    namePinyin: undefined,
    idPostalCode: undefined,
    idAddressCn: undefined,
    idAddressEn: undefined,
  },
};

export function useDuplicateCheck(
  fieldLabel: string,
  target: 'company' | 'legalRep',
  form: FormInstance,
) {
  const existingClientId = useClientWizardStore((s) => s.existingClientId);
  const hydrateFromExisting = useClientWizardStore((s) => s.hydrateFromExisting);
  const isLocked = useClientWizardStore((s) => s.mode === 'APPEND');
  const current = useClientWizardStore((s) => s.current);
  const clientType = useClientWizardStore((s) => s.clientType);
  const setCurrent = useClientWizardStore((s) => s.setCurrent);
  const clearRecognizedIdentity = useClientWizardStore((s) => s.clearRecognizedIdentity);
  // 组件卸载后若查重请求才返回，避免继续弹窗/写入已卸载组件关心的状态
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runDuplicateCheck = async (value: string) => {
    if (!value.trim() || isLocked) return;
    try {
      const { exists, owned, client } = await clientsApi.checkDuplicate(value.trim());
      if (!mountedRef.current || !exists) return;
      if (!owned) {
        // 命中的客户归属于其他用户：不暴露其任何信息，仅提示无权限，并清空当前表单强制
        // 重新上传证件，禁止带着这份识别结果继续填写/提交。
        Modal.error({
          title: '该客户您无权限新增或修改，请重新上传',
          onOk: () => {
            // 清空本次 OCR 识别回填的信息及已上传证件，停留在当前步骤强制重新上传，
            // 避免带着被拦截的统一信用代码/身份证号直接跳到下一步、到最终提交才报错。
            // 注意：这里不能用 form.resetFields()——它重置到的是 Form 当前已配置的
            // initialValues，而 initialValues 取自上一次渲染时的 store 快照；
            // clearRecognizedIdentity() 虽同步更新了 store，但 React 重渲染是异步的，
            // resetFields() 执行时组件还未用清空后的 store 重新渲染，initialValues 仍是
            // 识别出的旧值，resetFields() 等于把字段重置回这份旧值，视觉上没有任何变化。
            // 必须显式用 setFieldsValue 把目标字段逐一置空。
            clearRecognizedIdentity(target);
            form.setFieldsValue(EMPTY_FIELDS_BY_TARGET[target]);
          },
        });
        return;
      }
      if (!client || client.id === existingClientId) return;
      Modal.confirm({
        title: '该客户已存在',
        content: `识别到的${fieldLabel}已在系统中存在，是否为该客户追加新的代理信息？`,
        okText: '追加代理信息',
        cancelText: '返回上一步',
        onOk: () => {
          hydrateFromExisting({
            id: client.id,
            phone: client.phone,
            email: client.email,
            remark: client.remark,
            companyInfo: client.companyInfo,
            legalRepInfo: client.legalRepInfo,
            agentInfos: client.agentInfos,
          });
          const fields = target === 'company' ? client.companyInfo : client.legalRepInfo;
          form.setFieldsValue({ ...fields, phone: client.phone, email: client.email });
          void message.info(`已切换为追加代理信息模式，${fieldLabel}不可再变更`);
        },
        onCancel: () => setCurrent(resolvePrevStep(current, clientType)),
      });
    } catch {
      // 查重接口失败不阻断正常填写流程，静默忽略即可
    }
  };

  return { runDuplicateCheck, isLocked };
}
