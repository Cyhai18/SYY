import type { ThemeConfig } from 'antd';

export const brandColors = {
  primary: 'oklch(51.93% 0.1712 260)',
  secondary: 'oklch(77.26% 0.1268 231.1)',
  accent: 'oklch(82.45% 0.1384 82.1)',
  background: 'oklch(98.14% 0.0045 258.3)',
  title: 'oklch(27.76% 0.0341 255.8)',
  body: 'oklch(54.44% 0.035 265.1)',
  success: 'oklch(68.59% 0.1667 154.9)',
  warning: 'oklch(74.69% 0.1701 62.1)',
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
    borderRadius: 8,
    fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif',
  },
};
