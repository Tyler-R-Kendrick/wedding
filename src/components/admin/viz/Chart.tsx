"use client";

/*
 * Bar, line, area, pie and donut charts as plain SVG. Adapted from open-intelligent-ui (thesysdev),
 * MIT licence (../assistant/openui/functions/LICENSE-open-intelligent-ui.txt): the same `Chart`
 * arguments and the same geometry, with this console's ink-and-paper palette, flat fills (the
 * design system has no gradients), square bar ends, and a data table for readers who cannot see it.
 */
import "./viz.css";
import { useLayoutEffect, useState, type PointerEvent } from "react";

type Row = Record<string, unknown>;
type Format = (value: number, compact?: boolean) => string;
type Spec = {
  type: ChartType;
  rows: Row[];
  x: string;
  series: string[];
  stacked: boolean;
  height: number;
  format: Format;
};

const COLORS = 6;
// Written out, not built from a template: each is a custom property a reader (and the css-vars test) can find.
const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];
const seriesColor = (i: number) => SERIES[i % COLORS] ?? "var(--viz-1)";
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value) || 0;
const label = (row: Row, x: string) => String(row[x] ?? "");

function makeFormat(
  kind: string | undefined,
  currency: string | undefined,
): Format {
  const code =
    typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency)
      ? currency.toUpperCase()
      : "USD";
  // Axis ticks are compact ("$2B"); tooltips keep two decimals ("$1.24B").
  return (value, compact) => {
    if (kind === "percent") return `${Number(value.toFixed(compact ? 1 : 2))}%`;
    const big = Math.abs(value) >= (compact ? 1000 : 1e6);
    const options: Intl.NumberFormatOptions = {
      minimumFractionDigits: 0,
      maximumFractionDigits: compact && big ? 1 : 2,
      ...(big ? { notation: "compact" } : {}),
    };
    return value.toLocaleString(
      "en-US",
      kind === "currency"
        ? { ...options, style: "currency", currency: code }
        : options,
    );
  };
}

