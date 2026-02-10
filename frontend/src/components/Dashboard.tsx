import React, { useEffect, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import axios from 'axios';
import { jsPDF } from 'jspdf';
import { ThemeName, THEMES, applyThemeToOption } from './theme';
import { applyAdaptiveOption, NumberFormatMode } from './adaptive';

export interface DashboardChart {
  id: string;
  title: string;
  option: any;
  table?: string;
}

interface DashboardProps {
  title?: string;
  charts: DashboardChart[];
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  onRemoveChart: (id: string) => void;
  onUpdateChart: (id: string, patch: Partial<DashboardChart>, opts?: { recordHistory?: boolean }) => void;
  onReorderCharts: (fromId: string, toId: string) => void;
  onUndoChart: (id: string) => void;
  onRedoChart: (id: string) => void;
  canUndoChart: (id: string) => boolean;
  canRedoChart: (id: string) => boolean;
  onClear: () => void;
}

type LegendPreset = 'right' | 'left' | 'top' | 'bottom' | 'none' | 'float';

// ECharts option 经常被“局部 patch”，这里用深拷贝避免直接修改 state 里的对象引用。
const deepClone = (value: any): any => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
    return out;
  }
  return value;
};

const applyLegendPreset = (option: any, preset: LegendPreset) => {
  const o = deepClone(option || {});
  const legend = { ...(o.legend || {}) };
  if (preset === 'none') {
    legend.show = false;
    o.legend = legend;
    return o;
  }

  legend.show = true;
  if (preset === 'top') {
    Object.assign(legend, { orient: 'horizontal', top: 28, left: 'center', right: undefined, bottom: undefined });
  } else if (preset === 'bottom') {
    Object.assign(legend, { orient: 'horizontal', bottom: 8, left: 'center', right: undefined, top: undefined });
  } else if (preset === 'left') {
    Object.assign(legend, { orient: 'vertical', left: 8, top: 40, right: undefined, bottom: 12 });
  } else if (preset === 'right') {
    Object.assign(legend, { orient: 'vertical', right: 8, top: 40, left: undefined, bottom: 12 });
  } else if (preset === 'float') {
    Object.assign(legend, { orient: 'vertical', left: '65%', top: '20%', right: undefined, bottom: undefined });
  }
  legend.type = legend.type || 'scroll';
  o.legend = legend;

  const series = Array.isArray(o.series) ? o.series : [];
  if (series[0]?.type === 'pie' && preset === 'right') {
    series[0] = { ...series[0], center: ['35%', '58%'] };
    o.series = series;
  }
  if (series[0]?.type === 'pie' && preset === 'left') {
    series[0] = { ...series[0], center: ['65%', '58%'] };
    o.series = series;
  }
  if (series[0]?.type === 'pie' && (preset === 'top' || preset === 'bottom' || preset === 'float')) {
    series[0] = { ...series[0], center: ['50%', '58%'] };
    o.series = series;
  }

  return o;
};

const setTitle = (option: any, title: string) => {
  const o = deepClone(option || {});
  if (Array.isArray(o.title)) {
    o.title = o.title.map((t: any) => ({ ...t, text: title }));
  } else {
    o.title = { ...(o.title || {}), text: title };
  }
  return o;
};

const setSeriesColor = (option: any, seriesIndex: number, color: string) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series : [];
  if (!series[seriesIndex]) return o;
  const s = { ...(series[seriesIndex] || {}) };
  s.itemStyle = { ...(s.itemStyle || {}), color };
  if (s.type === 'line') s.lineStyle = { ...(s.lineStyle || {}), color };
  series[seriesIndex] = s;
  o.series = series;
  return o;
};

const setPieSliceColor = (option: any, dataIndex: number, color: string) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series : [];
  const s0 = series[0] || {};
  if (s0.type !== 'pie') return o;
  const data = Array.isArray(s0.data) ? s0.data.slice() : [];
  const item = data[dataIndex];
  if (!item || typeof item !== 'object') return o;
  data[dataIndex] = { ...item, itemStyle: { ...(item.itemStyle || {}), color } };
  series[0] = { ...s0, data };
  o.series = series;
  return o;
};

const setBarItemColor = (option: any, seriesIndex: number, dataIndex: number, color: string) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  const s = series[seriesIndex];
  if (!s || typeof s !== 'object') return o;
  if (String(s.type || '').toLowerCase() !== 'bar') return o;
  const data = Array.isArray(s.data) ? s.data.slice() : [];
  const item = data[dataIndex];
  if (item === undefined) return o;
  if (item && typeof item === 'object') {
    data[dataIndex] = { ...item, itemStyle: { ...(item.itemStyle || {}), color } };
  } else {
    data[dataIndex] = { value: item, itemStyle: { color } };
  }
  series[seriesIndex] = { ...s, data };
  o.series = series;
  return o;
};

const getGraphicText = (option: any, id: string) => {
  // 轴标题采用 graphic.text（可拖拽），而不是直接使用 xAxis.name/yAxis.name。
  // 这样可以更自由地摆放标题位置；同时会在渲染时做“轴名兜底”，避免图表无轴名难读。
  const g = option?.graphic;
  const list = Array.isArray(g) ? g : g ? [g] : [];
  const item = list.find((x: any) => x?.id === id);
  return String(item?.style?.text || '');
};

const upsertGraphic = (option: any, id: string, next: any) => {
  const o = deepClone(option || {});
  const g = o.graphic;
  const list = Array.isArray(g) ? g.slice() : g ? [g] : [];
  const idx = list.findIndex((x: any) => x?.id === id);
  if (idx >= 0) list[idx] = { ...(list[idx] || {}), ...next, id };
  else list.push({ ...next, id });
  o.graphic = list;
  return o;
};

