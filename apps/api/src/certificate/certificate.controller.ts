import { Controller, Get, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Queue } from 'bullmq';
import { CertificateService } from './certificate.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  CERTIFICATE_GENERATE_QUEUE,
  type CertificateGenerateJobData,
} from '../queue/queue.constants';

/**
 * `docs/certificate-generation-design.md` 异步生成方案：`AgentInfo` 已关联 `Client`，无需再嵌
 * `clientId` 路径。生成改为"入队即返回"，实际生成由 `CertificateProcessor`（BullMQ Worker）消费；
 * 本 controller 只负责手动重试入队、状态/历史查询、按已落盘文件下载。
 */
@Controller('agent-infos')
export class CertificateController {
  constructor(
    private readonly certificateService: CertificateService,
    private readonly prisma: PrismaService,
    @Inject(CERTIFICATE_GENERATE_QUEUE) private readonly queue: Queue<CertificateGenerateJobData>,
  ) {}

  /** 手动触发/重试生成：置 PENDING 并入队，立即返回，不等待生成结果。 */
  @Post(':agentInfoId/certificate')
  async generate(
    @Param('agentInfoId') agentInfoId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const agentInfo = await this.prisma.agentInfo.findUnique({ where: { id: agentInfoId } });
    if (!agentInfo) {
      throw new NotFoundException('代理信息不存在');
    }
    await this.prisma.agentInfo.update({
      where: { id: agentInfoId },
      data: { certificateStatus: 'PENDING', certificateError: null },
    });
    await this.queue.add('generate', { agentInfoId, actorId: user.id });
    return { certificateStatus: 'PENDING' };
  }

  /** 某条代理信息的历史成功生成记录，供列表页"查看证书"弹窗展示 + 下载。 */
  @Get(':agentInfoId/certificates')
  async listHistory(@Param('agentInfoId') agentInfoId: string) {
    return this.certificateService.listHistory(agentInfoId);
  }

  /** 按已落盘文件直接下载，不触发重新生成。 */
  @Get('certificates/:certificateId/download')
  async download(@Param('certificateId') certificateId: string, @Res() res: Response) {
    const { filePath, fileName } = await this.certificateService.getFileForDownload(certificateId);
    res.download(filePath, fileName);
  }
}
