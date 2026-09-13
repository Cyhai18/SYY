-- ClientStatus 枚举重构：PENDING_REVIEW(审核中)/APPROVED(已通过)/DISABLED(已禁用)
-- -> NORMAL(正常)/PENDING_RENEWAL(待续费)/PENDING_REVIEW(待审核)
-- 现存数据全部为 PENDING_REVIEW，语义调整为"待审核"，无需数据迁移；
-- 旧 APPROVED/DISABLED 无对应新值，若未来仍有历史数据落在这两个值上会在此步报错，需人工确认映射。
ALTER TABLE `Client` MODIFY `status` ENUM('NORMAL', 'PENDING_RENEWAL', 'PENDING_REVIEW') NOT NULL DEFAULT 'PENDING_REVIEW';
