import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Progress, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import type { ImportItem, ImportItemStatus, ImportJob } from '../../../lib/client-import-api';
import { clientImportApi } from '../../../lib/client-import-api';
import { brandColors } from '../../../theme';
import { ReviewItemModal } from './ReviewItemModal';

const STATUS_LABELS: Record<ImportItemStatus, string> = {
  PENDING: '待处理',
  OCR_PROCESSING: '识别中',
  SUCCESS: '成功',
  NEEDS_REVIEW: '待核对',
  FAILED: '失败',
};

const ERROR_COLOR = '#ff4d4f';

const STATUS_COLOR: Record<ImportItemStatus, string> = {
  PENDING: brandColors.body,
  OCR_PROCESSING: brandColors.primary,
  SUCCESS: brandColors.success,
  NEEDS_REVIEW: brandColors.warning,
  FAILED: ERROR_COLOR,
};

const TABS: { key: ImportItemStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: '全部' },
  { key: 'NEEDS_REVIEW', label: '待核对' },
  { key: 'SUCCESS', label: '成功' },
  { key: 'FAILED', label: '失败' },
];

/** 批量导入进度/结果页：轮询批次状态直至 DONE，明细按状态分 Tab，待核对/失败项可打开核对弹窗人工提交。 */
export function ClientImportProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<ImportJob | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [activeTab, setActiveTab] = useState<ImportItemStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<ImportItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const [jobResult, itemsResult] = await Promise.all([
        clientImportApi.get(jobId),
        clientImportApi.listItems(jobId, { pageSize: 500 }),
      ]);
      setJob(jobResult);
      setItems(itemsResult.items);
      if (jobResult.status === 'DONE' || jobResult.status === 'FAILED') {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } catch {
      void message.error('导入批次加载失败');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  if (!job) {
    return (
      <Card bordered={false} loading={loading}>
        {!loading ? <Typography.Text type="secondary">未找到该导入批次</Typography.Text> : null}
      </Card>
    );
  }

  const processed = job.successCount + job.reviewCount + job.failedCount;
  const percent = job.totalCount > 0 ? Math.round((processed / job.totalCount) * 100) : 0;
  const filteredItems = activeTab === 'ALL' ? items : items.filter((i) => i.status === activeTab);

  return (
    <div className="client-import-progress-page">
      <Card bordered={false} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 压缩包文件名来自 multer/busboy 对 multipart 请求头的 latin1 解码，中文文件名会
              乱码（浏览器实际用 UTF-8 编码发送），且非展示层问题无法在前端简单修复，故不展示。
              批次信息已有下方进度条 + 统计数字，不影响核对流程。 */}
          <Space align="center" style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={() => navigate('/clients')}>返回客户列表</Button>
          </Space>
          <Progress
            percent={percent}
            status={job.status === 'PROCESSING' || job.status === 'QUEUED' ? 'active' : 'normal'}
          />
          <Space size="large">
            <span>总数：{job.totalCount}</span>
            <span style={{ color: brandColors.success }}>成功：{job.successCount}</span>
            <span style={{ color: brandColors.warning }}>待核对：{job.reviewCount}</span>
            <span style={{ color: ERROR_COLOR }}>失败：{job.failedCount}</span>
          </Space>
        </Space>
      </Card>

      <Card bordered={false}>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as ImportItemStatus | 'ALL')}
          items={TABS.map((t) => ({ key: t.key, label: t.label }))}
        />
        <Table<ImportItem>
          rowKey="id"
          loading={loading}
          dataSource={filteredItems}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            { title: '文件名', dataIndex: 'fileName', width: 120 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 120,
              render: (status: ImportItemStatus) => (
                <Tag color={STATUS_COLOR[status]}>{STATUS_LABELS[status]}</Tag>
              ),
            },
            {
              title: '说明',
              key: 'detail',
              render: (_, item) =>
                item.status === 'FAILED'
                  ? item.errorReason
                  : item.status === 'NEEDS_REVIEW'
                    ? (item.reviewIssues ?? []).map((i) => i.message).join('；')
                    : '—',
            },
            {
              title: '操作',
              key: 'action',
              width: 120,
              render: (_, item) =>
                item.status === 'NEEDS_REVIEW' || item.status === 'FAILED' ? (
                  <Button type="link" size="small" onClick={() => setReviewTarget(item)}>
                    去核对
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <ReviewItemModal
        item={reviewTarget}
        open={reviewTarget !== null}
        onClose={() => setReviewTarget(null)}
        onSuccess={() => {
          setReviewTarget(null);
          void load();
        }}
      />
    </div>
  );
}
