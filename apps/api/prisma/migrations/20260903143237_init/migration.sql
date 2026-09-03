-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NOT NULL DEFAULT '用户',
    `avatarUrl` VARCHAR(191) NULL,
    `role` ENUM('USER', 'ADMIN', 'SUPERADMIN') NOT NULL DEFAULT 'USER',
    `status` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_phone_key`(`phone`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActionLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `requestId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActionLog_userId_idx`(`userId`),
    INDEX `ActionLog_action_idx`(`action`),
    INDEX `ActionLog_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `clientType` ENUM('COMPANY', 'INDIVIDUAL') NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `remark` TEXT NULL,
    `status` ENUM('PENDING_REVIEW', 'APPROVED', 'DISABLED') NOT NULL DEFAULT 'PENDING_REVIEW',
    `ownerId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Client_ownerId_idx`(`ownerId`),
    INDEX `Client_status_idx`(`status`),
    INDEX `Client_phone_idx`(`phone`),
    INDEX `Client_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyInfo` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `creditCode` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NULL,
    `nameEn` VARCHAR(191) NULL,
    `addressCn` TEXT NULL,
    `provinceEn` VARCHAR(191) NULL,
    `cityEn` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `addressEn` TEXT NULL,

    UNIQUE INDEX `CompanyInfo_clientId_key`(`clientId`),
    INDEX `CompanyInfo_creditCode_idx`(`creditCode`),
    INDEX `CompanyInfo_nameEn_idx`(`nameEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LegalRepresentative` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `nameCn` VARCHAR(191) NOT NULL,
    `namePinyin` VARCHAR(191) NOT NULL,
    `idNumber` VARCHAR(191) NOT NULL,
    `idAddressCn` TEXT NOT NULL,
    `idPostalCode` VARCHAR(191) NULL,
    `idAddressEn` TEXT NULL,

    UNIQUE INDEX `LegalRepresentative_clientId_key`(`clientId`),
    INDEX `LegalRepresentative_idNumber_idx`(`idNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shop` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `platform` ENUM('AMAZON', 'TEMU', 'SHEIN', 'TIKTOK', 'ALIEXPRESS', 'ALIBABA_ICBU', 'FRUUGO', 'OTHER') NOT NULL,
    `shopId` VARCHAR(191) NULL,
    `shopName` VARCHAR(191) NOT NULL,
    `shopUrl` TEXT NOT NULL,
    `brandNames` TEXT NOT NULL,
    `mainCategoryEn` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Shop_clientId_idx`(`clientId`),
    INDEX `Shop_platform_idx`(`platform`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `platform` ENUM('AMAZON', 'TEMU', 'SHEIN', 'TIKTOK', 'ALIEXPRESS', 'ALIBABA_ICBU', 'FRUUGO', 'OTHER') NOT NULL,
    `productNameCn` VARCHAR(191) NOT NULL,
    `productNameEn` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `asinOrSku` VARCHAR(191) NOT NULL,
    `productUrl` TEXT NOT NULL,
    `hasBattery` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Product_shopId_idx`(`shopId`),
    INDEX `Product_clientId_idx`(`clientId`),
    INDEX `Product_asinOrSku_idx`(`asinOrSku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AgentInfo` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `country` ENUM('GB', 'EU', 'US', 'TR', 'CA') NOT NULL,
    `expectedEffectiveDate` DATETIME(3) NOT NULL,
    `agentYears` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `agentCompany` ENUM('OVERSEA_WALKERS_GB', 'OVERSEA_WALKERS_EU', 'EU_CONSULTEN_SRLS', 'OVERSEA_WALKERS_US', 'OVERSEA_WALKERS_TR') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AgentInfo_shopId_idx`(`shopId`),
    INDEX `AgentInfo_clientId_idx`(`clientId`),
    INDEX `AgentInfo_country_idx`(`country`),
    INDEX `AgentInfo_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `type` ENUM('BUSINESS_LICENSE', 'ID_CARD_FRONT', 'ID_CARD_BACK', 'OTHER') NOT NULL,
    `fileUrl` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attachment_clientId_idx`(`clientId`),
    INDEX `Attachment_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ActionLog` ADD CONSTRAINT `ActionLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Client` ADD CONSTRAINT `Client_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyInfo` ADD CONSTRAINT `CompanyInfo_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LegalRepresentative` ADD CONSTRAINT `LegalRepresentative_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shop` ADD CONSTRAINT `Shop_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentInfo` ADD CONSTRAINT `AgentInfo_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
