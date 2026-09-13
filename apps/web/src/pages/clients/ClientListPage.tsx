import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import type { TablePaginationConfig } from 'antd/es/table';
import {
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FileProtectOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  CERTIFICATE_STATUS_LABELS,
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  type AgentInfoSummary,
  type CertificateRecord,
  type ClientListItem,
  type ClientStatus,
  type ClientType,
} from '@funtax/shared';
import { clientsApi, type ListClientsParams } from '../../lib/clients-api';
import { clientImportApi } from '../../lib/client-import-api';
import { brandColors } from '../../theme';
import { ClientDetailDrawer } from './ClientDetailDrawer';
import { AgentInfoDetailDrawer } from './AgentInfoDetailDrawer';

const { RangePicker } = DatePicker;

interface SearchFormValues {
  keyword?: string;
  clientType?: ClientType;
  status?: ClientStatus;
  agentCountry?: ListClientsParams['agentCountry'];
  submittedRange?: Parameters<NonNullable<ComponentProps<typeof RangePicker>['onChange']>>[0];
}

const STATUS_COLOR: Record<ClientStatus, string> = {
  NORMAL: brandColors.success,
  PENDING_RENEWAL: brandColors.warning,
  PENDING_REVIEW: brandColors.body,
};

const CERTIFICATE_STATUS_COLOR: Record<AgentInfoSummary['certificateStatus'], string> = {
  NONE: brandColors.body,
  PENDING: brandColors.warning,
  GENERATING: brandColors.warning,
  SUCCESS: brandColors.success,
  FAILED: 'error',
};

/** 格式化为 YYYY-MM-DD，无值时显示占位符 */
function formatDate(v: string | null): string {
  if (!v) return '—';
  return v.slice(0, 10);
}

interface CertificateTarget {
  clientName: string;
  agentInfo: AgentInfoSummary;
}

