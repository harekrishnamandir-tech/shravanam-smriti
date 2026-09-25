import { cssVar } from '../../lib/theme'

/** Shared chart chrome: recessive axes/grid, text in ink tokens, themed tooltip. */
export function chrome() {
  const ink = cssVar('--ink')
  const ink2 = cssVar('--ink-2')
  const muted = cssVar('--muted')
  const grid = cssVar('--grid')
  const axis = cssVar('--axis')
  const surface = cssVar('--surface')
  return {
    colors: {
      s1: cssVar('--s1'),
      s2: cssVar('--s2'),
      s3: cssVar('--s3'),
      s4: cssVar('--s4'),
      s5: cssVar('--s5'),
      seq: [0, 1, 2, 3, 4, 5].map((i) => cssVar(`--seq-${i}`)),
      surface,
      ink,
      ink2,
      muted,
    },
    base: {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: ink2 },
      animationDuration: 400,
      tooltip: {
        backgroundColor: surface,
        borderColor: cssVar('--line'),
        borderWidth: 1,
        textStyle: { color: ink, fontSize: 12 },
        extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);',
      },
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    },
    categoryAxis: {
      type: 'category' as const,
      axisLine: { lineStyle: { color: axis } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 11 },
    },
    valueAxis: {
      type: 'value' as const,
      splitLine: { lineStyle: { color: grid } },
      axisLabel: { color: muted, fontSize: 11 },
      nameTextStyle: { color: muted, fontSize: 11 },
    },
    legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: ink2, fontSize: 12 } },
  }
}

/** 4px rounded data-end on the top of a bar. */
export const barTop = { borderRadius: [4, 4, 0, 0] }
