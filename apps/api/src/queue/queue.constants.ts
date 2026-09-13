/** BullMQ 队列名称，见 docs/client-batch-import-design.md 第 3/6 节。 */
export const CLIENT_IMPORT_QUEUE_NAME = 'client-import';

/** IORedis 连接实例的注入 token（生产者/Worker 共用同一连接配置）。 */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION');

/** 批量导入 BullMQ Queue（生产者）的注入 token；Worker 侧另建 `client-import.processor.ts` 消费。 */
export const CLIENT_IMPORT_QUEUE = Symbol('CLIENT_IMPORT_QUEUE');

/** 批量导入任务 payload：只带 jobId + 临时文件路径，具体数据从 DB 查询，避免队列消息过大。 */
export interface ClientImportJobData {
  jobId: string;
  zipFilePath: string;
}

/** 代理证书后台生成 BullMQ 队列名称，见 docs/certificate-generation-design.md 异步生成方案。 */
export const CERTIFICATE_GENERATE_QUEUE_NAME = 'certificate-generate';

/** 证书生成 BullMQ Queue（生产者）的注入 token；Worker 侧见 certificate.processor.ts 消费。 */
export const CERTIFICATE_GENERATE_QUEUE = Symbol('CERTIFICATE_GENERATE_QUEUE');

/** 证书生成任务 payload：只带 agentInfoId + 触发人 id，具体数据从 DB 查询。 */
export interface CertificateGenerateJobData {
  agentInfoId: string;
  actorId: string;
}
