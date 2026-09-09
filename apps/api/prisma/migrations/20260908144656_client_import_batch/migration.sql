-- CreateTable
CREATE TABLE `ClientImportJob` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `fileName` VARCHAR(191) NOT NULL,
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `reviewCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `ClientImportJob_createdById_idx`(`createdById`),
    INDEX `ClientImportJob_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientImportItem` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'OCR_PROCESSING', 'SUCCESS', 'NEEDS_REVIEW', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `clientId` VARCHAR(191) NULL,
    `errorReason` TEXT NULL,
    `reviewFields` JSON NULL,
    `reviewIssues` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClientImportItem_jobId_idx`(`jobId`),
    INDEX `ClientImportItem_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClientImportJob` ADD CONSTRAINT `ClientImportJob_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientImportItem` ADD CONSTRAINT `ClientImportItem_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `ClientImportJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
