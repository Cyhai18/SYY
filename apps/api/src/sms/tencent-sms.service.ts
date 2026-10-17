import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import type { SmsService } from './sms.service';

const ENDPOINT = 'sms.tencentcloudapi.com';
const SERVICE = 'sms';
const ACTION = 'SendSms';
const VERSION = '2021-01-11';

/**
 * 腾讯云短信（SMS）Provider，通过云 API 3.0（TC3-HMAC-SHA256 签名）直接调用
 * `SendSms` 接口，不依赖官方 SDK（避免引入额外重量级依赖，签名算法见
 * https://cloud.tencent.com/document/product/382/55981）。
 *
 * 所需环境变量（见 apps/api/.env.example）：
 * - TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY：腾讯云 API 密钥
 * - TENCENT_SMS_SDK_APP_ID：短信应用 SdkAppId
 * - TENCENT_SMS_SIGN_NAME：短信签名（审核通过后的签名内容）
 * - TENCENT_SMS_TEMPLATE_ID：短信模板 ID（模板内容形如"您的验证码为{1}，1分钟内有效"）
 * - TENCENT_SMS_REGION：地域，默认 ap-guangzhou
 */
@Injectable()
export class TencentSmsService implements SmsService {
  private readonly logger = new Logger(TencentSmsService.name);

  private readonly secretId = process.env.TENCENT_SMS_SECRET_ID ?? '';
  private readonly secretKey = process.env.TENCENT_SMS_SECRET_KEY ?? '';
  private readonly sdkAppId = process.env.TENCENT_SMS_SDK_APP_ID ?? '';
  private readonly signName = process.env.TENCENT_SMS_SIGN_NAME ?? '';
  private readonly templateId = process.env.TENCENT_SMS_TEMPLATE_ID ?? '';
  private readonly region = process.env.TENCENT_SMS_REGION ?? 'ap-guangzhou';

  async send(phone: string, code: string): Promise<void> {
    const payload = JSON.stringify({
      PhoneNumberSet: [this.toE164(phone)],
      SmsSdkAppId: this.sdkAppId,
      SignName: this.signName,
      TemplateId: this.templateId,
      TemplateParamSet: [code],
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = this.buildAuthorization(payload, timestamp);

    let res: Response;
    try {
      res = await fetch(`https://${ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Host: ENDPOINT,
          'X-TC-Action': ACTION,
          'X-TC-Version': VERSION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': this.region,
          Authorization: authorization,
        },
        body: payload,
      });
    } catch (err) {
      this.logger.error(`[SMS] 调用腾讯云短信接口网络异常：${String(err)}`);
      throw new ServiceUnavailableException('短信发送失败，请稍后重试');
    }

    const data = (await res.json()) as {
      Response?: {
        Error?: { Code: string; Message: string };
        SendStatusSet?: { Code: string; Message: string }[];
      };
    };
    const apiError = data.Response?.Error;
    const sendStatus = data.Response?.SendStatusSet?.[0];
    if (apiError) {
      this.logger.error(`[SMS] 腾讯云短信接口报错：${apiError.Code} ${apiError.Message}`);
      throw new ServiceUnavailableException('短信发送失败，请稍后重试');
    }
    if (sendStatus && sendStatus.Code !== 'Ok') {
      this.logger.error(`[SMS] 腾讯云短信发送失败：${sendStatus.Code} ${sendStatus.Message}`);
      throw new ServiceUnavailableException('短信发送失败，请稍后重试');
    }
  }

  /** 腾讯云要求号码带国际区号；默认按中国大陆号码补 +86 前缀。 */
  private toE164(phone: string): string {
    return phone.startsWith('+') ? phone : `+86${phone}`;
  }

  private buildAuthorization(payload: string, timestamp: number): string {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const hashedPayload = sha256Hex(payload);
    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\n` +
      `host:${ENDPOINT}\n` +
      `x-tc-action:${ACTION.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join(
      '\n',
    );

    const credentialScope = `${date}/${SERVICE}/tc3_request`;
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const secretDate = hmac(`TC3${this.secretKey}`, date);
    const secretService = hmac(secretDate, SERVICE);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = hmac(secretSigning, stringToSign).toString('hex');

    return (
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
    );
  }
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}
