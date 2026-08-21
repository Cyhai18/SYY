import { Prisma } from '@prisma/client';

/**
 * 判断是否为 Prisma 唯一约束冲突（P2002）。
 * 用于把并发写入触发的数据库唯一键冲突转换成用户友好的 400 提示，
 * 而不是让 AllExceptionsFilter 兜底成不透明的 500。
 */
export function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
