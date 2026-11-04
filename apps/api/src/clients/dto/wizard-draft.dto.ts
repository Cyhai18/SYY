import { IsObject } from 'class-validator';

/**
 * 向导草稿保存体：只做「是对象」校验，不做建档强校验。
 * 半成品字段（缺 phone/agentInfos 等）必须能存，否则「临时保存」无意义。
 * 证件 File 不进草稿（选填，正式提交时再带）。
 */
export class SaveWizardDraftDto {
  @IsObject({ message: 'payload 必须是对象' })
  payload!: Record<string, unknown>;
}
