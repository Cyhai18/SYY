import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7 要求显式传入 driver adapter；MySQL/MariaDB 均可复用 `@prisma/adapter-mariadb`，
    // 直接把 DATABASE_URL 交给它解析即可（`mysql://` 会被内部改写为 `mariadb://`）。
    super({ adapter: new PrismaMariaDb(process.env.DATABASE_URL ?? '') });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
