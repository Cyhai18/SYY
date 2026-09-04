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
  message,
} from 'antd';
import type { TablePaginationConfig } from 'antd/es/table';
import { EyeOutlined, FileProtectOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  AGENT_COMPANY_LABELS,
  AGENT_COUNTRY_LABELS,
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  type AgentInfoSummary,
  type ClientListItem,
  type ClientStatus,
  type ClientType,
} from '@funtax/shared';
import { clientsApi, type ListClientsParams } from '../../lib/clients-api';
import { brandColors } from '../../theme';
import { ClientDetailDrawer } from './ClientDetailDrawer';

const { RangePicker } = DatePicker;

interface SearchFormValues {
  keyword?: string;
  clientType?: ClientType;
  status?: ClientStatus;
  agentCountry?: ListClientsParams['agentCountry'];
  submittedRange?: Parameters<NonNullable<ComponentProps<typeof RangePicker>['onChange']>>[0];
}

const STATUS_COLOR: Record<ClientStatus, string> = {
  PENDING_REVIEW: brandColors.warning,
  APPROVED: brandColors.success,
  DISABLED: brandColors.body,
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
  const [certificateTarget, setCertificateTarget] = useState<CertificateTarget | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
              <RangePicker />
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

            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/clients/new')}>
              新增客户
            </Button>
          </div>
        </Form>
      </Card>

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
              fixed: 'left',
              width: 180,
              render: (_, r) => r.nameCn ?? '—',
            },
            {
              // 个人客户没有英文名，取法人姓名拼音代替
              title: '客户名称（英文）',
              dataIndex: 'nameEn',
              fixed: 'left',
              width: 180,
              render: (_, r) => r.nameEn ?? '—',
            },
            {
              title: '注册类型',
              dataIndex: 'clientType',
              width: 100,
              render: (v: ClientType) => CLIENT_TYPE_LABELS[v],
            },
            {
              title: '提交日期',
              dataIndex: 'createdAt',
              width: 120,
              render: (v: string) => formatDate(v),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (v: ClientStatus) => (
                <Tag color={STATUS_COLOR[v]}>{CLIENT_STATUS_LABELS[v]}</Tag>
              ),
            },
            {
              title: '代理信息',
              dataIndex: 'agentInfos',
              width: 100,
              render: (v: AgentInfoSummary[]) => (v.length > 0 ? `${v.length} 条` : '—'),
            },
            {
              title: '操作',
              key: 'action',
              fixed: 'right',
              width: 120,
              render: (_, r) => (
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => setDetailClientId(r.id)}
                >
                  查看资料
                </Button>
              ),
            },
          ]}
          expandable={{
            rowExpandable: (r) => r.agentInfos.length > 0,
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
            expandedRowRender: (r) => (
              <Table<AgentInfoSummary>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={r.agentInfos}
                columns={[
                  {
                    title: '代理国家',
                    dataIndex: 'country',
                    width: 100,
                    render: (v: AgentInfoSummary['country']) => AGENT_COUNTRY_LABELS[v],
                  },
                  {
                    title: '代理公司',
                    dataIndex: 'agentCompany',
                    width: 220,
                    render: (v: AgentInfoSummary['agentCompany']) => AGENT_COMPANY_LABELS[v],
                  },
                  {
                    title: '生效日期',
                    dataIndex: 'expectedEffectiveDate',
                    width: 120,
                    render: (v: string) => formatDate(v),
                  },
                  {
                    title: '服务截止日期',
                    dataIndex: 'expiresAt',
                    width: 130,
                    render: (v: string) => formatDate(v),
                  },
                  { title: '店铺数', dataIndex: 'shopCount', width: 90, align: 'center' },
                  {
                    title: '操作',
                    key: 'action',
                    width: 120,
                    render: (_, agentInfo) => (
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
                    ),
                  },
                ]}
              />
            ),
          }}
          scroll={{ x: 1100 }}
        />
      </Card>

      <ClientDetailDrawer clientId={detailClientId} onClose={() => setDetailClientId(null)} />

      <Modal
        open={!!certificateTarget}
        title={
          certificateTarget
            ? `授权证书 · ${certificateTarget.clientName} · ${AGENT_COUNTRY_LABELS[certificateTarget.agentInfo.country]}`
            : '授权证书'
        }
        footer={null}
        onCancel={() => setCertificateTarget(null)}
      >
        <Tooltip title="证书生成/归档功能尚未上线，敬请期待">
          <Empty description="暂无可查看的授权证书" />
        </Tooltip>
      </Modal>
    </div>
  );
}
