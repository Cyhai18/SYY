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

export type ClientStatus = 'NORMAL' | 'PENDING_REVIEW' | 'INACTIVE';

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  NORMAL: '正常',
  PENDING_REVIEW: '审核中',
  INACTIVE: '失效',
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
  /** 仅展示用途，不再作为查重/唯一性键，见 ClientPayload.uniqueIdentifier */
  creditCode?: string;
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
  productNameCn?: string;
  productNameEn?: string;
  category?: string;
  asinOrSku?: string;
  productUrl?: string;
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
  | 'OVERSEA_WALKERS_TR'
  | 'OVERSEA_WALKERS_CA';

export const AGENT_COMPANY_LABELS: Record<AgentCompany, string> = {
  OVERSEA_WALKERS_GB: 'OVERSEA WALKERS LIMITED',
  OVERSEA_WALKERS_EU: 'Oversea Walkers',
  EU_CONSULTEN_SRLS: 'EU Consulten Srls',
  OVERSEA_WALKERS_US: 'Oversea Walkers LLC',
  OVERSEA_WALKERS_TR: 'OVERSEAWALKERS DANISMANLIK LiMiTED SiRKETi',
  OVERSEA_WALKERS_CA: 'Oversea Walkers',
};

/** 代理国家 -> 可选代理公司列表；选择代理国家后，代理公司下拉框据此过滤选项。 */
export const AGENT_COUNTRY_COMPANIES: Record<AgentCountry, AgentCompany[]> = {
  GB: ['OVERSEA_WALKERS_GB'],
  EU: ['OVERSEA_WALKERS_EU', 'EU_CONSULTEN_SRLS'],
  US: ['OVERSEA_WALKERS_US'],
  TR: ['OVERSEA_WALKERS_TR'],
  CA: ['OVERSEA_WALKERS_CA'],
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
  /** 每条代理信息下至少要有一条店铺，后端 AgentInfoDto 用 @ArrayMinSize(1) 强制校验 */
  shops: ShopPayload[];
}

/** `checkDuplicate` 命中已存在客户时一并带出的已有代理信息（含店铺/产品明细），
 * 用于代理信息步骤：1）禁用已占用的代理国家选项，避免重复追加同一国家；
 * 2）只读展示已有代理信息卡片，方便新增其他国家代理信息时参考/复用其店铺与产品数据。 */
export interface DuplicateCheckAgentInfo extends AgentInfoPayload {}

/**
 * `checkDuplicate` 查重接口命中已存在客户时返回的信息：统一信用代码/身份证号两个输入框
 * 禁止手动编辑、只能由证件 OCR 识别得出，命中后前端据此把 `companyInfo`/`legalRepInfo`/
 * 联系方式回填到对应表单 tab，客户已有信息不用再重新手填；`agentInfos` 用于代理信息步骤
 * 禁用已存在的代理国家选项。
 */
export interface DuplicateCheckResult {
  id: string;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo?: CompanyInfoPayload;
  legalRepInfo?: LegalRepresentativePayload;
  agentInfos?: DuplicateCheckAgentInfo[];
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
  /** 客户唯一标识：公司存统一社会信用代码，个人存身份证号，落在 Client.uniqueIdentifier */
  uniqueIdentifier: string;
  companyInfo: CompanyInfoPayload;
  /** 公司类型客户不再采集法人信息，仅个人类型客户必填 */
  legalRepInfo?: LegalRepresentativePayload;
  agentInfos: AgentInfoPayload[];
}

/** 代理证书后台生成状态机，与 Prisma `CertificateStatus` 枚举保持一致，见 docs/certificate-generation-design.md */
export type CertificateStatus = 'NONE' | 'PENDING' | 'GENERATING' | 'SUCCESS' | 'FAILED';

export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  NONE: '未生成',
  PENDING: '等待生成',
  GENERATING: '生成中',
  SUCCESS: '已生成',
  FAILED: '生成失败',
};

/**
 * 证书生成成功（`CertificateStatus = SUCCESS`）后，基于 `expectedEffectiveDate`/`expiresAt`
 * 与当前时间动态推导出的服务有效期状态，纯前端/后端计算得出，不落库、不依赖定时任务：
 * - 在有效期内：生效中
 * - 距到期不足 1 个月：待续费
 * - 已过期：失效
 * 未生成成功的代理信息（`NONE`/`PENDING`/`GENERATING`/`FAILED`）没有服务状态，仍展示生成流程状态。
 */
export type CertificateServiceStatus = 'ACTIVE' | 'PENDING_RENEWAL' | 'EXPIRED';

export const CERTIFICATE_SERVICE_STATUS_LABELS: Record<CertificateServiceStatus, string> = {
  ACTIVE: '生效中',
  PENDING_RENEWAL: '待续费',
  EXPIRED: '失效',
};

/** 到期前多少天进入"待续费"提醒窗口，见 `CERTIFICATE_SERVICE_STATUS_LABELS` 说明。 */
export const CERTIFICATE_RENEWAL_WINDOW_DAYS = 30;

/**
 * 客户列表"状态"搜索框使用的证书状态枚举：用生成成功后的服务状态（生效中/待续费/失效）替换掉
 * 单一的 `SUCCESS`（已生成），与列表页证书状态列的展示口径保持一致，便于按业务含义搜索。
 */
export type CertificateStatusFilter =
  Exclude<CertificateStatus, 'SUCCESS'> | CertificateServiceStatus;

export const CERTIFICATE_STATUS_FILTER_LABELS: Record<CertificateStatusFilter, string> = {
  NONE: CERTIFICATE_STATUS_LABELS.NONE,
  PENDING: CERTIFICATE_STATUS_LABELS.PENDING,
  GENERATING: CERTIFICATE_STATUS_LABELS.GENERATING,
  FAILED: CERTIFICATE_STATUS_LABELS.FAILED,
  ACTIVE: CERTIFICATE_SERVICE_STATUS_LABELS.ACTIVE,
  PENDING_RENEWAL: CERTIFICATE_SERVICE_STATUS_LABELS.PENDING_RENEWAL,
  EXPIRED: CERTIFICATE_SERVICE_STATUS_LABELS.EXPIRED,
};

/** 纯函数：根据服务截止日期推导证书服务状态，供前端/后端共用同一套计算口径。 */
export function deriveCertificateServiceStatus(
  expiresAt: string | Date,
  now: Date = new Date(),
): CertificateServiceStatus {
  const expiry = new Date(expiresAt).getTime();
  const nowMs = now.getTime();
  if (nowMs > expiry) return 'EXPIRED';
  const renewalWindowStart = expiry - CERTIFICATE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (nowMs >= renewalWindowStart) return 'PENDING_RENEWAL';
  return 'ACTIVE';
}

/** 某条代理信息的历史证书生成记录（仅归档成功的），供列表页"查看证书"弹窗展示 + 下载。 */
export interface CertificateRecord {
  id: string;
  agentInfoId: string;
  agreementNumber: string;
  fileUrl: string | null;
  createdAt: string;
}

/** 客户列表行中，某一条代理信息的摘要（展开子表格用），支持针对该条代理信息单独发起操作（如查看证书）。 */
export interface AgentInfoSummary {
  id: string;
  country: AgentCountry;
  agentCompany: AgentCompany;
  expectedEffectiveDate: string;
  expiresAt: string;
  agentYears: number;
  shopCount: number;
  certificateStatus: CertificateStatus;
  certificateError: string | null;
  /** 仅当 certificateStatus === 'SUCCESS' 时由后端计算返回，其余状态为 null，由前端展示生成流程状态。 */
  serviceStatus: CertificateServiceStatus | null;
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
