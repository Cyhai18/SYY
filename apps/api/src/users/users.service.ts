import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SmsCodeService } from '../sms/sms-code.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import type { RequestMeta } from '../auth/auth.service';
import { isUniqueConstraintError } from '../common/prisma-error.util';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { UpdatePhoneDto } from './dto/update-phone.dto';
import type { UpdatePasswordDto } from './dto/update-password.dto';

/** 个人中心：获取当前用户信息、修改昵称/邮箱/手机号/密码。 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly smsCodeService: SmsCodeService,
    private readonly actionLogService: ActionLogService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, meta: RequestMeta) {
    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== userId) {
        throw new BadRequestException('该邮箱已被使用');
      }
    }
    let user;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { nickname: dto.nickname, email: dto.email },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException('该邮箱已被使用');
      }
      throw error;
    }
    await this.actionLogService.record({
      userId,
      action: 'UPDATE_PROFILE',
      detail: JSON.stringify(dto),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.toPublicUser(user);
  }

  async updatePhone(userId: string, dto: UpdatePhoneDto, meta: RequestMeta) {
    this.smsCodeService.verify('bind-phone', dto.phone, dto.code);
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing && existing.id !== userId) {
      throw new BadRequestException('该手机号已被使用');
    }
    let user;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { phone: dto.phone },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException('该手机号已被使用');
      }
      throw error;
    }
    await this.actionLogService.record({
      userId,
      action: 'UPDATE_PHONE',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.toPublicUser(user);
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    if (user.password) {
      if (!dto.oldPassword || !(await bcrypt.compare(dto.oldPassword, user.password))) {
        throw new UnauthorizedException('原密码不正确');
      }
    }
    const password = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password } });
    await this.actionLogService.record({
      userId,
      action: 'UPDATE_PASSWORD',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { success: true as const };
  }

  private toPublicUser(user: {
    id: string;
    phone: string;
    email: string | null;
    nickname: string;
    avatarUrl: string | null;
    role: import('@prisma/client').Role;
  }) {
    const { id, phone, email, nickname, avatarUrl, role } = user;
    return { id, phone, email, nickname, avatarUrl, role };
  }
}
