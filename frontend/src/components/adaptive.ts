export type NumberFormatMode = 'auto' | 'raw' | 'comma' | 'wan' | 'yi';

const deepClone = (value: any): any => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
    return out;
  }
  return value;
};

const formatNumber = (value: any, mode: NumberFormatMode) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  const abs = Math.abs(n);

  if (mode === 'raw') return String(n);
  if (mode === 'comma') return n.toLocaleString();
  if (mode === 'wan') return `${(n / 1e4).toFixed(abs >= 1e6 ? 0 : 2)}万`;
  if (mode === 'yi') return `${(n / 1e8).toFixed(abs >= 1e10 ? 0 : 2)}亿`;

  if (abs >= 1e8) return `${(n / 1e8).toFixed(abs >= 1e10 ? 0 : 2)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(abs >= 1e6 ? 0 : 2)}万`;
  if (abs >= 1e3) return n.toLocaleString();
  return String(n);
};

const normalizeAxis = (axis: any) => {
  if (!axis) return axis;
  const axes = Array.isArray(axis) ? axis : [axis];
  const out = axes.map((a: any) => ({
    ...a,
    axisLabel: { ...(a?.axisLabel || {}), hideOverlap: true, margin: a?.axisLabel?.margin ?? 10 },
  }));
  return Array.isArray(axis) ? out : out[0];
};

export const applyAdaptiveOption = (option: any, numberFormat: NumberFormatMode = 'auto') => {
  const o = deepClone(option || {});

  const hasCartesian = !!(o.xAxis || o.yAxis);
  if (hasCartesian) {
    o.grid = {
      left: o.grid?.left ?? 24,
      right: o.grid?.right ?? 18,
      top: o.grid?.top ?? 44,
      bottom: o.grid?.bottom ?? 24,
      ...(o.grid || {}),
      containLabel: true,
    };
  }

  o.xAxis = normalizeAxis(o.xAxis);
  o.yAxis = normalizeAxis(o.yAxis);

  const applyNumericFormatter = (axis: any) => {
    if (!axis) return axis;
    const axes = Array.isArray(axis) ? axis : [axis];
    const out = axes.map((a: any) => {
      const type = String(a?.type || 'value');
      if (type !== 'value' && type !== 'log') return a;
      if (a?.axisLabel?.formatter) return a;
      return {
        ...a,
        axisLabel: {
          ...(a?.axisLabel || {}),
          formatter: (val: any) => formatNumber(val, numberFormat),
        },
      };
    });
    return Array.isArray(axis) ? out : out[0];
  };

  o.yAxis = applyNumericFormatter(o.yAxis);

  const xAxis = Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis;
  const xData = xAxis?.data;
  if (Array.isArray(xData) && xData.length >= 10) {
    o.xAxis = applyAxisLabelRotation(o.xAxis, 30);
  } else if (Array.isArray(xData) && xData.some((v) => String(v ?? '').length >= 10)) {
    o.xAxis = applyAxisLabelRotation(o.xAxis, 30);
  }

  if (Array.isArray(o.legend)) {
    o.legend = o.legend.map((l: any) => ({ ...l, type: l?.type || 'scroll' }));
  } else if (o.legend) {
    o.legend = { ...(o.legend || {}), type: o.legend?.type || 'scroll' };
  }

  return o;
};

const applyAxisLabelRotation = (axis: any, rotate: number) => {
  if (!axis) return axis;
  const axes = Array.isArray(axis) ? axis : [axis];
  const out = axes.map((a: any) => ({
    ...a,
    axisLabel: { ...(a?.axisLabel || {}), rotate, interval: a?.axisLabel?.interval ?? 0 },
  }));
  return Array.isArray(axis) ? out : out[0];
};

export const applyDataLabels = (option: any, show: boolean) => {
  const o = deepClone(option || {});
  const series = Array.isArray(o.series) ? o.series : [];
  o.series = series.map((s: any) => {
    if (!s || typeof s !== 'object') return s;
    if (String(s.type || '').toLowerCase() === 'pie') {
      return { ...s, label: { ...(s.label || {}), show } };
    }
    return { ...s, label: { ...(s.label || {}), show } };
  });
  return o;
};
