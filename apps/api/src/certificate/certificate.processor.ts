import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateService } from './certificate.service';
import {
  CERTIFICATE_GENERATE_QUEUE_NAME,
  REDIS_CONNECTION,
  type CertificateGenerateJobData,
} from '../queue/queue.constants';

/**
 * 代理证书后台生成 BullMQ Worker：新增客户 / 追加代理信息成功后自动入队，
 * 也供列表页失败重试时手动入队消费，见 docs/certificate-generation-design.md 异步生成方案。
 * 状态机全部落在 `AgentInfo.certificateStatus`：入队时置 PENDING（生产者侧）->
 * 本 Worker 开始处理置 GENERATING -> 成功置 SUCCESS 并清空 certificateError ->
 * 失败置 FAILED 并记录 certificateError，不影响 `Certificate` 归档表语义。
 */
@Injectable()
export class CertificateProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CertificateProcessor.name);
  private worker?: Worker<CertificateGenerateJobData>;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    private readonly prisma: PrismaService,
    private readonly certificateService: CertificateService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<CertificateGenerateJobData>(
      CERTIFICATE_GENERATE_QUEUE_NAME,
      (job) => this.handle(job),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`证书生成任务失败 agentInfoId=${job?.data.agentInfoId} err=${String(err)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handle(job: Job<CertificateGenerateJobData>): Promise<void> {
    const { agentInfoId, actorId } = job.data;

    await this.prisma.agentInfo.update({
      where: { id: agentInfoId },
      data: { certificateStatus: 'GENERATING' },
    });

    try {
      await this.certificateService.generate(agentInfoId, actorId, {});
      await this.prisma.agentInfo.update({
        where: { id: agentInfoId },
        data: { certificateStatus: 'SUCCESS', certificateError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.agentInfo.update({
        where: { id: agentInfoId },
        data: { certificateStatus: 'FAILED', certificateError: message },
      });
      throw err;
    }
  }
}
