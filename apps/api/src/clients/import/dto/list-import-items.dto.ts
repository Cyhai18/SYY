import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ImportItemStatus } from '@prisma/client';

export class ListImportItemsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 100;

  @IsOptional() @IsEnum(ImportItemStatus) status?: ImportItemStatus;
}
