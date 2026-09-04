import { Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CertificateService } from './certificate.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReqMeta } from '../common/decorators/request-meta.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import type { RequestMeta } from '../auth/auth.service';

/** `docs/certificate-generation-design.md` 第六节：`AgentInfo` 已关联 `Client`，无需再嵌 `clientId` 路径。 */
@Controller('agent-infos')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Post(':agentInfoId/certificate')
  async generate(
    @Param('agentInfoId') agentInfoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const { fileName, buffer } = await this.certificateService.generate(agentInfoId, user, meta);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    res.send(buffer);
  }
}
