import { useCallback, useEffect, useRef } from 'react';
import { Modal, message } from 'antd';
import type { FormInstance } from 'antd';
import { normalizeIdentifier, validateUniqueIdentifier, type ClientType } from '@funtax/shared';
import { clientsApi } from '../../../lib/clients-api';
import { useClientWizardStore } from '../../../store/client-wizard-store';
import { resolvePrevStep, WIZARD_STEP } from '../wizard-steps';

export type DuplicateCheckOutcome = 'ok' | 'blocked' | 'appended';
type ManagedModal = { destroy: () => void };
type RegisterModal = (modal: ManagedModal) => () => void;

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
    contactPerson: undefined,
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

/**
 * 向导唯一标识查重：OCR / 失焦 / 下一步共用。
 * - APPEND 且输入仍等于锁定唯一标识 → 不查，直接 ok（继续追加当前客户）
 * - APPEND 但用户改了号 → 先 exitAppendMode，再按 CREATE 查重
 * - 校验位不过 → 不发请求
 */
export async function runWizardDuplicateCheck(opts: {
  value: string;
  fieldLabel: string;
  target: 'company' | 'legalRep';
  form?: FormInstance;
  isMounted?: () => boolean;
  registerModal?: RegisterModal;
  /** 退出 APPEND 后应回到的步骤（主体/个人信息） */
  returnToStepOnExitAppend?: number;
}): Promise<DuplicateCheckOutcome> {
  let state = useClientWizardStore.getState();
  const normalized = normalizeIdentifier(opts.value);
  if (!normalized) return 'ok';

  // 仍挂在同一客户的锁定标识上：无需重复查重
  if (
    state.mode === 'APPEND' &&
    state.lockedUniqueIdentifier &&
    normalized === state.lockedUniqueIdentifier
  ) {
    return 'ok';
  }

  const typeForCheck: ClientType = opts.target === 'company' ? 'COMPANY' : 'INDIVIDUAL';
  // 校验位不过：不发请求，也不 exitAppend——避免误按一个字符就清掉 existingAgentInfos
  if (validateUniqueIdentifier(typeForCheck, normalized)) return 'ok';

  // 用户在追加模式下改成了另一个合法号 → 退出追加，再按新建查重
  if (state.mode === 'APPEND') {
    state.exitAppendMode({ returnToStep: opts.returnToStepOnExitAppend });
    void message.info(`已退出追加模式，将按新的${opts.fieldLabel}继续`);
    state = useClientWizardStore.getState();
  }

  try {
    const { exists, owned, client } = await clientsApi.checkDuplicate(normalized);
    if (opts.isMounted && !opts.isMounted()) return 'ok';
    if (!exists) return 'ok';
    if (!owned) {
      await new Promise<void>((resolve) => {
        let settled = false;
        let releaseModal = () => {};
        const finish = () => {
          if (settled) return;
          settled = true;
          releaseModal();
          if (!opts.isMounted || opts.isMounted()) {
            state.clearRecognizedIdentity(opts.target);
            opts.form?.setFieldsValue(EMPTY_FIELDS_BY_TARGET[opts.target]);
          }
          resolve();
        };
        const modal = Modal.error({
          title: '该客户您无权限新增或修改，请更换号码或重新上传证件',
          onOk: finish,
          afterClose: finish,
        });
        releaseModal = opts.registerModal?.(modal) ?? (() => {});
      });
      return 'blocked';
    }
    if (!client || client.id === state.existingClientId) return 'ok';
    return await new Promise<DuplicateCheckOutcome>((resolve) => {
      let settled = false;
      let releaseModal = () => {};
      const finish = (outcome: DuplicateCheckOutcome) => {
        if (settled) return;
        settled = true;
        releaseModal();
        resolve(outcome);
      };
      const modal = Modal.confirm({
        title: '该客户已存在',
        content: `该${opts.fieldLabel}已在系统中存在，是否为该客户追加新的代理信息？也可取消后修改${opts.fieldLabel}继续新建。`,
        okText: '追加代理信息',
        cancelText: '返回上一步',
        onOk: () => {
          if (opts.isMounted && !opts.isMounted()) {
            finish('ok');
            return;
          }
          state.hydrateFromExisting({
            id: client.id,
            phone: client.phone,
            email: client.email,
            remark: client.remark,
            companyInfo: client.companyInfo,
            legalRepInfo: client.legalRepInfo,
            agentInfos: client.agentInfos,
            lockedUniqueIdentifier: normalized,
          });
          const fields = opts.target === 'company' ? client.companyInfo : client.legalRepInfo;
          opts.form?.setFieldsValue({ ...fields, phone: client.phone, email: client.email });
          void message.info(
            `已切换为追加代理信息模式。若需改为新建客户，可修改${opts.fieldLabel}后继续`,
          );
          finish('appended');
        },
        afterClose: () => {
          if (settled) return;
          if (opts.isMounted && !opts.isMounted()) {
            finish('ok');
            return;
          }
          state.setCurrent(resolvePrevStep(state.current, state.clientType));
          finish('blocked');
        },
      });
      releaseModal = opts.registerModal?.(modal) ?? (() => {});
    });
  } catch {
    return 'ok';
  }
}

/** Step 内失焦/OCR 查重，带卸载守卫与请求序号。APPEND 下唯一标识仍可编辑。 */
export function useDuplicateCheck(
  fieldLabel: string,
  target: 'company' | 'legalRep',
  form: FormInstance,
) {
  const isAppend = useClientWizardStore((s) => s.mode === 'APPEND');
  const mountedRef = useRef(true);
  const reqIdRef = useRef(0);
  const modalsRef = useRef(new Set<ManagedModal>());
  const invalidateDuplicateCheck = useCallback(() => {
    reqIdRef.current += 1;
    for (const modal of modalsRef.current) modal.destroy();
    modalsRef.current.clear();
  }, []);
  const registerModal = useCallback<RegisterModal>((modal) => {
    modalsRef.current.add(modal);
    return () => {
      modalsRef.current.delete(modal);
    };
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateDuplicateCheck();
    };
  }, [invalidateDuplicateCheck]);
  const runDuplicateCheck = async (value: string): Promise<DuplicateCheckOutcome> => {
    invalidateDuplicateCheck();
    const reqId = reqIdRef.current;
    const returnToStep = target === 'company' ? WIZARD_STEP.COMPANY : WIZARD_STEP.LEGAL_REP;
    const outcome = await runWizardDuplicateCheck({
      value,
      fieldLabel,
      target,
      form,
      returnToStepOnExitAppend: returnToStep,
      registerModal,
      isMounted: () => {
        const state = useClientWizardStore.getState();
        const currentValue =
          target === 'company' ? state.companyInfo.creditCode : state.legalRepInfo.idNumber;
        return (
          mountedRef.current &&
          reqId === reqIdRef.current &&
          normalizeIdentifier(currentValue ?? '') === normalizeIdentifier(value)
        );
      },
    });
    if (!mountedRef.current || reqId !== reqIdRef.current) return 'ok';
    return outcome;
  };
  // isAppend 仅供步骤文案/提示条使用，不再禁用唯一标识输入
  return { runDuplicateCheck, invalidateDuplicateCheck, isAppend };
}
