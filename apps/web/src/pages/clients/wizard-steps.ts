import type { ClientType } from '@funtax/shared';

/** `current` 对应的向导步骤，避免散落各处的魔法数字（个人客户跳过 COMPANY，公司客户跳过 LEGAL_REP）。 */
export const WIZARD_STEP = {
  TYPE: 0,
  COMPANY: 1,
  LEGAL_REP: 2,
  AGENT_INFO: 3,
} as const;

/**
 * 计算"上一步"应该落到的 step：个人客户从 LEGAL_REP 返回 TYPE（跳过不存在的 COMPANY），
 * 公司客户从 AGENT_INFO 返回 COMPANY（跳过不存在的 LEGAL_REP），其余情况直接 -1。
 * `ClientWizardPage` 的"上一步"按钮与查重弹窗的"返回上一步"共用同一份逻辑。
 */
export function resolvePrevStep(current: number, clientType: ClientType | null): number {
  const isIndividual = clientType === 'INDIVIDUAL';
  const isCompany = clientType === 'COMPANY';
  if (current === WIZARD_STEP.LEGAL_REP && isIndividual) return WIZARD_STEP.TYPE;
  if (current === WIZARD_STEP.AGENT_INFO && isCompany) return WIZARD_STEP.COMPANY;
  return current - 1;
}
