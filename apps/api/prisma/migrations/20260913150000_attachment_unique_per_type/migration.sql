-- 每个客户每种证件类型只保留最新一份附件：先清理历史重复数据（同 clientId+type 只保留 createdAt 最新一条），
-- 再加唯一约束，避免后续追加代理信息重新上传时产生重复行。
DELETE a FROM `Attachment` a
INNER JOIN `Attachment` b
  ON a.`clientId` = b.`clientId`
  AND a.`type` = b.`type`
  AND (
    a.`createdAt` < b.`createdAt`
    OR (a.`createdAt` = b.`createdAt` AND a.`id` < b.`id`)
  );

-- CreateIndex
CREATE UNIQUE INDEX `Attachment_clientId_type_key` ON `Attachment`(`clientId`, `type`);
