import type { ThemeConfig } from 'antd';

export const brandColors = {
  primary: '#2563C9',
  secondary: '#4FC3F7',
  accent: '#F2BC4F',
  background: '#F7F9FC',
  title: '#1D2939',
  body: '#667085',
  success: '#12B76A',
  warning: '#F79009',
} as const;

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: brandColors.primary,
    colorInfo: brandColors.secondary,
    colorSuccess: brandColors.success,
    colorWarning: brandColors.warning,
    colorTextBase: brandColors.title,
    colorText: brandColors.title,
    colorTextSecondary: brandColors.body,
    colorBgLayout: brandColors.background,
    colorLink: brandColors.primary,
    colorHighlight: brandColors.accent,
    borderRadius: 8,
    fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif',
  },
};
