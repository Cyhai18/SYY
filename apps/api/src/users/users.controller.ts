import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqMeta } from '../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type { RequestMeta } from '../auth/auth.service';
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