const toHexColor = (value: any, fallback: string) => {
  const s = String(value || '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return fallback;
};

const axisAt = (axis: any, index: number) => {
  const axes = Array.isArray(axis) ? axis.slice() : [axis || {}];
  while (axes.length <= index) axes.push({});
  return { axes, current: { ...(axes[index] || {}) }, isArray: Array.isArray(axis) };
};

const setAxis = (option: any, axisKey: 'xAxis' | 'yAxis', index: number, patch: any) => {
  const o = deepClone(option || {});
  const { axes, current, isArray } = axisAt(o[axisKey], index);
  axes[index] = { ...current, ...patch };
  o[axisKey] = isArray ? axes : axes[0];
  return o;
};

const setAxisLabel = (
  option: any,
  axisKey: 'xAxis' | 'yAxis',
  index: number,
  patch: { rotate?: number; fontSize?: number; show?: boolean }
) => {
  const o = deepClone(option || {});
  const { axes, current, isArray } = axisAt(o[axisKey], index);
  const axisLabel = { ...(current.axisLabel || {}) };
  if (patch.rotate !== undefined) axisLabel.rotate = patch.rotate;
  if (patch.fontSize !== undefined) axisLabel.fontSize = patch.fontSize;
  if (patch.show !== undefined) axisLabel.show = patch.show;
  axes[index] = { ...current, axisLabel };
  o[axisKey] = isArray ? axes : axes[0];
  return o;
};

const setSplitLine = (option: any, axisKey: 'xAxis' | 'yAxis', index: number, show: boolean) => {
  return setAxis(option, axisKey, index, { splitLine: { ...(axisAt(option?.[axisKey], index).current.splitLine || {}), show } });
};

const setAxisTick = (option: any, axisKey: 'xAxis' | 'yAxis', index: number, show: boolean) => {
  return setAxis(option, axisKey, index, { axisTick: { ...(axisAt(option?.[axisKey], index).current.axisTick || {}), show } });
};

const setAxisName = (option: any, axisKey: 'xAxis' | 'yAxis', index: number, name: string) => {
  return setAxis(option, axisKey, index, { name, nameLocation: 'middle', nameGap: 30 });
};

const hasCartesianAxes = (option: any) => !!(option?.xAxis || option?.yAxis);

// 兜底：确保坐标轴图表一定有轴名称可读。
// 若用户已经设置了可拖拽的 graphic 轴标题，则不再重复设置 axis.name。
const ensureAxisNames = (option: any) => {
  const o = deepClone(option || {});
  if (!hasCartesianAxes(o)) return o;
  const series = Array.isArray(o.series) ? o.series : [];
  if (String(series[0]?.type || '').toLowerCase() === 'pie') return o;

  const ensureOne = (axisKey: 'xAxis' | 'yAxis', index: number, fallbackName: string) => {
    const graphicId = `axis_title_${axisKey}_${index}`;
    if (getGraphicText(o, graphicId)) return;

    const { axes, current, isArray } = axisAt(o[axisKey], index);
    const existing = String(current?.name || '').trim();
    const name = existing || fallbackName;
    if (!name) return;
    const patch: any = { name };
    if (!current?.nameLocation) patch.nameLocation = 'middle';
    if (current?.nameGap === undefined) patch.nameGap = 30;
    axes[index] = { ...current, ...patch };
    o[axisKey] = isArray ? axes : axes[0];
  };

  const x0 = axisAt(o.xAxis, 0).current;
  const xFallback = String(x0?.type || '').toLowerCase() === 'time' ? '时间' : '类别';
  ensureOne('xAxis', 0, xFallback);
  ensureOne('yAxis', 0, '数值');
  if (Array.isArray(o.yAxis) && o.yAxis.length >= 2) ensureOne('yAxis', 1, '数值2');
  return o;
};

const applyDualAxis = (option: any, enabled: boolean) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  if (!enabled) {
    if (Array.isArray(o.yAxis)) o.yAxis = o.yAxis[0];
    o.series = series.map((s: any) => {
      if (!s || typeof s !== 'object') return s;
      const { yAxisIndex, ...rest } = s;
      return rest;
    });
    return o;
  }

  const y0 = Array.isArray(o.yAxis) ? (o.yAxis[0] || {}) : (o.yAxis || {});
  const y1 = Array.isArray(o.yAxis) ? (o.yAxis[1] || {}) : { ...y0, position: 'right', splitLine: { show: false } };
  const yAxis = [{ ...y0, type: y0.type || 'value' }, { ...y1, type: y1.type || 'value', position: 'right' }];
  o.yAxis = yAxis;
  o.series = series.map((s: any) => {
    if (!s || typeof s !== 'object') return s;
    if (s.yAxisIndex === 1 || s.yAxisIndex === 0) return s;
    return { ...s, yAxisIndex: 0 };
  });
  return o;
};

const setSeriesYAxisIndex = (option: any, seriesIndex: number, yAxisIndex: number) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  if (!series[seriesIndex] || typeof series[seriesIndex] !== 'object') return o;
  series[seriesIndex] = { ...series[seriesIndex], yAxisIndex };
  o.series = series;
  return o;
};

const moveSeries = (option: any, from: number, to: number) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  if (from < 0 || to < 0 || from >= series.length || to >= series.length) return o;
  const [item] = series.splice(from, 1);
  series.splice(to, 0, item);
  o.series = series;
  return o;
};

const setDataLabelStyle = (
  option: any,
  patch: { show?: boolean; fontSize?: number; color?: string; position?: string }
) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  o.series = series.map((s: any) => {
    if (!s || typeof s !== 'object') return s;
    const label = { ...(s.label || {}) };
    if (patch.show !== undefined) label.show = patch.show;
    if (patch.fontSize !== undefined) label.fontSize = patch.fontSize;
    if (patch.color !== undefined) label.color = patch.color;
    if (patch.position !== undefined) label.position = patch.position;
    return { ...s, label };
  });
  return o;
};

const getThreshold = (option: any) => {
  const series = Array.isArray(option?.series) ? option.series : [];
  const s0 = series[0] || {};
  const data = s0?.markLine?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const first = data[0];
  if (!first || typeof first !== 'object') return null;
  if (first.yAxis === undefined || first.yAxis === null) return null;
  return { value: Number(first.yAxis), name: String(first.name || '') };
};

const setThresholdLine = (option: any, enabled: boolean, value: number | null, name: string, color: string) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series.slice() : [];
  if (!series.length) return o;
  const t0 = String(series[0]?.type || '').toLowerCase();
  if (t0 === 'pie') return o;

  if (!enabled || value === null || !Number.isFinite(value)) {
    o.series = series.map((s: any) => {
      if (!s || typeof s !== 'object') return s;
      const { markLine, ...rest } = s;
      return rest;
    });
    return o;
  }

  const ml = {
    silent: true,
    symbol: ['none', 'none'],
    lineStyle: { color, width: 2, type: 'dashed' },
    label: { show: true, formatter: name || `阈值: ${value}` },
    data: [{ yAxis: value, name: name || `阈值: ${value}` }],
  };

  o.series = series.map((s: any, idx: number) => {
    if (!s || typeof s !== 'object') return s;
    if (idx === 0) return { ...s, markLine: ml };
    const { markLine, ...rest } = s;
    return rest;
  });
  return o;
};

