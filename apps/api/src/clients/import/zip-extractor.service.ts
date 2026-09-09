import { Injectable, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ExtractedXlsxFile {
  /** ZIP 内的原始文件名（不含目录路径），如“张三.xlsx”，用于 `ClientImportItem.fileName` 展示 */
  fileName: string;
  /** 解压后落盘的实际磁盘路径，供 `ExcelParserService` 读取 */
  filePath: string;
}

export interface ExtractResult {
  /** 本批次的临时解压目录，处理完成（无论成功/失败）需调用 `cleanup` 统一清理 */
  extractDir: string;
  files: ExtractedXlsxFile[];
  /** 被跳过的文件数量（非 .xlsx、隐藏/系统文件），仅计数不阻断流程 */
  ignoredCount: number;
}

/** 跳过 macOS 压缩包附带的系统文件/隐藏文件，见 docs/client-batch-import-design.md 第 2 节 */
const IGNORED_PATTERNS = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)\./];

/**
 * ZIP 解压 + 文件名过滤：仅保留 `.xlsx`，跳过隐藏/系统文件，不因个别无效条目报错阻断整批。
 * 见 docs/client-batch-import-design.md 第 6 节模块结构 / 第 6.2 节 Worker 处理流程第 1 步。
 */
@Injectable()
export class ZipExtractorService {
  private readonly logger = new Logger(ZipExtractorService.name);

  /**
   * @param zipFilePath 已落盘的临时 ZIP 文件路径
   * @param jobId 用于隔离每个批次的临时解压目录，避免并发批次互相覆盖
   */
  extract(zipFilePath: string, jobId: string): ExtractResult {
    const extractDir = join(tmpdir(), `client-import-${jobId}`);
    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();
    const files: ExtractedXlsxFile[] = [];
    let ignoredCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }
      const entryName = entry.entryName;
      if (this.shouldIgnore(entryName) || !entryName.toLowerCase().endsWith('.xlsx')) {
        ignoredCount += 1;
        continue;
      }

      const fileName = entryName.split('/').pop() ?? entryName;
      // 同名文件（可能来自 ZIP 内不同子目录）追加序号，避免解压时互相覆盖
      const safeFileName = files.some((f) => f.fileName === fileName)
        ? `${files.length}-${fileName}`
        : fileName;
      zip.extractEntryTo(entry, extractDir, false, true, false, safeFileName);
      files.push({ fileName, filePath: join(extractDir, safeFileName) });
    }

    this.logger.log(
      `ZIP 解压完成 jobId=${jobId}: ${files.length} 个有效 .xlsx，忽略 ${ignoredCount} 个文件`,
    );
    return { extractDir, files, ignoredCount };
  }

  /** 处理完成（无论成功/失败）统一清理临时解压目录，避免磁盘堆积 */
  cleanup(extractDir: string): void {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`清理临时解压目录失败: ${extractDir} err=${String(err)}`);
    }
  }

  private shouldIgnore(entryName: string): boolean {
    return IGNORED_PATTERNS.some((pattern) => pattern.test(entryName));
  }
}
