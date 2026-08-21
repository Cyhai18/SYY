import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { RequestContext } from '../context/request-context';

const isProd = process.env.NODE_ENV === 'production';

/**
 * 应用运行日志（技术视角，非业务审计）。结构化 JSON 输出到 stdout，
 * 开发环境用 pino-pretty 便于阅读；生产环境交给容器平台采集（如 K8s + Loki）。
 * 每条日志自动带 requestId/userId，与 ActionLog 用同一个 requestId 串联，见
 * docs/auth-profile-plan.md 第 7 节。
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
        autoLogging: true,
        transport: isProd
          ? undefined
          : {
              target: 'pino-pretty',
              options: { colorize: true, singleLine: true },
            },
        customProps: () => {
          const ctx = RequestContext.get();
          return {
            requestId: ctx?.requestId,
            userId: ctx?.userId,
          };
        },
        // 敏感字段脱敏：密码/验证码/token 不进日志
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.code',
            'req.body.oldPassword',
            'req.body.newPassword',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggingModule {}
