/** Piezas compartidas de los reportes: periodos, exportar CSV, gráfica de barras y renglones */
import React, { useState } from 'react';
import { Platform, Pressable, Share, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { Button, Text } from '../../ui/primitives';
import { palette, space, fonts } from '../../theme/tokens';
import { getLanguage, t } from '../../i18n';
import { money } from '../../utils/format';
import { useIsWide } from '../../navigation/AppShell';

export const rt = (k: string, o?: Record<string, unknown>) => t(`reports.${k}`, o);

/** Colores de la gráfica (validados para daltonismo; se acompañan de leyenda y tabla) */
export const SERIES = { income: '#257de0', expense: '#f47230' };

const locale = () => (getLanguage() === 'en' ? 'en-US' : 'es-MX');
const pad = (n: number) => String(n).padStart(2, '0');
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'AAAA-MM' → 'oct' / 'oct 2026' */
export function monthLabel(ym: string, withYear = false) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat(locale(), withYear ? { month: 'short', year: 'numeric' } : { month: 'short' }).format(new Date(y, m - 1, 1));
  return s.replace('.', '');
}
export function monthLong(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  return s[0].toUpperCase() + s.slice(1);
}

export type MonthPeriod = 'last12' | 'thisYear' | 'lastYear';
export function monthPeriod(p: MonthPeriod): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (p === 'thisYear') return { from: `${y}-01`, to: `${y}-${pad(now.getMonth() + 1)}` };
  if (p === 'lastYear') return { from: `${y - 1}-01`, to: `${y - 1}-12` };
  return {};
}

export type DayPeriod = 'last30' | 'thisMonth' | 'lastMonth' | 'last90';
export function dayPeriod(p: DayPeriod): { from: string; to: string } {
  const now = new Date();
  if (p === 'thisMonth') return { from: ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymdLocal(now) };
  if (p === 'lastMonth') return { from: ymdLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymdLocal(new Date(now.getFullYear(), now.getMonth(), 0)) };
  const from = new Date(now); from.setDate(from.getDate() - (p === 'last90' ? 89 : 29));
  return { from: ymdLocal(from), to: ymdLocal(now) };
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function exportCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }); // BOM: Excel abre bien los acentos
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${filename}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: filename, message: csv });
}

export function ExportButton({ onPress }: { onPress: () => void }) {
  return <Button label={rt('exportCsv')} variant="ghost" size="sm" icon="download" onPress={onPress} />;
}

// ---------------------------------------------------------------------------
// Renglones y cifras
// ---------------------------------------------------------------------------
/** Renglón etiqueta … valor (para desgloses) */
export function Row({ label, value, strong, swatch, muted, indent }: {
  label: string; value: string; strong?: boolean; swatch?: string; muted?: boolean; indent?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: 6, paddingLeft: indent ? space.md : 0 }}>
      {swatch ? <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: swatch }} /> : null}
      <Text variant={strong ? 'bodyStrong' : 'body'} color={muted ? palette.ink2 : palette.ink} style={{ flex: 1, minWidth: 0 }}>{label}</Text>
      <Text variant={strong ? 'bodyStrong' : 'body'} color={muted ? palette.ink2 : palette.ink}>{value}</Text>
    </View>
  );
}