export function ClientListPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<SearchFormValues>();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ClientListItem[]>([]);
  const [detailClientId, setDetailClientId] = useState<string | null>(null);
  const [agentInfoDetailTarget, setAgentInfoDetailTarget] = useState<{
    clientId: string;
    agentInfoId: string;
  } | null>(null);
  const [certificateTarget, setCertificateTarget] = useState<CertificateTarget | null>(null);
  const [certificateRecords, setCertificateRecords] = useState<CertificateRecord[]>([]);
  const [certificateLoading, setCertificateLoading] = useState(false);
  const [generatingAgentInfoId, setGeneratingAgentInfoId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  // 已提交的筛选条件：仅在点击"查询"按钮（表单 onFinish）时更新，翻页/切页大小时复用
  const [filters, setFilters] = useState<Omit<ListClientsParams, 'page' | 'pageSize'>>({});

  const load = useCallback(
    async (overrides?: { page?: number; pageSize?: number } & Partial<ListClientsParams>) => {
      setLoading(true);
      try {
        const result = await clientsApi.list({
          page: overrides?.page ?? page,
          pageSize: overrides?.pageSize ?? pageSize,
          ...filters,
          ...overrides,
        });
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setPageSize(result.pageSize);
        setExpandedRowKeys(result.items.filter((c) => c.agentInfos.length > 0).map((c) => c.id));
      } catch {
        void message.error('客户列表加载失败');
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, filters],
  );

  const handleGenerateCertificate = useCallback(
    async (agentInfoId: string) => {
      setGeneratingAgentInfoId(agentInfoId);
      try {
        await clientsApi.generateCertificate(agentInfoId);
        void message.success('已提交生成任务，请稍候查看状态');
        void load();
      } catch {
        void message.error('提交生成任务失败');
      } finally {
        setGeneratingAgentInfoId(null);
      }
    },
    [load],
  );

  const handleDownloadTemplate = useCallback(async () => {
    setDownloadingTemplate(true);
    try {
      const { blob, fileName } = await clientImportApi.downloadTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName ?? '授权客户批量导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      void message.error('模板下载失败，请重试');
    } finally {
      setDownloadingTemplate(false);
    }
  }, []);

  const handleDownloadCertificate = useCallback(async (certificateId: string) => {
    setDownloadingId(certificateId);
    try {
      const { blob, fileName } = await clientsApi.downloadCertificate(certificateId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName ?? `${certificateId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      void message.error('下载失败，请重试');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  /** 在线预览：借助浏览器内置 PDF 阅读器在新标签页打开，不触发下载。 */
  const handlePreviewCertificate = useCallback(async (certificateId: string) => {
    setPreviewingId(certificateId);
    try {
      const { blob } = await clientsApi.downloadCertificate(certificateId);
      const pdfBlob =
        blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf');
      const url = URL.createObjectURL(pdfBlob);
      window.open(url, '_blank');
      // 交给新标签页加载后再释放，避免过早回收导致预览失败
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      void message.error('预览失败，请重试');
    } finally {
      setPreviewingId(null);
    }
  }, []);

  useEffect(() => {
    if (!certificateTarget) {
      setCertificateRecords([]);
      return;
    }
    setCertificateLoading(true);
    clientsApi
      .listCertificates(certificateTarget.agentInfo.id)
      .then(setCertificateRecords)
      .catch(() => void message.error('证书历史加载失败'))
      .finally(() => setCertificateLoading(false));
  }, [certificateTarget]);

  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTableChange = (pagination: TablePaginationConfig) => {
    void load({ page: pagination.current, pageSize: pagination.pageSize });
  };

  /** 表单内所有查询条件填写/选择完毕后，点击"查询"统一发起一次请求 */
  const handleSearch = (values: SearchFormValues) => {
    const nextFilters: Omit<ListClientsParams, 'page' | 'pageSize'> = {
      keyword: values.keyword?.trim() || undefined,
      clientType: values.clientType,
      status: values.status,
      agentCountry: values.agentCountry,
      submittedFrom: values.submittedRange?.[0]?.format('YYYY-MM-DD'),
      submittedTo: values.submittedRange?.[1]?.format('YYYY-MM-DD'),
    };
    setFilters(nextFilters);
    void load({ page: 1, ...nextFilters });
  };

  return (
    <div className="clients-page">
      <Card bordered={false} className="clients-toolbar-card">
        <Form<SearchFormValues>
          form={form}
          layout="horizontal"
          onFinish={handleSearch}
          style={{ width: '100%' }}
        >
          <Space size="large" wrap align="center">
            <Form.Item name="keyword" label="客户名称" style={{ marginBottom: 0 }}>
              <Input allowClear placeholder="请输入客户名称" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="clientType" label="注册类型" style={{ marginBottom: 0 }}>
              <Select
                allowClear
                placeholder="请选择注册类型"
                style={{ width: 140 }}
                options={Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ marginBottom: 0 }}>
              <Select
                allowClear
                placeholder="请选择状态"
                style={{ width: 140 }}
                options={Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="agentCountry" label="代理国家" style={{ marginBottom: 0 }}>
              <Select
                allowClear
                placeholder="请选择代理国家"
                style={{ width: 140 }}
                options={Object.entries(AGENT_COUNTRY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="submittedRange" label="提交日期" style={{ marginBottom: 0 }}>
              {/* 允许只选其中一端：只选开始日期表示查到最新，只选结束日期表示从最早查起 */}
              <RangePicker allowEmpty={[true, true]} />
            </Form.Item>
          </Space>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              rowGap: 12,
              marginTop: 16,
            }}
          >
            <Space>
              <Button type="primary" icon={<SearchOutlined />} htmlType="submit">
                查询
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setFilters({});
                  void load({
                    page: 1,
                    keyword: undefined,
                    clientType: undefined,
                    status: undefined,
                    agentCountry: undefined,
                    submittedFrom: undefined,
                    submittedTo: undefined,
                  });
                }}
              >
                重置
              </Button>
            </Space>

            <Space>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
                刷新
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
                批量导入
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/clients/new')}
              >
                新增客户
              </Button>
            </Space>
          </div>
        </Form>
      </Card>

      <Modal
        title="批量导入客户"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          setImportFile(null);
        }}
        destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingTemplate}
              onClick={handleDownloadTemplate}
            >
              下载批量导入模板
            </Button>
            <Button
              type="primary"
              loading={importing}
              disabled={!importFile}
              onClick={async () => {
                if (!importFile) {
                  void message.warning('请先选择要上传的 ZIP 文件');
                  return;
                }
                setImporting(true);
                try {
                  const job = await clientImportApi.create(importFile);
                  setImportModalOpen(false);
                  setImportFile(null);
                  navigate(`/clients/import/${job.id}`);
                } catch {
                  void message.error('上传失败，请重试');
                } finally {
                  setImporting(false);
                }
              }}
            >
              开始导入
            </Button>
          </div>
        }
      >
        <Upload.Dragger
          accept=".zip"
          maxCount={1}
          showUploadList
          beforeUpload={(file) => {
            setImportFile(file);
            return false;
          }}
          onRemove={() => setImportFile(null)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 ZIP 文件到此区域上传</p>
          <p className="ant-upload-hint">ZIP 内应包含多个按官方模板填写的授权客户信息 Excel 文件</p>
        </Upload.Dragger>
      </Modal>

      <Card bordered={false} className="clients-table-card">
        <Table<ClientListItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          onChange={handleTableChange}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
          columns={[
            {
              // 企业客户：客户中文名取公司中文名；个人客户没有"公司"概念，取法人姓名（中文）代替
              title: '客户名称（中文）',
              dataIndex: 'nameCn',
              minWidth: 160,
              render: (_, r) => r.nameCn ?? '—',
            },
            {
              // 个人客户没有英文名，取法人姓名拼音代替
              title: '客户名称（英文）',
              dataIndex: 'nameEn',
              minWidth: 160,
              render: (_, r) => r.nameEn ?? '—',
            },
            {
              title: '注册类型',
              dataIndex: 'clientType',
              minWidth: 100,
              render: (v: ClientType) => CLIENT_TYPE_LABELS[v],
            },
            {
              title: '提交日期',
              dataIndex: 'createdAt',
              minWidth: 110,
              render: (v: string) => formatDate(v),
            },
            {
              title: '状态',
              dataIndex: 'status',
              minWidth: 100,
              render: (v: ClientStatus) => (
                <Tag color={STATUS_COLOR[v]}>{CLIENT_STATUS_LABELS[v]}</Tag>
              ),
            },
            // {
            //   title: '代理信息',
            //   dataIndex: 'agentInfos',
            //   width: 100,
            //   render: (v: AgentInfoSummary[]) => (v.length > 0 ? `${v.length} 条` : '—'),
            // },
            {
              title: '操作',
              key: 'action',
              minWidth: 110,
              render: (_, r) => (
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => setDetailClientId(r.id)}
                >
                  详情
                </Button>
              ),
            },
          ]}
          expandable={{
            rowExpandable: (r) => r.agentInfos.length > 0,
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
            expandedRowRender: (r) => (
              <div className="client-agent-subtable-wrap">
                <Table<AgentInfoSummary>
                  className="client-agent-subtable"
                  rowKey="id"
                  size="small"
                  pagination={false}
                  tableLayout="auto"
                  dataSource={r.agentInfos}
                  columns={[
                    {
                      title: '代理国家',
                      dataIndex: 'country',
                      minWidth: 90,
                      render: (v: AgentInfoSummary['country']) => AGENT_COUNTRY_LABELS[v],
                    },
                    {
                      title: '代理公司',
                      dataIndex: 'agentCompany',
                      minWidth: 180,
                      render: (v: AgentInfoSummary['agentCompany']) => AGENT_COMPANY_LABELS[v],
                    },
                    {
                      title: '生效日期',
                      dataIndex: 'expectedEffectiveDate',
                      minWidth: 110,
                      render: (v: string) => formatDate(v),
                    },
                    {
                      title: '服务截止日期',
                      dataIndex: 'expiresAt',
                      minWidth: 120,
                      render: (v: string) => formatDate(v),
                    },
                    // { title: '店铺数', dataIndex: 'shopCount', width: 80, align: 'center' },
                    {
                      title: '证书状态',
                      dataIndex: 'certificateStatus',
                      minWidth: 100,
                      render: (_, agentInfo) => {
                        const status = agentInfo.certificateStatus;
                        const tag = (
                          <Tag color={CERTIFICATE_STATUS_COLOR[status]}>
                            {CERTIFICATE_STATUS_LABELS[status]}
                          </Tag>
                        );
                        return status === 'FAILED' && agentInfo.certificateError ? (
                          <Tooltip title={agentInfo.certificateError}>{tag}</Tooltip>
                        ) : (
                          tag
                        );
                      },
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 260,
                      render: (_, agentInfo) => {
                        const isBusy =
                          agentInfo.certificateStatus === 'PENDING' ||
                          agentInfo.certificateStatus === 'GENERATING';
                        const generateBtn = (
                          <Button
                            type="link"
                            size="small"
                            icon={<FilePdfOutlined />}
                            disabled={isBusy}
                            loading={generatingAgentInfoId === agentInfo.id}
                            onClick={() => void handleGenerateCertificate(agentInfo.id)}
                          >
                            {agentInfo.certificateStatus === 'FAILED'
                              ? '重试生成'
                              : agentInfo.certificateStatus === 'SUCCESS'
                                ? '重新生成'
                                : '生成证书'}
                          </Button>
                        );
                        return (
                          <Space size={0}>
                            <Button
                              type="link"
                              size="small"
                              icon={<EyeOutlined />}
                              onClick={() =>
                                setAgentInfoDetailTarget({
                                  clientId: r.id,
                                  agentInfoId: agentInfo.id,
                                })
                              }
                            >
                              详情
                            </Button>
                            <Button
                              type="link"
                              size="small"
                              icon={<FileProtectOutlined />}
                              onClick={() =>
                                setCertificateTarget({
                                  clientName: r.nameCn ?? r.nameEn ?? '',
                                  agentInfo,
                                })
                              }
                            >
                              查看证书
                            </Button>
                            {isBusy ? (
                              <Tooltip title="证书生成中，请稍候">
                                <span>{generateBtn}</span>
                              </Tooltip>
                            ) : (
                              generateBtn
                            )}
                          </Space>
                        );
                      },
                    },
                  ]}
                />
              </div>
            ),
          }}
          scroll={{ x: 'max-content' }}
          tableLayout="auto"
        />
      </Card>

      <ClientDetailDrawer clientId={detailClientId} onClose={() => setDetailClientId(null)} />

      <AgentInfoDetailDrawer
        target={agentInfoDetailTarget}
        onClose={() => setAgentInfoDetailTarget(null)}
      />

      <Modal
        open={!!certificateTarget}
        title={
          certificateTarget
            ? `${AGENT_COUNTRY_LABELS[certificateTarget.agentInfo.country]}代理证书 · ${certificateTarget.clientName}`
            : '代理证书'
        }
        footer={null}
        onCancel={() => setCertificateTarget(null)}
      >
        {certificateRecords.length === 0 ? (
          <Empty description={certificateLoading ? '加载中…' : '暂无已生成的授权证书'} />
        ) : (
          <Table<CertificateRecord>
            rowKey="id"
            size="small"
            loading={certificateLoading}
            pagination={false}
            dataSource={certificateRecords}
            columns={[
              { title: '协议编号', dataIndex: 'agreementNumber' },
              {
                title: '生成时间',
                dataIndex: 'createdAt',
                render: (v: string) => formatDate(v),
              },
              {
                title: '操作',
                key: 'action',
                render: (_, record) => (
                  <Space size={0}>
                    <Button
                      type="link"
                      size="small"
                      loading={previewingId === record.id}
                      onClick={() => void handlePreviewCertificate(record.id)}
                    >
                      预览
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      loading={downloadingId === record.id}
                      onClick={() => void handleDownloadCertificate(record.id)}
                    >
                      下载
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
