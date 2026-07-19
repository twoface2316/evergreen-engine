'use strict';

/**
 * engine/lib/svg-chart.js — niche-agnostic build-time inline SVG line
 * chart. No JS chart library, no client-side rendering; the caller
 * embeds the returned <svg> markup directly into a page.
 *
 * Theme-aware by convention: callers pass CSS custom-property references
 * (e.g. "var(--chart-max)") as colors so the chart follows the site's
 * light/dark stylesheet instead of hardcoding colors here.
 */

/**
 * buildLineChartSvg({
 *   width, height,               // px, default 640x260
 *   padding: { l, r, t, b },     // default { l:34, r:10, t:14, b:26 }
 *   series: [ { data: number[], colorVar, strokeWidth } ],
 *   xLabels: string[],           // one label per data point (same length as each series.data)
 *   yTickFormat: (n) => string,  // default Math.round(n) + ''
 *   gridColorVar, labelColorVar, // default 'var(--border)', 'var(--text-muted)'
 *   ariaLabel, titleText
 * }) -> "<svg ...>...</svg>"
 */
function buildLineChartSvg(opts) {
  const {
    width = 640,
    height = 260,
    padding = {},
    series,
    xLabels = [],
    yTickFormat = (n) => String(Math.round(n)),
    gridColorVar = 'var(--border)',
    labelColorVar = 'var(--text-muted)',
    ariaLabel = 'Line chart',
    titleText = ''
  } = opts;

  if (!Array.isArray(series) || series.length === 0) {
    throw new TypeError('buildLineChartSvg: series must be a non-empty array');
  }

  const padL = padding.l ?? 34;
  const padR = padding.r ?? 10;
  const padT = padding.t ?? 14;
  const padB = padding.b ?? 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const pointCount = series[0].data.length;

  const all = series.flatMap((s) => s.data);
  const rawMin = Math.min.apply(null, all);
  const rawMax = Math.max.apply(null, all);
  const yMin = Math.floor((rawMin - 4) / 10) * 10;
  const yMax = Math.ceil((rawMax + 4) / 10) * 10;
  const yRange = Math.max(yMax - yMin, 10);

  const x = (i) => padL + (plotW * i) / Math.max(pointCount - 1, 1);
  const y = (v) => padT + plotH - ((v - yMin) / yRange) * plotH;

  const pathFor = (arr) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const gridStep = yRange <= 60 ? 10 : yRange <= 120 ? 20 : 30;
  let gridLines = '';
  let yLabels = '';
  for (let v = yMin; v <= yMax + 0.001; v += gridStep) {
    const gy = y(v).toFixed(1);
    gridLines += `<line x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" stroke="${gridColorVar}" stroke-width="1"/>`;
    yLabels += `<text x="${padL - 6}" y="${(parseFloat(gy) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${labelColorVar}">${yTickFormat(v)}</text>`;
  }

  let xLabelsSvg = '';
  for (let i = 0; i < pointCount; i++) {
    if (xLabels[i] == null) continue;
    xLabelsSvg += `<text x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="${labelColorVar}">${xLabels[i]}</text>`;
  }

  const paths = series
    .map(
      (s) =>
        `<path d="${pathFor(s.data)}" fill="none" stroke="${s.colorVar}" stroke-width="${s.strokeWidth ?? 2.25}" stroke-linejoin="round" stroke-linecap="round"/>`
    )
    .join('\n  ');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">
  ${titleText ? `<title>${titleText}</title>` : ''}
  ${gridLines}
  ${yLabels}
  ${xLabelsSvg}
  ${paths}
</svg>`;
}

module.exports = { buildLineChartSvg };
