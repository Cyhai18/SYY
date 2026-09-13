import type { AttachmentType } from '@prisma/client';

/**
 * 存储服务抽象，沿用 `SmsService`/`OcrProvider` 的"接口 + DI token 可替换 Provider"套路，
 * 见 docs/client-batch-import-design.md 第 5 节。初期唯一实现是本地磁盘（`LocalDiskProvider`），
 * 后续若要换对象存储（OSS/S3），只需新增一个 Provider 实现同一接口，业务代码不用改。
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface SaveFileParams {
  clientId: string;
  type: AttachmentType;
  buffer: Buffer;
  mimetype: string;
  originalName: string;
}

export interface SaveFileResult {
  /** 相对路径，落库到 `Attachment.fileUrl`，不含存储根目录前缀 */
  fileUrl: string;
}

export interface ReadFileResult {
  buffer: Buffer;
  mimetype?: string;
}

export interface FileStorageService {
  save(params: SaveFileParams): Promise<SaveFileResult>;
  /** 供鉴权下载接口按 `fileUrl` 读取原始文件内容 */
  read(fileUrl: string): Promise<ReadFileResult>;
  /** 覆盖上传（如重新上传营业执照）后清理旧文件，删除失败只记 warning，不阻断主流程 */
  delete(fileUrl: string): Promise<void>;
}
