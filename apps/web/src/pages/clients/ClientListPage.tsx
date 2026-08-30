import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, message } from 'antd';
import type { TablePaginationConfig } from 'antd/es/table';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  CLIENT_STATUS_LABELS,
  CLIENT_TYPE_LABELS,
  type ClientListItem,
  type ClientStatus,
  type ClientType,
} from '@funtax/shared';
import { clientsApi } from '../../lib/clients-api';
import { brandColors } from '../../theme';

const STATUS_COLOR: Record<ClientStatus, string> = {
  PENDING_REVIEW: brandColors.warning,
  APPROVED: brandColors.success,
  DISABLED: brandColors.body,
};

export function ClientListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ClientListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [clientType, setClientType] = useState<ClientType | undefined>();

  const load = useCallback(
    async (params?: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      clientType?: ClientType;
    }) => {
      setLoading(true);
      try {
        const result = await clientsApi.list({
          page: params?.page ?? page,
          pageSize: params?.pageSize ?? pageSize,
          keyword: params?.keyword ?? keyword,
          clientType: params?.clientType ?? clientType,
        });
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setPageSize(result.pageSize);
      } catch {
        void message.error('客户列表加载失败');
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, keyword, clientType],
  );

  useEffect(() => {
    void load({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTableChange = (pagination: TablePaginationConfig) => {
    void load({ page: pagination.current, pageSize: pagination.pageSize });
  };

  return (
    <div className="clients-page">
      <Card bordered={false} className="clients-toolbar-card">
        <Space size="middle" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space size="middle" wrap>
            <Input
              allowClear
              placeholder="搜索手机号 / 公司名称 / 信用代码"
              prefix={<SearchOutlined />}
              style={{ width: 280 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => void load({ page: 1 })}
            />
            <Select
              allowClear
              placeholder="注册类型"
              style={{ width: 140 }}
              value={clientType}
              options={Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(value) => {
                setClientType(value);
                void load({ page: 1, clientType: value });
              }}
            />
            <Button onClick={() => void load({ page: 1 })}>查询</Button>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/clients/new')}>
            新增客户
          </Button>
        </Space>
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
              title: '客户名称',
              dataIndex: 'nameCn',
              render: (_, r) => r.nameCn ?? r.nameEn ?? '—',
            },
            {
              title: '注册类型',
              dataIndex: 'clientType',
              width: 100,
              render: (v: ClientType) => CLIENT_TYPE_LABELS[v],
            },
            { title: '联系手机号', dataIndex: 'phone', width: 140 },
            { title: '店铺数', dataIndex: 'shopCount', width: 90, align: 'center' },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (v: ClientStatus) => (
                <Tag color={STATUS_COLOR[v]}>{CLIENT_STATUS_LABELS[v]}</Tag>
              ),
            },
            { title: '负责人', dataIndex: 'ownerNickname', width: 120 },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 180,
              render: (v: string) => new Date(v).toLocaleString('zh-CN'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
