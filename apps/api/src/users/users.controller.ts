import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqMeta } from '../common/decorators/request-meta.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type { RequestMeta } from '../auth/auth.service';
import { ListUserOptionsDto } from './dto/list-user-options.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePhoneDto } from './dto/update-phone.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  /**
   * 客户列表「录入账户」筛选项：仅 ADMIN/SUPERADMIN 可访问。
   * 支持 keyword（昵称/手机号）+ page/pageSize，供前端远程搜索与滚动加载。
   * 必须声明在动态路由之前（当前模块无 `:id`，但仍保持语义清晰的静态路径）。
   */
  @Get('options')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async listOptions(@Query() query: ListUserOptionsDto) {
    return this.usersService.listOptions(query);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.usersService.updateProfile(user.id, dto, meta);
  }

  @Patch('me/phone')
  async updatePhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePhoneDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.usersService.updatePhone(user.id, dto, meta);
  }

  @Patch('me/password')
  async updatePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.usersService.updatePassword(user.id, dto, meta);
  }
}
