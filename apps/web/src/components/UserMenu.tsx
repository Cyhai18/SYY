import { Avatar, Dropdown, message, type MenuProps } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@funtax/shared';
import { useAuthStore } from '../store/auth-store';
import { authApi } from '../lib/auth-api';
import { brandColors } from '../theme';

/** 右上角头像下拉：第一行角色（禁用态展示）、第二行个人中心、第三行退出登录。 */
export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // 即使接口失败也强制清态跳转，避免用户卡在已登录界面
    } finally {
      clear();
      void message.success('已退出登录');
      navigate('/login', { replace: true });
    }
  };

  const items: MenuProps['items'] = [
    { key: 'role', label: ROLE_LABELS[user.role], disabled: true },
    { type: 'divider' },
    { key: 'profile', label: '个人中心', onClick: () => navigate('/profile') },
    { key: 'logout', label: '退出登录', onClick: () => void handleLogout() },
  ];

  const initial = user.nickname?.[0]?.toUpperCase() ?? '?';

  return (
    <Dropdown menu={{ items }} placement="bottomRight" trigger={['click']}>
      <Avatar
        style={{ backgroundColor: brandColors.primary, cursor: 'pointer' }}
        icon={initial ? undefined : <UserOutlined />}
      >
        {initial}
      </Avatar>
    </Dropdown>
  );
}