/** Tabla sencilla: primera columna a la izquierda, el resto a la derecha */
export function Table({ head, rows, foot, minColWidth = 92 }: {
  head: string[]; rows: (string | number)[][]; foot?: (string | number)[]; minColWidth?: number;
}) {
  const line = (r: (string | number)[], i: number, kind: 'head' | 'body' | 'foot') => (
    <View key={`${kind}-${i}`} style={{
      flexDirection: 'row', paddingVertical: 8, borderBottomWidth: kind === 'foot' ? 0 : 1, borderBottomColor: palette.lineSoft,
      borderTopWidth: kind === 'foot' ? 1 : 0, borderTopColor: palette.line,
    }}>
      {r.map((c, j) => (
        <Text key={j} variant={kind === 'body' ? 'small' : 'smallStrong'} color={kind === 'head' ? palette.ink2 : palette.ink}
          style={{ width: j === 0 ? 120 : minColWidth, flexGrow: j === 0 ? 1 : 0, textAlign: j === 0 ? 'left' : 'right', paddingHorizontal: 4 }}>
          {String(c)}
        </Text>
      ))}
    </View>
  );
  return (
    <View>
      {line(head, 0, 'head')}
      {rows.map((r, i) => line(r, i, 'body'))}
      {foot ? line(foot, 0, 'foot') : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gráfica de barras agrupadas (ingresos vs gastos por mes)
// ---------------------------------------------------------------------------
type Point = { key: string; label: string; values: number[] };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compact = (n: number, currency: string) => new Intl.NumberFormat(locale(), {
  style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
}).format(n);

/** Barra con esquinas superiores redondeadas y base plana en la línea cero */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function BarChart({ points, series, currency, selected, onSelect, height = 220 }: {
  points: Point[]; series: { name: string; color: string }[]; currency: string;
  selected: string | null; onSelect: (k: string | null) => void; height?: number;
}) {
  const [w, setW] = useState(0);
  const wide = useIsWide();
  const left = 52; const bottom = 24; const top = 8;
  const plotW = Math.max(0, w - left - 4);
  const plotH = height - bottom - top;
  const max = niceMax(Math.max(0, ...points.flatMap((p) => p.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const slot = points.length ? plotW / points.length : 0;
  const gap = 2;
  const barW = Math.max(3, Math.min(22, (slot * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const every = slot < 28 ? Math.ceil(28 / Math.max(slot, 1)) : 1;
  const y = (v: number) => top + plotH - (v / max) * plotH;

  return (
    <View style={{ gap: space.xs }}>
      {/* Leyenda */}
      <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: s.color }} />
            <Text variant="small" color={palette.ink2}>{s.name}</Text>
          </View>
        ))}
      </View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
        {w > 0 ? (
          <>
            <Svg width={w} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {ticks.map((v, i) => (
                <React.Fragment key={i}>
                  <Line x1={left} x2={w} y1={y(v)} y2={y(v)} stroke={i === 0 ? palette.line : palette.lineSoft} strokeWidth={1} />
                  <SvgText x={left - 6} y={y(v) + 4} fontSize={11} fill={palette.ink3} textAnchor="end" fontFamily={fonts.body}>{compact(v, currency)}</SvgText>
                </React.Fragment>
              ))}
              {points.map((p, i) => {
                const x0 = left + i * slot + (slot - groupW) / 2;
                const dim = selected && selected !== p.key;
                return (
                  <React.Fragment key={p.key}>
                    {selected === p.key ? <Path d={`M${left + i * slot},${top} h${slot} v${plotH} h${-slot} Z`} fill={palette.sunken} /> : null}
                    {p.values.map((v, j) => (
                      <Path key={j} d={barPath(x0 + j * (barW + gap), y(v), barW, y(0) - y(v))} fill={series[j].color} opacity={dim ? 0.35 : 1} />
                    ))}
                    {i % every === 0 ? (
                      <SvgText x={left + i * slot + slot / 2} y={height - 6} fontSize={11} fill={palette.ink2} textAnchor="middle" fontFamily={fonts.body}>{p.label}</SvgText>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </Svg>
            {/* Zonas táctiles: más grandes que las barras (toda la columna del mes) */}
            <View style={{ position: 'absolute', left, top: 0, width: plotW, height, flexDirection: 'row' }}>
              {points.map((p) => (
                <Pressable key={p.key} accessibilityRole="button" accessibilityLabel={`${p.label}: ${series.map((s, j) => `${s.name} ${money(p.values[j], currency)}`).join(', ')}`}
                  onPress={() => onSelect(selected === p.key ? null : p.key)}
                  onHoverIn={wide ? () => onSelect(p.key) : undefined}
                  style={{ width: slot, height }} />
              ))}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}