function niceStep(span: number) {
  if (span <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(span));
  const n = span / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/**
 * The plot's width, measured. The element arrives through a callback ref held in state, so a chart
 * that first renders with nothing to draw (and so no figure) still starts measuring when its
 * figure appears; an effect keyed on a plain ref would have run once, against nothing.
 */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

function Legend({
  series,
  names,
}: {
  series: string[];
  names: Record<string, string>;
}) {
  if (series.length < 2) return null;
  return (
    <div className="viz-chart-legend">
      {series.map((s, i) => (
        <span key={s}>
          <i style={{ background: seriesColor(i) }} />
          {names[s] ?? s}
        </span>
      ))}
    </div>
  );
}

function Cartesian({
  spec,
  width,
  names,
}: {
  spec: Spec;
  width: number;
  names: Record<string, string>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { rows, series, type, height, format, x } = spec;
  const stacked = spec.stacked && type !== "line";
  const tops = rows.map((row) => {
    let total = 0;
    return series.map((s) => (total += Math.max(0, num(row[s]))));
  });
  const values = stacked
    ? tops.map((t) => t[t.length - 1] ?? 0)
    : rows.flatMap((row) => series.map((s) => num(row[s])));
  const step = niceStep((Math.max(0, ...values) - Math.min(0, ...values)) / 5);
  const lo = Math.floor(Math.min(0, ...values) / step) * step;
  const hi = Math.max(
    lo + step,
    Math.ceil(Math.max(0, ...values) / step) * step,
  );
  const ticks = Array.from(
    { length: Math.round((hi - lo) / step) + 1 },
    (_, k) => lo + k * step,
  );
  const left = Math.max(...ticks.map((t) => format(t, true).length)) * 6.4 + 12;
  const pad = { top: 10, right: 4, bottom: 26, left };
  const w = Math.max(10, width - pad.left - pad.right);
  const h = Math.max(10, height - pad.top - pad.bottom);
  const band = w / Math.max(1, rows.length);
  const xAt = (i: number) => pad.left + band * i + band / 2;
  const y = (v: number) => pad.top + h - ((v - lo) / (hi - lo)) * h;
  // Label every nth category so the labels never overlap.
  const longest = Math.max(1, ...rows.map((r) => label(r, x).length));
  const every = Math.max(1, Math.ceil((longest * 6.6 + 10) / band));
  const shown = (i: number) => i % every === 0;
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.floor((event.clientX - box.left - pad.left) / band);
    setHover(i >= 0 && i < rows.length ? i : null);
  };
  const tip = hover === null ? null : rows[hover];
  return (
    <div className="viz-chart-plot" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-hidden="true"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={pad.left + w}
              y1={y(t)}
              y2={y(t)}
              className="viz-chart-grid"
              strokeDasharray={t === 0 ? undefined : "3 4"}
            />
            <text
              x={pad.left - 10}
              y={y(t) + 4}
              textAnchor="end"
              className="viz-chart-tick"
            >
              {format(t, true)}
            </text>
          </g>
        ))}
        {rows.map((row, i) =>
          shown(i) ? (
            <text
              key={i}
              x={xAt(i)}
              y={height - 6}
              textAnchor="middle"
              className="viz-chart-category"
            >
              {label(row, x)}
            </text>
          ) : null,
        )}
        {hover !== null && type === "bar" && (
          <rect
            x={pad.left + band * hover}
            y={pad.top}
            width={band}
            height={h}
            className="viz-chart-hover"
          />
        )}
        {type === "bar" &&
          rows.map((row, i) => {
            const inner = Math.min(
              band * 0.7,
              72 * Math.max(1, stacked ? 1 : series.length),
            );
            if (stacked)
              return series.map((s, si) => {
                const top = y(tops[i]?.[si] ?? 0);
                const base = y(tops[i]?.[si - 1] ?? 0);
                return (
                  <rect
                    key={`${i}-${s}`}
                    x={xAt(i) - inner / 2}
                    y={top}
                    width={inner}
                    height={Math.max(0, base - top)}
                    fill={seriesColor(si)}
                    rx={si === series.length - 1 ? 2 : 0}
                  />
                );
              });
            const each = inner / series.length;
            return series.map((s, si) => {
              const v = num(row[s]);
              return (
                <rect
                  key={`${i}-${s}`}
                  x={xAt(i) - inner / 2 + each * si + 1}
                  y={Math.min(y(v), y(0))}
                  width={Math.max(1, each - 2)}
                  height={Math.abs(y(0) - y(v))}
                  rx={2}
                  fill={seriesColor(si)}
                />
              );
            });
          })}
        {(type === "line" || type === "area") &&
          series.map((s, si) => {
            const top = (i: number) =>
              stacked ? (tops[i]?.[si] ?? 0) : num(rows[i]?.[s]);
            const base = (i: number) => (stacked ? (tops[i]?.[si - 1] ?? 0) : 0);
            const points = rows.map(
              (_, i) => `${xAt(i).toFixed(1)},${y(top(i)).toFixed(1)}`,
            );
            const under = rows
              .map((_, i) => `${xAt(i).toFixed(1)},${y(base(i)).toFixed(1)}`)
              .reverse();
            return (
              <g key={s}>
                {type === "area" && rows.length > 1 && (
                  <path
                    d={`M${points.join("L")}L${under.join("L")}Z`}
                    fill={seriesColor(si)}
                    fillOpacity={stacked ? 0.4 : 0.12}
                  />
                )}
                <path
                  d={`M${points.join("L")}`}
                  fill="none"
                  stroke={seriesColor(si)}
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {(rows.length <= 16 || hover !== null) &&
                  rows.map((_, i) =>
                    rows.length <= 16 || i === hover ? (
                      <circle
                        key={i}
                        cx={xAt(i)}
                        cy={y(top(i))}
                        r={i === hover ? 4.5 : 3}
                        fill={seriesColor(si)}
                        stroke="var(--color-neutral)"
                        strokeWidth={1.5}
                      />
                    ) : null,
                  )}
              </g>
            );
          })}
        {hover !== null && type !== "bar" && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={pad.top}
            y2={pad.top + h}
            className="viz-chart-guide"
          />
        )}
      </svg>
      {tip && (
        <div
          className="viz-chart-tooltip"
          style={{
            left: Math.min(Math.max(xAt(hover!), 70), width - 70),
            top: pad.top,
          }}
        >
          <strong>{label(tip, x)}</strong>
          {series.map((s, si) => (
            <span key={s}>
              <i style={{ background: seriesColor(si) }} />
              {series.length > 1 ? `${names[s] ?? s} ` : ""}
              <b>{format(num(tip[s]))}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Pie({ spec, width }: { spec: Spec; width: number }) {
  const key = spec.series[0];
  const items = spec.rows.map((row) => ({
    label: label(row, spec.x),
    value: Math.max(0, num(key ? row[key] : 0)),
  }));
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const size = Math.max(80, Math.min(200, width < 420 ? width * 0.62 : 200));
  const r = size / 2;
  const inner = spec.type === "donut" ? r * 0.62 : 0;
  // Each slice's start angle is the sum of the sweeps before it, worked out before anything is drawn.
  const sweeps = items.map((item) => (item.value / total) * Math.PI * 2);
  const starts = sweeps.map((_, i) => -Math.PI / 2 + sweeps.slice(0, i).reduce((sum, v) => sum + v, 0));
  const point = (radius: number, a: number) =>
    `${(r + radius * Math.cos(a)).toFixed(2)},${(r + radius * Math.sin(a)).toFixed(2)}`;
  return (
    <div className="viz-pie">
      <svg width={size} height={size} aria-hidden="true">
        {items.map((item, i) => {
          const sweep = sweeps[i] ?? 0;
          const a0 = starts[i] ?? 0;
          const a1 = a0 + sweep;
          const large = sweep > Math.PI ? 1 : 0;
          if (sweep >= Math.PI * 2 - 1e-6)
            return inner ? (
              <circle
                key={i}
                cx={r}
                cy={r}
                r={(r + inner) / 2}
                fill="none"
                stroke={seriesColor(i)}
                strokeWidth={r - inner}
              />
            ) : (
              <circle key={i} cx={r} cy={r} r={r} fill={seriesColor(i)} />
            );
          const d = inner
            ? `M${point(r, a0)}A${r},${r} 0 ${large} 1 ${point(r, a1)}L${point(inner, a1)}A${inner},${inner} 0 ${large} 0 ${point(inner, a0)}Z`
            : `M${r},${r}L${point(r, a0)}A${r},${r} 0 ${large} 1 ${point(r, a1)}Z`;
          return (
            <path
              key={i}
              d={d}
              fill={seriesColor(i)}
              stroke="var(--color-neutral)"
              strokeWidth={2}
            >
              <title>{`${item.label}: ${spec.format(item.value)}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="viz-pie-legend">
        {items.map((item, i) => (
          <div key={i}>
            <i style={{ background: seriesColor(i) }} />
            <span>{item.label}</span>
            <b>{`${Math.round((item.value / total) * 1000) / 10}%`}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ChartType = "bar" | "line" | "area" | "pie" | "donut";
export type ChartProps = {
  type: ChartType;
  data: Row[];
  /** The category key. Default: the first text key. */
  x?: string;
  /** The value keys. Default: every number key. */
  series?: string[];
  format?: "number" | "currency" | "percent";
  currency?: string;
  stacked?: boolean;
  height?: number;
  /** Names the chart for a screen reader and captions its data table. */
  label?: string;
  /** Legend and table names for series keys ("pageviews" → "Pages opened"). */
  names?: Record<string, string>;
};

const TYPES: readonly ChartType[] = ["bar", "line", "area", "pie", "donut"];

function toSpec(props: ChartProps): Spec | null {
  const rows = (
    (Array.isArray(props.data) ? props.data : []) as unknown[]
  ).filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r));
  const first = rows[0];
  if (!first) return null;
  const x =
    (props.x && props.x in first ? props.x : null) ??
    Object.keys(first).find((k) => typeof first[k] === "string") ??
    Object.keys(first)[0]!;
  const series = (
    props.series?.length
      ? props.series.filter((s) => typeof s === "string")
      : Object.keys(first).filter(
          (k) => k !== x && typeof first[k] === "number",
        )
  ).slice(0, 6);
  return {
    type: TYPES.includes(props.type) ? props.type : "bar",
    rows,
    x,
    series,
    stacked: !!props.stacked,
    height: Math.min(480, Math.max(120, props.height ?? 220)),
    format: makeFormat(props.format, props.currency),
  };
}

/** The same numbers as a table: what a screen reader reads, and what a sighted reader can open. */
function DataTable({
  spec,
  label,
  names,
}: {
  spec: Spec;
  label: string;
  names: Record<string, string>;
}) {
  return (
    <details className="viz-data">
      <summary>Data</summary>
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">{names[spec.x] ?? spec.x}</th>
            {spec.series.map((s) => (
              <th key={s} scope="col">
                {names[s] ?? s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, i) => (
            <tr key={i}>
              <th scope="row">{String(row[spec.x] ?? "")}</th>
              {spec.series.map((s) => (
                <td key={s}>{spec.format(num(row[s]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function Chart(props: ChartProps) {
  const [ref, width] = useWidth();
  const spec = toSpec(props);
  const names = props.names ?? {};
  const pie = spec?.type === "pie" || spec?.type === "donut";
  const label =
    props.label ??
    (spec
      ? `${spec.series.map((s) => names[s] ?? s).join(", ")} by ${names[spec.x] ?? spec.x}`
      : "Chart");
  if (!spec) {
    return (
      <p className="viz-empty" role="status">
        Nothing to chart yet.
      </p>
    );
  }
  const named: Spec = { ...spec };
  return (
    <figure className="viz-chart" ref={ref} aria-label={label}>
      {width > 0 ? (
        pie ? (
          <Pie spec={named} width={width} />
        ) : (
          <Cartesian spec={named} width={width} names={names} />
        )
      ) : (
        <div style={{ height: spec.height }} />
      )}
      {!pie && <Legend series={spec.series} names={names} />}
      <DataTable spec={spec} label={label} names={names} />
    </figure>
  );
}
