export type ThemeName = 'light' | 'dark' | 'business' | 'blue';

export const THEMES: Record<
  ThemeName,
  { label: string; background: string; text: string; border: string; palette: string[] }
> = {
  light: {
    label: '明亮',
    background: '#ffffff',
    text: '#111827',
    border: '#e5e7eb',
    palette: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'],
  },
  dark: {
    label: '暗黑',
    background: '#0b1220',
    text: '#e5e7eb',
    border: '#243244',
    palette: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#2dd4bf', '#fb923c', '#94a3b8'],
  },
  business: {
    label: '商务',
    background: '#ffffff',
    text: '#0f172a',
    border: '#cbd5e1',
    palette: ['#0f172a', '#334155', '#64748b', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'],
  },
  blue: {
    label: '蓝色系',
    background: '#ffffff',
    text: '#0f172a',
    border: '#dbeafe',
    palette: ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444'],
  },
};

const deepClone = (value: any): any => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
    return out;
  }
  return value;
};

export const applyThemeToOption = (option: any, themeName: ThemeName) => {
  const theme = THEMES[themeName];
  const o = deepClone(option || {});

  o.backgroundColor = o.backgroundColor ?? theme.background;
  o.color = theme.palette;
  o.textStyle = { ...(o.textStyle || {}), color: theme.text };

  if (o.title) {
    const titles = Array.isArray(o.title) ? o.title : [o.title];
    o.title = titles.map((t: any) => ({
      ...t,
      textStyle: { ...(t?.textStyle || {}), color: theme.text },
      subtextStyle: { ...(t?.subtextStyle || {}), color: theme.text },
    }));
    if (!Array.isArray(option?.title)) o.title = o.title[0];
  }

  if (o.legend) {
    const legends = Array.isArray(o.legend) ? o.legend : [o.legend];
    o.legend = legends.map((l: any) => ({
      ...l,
      textStyle: { ...(l?.textStyle || {}), color: theme.text },
    }));
    if (!Array.isArray(option?.legend)) o.legend = o.legend[0];
  }

  const applyAxis = (axis: any) => {
    if (!axis) return axis;
    const axes = Array.isArray(axis) ? axis : [axis];
    const out = axes.map((a: any) => ({
      ...a,
      axisLine: { ...(a?.axisLine || {}), lineStyle: { ...(a?.axisLine?.lineStyle || {}), color: theme.border } },
      axisLabel: { ...(a?.axisLabel || {}), color: theme.text },
      splitLine: { ...(a?.splitLine || {}), lineStyle: { ...(a?.splitLine?.lineStyle || {}), color: theme.border } },
      nameTextStyle: { ...(a?.nameTextStyle || {}), color: theme.text },
    }));
    return Array.isArray(axis) ? out : out[0];
  };

  o.xAxis = applyAxis(o.xAxis);
  o.yAxis = applyAxis(o.yAxis);

  return o;
};

