import type { BusinessLicenseFields, IdCardFields, OcrResult } from '@funtax/shared';
import { useAuthStore } from '../store/auth-store';

export type { BusinessLicenseFields, IdCardFields, OcrResult };

/** OCR 上传走独立的 multipart 请求（不复用 JSON 的 apiClient），沿用相同的鉴权 Header。 */
async function uploadFile<T>(
  path: string,
  file: File,
  signal?: AbortSignal,
): Promise<OcrResult<T>> {
  const formData = new FormData();
  formData.append('file', file);
  const accessToken = useAuthStore.getState().accessToken;
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: formData,
    signal,
  });
  if (!response.ok) {
    throw new Error(`OCR 识别失败: HTTP ${response.status}`);
  }
  return (await response.json()) as OcrResult<T>;
}

export const ocrApi = {
  recognizeBusinessLicense: (file: File, signal?: AbortSignal) =>
    uploadFile<BusinessLicenseFields>('/ocr/business-license', file, signal),

  recognizeIdCard: (file: File, side: 'front' | 'back', signal?: AbortSignal) =>
    uploadFile<IdCardFields>(`/ocr/id-card?side=${side}`, file, signal),
};
