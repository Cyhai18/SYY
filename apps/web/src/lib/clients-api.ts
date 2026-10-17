import type {
  AgentCompany,
  AgentCountry,
  AgentInfoPayload,
  CertificateRecord,
  CertificateStatus,
  CertificateStatusFilter,
  ClientDetail,
  ClientListItem,
  ClientPayload,
  ClientType,
  CompanyInfoPayload,
  DuplicateCheckResult,
  LegalRepresentativePayload,
  ShopPayload,
} from '@funtax/shared';
import { apiClient } from './api-client';

/** 追加代理信息接口的负载：主体/法人信息中的统一信用代码/身份证号即便传了也会被后端忽略。 */
export interface AppendAgentInfoPayload {
  email: string;
  remark?: string;
  companyInfo: CompanyInfoPayload;
  legalRepInfo?: LegalRepresentativePayload;
  agentInfos: AgentInfoPayload[];
}

/** 编辑客户基础信息负载：`uniqueIdentifier`/`clientType` 锁定不可变更，不在此结构内。 */
export interface UpdateClientPayload {
  email?: string;
  remark?: string;
  companyInfo?: CompanyInfoPayload;
  legalRepInfo?: LegalRepresentativePayload;
}

/** 编辑代理信息负载：`country` 锁定不可变更；shops 整体替换，不支持增量增删单条店铺。 */
export interface UpdateAgentInfoPayload {
  expectedEffectiveDate: string;
  agentYears: number;
  agentCompany: AgentCompany;
  shops: ShopPayload[];
}

export interface ListClientsParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  clientType?: ClientType;
  certificateStatus?: CertificateStatusFilter;
  agentCountry?: AgentCountry;
  /** 提交日期区间，格式 YYYY-MM-DD */
  submittedFrom?: string;
  submittedTo?: string;
}

export interface ListClientsResult {
  total: number;
  page: number;
  pageSize: number;
  items: ClientListItem[];
}

function buildQuery(params: ListClientsParams): string {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.clientType) query.set('clientType', params.clientType);
  if (params.certificateStatus) query.set('certificateStatus', params.certificateStatus);
  if (params.agentCountry) query.set('agentCountry', params.agentCountry);
  if (params.submittedFrom) query.set('submittedFrom', params.submittedFrom);
  if (params.submittedTo) query.set('submittedTo', params.submittedTo);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export const clientsApi = {
  list: (params: ListClientsParams = {}) =>
    apiClient.get<ListClientsResult>(`/clients${buildQuery(params)}`),

  /** 提交改为 multipart：文字字段 JSON 序列化后放入 `payload` 字段，证件图片随行携带，见 client-batch-import-design.md 第 5.2 节。 */
  create: (
    payload: ClientPayload,
    files?: {
      businessLicenseFile?: File | null;
      idCardFrontFile?: File | null;
      idCardBackFile?: File | null;
    },
  ) => {
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    if (files?.businessLicenseFile) {
      formData.append('businessLicenseFile', files.businessLicenseFile);
    }
    if (files?.idCardFrontFile) {
      formData.append('idCardFrontFile', files.idCardFrontFile);
    }
    if (files?.idCardBackFile) {
      formData.append('idCardBackFile', files.idCardBackFile);
    }
    return apiClient.postMultipart<ClientDetail>('/clients', formData);
  },

  get: (id: string) => apiClient.get<ClientDetail>(`/clients/${id}`),

  /** 编辑客户基础信息：邮箱/备注/公司信息/法人信息，`uniqueIdentifier`/`clientType` 锁定不可变更。 */
  update: (id: string, payload: UpdateClientPayload) =>
    apiClient.patch<ClientDetail>(`/clients/${id}`, payload),

  /** 编辑代理信息：`country` 锁定不可变更，代理公司/年限/生效日期/店铺可编辑，保存不触发重新生成证书。 */
  updateAgentInfo: (clientId: string, agentInfoId: string, payload: UpdateAgentInfoPayload) =>
    apiClient.patch<ClientDetail>(`/clients/${clientId}/agent-infos/${agentInfoId}`, payload),

  /**
   * 证件 OCR 识别成功后触发的查重：命中已存在客户时返回其 companyInfo/legalRepInfo，用于前端回填表单并切换到追加模式。
   * `owned: false` 表示命中的客户存在但归属于其他用户，此时 `client` 恒为 `null`，前端应阻断流程、禁止继续新增/修改。
   */
  checkDuplicate: (creditCode: string) =>
    apiClient.get<{ exists: boolean; owned: boolean; client: DuplicateCheckResult | null }>(
      `/clients/duplicate-check?creditCode=${encodeURIComponent(creditCode)}`,
    ),

  /** 老客户追加代理信息：与 create 一样走 multipart，统一信用代码/身份证号即便携带也会被后端忽略。 */
  appendAgentInfo: (
    clientId: string,
    payload: AppendAgentInfoPayload,
    files?: {
      businessLicenseFile?: File | null;
      idCardFrontFile?: File | null;
      idCardBackFile?: File | null;
    },
  ) => {
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    if (files?.businessLicenseFile) {
      formData.append('businessLicenseFile', files.businessLicenseFile);
    }
    if (files?.idCardFrontFile) {
      formData.append('idCardFrontFile', files.idCardFrontFile);
    }
    if (files?.idCardBackFile) {
      formData.append('idCardBackFile', files.idCardBackFile);
    }
    return apiClient.postMultipart<ClientDetail>(`/clients/${clientId}/agent-infos`, formData);
  },

  /**
   * 触发/重试后台生成证书：仅入队，立即返回，不等待/下载生成结果，见 docs/certificate-generation-design.md 异步生成方案。
   * 生成状态体现在 `AgentInfo.certificateStatus`（列表刷新可见），成功后到 `listCertificates` 查历史记录下载。
   */
  generateCertificate: (agentInfoId: string) =>
    apiClient.post<{ certificateStatus: CertificateStatus }>(
      `/agent-infos/${agentInfoId}/certificate`,
    ),

  /**
   * 续费：仅限服务状态为"待续费/失效"的代理信息。新生效日期 = 原截止日期次日，
   * 新截止日期 = 新生效日期 + 原代理年限，更新后立即入队重新生成证书。
   */
  renewCertificate: (agentInfoId: string) =>
    apiClient.post<{ certificateStatus: CertificateStatus }>(`/agent-infos/${agentInfoId}/renew`),

  /** 某条代理信息的历史成功生成记录，供"查看证书"弹窗展示 + 下载。 */
  listCertificates: (agentInfoId: string) =>
    apiClient.get<CertificateRecord[]>(`/agent-infos/${agentInfoId}/certificates`),

  /** 按已落盘文件直接下载，不触发重新生成。 */
  downloadCertificate: (certificateId: string) =>
    apiClient.getBinary(`/agent-infos/certificates/${certificateId}/download`),

  /** 导出客户列表为 Excel，筛选口径与 `list` 一致（分页参数不生效，后端按 5000 条上限阻断）。 */
  exportClients: (params: Omit<ListClientsParams, 'page' | 'pageSize'> = {}) =>
    apiClient.getBinary(`/clients/export${buildQuery(params)}`),

  /**
   * 按当前筛选范围把代理证书打包成 ZIP 下载，筛选口径与 `list`/`exportClients` 一致。
   * 超过 500 份时后端不报错，取前 500 份打包，并通过返回值 `truncated` 告知调用方弹提示。
   */
  exportCertificatesZip: (params: Omit<ListClientsParams, 'page' | 'pageSize'> = {}) =>
    apiClient.getBinary(`/clients/export-certificates${buildQuery(params)}`),
};
