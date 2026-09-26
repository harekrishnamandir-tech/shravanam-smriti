import { EChart } from '../../components/charts/EChart'
import { barTop, chrome } from '../../components/charts/chartTheme'
import { fmtDate, fmtShortDate } from '../../lib/format'
import type { OverviewCourse } from '../../lib/overview'

/** Series slot for a course: stable by the course's position in the full list. */
export const courseColorVar = (index: number) => `--s${(index % 5) + 1}`

const weekLabel = (w: string) => fmtShortDate(w)

export function TrendChart({
  weeks,
  series,
  colorIndex,
}: {
  weeks: string[]
  series: { course: OverviewCourse; values: (number | null)[] }[]
  colorIndex: (courseId: string) => number
}) {
  return (
    <EChart
      ariaLabel="Average devotees per session, by week and course"
      deps={[weeks, series]}
      height={400}
      build={() => {
        const t = chrome()
        const color = (id: string) => t.colors[`s${(colorIndex(id) % 5) + 1}` as 's1']
        return {
          ...t.base,
          legend: { ...t.legend, type: 'scroll', data: series.map((s) => s.course.name) },
          grid: { ...t.base.grid, bottom: weeks.length > 26 ? 32 : 8 },
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            formatter: (ps: { dataIndex: number; seriesName: string; value: number | null; color: string }[]) =>
              `<b>Week of ${fmtDate(weeks[ps[0].dataIndex])}</b><br/>` +
              ps
                .filter((p) => p.value != null)
                .map((p) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: ${p.value} avg`)
                .join('<br/>'),
          },
          xAxis: { ...t.categoryAxis, data: weeks.map(weekLabel), boundaryGap: false },
          yAxis: { ...t.valueAxis, name: 'devotees' },
          dataZoom:
            weeks.length > 26
              ? [
                  { type: 'inside', start: 100 - (26 / weeks.length) * 100, end: 100 },
                  { type: 'slider', height: 18, bottom: 4, showDetail: false, start: 100 - (26 / weeks.length) * 100, end: 100 },
                ]
              : [],
          series: series.map((s) => ({
            name: s.course.name,
            type: 'line',
            data: s.values,
            connectNulls: true,
            showSymbol: weeks.length <= 20,
            symbolSize: 8,
            lineStyle: { width: 2, color: color(s.course.id) },
            itemStyle: { color: color(s.course.id), borderColor: t.colors.surface, borderWidth: 2 },
            emphasis: { focus: 'series' },
          })),
        }
      }}
    />
  )
}

export function VisitsChart({ rows }: { rows: { week: string; first: number; returning: number }[] }) {
  return (
    <EChart
      ariaLabel="Visits per week, split into first-time and returning devotees"
      deps={[rows]}
      height={260}
      build={() => {
        const t = chrome()
        return {
          ...t.base,
          legend: { ...t.legend, data: ['Returning', 'First time'] },
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (ps: { dataIndex: number }[]) => {
              const r = rows[ps[0].dataIndex]
              return `<b>Week of ${fmtDate(r.week)}</b><br/>${r.returning + r.first} visits · ${r.returning} returning · ${r.first} first time`
            },
          },
          xAxis: { ...t.categoryAxis, data: rows.map((r) => weekLabel(r.week)) },
          yAxis: { ...t.valueAxis, name: 'visits', minInterval: 1 },
          series: [
            {
              name: 'Returning',
              type: 'bar',
              stack: 'v',
              barMaxWidth: 22,
              itemStyle: { color: t.colors.s1, borderColor: t.colors.surface, borderWidth: 1 },
              data: rows.map((r) => r.returning),
            },
            {
              name: 'First time',
              type: 'bar',
              stack: 'v',
              barMaxWidth: 22,
              itemStyle: { color: t.colors.s2, borderColor: t.colors.surface, borderWidth: 1, ...barTop },
              data: rows.map((r) => r.first),
            },
          ],
        }
      }}
    />
  )
}
