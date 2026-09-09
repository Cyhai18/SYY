import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ImportJobStatus } from '@prisma/client';

export class ListImportJobsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;

  @IsOptional() @IsEnum(ImportJobStatus) status?: ImportJobStatus;
}
