-- AlterTable
ALTER TABLE `AgentInfo` ADD COLUMN `certificateError` TEXT NULL,
    ADD COLUMN `certificateStatus` ENUM('NONE', 'PENDING', 'GENERATING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'NONE';
