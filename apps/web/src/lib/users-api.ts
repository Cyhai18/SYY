import { apiClient } from './api-client';

/** 客户列表「录入账户」筛选项下拉用。 */
export interface UserOption {
  id: string;
  nickname: string;
  phone: string;
}

export interface ListUserOptionsParams {
  page?: number;
  pageSize?: number;
  /** 按昵称或手机号模糊匹配 */
  keyword?: string;
}

export interface ListUserOptionsResult {
  total: number;
  page: number;
  pageSize: number;
  items: UserOption[];
}

function buildQuery(params: ListUserOptionsParams): string {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.keyword) query.set('keyword', params.keyword);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export const usersApi = {
  /** 仅 ADMIN/SUPERADMIN 可调用；普通用户会被后端 403。支持关键词 + 分页。 */
  listOptions: (params: ListUserOptionsParams = {}) =>
    apiClient.get<ListUserOptionsResult>(`/users/options${buildQuery(params)}`),
};
