/*
  Warnings:

  - You are about to alter the column `agentCompany` on the `AgentInfo` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(6))`.

*/
-- AlterTable
ALTER TABLE `AgentInfo` MODIFY `agentCompany` ENUM('OVERSEA_WALKERS_GB', 'OVERSEA_WALKERS_EU', 'EU_CONSULTEN_SRLS', 'OVERSEA_WALKERS_US', 'OVERSEA_WALKERS_TR') NOT NULL;
