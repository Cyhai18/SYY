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

  create: (payload: ClientPayload) => apiClient.post<ClientDetail>('/clients', payload),

  get: (id: string) => apiClient.get<ClientDetail>(`/clients/${id}`),
};
