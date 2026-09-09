import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { CLIENT_IMPORT_QUEUE, CLIENT_IMPORT_QUEUE_NAME, REDIS_CONNECTION } from './queue.constants';

/**
 * BullMQ + Redis 基础设施模块（见 docs/client-batch-import-design.md 第 12/13 节）。
 * 本地开发需要一个可用的 Redis 实例，见根 README.md「本地依赖」一节；
 * 连接地址由 `REDIS_URL` 配置，默认 `redis://127.0.0.1:6379`。
 *
 * 声明为 @Global，供批量导入的 controller（生产者，入队）和后续 Worker（消费者，
 * 见 client-import.processor.ts）共用同一份连接与 Queue 实例，避免重复创建连接。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      useFactory: (): IORedis => {
        const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
        // BullMQ 要求阻塞命令的连接必须关闭 maxRetriesPerRequest，否则会抛出异常。
        return new IORedis(url, { maxRetriesPerRequest: null });
      },
    },
    {
      provide: CLIENT_IMPORT_QUEUE,
      useFactory: (connection: IORedis): Queue =>
        new Queue(CLIENT_IMPORT_QUEUE_NAME, { connection }),
      inject: [REDIS_CONNECTION],
    },
  ],
  exports: [REDIS_CONNECTION, CLIENT_IMPORT_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: IORedis,
    @Inject(CLIENT_IMPORT_QUEUE) private readonly clientImportQueue: Queue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.clientImportQueue.close();
    this.connection.disconnect();
    this.logger.log('QueueModule: Redis connection closed');
  }
}
