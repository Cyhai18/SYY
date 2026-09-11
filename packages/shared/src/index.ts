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
  /** 联系人，仅公司类型客户必填（个人客户无此字段） */
  contactPerson?: string;
}

export interface LegalRepresentativePayload {
  nameCn: string;
  namePinyin: string;
  idNumber: string;
  idAddressCn: string;
  idPostalCode?: string;
  idAddressEn?: string;
}

export interface ProductPayload {
  platform: Platform;
  productNameCn: string;
  productNameEn: string;
  category: string;
  asinOrSku: string;
  productUrl: string;
  hasBattery?: boolean;
}

/**
 * 代理公司为固定枚举值：同一 title 在不同国家下可能重复（如均叫 "Oversea Walkers"），
 * 故用语义化 value 区分；后续不同代理公司对应的操作逻辑（如后续跟进流程）都基于此 value 分支。
 */
export type AgentCompany =
  | 'OVERSEA_WALKERS_GB'
  | 'OVERSEA_WALKERS_EU'
  | 'EU_CONSULTEN_SRLS'
  | 'OVERSEA_WALKERS_US'
  | 'OVERSEA_WALKERS_TR';

export const AGENT_COMPANY_LABELS: Record<AgentCompany, string> = {
  OVERSEA_WALKERS_GB: 'OVERSEA WALKERS LIMITED',
  OVERSEA_WALKERS_EU: 'Oversea Walkers',
  EU_CONSULTEN_SRLS: 'EU Consulten Srls',
  OVERSEA_WALKERS_US: 'Oversea Walkers LLC',
  OVERSEA_WALKERS_TR: 'OVERSEAWALKERS DANISMANLIK LiMiTED SiRKETi',
};

/** 代理国家 -> 可选代理公司列表；选择代理国家后，代理公司下拉框据此过滤选项。 */
export const AGENT_COUNTRY_COMPANIES: Record<AgentCountry, AgentCompany[]> = {
  GB: ['OVERSEA_WALKERS_GB'],
  EU: ['OVERSEA_WALKERS_EU', 'EU_CONSULTEN_SRLS'],
  US: ['OVERSEA_WALKERS_US'],
  TR: ['OVERSEA_WALKERS_TR'],
  CA: [],
};

export interface ShopPayload {
  platform: Platform;
  shopId?: string;
  shopName: string;
  shopUrl: string;
  brandNames: string;
  mainCategoryEn: string;
  products?: ProductPayload[];
}

export interface AgentInfoPayload {
  country: AgentCountry;
  expectedEffectiveDate: string;
  agentYears: number;
  agentCompany: AgentCompany;
  shops?: ShopPayload[];
}

/**
 * `checkDuplicate` 查重接口返回的最小字段集合（见 `ClientsService.checkDuplicate` 的隐私说明），
 * 仅供向导展示"该客户已有哪些代理信息"的摘要提示，不是完整的 `AgentInfoPayload`/`ShopPayload`，
 * 不要与两者混用。
 */
export interface DuplicateCheckShop {
  platform: Platform;
  shopName: string;
  productCount: number;
}
export interface DuplicateCheckAgentInfo {
  country: AgentCountry;
  agentCompany: AgentCompany;
  shops: DuplicateCheckShop[];
}
export interface DuplicateCheckResult {
  id: string;
  agentInfos: DuplicateCheckAgentInfo[];
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
  namePinyin?: string;
  idAddressCn?: string;
  idAddressEn?: string;
  idPostalCode?: string;
}

/** 单条创建/编辑客户的统一结构，未来批量导入按同一结构拼装后复用同一后端入口。 */
export interface ClientPayload {
  clientType: ClientType;
  phone: string;
  email: string;
  remark?: string;
  companyInfo: CompanyInfoPayload;
  /** 公司类型客户不再采集法人信息，仅个人类型客户必填 */
  legalRepInfo?: LegalRepresentativePayload;
  agentInfos: AgentInfoPayload[];
}

/** 客户列表行中，某一条代理信息的摘要（展开子表格用），支持针对该条代理信息单独发起操作（如查看证书）。 */
export interface AgentInfoSummary {
  id: string;
  country: AgentCountry;
  agentCompany: AgentCompany;
  expectedEffectiveDate: string;
  expiresAt: string;
  shopCount: number;
}

/**
 * 列表页第一/二列展示的"名称"：企业客户取 `CompanyInfo.nameCn/nameEn`；
 * 个人客户没有英文名概念，中文列取法人姓名（`LegalRepresentative.nameCn`），
 * 英文列取法人姓名拼音（`LegalRepresentative.namePinyin`）代替。
 *
 * 一个客户可能有多条代理信息，列表以客户为主行、代理信息作为可展开的子表格展示，
 * 详见 `agentInfos`；子表格每一行都可独立发起"查看证书"等操作。
 */
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
  /** 客户提交（创建）日期 */
  createdAt: string;
  /** 该客户下的全部代理信息，按创建时间升序排列；客户尚未录入代理信息时为空数组 */
  agentInfos: AgentInfoSummary[];
}

export type AttachmentType = 'BUSINESS_LICENSE' | 'ID_CARD_FRONT' | 'ID_CARD_BACK' | 'OTHER';

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  BUSINESS_LICENSE: '营业执照',
  ID_CARD_FRONT: '身份证正面',
  ID_CARD_BACK: '身份证反面',
  OTHER: '其他',
};

export interface AttachmentItem {
  id: string;
  type: AttachmentType;
  fileUrl: string;
  createdAt: string;
}

export interface ProductDetail extends ProductPayload {
  id: string;
}

export interface ShopDetail extends ShopPayload {
  id: string;
  products: ProductDetail[];
}

export interface AgentInfoDetail extends Omit<AgentInfoPayload, 'shops'> {
  id: string;
  expiresAt: string;
  shops: ShopDetail[];
}

export interface ClientDetail extends Omit<ClientPayload, 'agentInfos'> {
  id: string;
  status: ClientStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  agentInfos: AgentInfoDetail[];
  attachments: AttachmentItem[];
}
