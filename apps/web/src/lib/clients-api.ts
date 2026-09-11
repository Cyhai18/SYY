import type {
  AgentCountry,
  AgentInfoPayload,
  ClientDetail,
  ClientListItem,
  ClientPayload,
  ClientStatus,
  ClientType,
  CompanyInfoPayload,
  DuplicateCheckResult,
  LegalRepresentativePayload,
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

export interface ListClientsParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  clientType?: ClientType;
  status?: ClientStatus;
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
  if (params.status) query.set('status', params.status);
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

  /** onBlur + 防抖触发的实时查重：命中已存在客户时返回其基本信息 + 已有代理信息组合，用于前端切换到追加模式。 */
  checkDuplicate: (creditCode: string) =>
    apiClient.get<{ exists: boolean; client: DuplicateCheckResult | null }>(
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

  /** 生成证书 PDF，见 docs/certificate-generation-design.md */
  generateCertificate: (agentInfoId: string) =>
    apiClient.postBinary(`/agent-infos/${agentInfoId}/certificate`),
};
