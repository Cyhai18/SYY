export const APP_NAME = '税驿云';

export const API_PREFIX = '/api';

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  timestamp: string;
}

export const createHealthResponse = (service: string): HealthResponse => ({
  status: 'ok',
  service,
  timestamp: new Date().toISOString(),
});

/** 与 Prisma `Role` 枚举保持一致，供前端展示角色名等场景使用。 */
export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

export const ROLE_LABELS: Record<Role, string> = {
  USER: '普通用户',
  ADMIN: '管理员',
  SUPERADMIN: '超级管理员',
};

/** 登录/注册/`/users/me` 等接口返回的用户信息（不含敏感字段）。 */
export interface PublicUser {
  id: string;
  phone: string;
  email: string | null;
  nickname: string;
  avatarUrl: string | null;
  role: Role;
}

/** 登录/注册接口成功响应体（Refresh Token 走 HttpOnly Cookie，不在响应体中）。 */
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}

export type SmsScene = 'register' | 'login' | 'reset-password' | 'bind-phone';

// ---------------------------------------------------------------------------
// 客户画像（授权客户）
// ---------------------------------------------------------------------------

export type ClientType = 'COMPANY' | 'INDIVIDUAL';

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  COMPANY: '企业',
  INDIVIDUAL: '个人',
};

export type ClientStatus = 'PENDING_REVIEW' | 'APPROVED' | 'DISABLED';

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  PENDING_REVIEW: '审核中',
  APPROVED: '已通过',
  DISABLED: '已禁用',
};

export type Platform =
  'AMAZON' | 'TEMU' | 'SHEIN' | 'TIKTOK' | 'ALIEXPRESS' | 'ALIBABA_ICBU' | 'FRUUGO' | 'OTHER';

export const PLATFORM_LABELS: Record<Platform, string> = {
  AMAZON: 'Amazon',
  TEMU: 'Temu',
  SHEIN: 'Shein',
  TIKTOK: 'TikTok',
  ALIEXPRESS: '速卖通',
  ALIBABA_ICBU: '阿里国际站',
  FRUUGO: 'Fruugo',
  OTHER: '其他',
};

export type AgentCountry = 'GB' | 'EU' | 'US' | 'TR' | 'CA';

export const AGENT_COUNTRY_LABELS: Record<AgentCountry, string> = {
  GB: '英国',
  EU: '欧盟',
  US: '美国',
  TR: '土耳其',
  CA: '加拿大',
};

export interface CompanyInfoPayload {
  creditCode: string;
  nameCn?: string;
  nameEn?: string;
  addressCn?: string;
  provinceEn?: string;
  cityEn?: string;
  postalCode?: string;
  addressEn?: string;
}

export interface LegalRepresentativePayload {
  nameCn: string;
  surnamePinyin: string;
  givenNamePinyin: string;
  idNumber: string;
  idAddress: string;
}

export interface ProductPayload {
  platform: Platform;
  productName: string;
  category: string;
  asinOrSku: string;
  productUrl: string;
  hasBattery?: boolean;
}

export interface AgentInfoPayload {
  country: AgentCountry;
  expectedEffectiveDate: string;
  agentYears: number;
  agentCompany: string;
}

export interface ShopPayload {
  platform: Platform;
  shopName: string;
  shopUrl: string;
  brandNames: string;
  mainCategoryEn: string;
  products?: ProductPayload[];
  agentInfos?: AgentInfoPayload[];
}

/** OCR 识别接口的统一返回结构：`fields` 为结构化字段，`recognized` 标记是否识别成功。营业执照/身份证图片仅用于识别，不落盘、不返回 fileUrl。 */
export interface OcrResult<T> {
  fields: T;
  recognized: boolean;
}

export interface BusinessLicenseFields {
  creditCode?: string;
  nameCn?: string;
  nameEn?: string;
  addressCn?: string;
  addressEn?: string;
  provinceEn?: string;
  cityEn?: string;
  postalCode?: string;
}

export interface IdCardFields {
  nameCn?: string;
  idNumber?: string;
  idAddress?: string;
  surnamePinyin?: string;
  givenNamePinyin?: string;
}

/** 单条创建/编辑客户的统一结构，未来批量导入按同一结构拼装后复用同一后端入口。 */
export interface ClientPayload {
  clientType: ClientType;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo: CompanyInfoPayload;
  legalRepInfo: LegalRepresentativePayload;
  shops: ShopPayload[];
}

export interface ClientListItem {
  id: string;
  clientType: ClientType;
  phone: string;
  email: string | null;
  status: ClientStatus;
  nameCn: string | null;
  nameEn: string | null;
  ownerId: string;
  ownerNickname: string;
  shopCount: number;
  createdAt: string;
}

export interface ClientDetail extends ClientPayload {
  id: string;
  status: ClientStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
