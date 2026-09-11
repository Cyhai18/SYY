import { useEffect, useRef } from 'react';
import { Modal, message } from 'antd';
import { clientsApi } from '../../../lib/clients-api';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { resolvePrevStep } from '../wizard-steps';

const DUPLICATE_CHECK_DEBOUNCE_MS = 500;

/**
 * `StepCompany`（统一信用代码）与 `StepLegalRep`（身份证号）共用的 onBlur + 防抖查重逻辑。
 * 命中已存在客户时弹窗提示，确认后切到"追加代理信息"模式并锁定该唯一标识字段；
 * 取消则退回上一步，方便用户先核对/修改刚填写的内容。
 *
 * @param fieldLabel 用于弹窗/提示文案的字段名，如"统一信用代码"/"身份证号"。
 */
export function useDuplicateCheck(fieldLabel: string) {
  const existingClientId = useClientWizardStore((s) => s.existingClientId);
  const hydrateFromExisting = useClientWizardStore((s) => s.hydrateFromExisting);
  const isLocked = useClientWizardStore((s) => s.mode === 'APPEND');
  const current = useClientWizardStore((s) => s.current);
  const clientType = useClientWizardStore((s) => s.clientType);
  const setCurrent = useClientWizardStore((s) => s.setCurrent);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 组件卸载后若查重请求才返回，避免继续弹窗/写入已卸载组件关心的状态
  const mountedRef = useRef(true);

  // 组件卸载时清理未触发的定时器，避免卸载后仍触发查重请求/状态更新
  useEffect(
    () => () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const checkDuplicate = async (value: string) => {
    try {
      const { exists, client } = await clientsApi.checkDuplicate(value);
      if (!mountedRef.current || !exists || !client || client.id === existingClientId) return;
      Modal.confirm({
        title: '该客户已存在',
        content: `识别到的${fieldLabel}已在系统中存在，是否为该客户追加新的代理信息？`,
        okText: '追加代理信息',
        cancelText: '返回上一步',
        onOk: () => {
          hydrateFromExisting({ id: client.id, agentInfos: client.agentInfos });
          void message.info(`已切换为追加代理信息模式，${fieldLabel}不可再变更`);
        },
        onCancel: () => setCurrent(resolvePrevStep(current, clientType)),
      });
    } catch {
      // 查重接口失败不阻断正常填写流程，静默忽略即可
    }
  };

  const scheduleDuplicateCheck = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || isLocked) return;
    debounceRef.current = setTimeout(() => {
      void checkDuplicate(value.trim());
    }, DUPLICATE_CHECK_DEBOUNCE_MS);
  };

  return { scheduleDuplicateCheck, isLocked };
}
