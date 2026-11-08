/**
 * 统一社会信用代码 / 身份证号：规范化 + 校验位。
 * 算法与 packages/shared、services/ocr-service/parsers.py 保持一致（GB 32100 / GB 11643-1999）。
 * apps/api 未依赖 @funtax/shared，此处单独维护一份，改算法时两边需同步。
 */

export type ClientTypeForIdentifier = 'COMPANY' | 'INDIVIDUAL';

/** 去掉空白后转大写，供入库与比较前统一口径。 */
export function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

const CC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const CC_INDEX: Record<string, number> = Object.fromEntries([...CC_CHARS].map((c, i) => [c, i]));
const CC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

function creditCodeCheckChar(first17: string): string {
  let total = 0;
  for (let i = 0; i < 17; i++) {
    total += (CC_INDEX[first17[i]] ?? 0) * CC_WEIGHTS[i];
  }
  return CC_CHARS[(31 - (total % 31)) % 31];
}

export function isValidCreditCode(code: string): boolean {
  if (code.length !== 18) return false;
  for (const ch of code) {
    if (!(ch in CC_INDEX)) return false;
  }
  return creditCodeCheckChar(code.slice(0, 17)) === code[17];
}

const ID_NUMBER_RE = /^\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX]$/;
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

export function isValidIdNumber(idNumber: string): boolean {
  if (!ID_NUMBER_RE.test(idNumber)) return false;
  const year = Number(idNumber.slice(6, 10));
  const month = Number(idNumber.slice(10, 12));
  const day = Number(idNumber.slice(12, 14));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  )
    return false;
  let total = 0;
  for (let i = 0; i < 17; i++) {
    total += Number(idNumber[i]) * ID_WEIGHTS[i];
  }
  return ID_CHECK_CODES[total % 11] === idNumber[17];
}

/**
 * 按客户类型校验唯一标识。返回 null 表示通过，否则为错误文案。
 */
export function validateUniqueIdentifier(
  clientType: ClientTypeForIdentifier,
  raw: string | null | undefined,
): string | null {
  const value = normalizeIdentifier(raw);
  if (!value) {
    return clientType === 'COMPANY' ? '统一社会信用代码不能为空' : '身份证号不能为空';
  }
  if (clientType === 'COMPANY') {
    if (!isValidCreditCode(value)) {
      return '统一社会信用代码格式不正确或校验位错误';
    }
    return null;
  }
  if (!isValidIdNumber(value)) {
    return '身份证号格式不正确或校验位错误';
  }
  return null;
}