const Dashboard: React.FC<DashboardProps> = ({ title, charts, theme, onThemeChange, onRemoveChart, onUpdateChart, onReorderCharts, onUndoChart, onRedoChart, canUndoChart, canRedoChart, onClear }) => {
  const [editingChartId, setEditingChartId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [legendPreset, setLegendPreset] = useState<Record<string, LegendPreset>>({});
  const [dragLegendFor, setDragLegendFor] = useState<string | null>(null);
  const [designerChartId, setDesignerChartId] = useState<string | null>(null);
  const [numberFormat, setNumberFormat] = useState<Record<string, NumberFormatMode>>({});
  const [chartLayout, setChartLayout] = useState<Record<string, { height: number; colSpan: 4 | 6 | 12; locked?: boolean }>>({});
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [overCardId, setOverCardId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; baseLeft: number; baseTop: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; baseH: number; baseColSpan: 4 | 6 | 12; w: number; mode: 'corner' | 'bottom' | 'right' } | null>(null);
  const axisTitleDragRef = useRef<{ id: string; graphicId: string; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const chartsRef = useRef<DashboardChart[]>([]);
  chartsRef.current = charts;
  const echartsRef = useRef<Record<string, any>>({});
  const resizeRafRef = useRef<Record<string, number>>({});
  const [exportMenuFor, setExportMenuFor] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('dashboard_chart_layout_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, { height: number; colSpan: 4 | 6 | 12; locked?: boolean }> = {};
        for (const [id, v] of Object.entries(parsed)) {
          const obj: any = v as any;
          const height = Number(obj?.height ?? 320);
          const legacySpan = obj?.span;
          const colSpanRaw = obj?.colSpan ?? (legacySpan === 2 ? 12 : legacySpan === 1 ? 6 : 6);
          const colSpan: 4 | 6 | 12 = colSpanRaw === 12 ? 12 : colSpanRaw === 4 ? 4 : 6;
          out[id] = { height: Number.isFinite(height) ? height : 320, colSpan, locked: !!obj?.locked };
        }
        setChartLayout(out);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const ids = new Set(charts.map((c) => c.id));
      setChartLayout((prev) => {
        const next: Record<string, { height: number; colSpan: 4 | 6 | 12; locked?: boolean }> = {};
        for (const k of Object.keys(prev)) {
          if (ids.has(k)) next[k] = prev[k];
        }
        if (Object.keys(next).length === Object.keys(prev).length) return prev;
        return next;
      });
    } catch {}
  }, [charts]);

  useEffect(() => {
    try {
      localStorage.setItem('dashboard_chart_layout_v1', JSON.stringify(chartLayout));
    } catch {}
  }, [chartLayout]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const exportChart = async (chart: DashboardChart) => {
    const res = await axios.post(
      '/api/export/chart/',
      { title: chart.title, option: chart.option },
      { responseType: 'blob' }
    );
    const filename = `${chart.title || 'chart'}.xlsx`;
    downloadBlob(res.data, filename);
  };

  const exportAllExcel = async () => {
    const res = await axios.post(
      '/api/export/dashboard/',
      { title: title || 'dashboard', charts: charts.map((c) => ({ title: c.title, option: c.option })) },
      { responseType: 'blob' }
    );
    const filename = `${title || 'dashboard'}.xlsx`;
    downloadBlob(res.data, filename);
  };

  const getChartPngDataUrl = (id: string) => {
    const ref = echartsRef.current[id];
    const inst = ref?.getEchartsInstance?.();
    if (!inst) return null;
    return inst.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: THEMES[theme].background,
      excludeComponents: ['toolbox'],
    });
  };

  const exportChartPng = async (chart: DashboardChart) => {
    const url = getChartPngDataUrl(chart.id);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chart.title || 'chart'}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportAllPng = async () => {
    for (const c of chartsRef.current) {
      await exportChartPng(c);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  const exportChartPdf = async (chart: DashboardChart) => {
    const url = getChartPngDataUrl(chart.id);
    const ref = echartsRef.current[chart.id];
    const inst = ref?.getEchartsInstance?.();
    if (!url || !inst) return;
    const w = inst.getWidth?.() || 800;
    const h = inst.getHeight?.() || 450;
    const doc = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const scale = Math.min((pageW - 40) / w, (pageH - 60) / h);
    const imgW = w * scale;
    const imgH = h * scale;
    const x = (pageW - imgW) / 2;
    const y = 30;
    doc.setFontSize(14);
    doc.text(chart.title || 'Chart', 20, 20);
    doc.addImage(url, 'PNG', x, y, imgW, imgH);
    doc.save(`${chart.title || 'chart'}.pdf`);
  };

  const exportDashboardPdf = async () => {
    const list = chartsRef.current;
    if (!list.length) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 20;
    const marginY = 30;

    const firstTitle = title || 'dashboard';
    doc.setFontSize(16);
    doc.text(firstTitle, marginX, 20);

    for (let idx = 0; idx < list.length; idx += 1) {
      const c = list[idx];
      const url = getChartPngDataUrl(c.id);
      const ref = echartsRef.current[c.id];
      const inst = ref?.getEchartsInstance?.();
      if (!url || !inst) continue;
      const w = inst.getWidth?.() || 800;
      const h = inst.getHeight?.() || 450;
      if (idx > 0) doc.addPage();
      doc.setFontSize(14);
      doc.text(c.title || `Chart ${idx + 1}`, marginX, 20);
      const scale = Math.min((pageW - marginX * 2) / w, (pageH - marginY * 2) / h);
      const imgW = w * scale;
      const imgH = h * scale;
      const x = (pageW - imgW) / 2;
      const y = marginY;
      doc.addImage(url, 'PNG', x, y, imgW, imgH);
    }
    doc.save(`${firstTitle}.pdf`);
  };

  const beginEdit = (c: DashboardChart) => {
    setEditingChartId(c.id);
    setEditingTitle(c.title || '');
  };

  const applyEditTitle = () => {
    if (!editingChartId) return;
    const c = chartsRef.current.find((x) => x.id === editingChartId);
    onUpdateChart(editingChartId, { title: editingTitle, option: setTitle(c?.option, editingTitle) });
  };

  const onLegendPresetChange = (id: string, preset: LegendPreset) => {
    const c = chartsRef.current.find((x) => x.id === id);
    if (!c) return;
    setLegendPreset((prev) => ({ ...prev, [id]: preset }));
    onUpdateChart(id, { option: applyLegendPreset(c.option, preset) }, { recordHistory: true });
  };

  const startLegendDrag = (id: string, e: React.MouseEvent<HTMLElement>) => {
    const card = e.currentTarget.closest('[data-dashboard-card]') as HTMLElement | null;
    const container = (card?.querySelector('[data-chart-container]') as HTMLDivElement | null) || null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const c = chartsRef.current.find((x) => x.id === id);
    if (!c) return;
    const opt = c.option || {};
    const lg = opt.legend || {};
    const leftRaw = lg.left ?? '65%';
    const topRaw = lg.top ?? '20%';
    const left = typeof leftRaw === 'string' && leftRaw.endsWith('%') ? parseFloat(leftRaw) / 100 : 0.65;
    const top = typeof topRaw === 'string' && topRaw.endsWith('%') ? parseFloat(topRaw) / 100 : 0.2;
    onUpdateChart(id, {}, { recordHistory: true });
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, baseLeft: left, baseTop: top, w: rect.width, h: rect.height };
    setDragLegendFor(id);
    window.addEventListener('mousemove', onLegendDragMove);
    window.addEventListener('mouseup', stopLegendDrag);
  };

  const onLegendDragMove = (e: MouseEvent) => {
    const st = dragRef.current;
    if (!st) return;
    const dx = (e.clientX - st.startX) / st.w;
    const dy = (e.clientY - st.startY) / st.h;
    const left = Math.min(0.95, Math.max(0.0, st.baseLeft + dx));
    const top = Math.min(0.9, Math.max(0.0, st.baseTop + dy));
    const c = chartsRef.current.find((x) => x.id === st.id);
    if (!c) return;
    const o = deepClone(c.option || {});
    o.legend = { ...(o.legend || {}), show: true, type: (o.legend?.type || 'scroll'), orient: (o.legend?.orient || 'vertical'), left: `${Math.round(left * 100)}%`, top: `${Math.round(top * 100)}%`, right: undefined, bottom: undefined };
    onUpdateChart(st.id, { option: o }, { recordHistory: false });
  };

  const stopLegendDrag = () => {
    dragRef.current = null;
    setDragLegendFor(null);
    window.removeEventListener('mousemove', onLegendDragMove);
    window.removeEventListener('mouseup', stopLegendDrag);
  };

  const getLayout = (id: string) => chartLayout[id] || { height: 320, colSpan: 6 as const, locked: false };

  const queueResize = (id: string) => {
    const existing = resizeRafRef.current[id];
    if (existing) cancelAnimationFrame(existing);
    resizeRafRef.current[id] = requestAnimationFrame(() => {
      delete resizeRafRef.current[id];
      const inst = echartsRef.current[id]?.getEchartsInstance?.();
      inst?.resize?.();
    });
  };

  const startResize = (id: string, mode: 'corner' | 'bottom' | 'right', e: React.MouseEvent<HTMLElement>) => {
    if (getLayout(id).locked) return;
    const card = e.currentTarget.closest('[data-dashboard-card]') as HTMLElement | null;
    const container = (card?.querySelector('[data-chart-container]') as HTMLDivElement | null) || null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const base = getLayout(id);
    resizeRef.current = { id, startX: e.clientX, startY: e.clientY, baseH: base.height, baseColSpan: base.colSpan, w: rect.width, mode };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', stopResize);
  };

  const onResizeMove = (e: MouseEvent) => {
    const st = resizeRef.current;
    if (!st) return;
    const dy = e.clientY - st.startY;
    const dx = e.clientX - st.startX;
    const nextH =
      st.mode === 'right'
        ? st.baseH
        : Math.min(1200, Math.max(220, Math.round((st.baseH + dy) / 20) * 20));
    const nextColSpan: 4 | 6 | 12 =
      st.mode === 'bottom'
        ? st.baseColSpan
        : dx > st.w * 0.3
          ? 12
          : dx < -st.w * 0.3
            ? 4
            : 6;
    setChartLayout((prev) => ({ ...prev, [st.id]: { ...(prev[st.id] || {}), height: nextH, colSpan: nextColSpan } }));
    queueResize(st.id);
  };

  const stopResize = () => {
    resizeRef.current = null;
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', stopResize);
  };

  const setAxisTitleText = (chartId: string, axisKey: 'xAxis' | 'yAxis', index: number, text: string, commit: boolean) => {
    const c = chartsRef.current.find((x) => x.id === chartId);
    if (!c) return;
    const inst = echartsRef.current[chartId]?.getEchartsInstance?.();
    const w = inst?.getWidth?.() || 800;
    const h = inst?.getHeight?.() || 320;
    const graphicId = `axis_title_${axisKey}_${index}`;
    const option = c.option || {};
    const existingText = getGraphicText(option, graphicId);
    const nextText = text ?? existingText;
    const gList = Array.isArray(option.graphic) ? option.graphic : option.graphic ? [option.graphic] : [];
    const existing = gList.find((x: any) => x?.id === graphicId);
    const baseX = typeof existing?.x === 'number' ? existing.x : axisKey === 'xAxis' ? Math.round(w / 2) : 18;
    const baseY = typeof existing?.y === 'number' ? existing.y : axisKey === 'xAxis' ? Math.round(h - 14) : Math.round(h / 2);
    const rotation = axisKey === 'yAxis' ? -Math.PI / 2 : 0;

    let o = option;
    o = setAxis(o, axisKey, index, { name: '' });
    o = upsertGraphic(o, graphicId, {
      type: 'text',
      x: baseX,
      y: baseY,
      rotation,
      z: 100,
      draggable: false,
      style: {
        text: nextText,
        fill: THEMES[theme].text,
        fontSize: 12,
        fontWeight: 600,
      },
    });
    onUpdateChart(chartId, { option: o }, { recordHistory: commit });
  };

  const startAxisTitleDrag = (chartId: string, graphicId: string, e: React.MouseEvent<HTMLElement>) => {
    const c = chartsRef.current.find((x) => x.id === chartId);
    if (!c) return;
    const option = c.option || {};
    const g = option.graphic;
    const list = Array.isArray(g) ? g : g ? [g] : [];
    const item = list.find((x: any) => x?.id === graphicId);
    const baseX = typeof item?.x === 'number' ? item.x : 0;
    const baseY = typeof item?.y === 'number' ? item.y : 0;
    onUpdateChart(chartId, {}, { recordHistory: true });
    axisTitleDragRef.current = { id: chartId, graphicId, startX: e.clientX, startY: e.clientY, baseX, baseY };
    window.addEventListener('mousemove', onAxisTitleDragMove);
    window.addEventListener('mouseup', stopAxisTitleDrag);
  };

  const onAxisTitleDragMove = (e: MouseEvent) => {
    const st = axisTitleDragRef.current;
    if (!st) return;
    const c = chartsRef.current.find((x) => x.id === st.id);
    if (!c) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const option = c.option || {};
    const o = upsertGraphic(option, st.graphicId, { x: Math.round(st.baseX + dx), y: Math.round(st.baseY + dy) });
    onUpdateChart(st.id, { option: o }, { recordHistory: false });
    queueResize(st.id);
  };

  const stopAxisTitleDrag = () => {
    axisTitleDragRef.current = null;
    window.removeEventListener('mousemove', onAxisTitleDragMove);
    window.removeEventListener('mouseup', stopAxisTitleDrag);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">综合分析仪表板</h2>
          {title ? <p className="text-sm text-gray-500 mt-1">{title}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            {Object.entries(THEMES).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
          <button
            onClick={exportAllExcel}
            disabled={!charts.length}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            全部导出Excel
          </button>
          <button
            onClick={exportAllPng}
            disabled={!charts.length}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            全部导出PNG
          </button>
          <button
            onClick={exportDashboardPdf}
            disabled={!charts.length}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            全部导出PDF
          </button>
          <button
            onClick={() => {
              setChartLayout({});
              try {
                localStorage.removeItem('dashboard_chart_layout_v1');
              } catch {}
            }}
            disabled={!charts.length}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            重置布局
          </button>
          <button
            onClick={onClear}
            disabled={!charts.length}
            className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
          >
            清空
          </button>
        </div>
      </div>

      {!charts.length ? (
        <div className="text-gray-500 text-sm">暂无图表。你可以在右侧输入“生成一个销售分析仪表板”。</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {charts.map((c) => (
            <div
              key={c.id}
              className="border rounded-lg overflow-hidden"
              data-dashboard-card
              onDragOver={(e) => {
                if (!dragCardId) return;
                if (getLayout(c.id).locked) return;
                e.preventDefault();
              }}
              onDragEnter={() => {
                if (!dragCardId) return;
                if (getLayout(c.id).locked) return;
                setOverCardId(c.id);
              }}
              onDragLeave={() => {
                if (overCardId === c.id) setOverCardId(null);
              }}
              onDrop={() => {
                if (!dragCardId || dragCardId === c.id) return;
                if (getLayout(c.id).locked) return;
                onReorderCharts(dragCardId, c.id);
                setDragCardId(null);
                setOverCardId(null);
              }}
              style={{
                ...(getLayout(c.id).colSpan ? { gridColumn: `span ${getLayout(c.id).colSpan}` } : {}),
                ...(overCardId === c.id && dragCardId ? { outline: '2px solid #60a5fa', outlineOffset: '-2px' } : {}),
              }}
            >
              <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {editingChartId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={applyEditTitle}
                        className="px-2 py-1 border rounded text-sm w-[220px]"
                      />
                      <button onClick={applyEditTitle} className="text-sm text-blue-600 hover:text-blue-700">
                        保存
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => beginEdit(c)} className="font-medium text-gray-800 truncate text-left">
                      {c.title || '图表'}
                    </button>
                  )}
                  {c.table ? <div className="text-xs text-gray-500 truncate">{c.table}</div> : null}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    draggable
                    onDragStart={(e) => {
                      if (getLayout(c.id).locked) return;
                      setDragCardId(c.id);
                      try {
                        e.dataTransfer.setData('text/plain', c.id);
                        e.dataTransfer.effectAllowed = 'move';
                      } catch {}
                    }}
                    onDragEnd={() => {
                      setDragCardId(null);
                      setOverCardId(null);
                    }}
                    disabled={getLayout(c.id).locked}
                    className="text-sm text-gray-500 hover:text-gray-800 cursor-move disabled:opacity-50"
                    title="拖动排序"
                  >
                    排序
                  </button>
                  <button
                    onClick={() =>
                      setChartLayout((prev) => ({
                        ...prev,
                        [c.id]: { ...(prev[c.id] || getLayout(c.id)), locked: !getLayout(c.id).locked },
                      }))
                    }
                    className="text-sm text-gray-500 hover:text-gray-800"
                    title={getLayout(c.id).locked ? '已锁定' : '未锁定'}
                  >
                    {getLayout(c.id).locked ? '解锁' : '锁定'}
                  </button>
                  <button
                    onClick={() => setEditingChartId((prev) => (prev === c.id ? null : c.id))}
                    className="text-sm text-gray-700 hover:text-gray-900"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => setDesignerChartId(c.id)}
                    className="text-sm text-gray-700 hover:text-gray-900"
                  >
                    设计器
                  </button>
                  <button
                    onClick={() => setExportMenuFor((prev) => (prev === c.id ? null : c.id))}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    导出
                  </button>
                  {exportMenuFor === c.id ? (
                    <div className="relative">
                      <div
                        className="absolute right-0 top-6 bg-white border rounded-lg shadow-lg overflow-hidden z-20 min-w-[140px]"
                        onMouseLeave={() => setExportMenuFor(null)}
                      >
                        <button
                          onClick={() => {
                            setExportMenuFor(null);
                            exportChart(c);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          导出Excel
                        </button>
                        <button
                          onClick={() => {
                            setExportMenuFor(null);
                            exportChartPng(c);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          导出PNG
                        </button>
                        <button
                          onClick={() => {
                            setExportMenuFor(null);
                            exportChartPdf(c);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          导出PDF
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <button
                    onClick={() => onRemoveChart(c.id)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>
              {editingChartId === c.id ? (
                <div className="px-4 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">图例</span>
                    <select
                      value={legendPreset[c.id] || 'right'}
                      onChange={(e) => onLegendPresetChange(c.id, e.target.value as LegendPreset)}
                      className="px-2 py-1 border rounded"
                    >
                      <option value="right">右侧</option>
                      <option value="left">左侧</option>
                      <option value="top">顶部</option>
                      <option value="bottom">底部</option>
                      <option value="none">隐藏</option>
                      <option value="float">浮动(可拖拽)</option>
                    </select>
                  </div>
                  <button
                    onMouseDown={(e) => startLegendDrag(c.id, e)}
                    disabled={(legendPreset[c.id] || 'right') !== 'float'}
                    className="px-2 py-1 text-sm border rounded disabled:opacity-50"
                  >
                    拖动图例
                  </button>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-600">颜色</span>
                    {Array.isArray(c.option?.series) && c.option.series[0]?.type === 'pie' ? (
                      <div className="flex items-center gap-2 overflow-x-auto max-w-[520px]">
                        {(c.option.series[0]?.data || []).slice(0, 10).map((d: any, idx: number) => (
                          <label key={idx} className="flex items-center gap-1 text-xs text-gray-600">
                            <span className="max-w-[80px] truncate">{String(d?.name ?? idx)}</span>
                            <input
                              type="color"
                              onChange={(e) => onUpdateChart(c.id, { option: setPieSliceColor(c.option, idx, e.target.value) })}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 overflow-x-auto max-w-[520px]">
                        {(c.option?.series || []).slice(0, 10).map((s: any, idx: number) => (
                          <label key={idx} className="flex items-center gap-1 text-xs text-gray-600">
                            <span className="max-w-[80px] truncate">{String(s?.name ?? `S${idx + 1}`)}</span>
                            <input
                              type="color"
                              onChange={(e) => onUpdateChart(c.id, { option: setSeriesColor(c.option, idx, e.target.value) })}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="p-2 relative" data-chart-container>
                <ReactECharts
                  ref={(r) => {
                    if (r) echartsRef.current[c.id] = r;
                    else delete echartsRef.current[c.id];
                  }}
                  option={applyAdaptiveOption(applyThemeToOption(ensureAxisNames(c.option), theme), numberFormat[c.id] || 'auto')}
                  style={{ height: getLayout(c.id).height, width: '100%' }}
                />
                <div
                  onMouseDown={(e) => startResize(c.id, 'corner', e)}
                  className={`absolute right-2 bottom-2 w-4 h-4 border border-gray-300 bg-white/70 cursor-nwse-resize rounded ${getLayout(c.id).locked ? 'opacity-40 pointer-events-none' : ''}`}
                  title="拖拽调整大小"
                />
                <div
                  onMouseDown={(e) => startResize(c.id, 'bottom', e)}
                  className={`absolute left-1/2 -translate-x-1/2 bottom-2 w-10 h-2 border border-gray-300 bg-white/70 cursor-ns-resize rounded ${getLayout(c.id).locked ? 'opacity-40 pointer-events-none' : ''}`}
                  title="拖拽调整高度"
                />
                <div
                  onMouseDown={(e) => startResize(c.id, 'right', e)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 w-2 h-10 border border-gray-300 bg-white/70 cursor-ew-resize rounded ${getLayout(c.id).locked ? 'opacity-40 pointer-events-none' : ''}`}
                  title="拖拽调整宽度（1/3、1/2、全宽）"
                />
                {dragLegendFor === c.id ? (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute left-2 top-2 text-xs text-gray-600 bg-white/80 px-2 py-1 rounded pointer-events-none">
                      正在拖拽图例位置…
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {designerChartId ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDesignerChartId(null)}
          />
          <div className="absolute right-0 top-0 h-full w-[420px] bg-white shadow-2xl flex flex-col">
            {(() => {
              const c = chartsRef.current.find((x) => x.id === designerChartId);
              if (!c) return null;
              const fmt = numberFormat[c.id] || 'auto';
              const labels = !!(Array.isArray(c.option?.series) && c.option.series.some((s: any) => s?.label?.show));
              const preset = legendPreset[c.id] || 'right';
              return (
                <>
                  <div className="p-4 border-b flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">看板设计器</div>
                      <div className="text-xs text-gray-500 truncate">{c.title || '图表'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onUndoChart(c.id)}
                        disabled={!canUndoChart(c.id)}
                        className="px-2 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        撤销
                      </button>
                      <button
                        onClick={() => onRedoChart(c.id)}
                        disabled={!canRedoChart(c.id)}
                        className="px-2 py-1 text-sm border rounded disabled:opacity-50"
                      >
                        重做
                      </button>
                      <button
                        onClick={() => setDesignerChartId(null)}
                        className="text-sm text-gray-600 hover:text-gray-900"
                      >
                        关闭
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-4 overflow-auto">
                    {(() => {
                      const option = c.option || {};
                      const layout = getLayout(c.id);
                      const layoutHeight = Number(layout.height || 320);
                      const layoutColSpan = (layout.colSpan || 6) as 4 | 6 | 12;
                      const layoutLocked = !!layout.locked;
                      const isCartesian = hasCartesianAxes(option);
                      const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
                      const yAxis0 = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
                      const yAxis1 = Array.isArray(option.yAxis) ? option.yAxis[1] : null;
                      const series = Array.isArray(option.series) ? option.series : [];
                      const xData = Array.isArray(xAxis?.data) ? xAxis.data : [];
                      const barData0 = Array.isArray(series[0]?.data) ? series[0].data : [];
                      const isBar = String(series[0]?.type || '').toLowerCase() === 'bar';
                      const dualEnabled = Array.isArray(option.yAxis) && option.yAxis.length >= 2;
                      const threshold = getThreshold(option);
                      const thresholdEnabled = !!threshold;
                      const thresholdValue = threshold?.value ?? 0;
                      const thresholdName = threshold?.name ?? '';
                      const xName = getGraphicText(option, 'axis_title_xAxis_0') || String(xAxis?.name || '');
                      const yName = getGraphicText(option, 'axis_title_yAxis_0') || String(yAxis0?.name || '');
                      const y2Name = getGraphicText(option, 'axis_title_yAxis_1') || String(yAxis1?.name || '');
                      const xRotate = Number(xAxis?.axisLabel?.rotate ?? 0);
                      const xFontSize = Number(xAxis?.axisLabel?.fontSize ?? 12);
                      const yRotate = Number(yAxis0?.axisLabel?.rotate ?? 0);
                      const yFontSize = Number(yAxis0?.axisLabel?.fontSize ?? 12);
                      const showXGrid = !!(xAxis?.splitLine?.show ?? false);
                      const showYGrid = !!(yAxis0?.splitLine?.show ?? false);
                      const showXTick = !!(xAxis?.axisTick?.show ?? false);
                      const showYTick = !!(yAxis0?.axisTick?.show ?? false);
                      const labelShow = !!series.some((s: any) => s?.label?.show);
                      const labelFontSize = Number(series[0]?.label?.fontSize ?? 12);
                      const labelColor = String(series[0]?.label?.color || '#111827');
                      const labelPosition = String(series[0]?.label?.position || (series[0]?.type === 'pie' ? 'outside' : 'top'));

                      return (
                        <>
                          <div className="space-y-2">
                            <div className="text-sm text-gray-700">布局</div>
                            <div className="flex items-center gap-2">
                              <select
                                value={layoutColSpan}
                                onChange={(e) => {
                                  const v = Number(e.target.value) as 4 | 6 | 12;
                                  setChartLayout((prev) => ({
                                    ...prev,
                                    [c.id]: { ...(prev[c.id] || layout), colSpan: v, height: layoutHeight, locked: layoutLocked },
                                  }));
                                  queueResize(c.id);
                                }}
                                className="px-3 py-2 border rounded-lg text-sm flex-1"
                              >
                                <option value={4}>1/3 宽</option>
                                <option value={6}>1/2 宽</option>
                                <option value={12}>全宽</option>
                              </select>
                              <input
                                type="number"
                                min={220}
                                max={1200}
                                step={20}
                                value={layoutHeight}
                                onChange={(e) => {
                                  const h = Math.min(1200, Math.max(220, Math.round(Number(e.target.value || 320) / 20) * 20));
                                  setChartLayout((prev) => ({
                                    ...prev,
                                    [c.id]: { ...(prev[c.id] || layout), colSpan: layoutColSpan, height: h, locked: layoutLocked },
                                  }));
                                  queueResize(c.id);
                                }}
                                className="w-[120px] px-3 py-2 border rounded-lg text-sm"
                                placeholder="高度"
                              />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={layoutLocked}
                                onChange={(e) =>
                                  setChartLayout((prev) => ({
                                    ...prev,
                                    [c.id]: { ...(prev[c.id] || layout), colSpan: layoutColSpan, height: layoutHeight, locked: e.target.checked },
                                  }))
                                }
                              />
                              锁定（禁用缩放与排序）
                            </label>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-gray-700">图名</div>
                            <input
                              value={c.title || ''}
                              onChange={(e) =>
                                onUpdateChart(
                                  c.id,
                                  { title: e.target.value, option: setTitle(option, e.target.value) },
                                  { recordHistory: true }
                                )
                              }
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-gray-700">图例位置</div>
                            <div className="flex items-center gap-2">
                              <select
                                value={preset}
                                onChange={(e) => onLegendPresetChange(c.id, e.target.value as LegendPreset)}
                                className="px-3 py-2 border rounded-lg text-sm flex-1"
                              >
                                <option value="right">右侧</option>
                                <option value="left">左侧</option>
                                <option value="top">顶部</option>
                                <option value="bottom">底部</option>
                                <option value="none">隐藏</option>
                                <option value="float">浮动(可拖拽)</option>
                              </select>
                              <button
                                onMouseDown={(e) => startLegendDrag(c.id, e)}
                                disabled={preset !== 'float'}
                                className="px-3 py-2 text-sm border rounded-lg disabled:opacity-50"
                              >
                                拖拽
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-gray-700">数字显示</div>
                            <select
                              value={fmt}
                              onChange={(e) =>
                                setNumberFormat((prev) => ({ ...prev, [c.id]: e.target.value as NumberFormatMode }))
                              }
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                            >
                              <option value="auto">自适应(万/亿/千分位)</option>
                              <option value="comma">千分位</option>
                              <option value="wan">万</option>
                              <option value="yi">亿</option>
                              <option value="raw">原始</option>
                            </select>
                            <div className="text-xs text-gray-500">用于坐标轴大数显示，避免被裁剪。</div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-gray-700">数据标签</div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => onUpdateChart(c.id, { option: setDataLabelStyle(option, { show: !labelShow }) }, { recordHistory: true })}
                                className={`px-3 py-2 text-sm border rounded-lg ${labelShow ? 'bg-blue-50 border-blue-200' : ''}`}
                              >
                                {labelShow ? '已开启' : '已关闭'}
                              </button>
                              <select
                                value={labelPosition}
                                onChange={(e) => onUpdateChart(c.id, { option: setDataLabelStyle(option, { position: e.target.value }) }, { recordHistory: true })}
                                className="px-3 py-2 text-sm border rounded-lg flex-1"
                              >
                                {series[0]?.type === 'pie' ? (
                                  <>
                                    <option value="outside">外侧</option>
                                    <option value="inside">内侧</option>
                                    <option value="center">中心</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="top">顶部</option>
                                    <option value="inside">内部</option>
                                    <option value="insideTop">内部顶部</option>
                                    <option value="insideBottom">内部底部</option>
                                  </>
                                )}
                              </select>
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                字号
                                <input
                                  type="number"
                                  min={8}
                                  max={28}
                                  value={labelFontSize}
                                  onChange={(e) => onUpdateChart(c.id, { option: setDataLabelStyle(option, { fontSize: Number(e.target.value) }) }, { recordHistory: true })}
                                  className="w-[90px] px-2 py-1 border rounded"
                                />
                              </label>
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                颜色
                                <input
                                  type="color"
                                  value={labelColor}
                                  onChange={(e) => onUpdateChart(c.id, { option: setDataLabelStyle(option, { color: e.target.value }) }, { recordHistory: true })}
                                />
                              </label>
                            </div>
                          </div>

                          {isCartesian && isBar && xData.length && barData0.length ? (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-700">柱体颜色</div>
                              <div className="text-xs text-gray-500">按柱体设置颜色（仅对当前柱形系列生效）。</div>
                              <div className="flex flex-col gap-2 max-h-[240px] overflow-auto">
                                {xData.slice(0, 20).map((name: any, idx: number) => {
                                  const fallback = THEMES[theme].palette[idx % THEMES[theme].palette.length];
                                  const item = barData0[idx];
                                  const cur = item && typeof item === 'object' ? item?.itemStyle?.color : undefined;
                                  const hex = toHexColor(cur, fallback);
                                  return (
                                    <label key={idx} className="flex items-center gap-2 text-xs text-gray-700">
                                      <span className="flex-1 min-w-0 truncate">{String(name ?? idx)}</span>
                                      <input
                                        type="color"
                                        value={hex}
                                        onChange={(e) =>
                                          onUpdateChart(
                                            c.id,
                                            { option: setBarItemColor(option, 0, idx, e.target.value) },
                                            { recordHistory: true }
                                          )
                                        }
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {isCartesian ? (
                            <>
                              <div className="space-y-2">
                                <div className="text-sm text-gray-700">轴标题</div>
                                <div className="grid grid-cols-1 gap-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={xName}
                                      onChange={(e) => setAxisTitleText(c.id, 'xAxis', 0, e.target.value, false)}
                                      onBlur={(e) => setAxisTitleText(c.id, 'xAxis', 0, e.target.value, true)}
                                      placeholder="X 轴标题"
                                      className="w-full px-3 py-2 border rounded-lg text-sm"
                                    />
                                    <button
                                      onMouseDown={(e) => {
                                        setAxisTitleText(c.id, 'xAxis', 0, xName, true);
                                        startAxisTitleDrag(c.id, 'axis_title_xAxis_0', e);
                                      }}
                                      className="px-3 py-2 text-sm border rounded-lg"
                                    >
                                      拖动
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={yName}
                                      onChange={(e) => setAxisTitleText(c.id, 'yAxis', 0, e.target.value, false)}
                                      onBlur={(e) => setAxisTitleText(c.id, 'yAxis', 0, e.target.value, true)}
                                      placeholder="Y 轴标题"
                                      className="w-full px-3 py-2 border rounded-lg text-sm"
                                    />
                                    <button
                                      onMouseDown={(e) => {
                                        setAxisTitleText(c.id, 'yAxis', 0, yName, true);
                                        startAxisTitleDrag(c.id, 'axis_title_yAxis_0', e);
                                      }}
                                      className="px-3 py-2 text-sm border rounded-lg"
                                    >
                                      拖动
                                    </button>
                                  </div>
                                  {dualEnabled ? (
                                    <div className="flex items-center gap-2">
                                      <input
                                        value={y2Name}
                                        onChange={(e) => setAxisTitleText(c.id, 'yAxis', 1, e.target.value, false)}
                                        onBlur={(e) => setAxisTitleText(c.id, 'yAxis', 1, e.target.value, true)}
                                        placeholder="Y2 轴标题（右侧）"
                                        className="w-full px-3 py-2 border rounded-lg text-sm"
                                      />
                                      <button
                                        onMouseDown={(e) => {
                                          setAxisTitleText(c.id, 'yAxis', 1, y2Name, true);
                                          startAxisTitleDrag(c.id, 'axis_title_yAxis_1', e);
                                        }}
                                        className="px-3 py-2 text-sm border rounded-lg"
                                      >
                                        拖动
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <div className="text-sm text-gray-700">刻度与网格线</div>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={showXGrid}
                                      onChange={(e) => onUpdateChart(c.id, { option: setSplitLine(option, 'xAxis', 0, e.target.checked) }, { recordHistory: true })}
                                    />
                                    X 网格线
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={showYGrid}
                                      onChange={(e) => onUpdateChart(c.id, { option: setSplitLine(option, 'yAxis', 0, e.target.checked) }, { recordHistory: true })}
                                    />
                                    Y 网格线
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={showXTick}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisTick(option, 'xAxis', 0, e.target.checked) }, { recordHistory: true })}
                                    />
                                    X 刻度线
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={showYTick}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisTick(option, 'yAxis', 0, e.target.checked) }, { recordHistory: true })}
                                    />
                                    Y 刻度线
                                  </label>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    X 旋转
                                    <input
                                      type="number"
                                      min={-90}
                                      max={90}
                                      value={xRotate}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisLabel(option, 'xAxis', 0, { rotate: Number(e.target.value) }) }, { recordHistory: true })}
                                      className="w-[90px] px-2 py-1 border rounded"
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    X 字号
                                    <input
                                      type="number"
                                      min={8}
                                      max={24}
                                      value={xFontSize}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisLabel(option, 'xAxis', 0, { fontSize: Number(e.target.value) }) }, { recordHistory: true })}
                                      className="w-[90px] px-2 py-1 border rounded"
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    Y 旋转
                                    <input
                                      type="number"
                                      min={-90}
                                      max={90}
                                      value={yRotate}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisLabel(option, 'yAxis', 0, { rotate: Number(e.target.value) }) }, { recordHistory: true })}
                                      className="w-[90px] px-2 py-1 border rounded"
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-sm text-gray-700">
                                    Y 字号
                                    <input
                                      type="number"
                                      min={8}
                                      max={24}
                                      value={yFontSize}
                                      onChange={(e) => onUpdateChart(c.id, { option: setAxisLabel(option, 'yAxis', 0, { fontSize: Number(e.target.value) }) }, { recordHistory: true })}
                                      className="w-[90px] px-2 py-1 border rounded"
                                    />
                                  </label>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <div className="text-sm text-gray-700">双轴</div>
                                <div className="flex items-center justify-between gap-3">
                                  <button
                                    onClick={() => onUpdateChart(c.id, { option: applyDualAxis(option, !dualEnabled) }, { recordHistory: true })}
                                    className={`px-3 py-2 text-sm border rounded-lg ${dualEnabled ? 'bg-blue-50 border-blue-200' : ''}`}
                                  >
                                    {dualEnabled ? '已开启' : '已关闭'}
                                  </button>
                                  <div className="text-xs text-gray-500">开启后可为不同系列分配 Y / Y2。</div>
                                </div>
                                {dualEnabled && series.length ? (
                                  <div className="space-y-2">
                                    {series.map((s: any, idx: number) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        <div className="text-xs text-gray-600 flex-1 truncate">{String(s?.name ?? `系列${idx + 1}`)}</div>
                                        <select
                                          value={Number(s?.yAxisIndex ?? 0)}
                                          onChange={(e) =>
                                            onUpdateChart(
                                              c.id,
                                              { option: setSeriesYAxisIndex(option, idx, Number(e.target.value)) },
                                              { recordHistory: true }
                                            )
                                          }
                                          className="px-2 py-1 text-sm border rounded"
                                        >
                                          <option value={0}>Y</option>
                                          <option value={1}>Y2</option>
                                        </select>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div className="space-y-2">
                                <div className="text-sm text-gray-700">阈值线</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() =>
                                      onUpdateChart(
                                        c.id,
                                        { option: setThresholdLine(option, !thresholdEnabled, thresholdValue, thresholdName, '#ef4444') },
                                        { recordHistory: true }
                                      )
                                    }
                                    className={`px-3 py-2 text-sm border rounded-lg ${thresholdEnabled ? 'bg-blue-50 border-blue-200' : ''}`}
                                  >
                                    {thresholdEnabled ? '已开启' : '已关闭'}
                                  </button>
                                  <input
                                    type="number"
                                    value={thresholdValue}
                                    onChange={(e) =>
                                      onUpdateChart(
                                        c.id,
                                        { option: setThresholdLine(option, true, Number(e.target.value), thresholdName, '#ef4444') },
                                        { recordHistory: true }
                                      )
                                    }
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                                    placeholder="阈值"
                                  />
                                </div>
                                <input
                                  value={thresholdName}
                                  onChange={(e) =>
                                    onUpdateChart(
                                      c.id,
                                      { option: setThresholdLine(option, true, thresholdValue, e.target.value, '#ef4444') },
                                      { recordHistory: true }
                                    )
                                  }
                                  className="w-full px-3 py-2 border rounded-lg text-sm"
                                  placeholder="阈值标签（可选）"
                                />
                              </div>
                            </>
                          ) : null}

                          {series.length > 1 ? (
                            <div className="space-y-2">
                              <div className="text-sm text-gray-700">系列顺序</div>
                              <div className="space-y-2">
                                {series.map((s: any, idx: number) => (
                                  <div key={idx} className="flex items-center gap-2">
                                    <div className="text-xs text-gray-600 flex-1 truncate">{String(s?.name ?? `系列${idx + 1}`)}</div>
                                    <button
                                      onClick={() => onUpdateChart(c.id, { option: moveSeries(option, idx, Math.max(0, idx - 1)) }, { recordHistory: true })}
                                      disabled={idx === 0}
                                      className="px-2 py-1 text-sm border rounded disabled:opacity-50"
                                    >
                                      上移
                                    </button>
                                    <button
                                      onClick={() => onUpdateChart(c.id, { option: moveSeries(option, idx, Math.min(series.length - 1, idx + 1)) }, { recordHistory: true })}
                                      disabled={idx === series.length - 1}
                                      className="px-2 py-1 text-sm border rounded disabled:opacity-50"
                                    >
                                      下移
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
