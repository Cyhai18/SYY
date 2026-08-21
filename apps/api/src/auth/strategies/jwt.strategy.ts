import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JWT_ACCESS_SECRET } from '../jwt.constants';
import type { AuthenticatedUser } from '../types/authenticated-user';

interface JwtPayload {
  sub: string;
}

/** 校验 Access Token（Authorization: Bearer），每次都查库确认用户仍有效，防止角色变更/封禁后旧 Token 仍可用。 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 1) {
      throw new UnauthorizedException('账号不可用');
    }
    return { id: user.id, phone: user.phone, role: user.role };
  }
}
