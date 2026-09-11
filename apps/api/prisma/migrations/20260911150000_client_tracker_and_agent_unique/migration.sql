-- CreateTable
CREATE TABLE `ClientTracker` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClientTracker_userId_idx`(`userId`),
    UNIQUE INDEX `ClientTracker_clientId_userId_key`(`clientId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClientTracker` ADD CONSTRAINT `ClientTracker_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientTracker` ADD CONSTRAINT `ClientTracker_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex（同一客户禁止重复添加相同的代理国家+代理公司组合）
CREATE UNIQUE INDEX `AgentInfo_clientId_country_agentCompany_key` ON `AgentInfo`(`clientId`, `country`, `agentCompany`);
