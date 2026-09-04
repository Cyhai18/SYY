-- CreateTable
CREATE TABLE `Certificate` (
    `id` VARCHAR(191) NOT NULL,
    `agentInfoId` VARCHAR(191) NOT NULL,
    `agreementNumber` VARCHAR(191) NOT NULL,
    `fileUrl` TEXT NULL,
    `generatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Certificate_agreementNumber_key`(`agreementNumber`),
    INDEX `Certificate_agentInfoId_idx`(`agentInfoId`),
    INDEX `Certificate_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CertificateDailyCounter` (
    `day` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_agentInfoId_fkey` FOREIGN KEY (`agentInfoId`) REFERENCES `AgentInfo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Certificate` ADD CONSTRAINT `Certificate_generatedById_fkey` FOREIGN KEY (`generatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
