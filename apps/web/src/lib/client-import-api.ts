import type { ClientPayload } from '@funtax/shared';
import { apiClient } from './api-client';

export type ImportJobStatus = 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';
export type ImportItemStatus = 'PENDING' | 'OCR_PROCESSING' | 'SUCCESS' | 'NEEDS_REVIEW' | 'FAILED';

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  fileName: string;
  totalCount: number;
  successCount: number;
  reviewCount: number;
  failedCount: number;
  createdById: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface ReviewIssue {
  field: string;
  message: string;
}

export interface ImportItem {
  id: string;
  jobId: string;
  fileName: string;
  status: ImportItemStatus;
  clientId: string | null;
  errorReason: string | null;
  reviewFields: Record<string, unknown> | null;
  reviewIssues: ReviewIssue[] | null;
  createdAt: string;
  updatedAt: string;
}

interface PagedResult<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export const clientImportApi = {
  /** 上传 ZIP，创建导入批次并入队，返回批次记录（初始状态 QUEUED）。 */
  create: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.postMultipart<ImportJob>('/clients/import', formData);
  },

  /** 下载官方批量导入模板（需鉴权，走二进制下载接口，与证书下载同一套逻辑）。 */
  downloadTemplate: () => apiClient.getBinary('/clients/import/template'),

  list: (params: { page?: number; pageSize?: number; status?: ImportJobStatus } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient.get<PagedResult<ImportJob>>(`/clients/import${qs ? `?${qs}` : ''}`);
  },

  get: (jobId: string) => apiClient.get<ImportJob>(`/clients/import/${jobId}`),

  listItems: (
    jobId: string,
    params: { page?: number; pageSize?: number; status?: ImportItemStatus } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    const qs = query.toString();
    return apiClient.get<PagedResult<ImportItem>>(
      `/clients/import/${jobId}/items${qs ? `?${qs}` : ''}`,
    );
  },

  /** 人工核对提交：与单条录入向导相同的 multipart 结构（`payload` JSON + 可选证件图片）。 */
  reviewItem: (
    itemId: string,
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
    return apiClient.patchMultipart<ImportItem>(`/clients/import/items/${itemId}`, formData);
  },
};
