-- 1. 新增 Client.uniqueIdentifier（先允许 NULL，便于回填存量数据）
ALTER TABLE `Client` ADD COLUMN `uniqueIdentifier` VARCHAR(191) NULL;

-- 2. 回填：公司类型取 CompanyInfo.creditCode，个人类型取 LegalRepresentative.idNumber
UPDATE `Client` c
JOIN `CompanyInfo` ci ON ci.`clientId` = c.`id`
SET c.`uniqueIdentifier` = ci.`creditCode`
WHERE c.`clientType` = 'COMPANY';

UPDATE `Client` c
JOIN `LegalRepresentative` l ON l.`clientId` = c.`id`
SET c.`uniqueIdentifier` = l.`idNumber`
WHERE c.`clientType` = 'INDIVIDUAL';

-- 3. 收紧为 NOT NULL + 唯一索引
ALTER TABLE `Client` MODIFY `uniqueIdentifier` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `Client_uniqueIdentifier_key` ON `Client`(`uniqueIdentifier`);

-- 4. CompanyInfo.creditCode 不再是查重/唯一性来源，个人类型客户也不再需要写入该列，改为可空
DROP INDEX `CompanyInfo_creditCode_idx` ON `CompanyInfo`;
ALTER TABLE `CompanyInfo` MODIFY `creditCode` VARCHAR(191) NULL;
