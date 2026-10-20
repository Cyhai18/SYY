import 'dotenv/config';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  // 前端统一以 /api 为前缀请求（Vite 代理也只转发 /api），根路径 `/` 保留给健康探活/欢迎信息，不加前缀。
  app.setGlobalPrefix('api', { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  // 生产环境必须通过 CORS_ORIGIN 显式配置正式域名（逗号分隔支持多个），不能沿用本地开发的
  // localhost 白名单，否则要么线上跨域请求被拒，要么被误改成 `*` 导致任意来源可带凭证访问。
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (isProd && (!corsOrigin || corsOrigin.length === 0)) {
    throw new Error('生产环境必须配置 CORS_ORIGIN 环境变量（允许访问的正式域名，逗号分隔）。');
  }
  app.enableCors({
    origin: corsOrigin ?? ['http://localhost:5173'],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
