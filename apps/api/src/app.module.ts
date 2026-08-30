import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { LoggingModule } from './common/logging/logging.module';
import { ActionLogModule } from './common/action-log/action-log.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { AllExceptionsFilter } from './common/logging/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './auth/auth.module';
import { SmsModule } from './sms/sms.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { OcrModule } from './ocr/ocr.module';

@Module({
  imports: [
    LoggingModule,
    ActionLogModule,
    PrismaModule,
    PassportModule,
    SmsModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    OcrModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
