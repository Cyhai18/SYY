import type {
  AgentCountry,
  ClientDetail,
  ClientListItem,
  ClientPayload,
  ClientStatus,
  ClientType,
} from '@funtax/shared';
import { apiClient } from './api-client';

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

  /** 生成证书 PDF，见 docs/certificate-generation-design.md */
  generateCertificate: (agentInfoId: string) =>
    apiClient.postBinary(`/agent-infos/${agentInfoId}/certificate`),
};
