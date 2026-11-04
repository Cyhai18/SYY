import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { SmsCodeService } from '../sms/sms-code.service';
import { ActionLogService } from '../common/action-log/action-log.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { SendCodeDto } from './dto/send-code.dto';
import { hashToken } from './token.util';
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } from './jwt.constants';
import type { AuthenticatedUser } from './types/authenticated-user';
import { isUniqueConstraintError } from '../common/prisma-error.util';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smsCodeService: SmsCodeService,
    private readonly actionLogService: ActionLogService,
  ) {}

  async sendCode(dto: SendCodeDto): Promise<void> {
    await this.smsCodeService.sendCode(dto.scene, dto.phone);
  }

  async register(dto: RegisterDto, meta: RequestMeta) {
    this.smsCodeService.verify('register', dto.phone, dto.code);

    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      throw new BadRequestException('该手机号已注册');
    }

    const password = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
    let user;
    try {
      user = await this.prisma.user.create({
        data: { phone: dto.phone, password },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException('该手机号已注册');
      }
      throw error;
    }

    return this.finishAuth(user, 'REGISTER', meta);
  }

  /**
   * 登录：密码路径要求账号已存在；验证码路径在验码通过后，未注册手机号自动建号（与独立注册页并存）。
   * 自动注册不设 password，用户可之后在个人中心设置。
   */
  async login(dto: LoginDto, meta: RequestMeta) {
    // 与历史一致：同时带 code+password 时走验证码（前端只会传一种）
    if (dto.code) {
      return this.loginWithSmsCode(dto.phone, dto.code, meta);
    }
    if (dto.password) {
      return this.loginWithPassword(dto.phone, dto.password, meta);
    }
    throw new BadRequestException('请提供验证码或密码');
  }

  private async loginWithPassword(phone: string, password: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('手机号或密码不正确');
    }
    this.assertUserActive(user.status);
    return this.finishAuth(user, 'LOGIN', meta);
  }

  private async loginWithSmsCode(phone: string, code: string, meta: RequestMeta) {
    // 先验码再查/建用户，避免错误验证码刷出幽灵账号
    this.smsCodeService.verify('login', phone, code);

    let user = await this.prisma.user.findUnique({ where: { phone } });
    let isNew = false;
    if (!user) {
      try {
        user = await this.prisma.user.create({ data: { phone } });
        isNew = true;
      } catch (error) {
        // 并发首次登录同一手机号：另一请求已建号，改为走已有用户
        if (isUniqueConstraintError(error)) {
          user = await this.prisma.user.findUnique({ where: { phone } });
          if (!user) throw error;
        } else {
          throw error;
        }
      }
    }

    this.assertUserActive(user.status);
    return this.finishAuth(user, isNew ? 'REGISTER' : 'LOGIN', meta);
  }

  private assertUserActive(status: number) {
    if (status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }
  }

  private async finishAuth(
    user: {
      id: string;
      phone: string;
      email: string | null;
      nickname: string;
      avatarUrl: string | null;
      role: AuthenticatedUser['role'];
    },
    action: 'LOGIN' | 'REGISTER',
    meta: RequestMeta,
  ) {
    await this.actionLogService.record({
      userId: user.id,
      action,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const tokens = await this.issueTokenPair(user);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(rawRefreshToken: string | undefined): Promise<TokenPair> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('未登录');
    }
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(rawRefreshToken, {
        secret: JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (
      !record ||
      record.revokedAt ||
      record.expiresAt < new Date() ||
      record.userId !== payload.sub
    ) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }

    // 撤销旧 Refresh Token，签发新的一对（滚动刷新，降低重放风险）
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokenPair(user);
  }

  async logout(
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
    userId?: string,
  ): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await this.prisma.refreshToken
        .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
    }
    await this.actionLogService.record({
      userId,
      action: 'LOGOUT',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async issueTokenPair(user: {
    id: string;
    phone: string;
    role: AuthenticatedUser['role'];
  }): Promise<TokenPair> {
    const payload = { sub: user.id, phone: user.phone, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: JWT_ACCESS_SECRET,
      expiresIn: '2h',
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  private toPublicUser(user: {
    id: string;
    phone: string;
    email: string | null;
    nickname: string;
    avatarUrl: string | null;
    role: AuthenticatedUser['role'];
  }) {
    const { id, phone, email, nickname, avatarUrl, role } = user;
    return { id, phone, email, nickname, avatarUrl, role };
  }
}
