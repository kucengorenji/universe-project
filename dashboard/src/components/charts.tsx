import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { niceTicks } from '../format.ts';

// Hand-rolled SVG charts in the dataviz spec: one series hue (The Green),
// 2px lines with a 10% wash, columns <= 24px with 4px rounded data-ends and a
// 2px surface gap, solid hairline grid, a crosshair/hover tooltip on every
// chart, keyboard focus showing the same, and a table view for each.

export interface Point { key: string; label: string; value: number }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const PAD = { top: 16, right: 44, bottom: 26, left: 40 };

function Frame({ width, height, ticks, y, labels, x }: { width: number; height: number; ticks: number[]; y: (v: number) => number; labels: Point[]; x: (i: number) => number }) {
  const picks = labels.length <= 1 ? [0] : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];
  return (
    <>
      <g className="grid">{ticks.map((t) => <line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />)}</g>
      <g className="axis">
        {ticks.map((t) => <text key={t} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{t.toLocaleString('id-ID')}</text>)}
        {[...new Set(picks)].map((i) => <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{labels[i]?.label}</text>)}
      </g>
    </>
  );
}

function ChartTable({ data, valueLabel, format }: { data: Point[]; valueLabel: string; format: (v: number) => string }) {
  return (
    <div className="table-wrap" style={{ marginTop: 12 }}>
      <table>
        <thead><tr><th>Tanggal</th><th className="num">{valueLabel}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num">{format(d.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

interface SeriesChartProps {
  data: Point[];
  valueLabel: string;
  format?: (v: number) => string;
  height?: number;
  stale?: boolean;
  kind: 'line' | 'columns';
}

/** One series over days: a line (continuous) or columns (counts). */
export function SeriesChart({ data, valueLabel, format = (v) => v.toLocaleString('id-ID'), height = 220, stale = false, kind }: SeriesChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = width - PAD.left - PAD.right, plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, data.length);
  const x = (i: number) => (kind === 'line' ? PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW) : PAD.left + band * i + band / 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const barW = Math.max(2, Math.min(24, band - 2));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    data.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setActive(best);
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!data.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(data.length - 1, (a ?? data.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
    }
  };

  const linePath = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
  const areaPath = data.length ? `${linePath}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const last = data.length - 1;
  const a = active === null ? null : data[active];
  const column = (v: number, i: number) => {
    const h = Math.max(0, y(0) - y(v)), x0 = x(i) - barW / 2, r = Math.min(4, h, barW / 2);
    if (h <= 0) return '';
    // Rounded at the data end, square at the baseline.
    return `M${x0},${y(0)}V${y(v) + r}Q${x0},${y(v)} ${x0 + r},${y(v)}H${x0 + barW - r}Q${x0 + barW},${y(v)} ${x0 + barW},${y(v) + r}V${y(0)}Z`;
  };

  return (
    <div className={`chart${stale ? ' is-stale' : ''}`} ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} height={height} role="img" aria-label={`${valueLabel}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`}
        tabIndex={0} onPointerMove={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive(last)} onBlur={() => setActive(null)} onKeyDown={keys}>
        <Frame width={width} height={height} ticks={ticks} y={y} labels={data} x={x} />
        {kind === 'line' ? (
          <>
            <path className="area" d={areaPath} />
            <path className="line" d={linePath} />
            {last >= 0 ? (
              <>
                <circle className="dot" cx={x(last)} cy={y(data[last].value)} r={4} />
                <text className="label label--value" x={x(last) + 8} y={y(data[last].value) + 4}>{format(data[last].value)}</text>
              </>
            ) : null}
          </>
        ) : (
          data.map((d, i) => <path key={d.key} className={`bar${active === i ? ' is-hot' : ''}`} d={column(d.value, i)} />)
        )}
        {a && active !== null ? (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} />
            {kind === 'line' ? <circle className="dot" cx={x(active)} cy={y(a.value)} r={5} /> : null}
          </g>
        ) : null}
      </svg>
      {a && active !== null ? (
        <div className="tooltip" style={{ left: `${(x(active) / width) * 100}%`, top: y(a.value) }}>
          <strong>{format(a.value)}</strong><span className="key" />{valueLabel} · {a.label}
        </div>
      ) : null}
      <div className="chart-foot"><button type="button" className="linkish" onClick={() => setTable((v) => !v)} aria-expanded={table}>{table ? 'Sembunyikan tabel' : 'Lihat tabel'}</button></div>
      {table ? <ChartTable data={data} valueLabel={valueLabel} format={format} /> : null}
    </div>
  );
}

/** Horizontal bars: label, bar, value at the tip. One hue; the scale is `max` (or the largest value). */
export function BarList({ items, max, format = (v) => v.toLocaleString('id-ID'), describe, empty = 'Belum ada data.' }: {
  items: { key: string; label: ReactNode; value: number }[];
  max?: number;
  format?: (v: number) => string;
  describe?: (item: { key: string; value: number }) => string;
  empty?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!items.length) return <p className="small muted">{empty}</p>;
  const scale = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="barlist">
      {items.map((it) => {
        const pct = scale > 0 ? Math.min(100, (it.value / scale) * 100) : 0;
        return (
          <li key={it.key} className="barlist__row" tabIndex={0} onPointerEnter={() => setHover(it.key)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(it.key)} onBlur={() => setHover(null)}>
            <span className="barlist__label">{it.label}</span>
            <span className="barlist__track">
              <span className="barlist__bar" style={{ width: `calc((100% - 56px) * ${(pct / 100).toFixed(4)})` }} />
              <span className="barlist__value">{format(it.value)}</span>
            </span>
            {hover === it.key && describe ? <span className="tooltip" style={{ left: '62%', top: 0 }}><strong>{format(it.value)}</strong>{describe(it)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
