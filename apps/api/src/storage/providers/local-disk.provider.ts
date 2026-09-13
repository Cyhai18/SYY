import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join, sep } from 'path';
import type {
  FileStorageService,
  ReadFileResult,
  SaveFileParams,
  SaveFileResult,
} from '../file-storage.service';

/** 落盘根目录，可用 `UPLOAD_DIR` 环境变量覆盖；未配置时落在 `apps/api/uploads/attachments`。 */
const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'attachments');

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 初期唯一 Provider：落盘到本地磁盘，按 clientId 分目录，见 client-batch-import-design.md 5.1 节。 */
@Injectable()
export class LocalDiskProvider implements FileStorageService {
  private readonly logger = new Logger(LocalDiskProvider.name);

  async save({ clientId, type, buffer, originalName }: SaveFileParams): Promise<SaveFileResult> {
    const ext = extname(originalName) || '.jpg';
    const fileName = `${type}-${randomUUID()}${ext}`;
    const relativePath = join('clients', clientId, fileName);
    const absoluteDir = join(UPLOAD_ROOT, 'clients', clientId);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(join(absoluteDir, fileName), buffer);
    // 统一用 posix 分隔符落库，避免跨平台路径不一致
    return { fileUrl: relativePath.split(sep).join('/') };
  }

  async read(fileUrl: string): Promise<ReadFileResult> {
    const absolutePath = join(UPLOAD_ROOT, ...fileUrl.split('/'));
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('文件不存在');
    }
    const buffer = await readFile(absolutePath);
    const ext = extname(absolutePath).toLowerCase();
    return { buffer, mimetype: MIME_BY_EXT[ext] };
  }

  async delete(fileUrl: string): Promise<void> {
    const absolutePath = join(UPLOAD_ROOT, ...fileUrl.split('/'));
    try {
      await unlink(absolutePath);
    } catch (err) {
      // 文件已不存在或删除失败都不影响主流程，只记 warning
      this.logger.warn(`旧附件删除失败：${absolutePath} err=${String(err)}`);
    }
  }
}
