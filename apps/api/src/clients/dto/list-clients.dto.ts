import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ClientStatus, ClientType } from '@prisma/client';

export class ListClientsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;

  @IsOptional() @IsString() keyword?: string;

  @IsOptional() @IsEnum(ClientType) clientType?: ClientType;

  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
}
