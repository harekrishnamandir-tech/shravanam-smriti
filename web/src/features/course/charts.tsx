import { useNavigate } from 'react-router-dom'
import { EChart } from '../../components/charts/EChart'
import { barTop, chrome } from '../../components/charts/chartTheme'
import { byMonth, byWeekday, histogram, joinBuckets, presentCells } from '../../lib/derive'
import { fmtDate, fmtMonth, fmtShortDate } from '../../lib/format'
import type { Dashboard, ParticipantStat, SessionStat } from '../../lib/types'

const sessionLabel = (s: SessionStat) => fmtShortDate(s.date) + (s.seq > 1 ? ` (${s.seq})` : '')

function zoom(n: number) {
  if (n <= 30) return []
  const start = Math.max(0, 100 - (30 / n) * 100)
  return [
    { type: 'inside', start, end: 100 },
    { type: 'slider', start, end: 100, height: 18, bottom: 4, borderColor: 'transparent', showDetail: false },
  ]
}

export function SessionsChart({
  sessions,
  selected,
  onSelect,
}: {
  sessions: SessionStat[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <EChart
      ariaLabel="Headcount per session, split into returning and first-time devotees"
      deps={[sessions, selected]}
      height={300}
      onClick={(p) => {
        const s = sessions[p.dataIndex]
        if (s) onSelect(s.id === selected ? null : s.id)
      }}
      build={() => {
        const t = chrome()
        const dim = (s: SessionStat) => (selected && s.id !== selected ? 0.3 : 1)
        const series = (name: string, color: string, key: 'returning_count' | 'new_count', top: boolean) => ({
          name,
          type: 'bar',
          stack: 'h',
          barMaxWidth: 22,
          cursor: 'pointer',
          itemStyle: { color }, // legend swatch
          data: sessions.map((s) => ({
            value: s[key],
            itemStyle: {
              color,
              opacity: dim(s),
              borderColor: t.colors.surface,
              borderWidth: 1,
              ...(top ? barTop : {}),
            },
          })),
        })
        return {
          ...t.base,
          grid: { ...t.base.grid, bottom: sessions.length > 30 ? 32 : 8 },
          legend: { ...t.legend, data: ['Returning', 'First time'] },
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (ps: { dataIndex: number }[]) => {
              const s = sessions[ps[0].dataIndex]
              return `<b>${fmtDate(s.date)}${s.seq > 1 ? ` · session ${s.seq}` : ''}</b><br/>
                ${s.headcount} present · ${s.returning_count} returning · ${s.new_count} first time<br/>
                Avg ${Math.round(s.avg_seconds / 60)} min of ${Math.round(s.duration_sec / 60)} · ${s.full_count} stayed to the end<br/>
                <span style="opacity:.7">Click to filter devotees</span>`
            },
          },
          xAxis: { ...t.categoryAxis, data: sessions.map(sessionLabel) },
          yAxis: { ...t.valueAxis, name: 'devotees', minInterval: 1 },
          dataZoom: zoom(sessions.length),
          series: [series('Returning', t.colors.s1, 'returning_count', false), series('First time', t.colors.s2, 'new_count', true)],
        }
      }}
    />
  )
}

export function AvgMinutesChart({ sessions }: { sessions: SessionStat[] }) {
  return (
    <EChart
      ariaLabel="Average minutes in the call per session"
      deps={[sessions]}
      height={220}
      build={() => {
        const t = chrome()
        return {
          ...t.base,
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            formatter: (ps: { dataIndex: number }[]) => {
              const s = sessions[ps[0].dataIndex]
              return `<b>${fmtDate(s.date)}</b><br/>Avg ${Math.round(s.avg_seconds / 60)} min · session ${Math.round(s.duration_sec / 60)} min`
            },
          },
          grid: { ...t.base.grid, top: 24, bottom: sessions.length > 30 ? 32 : 8 },
          xAxis: { ...t.categoryAxis, data: sessions.map(sessionLabel), boundaryGap: false },
          yAxis: { ...t.valueAxis, name: 'minutes' },
          dataZoom: zoom(sessions.length),
          series: [
            {
              type: 'line',
              data: sessions.map((s) => Math.round(s.avg_seconds / 60)),
              showSymbol: sessions.length <= 40,
              symbolSize: 8,
              lineStyle: { width: 2, color: t.colors.s1 },
              itemStyle: { color: t.colors.s1, borderColor: t.colors.surface, borderWidth: 2 },
              areaStyle: { color: t.colors.s1, opacity: 0.08 },
            },
          ],
        }
      }}
    />
  )
}

export function AttendanceHeatmap({
  d,
  people,
  slug,
}: {
  d: Dashboard
  people: ParticipantStat[]
  slug: string
}) {
  const navigate = useNavigate()
  const rows = people.slice(0, 40)
  const rowIdx = new Map(rows.map((p, i) => [p.id, i]))
  const colIdx = new Map(d.sessions.map((s, i) => [s.id, i]))
  const cells = presentCells(d)
    .filter((c) => rowIdx.has(c[1]) && colIdx.has(c[0]))
    .map((c) => [colIdx.get(c[0])!, rowIdx.get(c[1])!, Math.round(c[2] / 60)])
  const maxMin = Math.max(30, ...d.sessions.map((s) => Math.round(s.duration_sec / 60)))

  return (
    <EChart
      ariaLabel="Attendance heatmap: devotees by session, shaded by minutes attended"
      deps={[d, people]}
      height={Math.max(220, rows.length * 20 + 90)}
      onClick={(p) => {
        const r = rows[(p.data as number[])[1]]
        if (r) navigate(`/c/${slug}/p/${r.id}`)
      }}
      build={() => {
        const t = chrome()
        return {
          ...t.base,
          grid: { left: 8, right: 16, top: 8, bottom: d.sessions.length > 30 ? 64 : 40, containLabel: true },
          tooltip: {
            ...t.base.tooltip,
            formatter: (p: { data: number[] }) => {
              const [x, y, m] = p.data
              return `<b>${rows[y].name}</b><br/>${fmtDate(d.sessions[x].date)} · ${m} min`
            },
          },
          xAxis: { ...t.categoryAxis, data: d.sessions.map(sessionLabel), splitArea: { show: false } },
          yAxis: {
            ...t.categoryAxis,
            data: rows.map((r) => r.name),
            inverse: true,
            axisLabel: { ...t.categoryAxis.axisLabel, width: 130, overflow: 'truncate' },
          },
          visualMap: {
            min: 0,
            max: maxMin,
            calculable: false,
            orient: 'horizontal',
            left: 'center',
            bottom: d.sessions.length > 30 ? 28 : 0,
            itemHeight: 120,
            itemWidth: 10,
            text: [`${maxMin} min`, '0'],
            textStyle: { color: t.colors.muted, fontSize: 11 },
            inRange: { color: t.colors.seq.slice(1) },
          },
          dataZoom: d.sessions.length > 30 ? [{ type: 'slider', xAxisIndex: 0, height: 14, bottom: 4, showDetail: false, start: Math.max(0, 100 - (30 / d.sessions.length) * 100), end: 100 }] : [],
          series: [
            {
              type: 'heatmap',
              data: cells,
              cursor: 'pointer',
              itemStyle: { borderColor: t.colors.surface, borderWidth: 2, borderRadius: 3 },
              emphasis: { itemStyle: { borderColor: t.colors.ink, borderWidth: 1 } },
            },
          ],
        }
      }}
    />
  )
}

function SimpleBars({
  labels,
  values,
  ariaLabel,
  unit,
  height = 220,
  tooltip,
}: {
  labels: string[]
  values: number[]
  ariaLabel: string
  unit: string
  height?: number
  tooltip?: (i: number) => string
}) {
  return (
    <EChart
      ariaLabel={ariaLabel}
      deps={[labels.join('|'), values.join('|')]}
      height={height}
      build={() => {
        const t = chrome()
        return {
          ...t.base,
          grid: { ...t.base.grid, top: 24 },
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (ps: { dataIndex: number }[]) =>
              tooltip ? tooltip(ps[0].dataIndex) : `<b>${labels[ps[0].dataIndex]}</b><br/>${values[ps[0].dataIndex]} ${unit}`,
          },
          xAxis: { ...t.categoryAxis, data: labels },
          yAxis: { ...t.valueAxis, name: unit, minInterval: 1 },
          series: [{ type: 'bar', data: values, barMaxWidth: 28, itemStyle: { color: t.colors.s1, ...barTop } }],
        }
      }}
    />
  )
}

export function TimeInCallChart({ d, sessionIds }: { d: Dashboard; sessionIds: Set<string> }) {
  const mins = presentCells(d)
    .filter((c) => sessionIds.has(c[0]))
    .map((c) => c[2] / 60)
  const bins = histogram(mins, 10, 10)
  return (
    <SimpleBars
      ariaLabel="How long devotees stay: distribution of minutes in call"
      labels={bins.map((b) => b.label)}
      values={bins.map((b) => b.count)}
      unit="visits"
      tooltip={(i) => `<b>${bins[i].label} min</b><br/>${bins[i].count} visits`}
    />
  )
}

export function JoinTimeChart({ d, sessionIds }: { d: Dashboard; sessionIds: Set<string> }) {
  const delays = presentCells(d)
    .filter((c) => sessionIds.has(c[0]))
    .map((c) => c[3])
  const b = joinBuckets(delays)
  return (
    <SimpleBars
      ariaLabel="When devotees join relative to the start of the session"
      labels={b.map((x) => x.label)}
      values={b.map((x) => x.count)}
      unit="visits"
    />
  )
}

export function WeekdayChart({ sessions }: { sessions: SessionStat[] }) {
  const w = byWeekday(sessions)
  return (
    <SimpleBars
      ariaLabel="Average headcount by day of week"
      labels={w.map((x) => x.label)}
      values={w.map((x) => Math.round(x.avgHeadcount * 10) / 10)}
      unit="avg devotees"
      tooltip={(i) => `<b>${w[i].label}</b><br/>${w[i].avgHeadcount.toFixed(1)} avg devotees · ${w[i].sessions} sessions`}
    />
  )
}

export function MonthChart({ d }: { d: Dashboard }) {
  const m = byMonth(d)
  return (
    <EChart
      ariaLabel="Average headcount and unique devotees per month"
      deps={[d]}
      height={240}
      build={() => {
        const t = chrome()
        return {
          ...t.base,
          legend: { ...t.legend, data: ['Avg per session', 'Unique devotees'] },
          tooltip: {
            ...t.base.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (ps: { dataIndex: number }[]) => {
              const x = m[ps[0].dataIndex]
              return `<b>${fmtMonth(x.month)}</b><br/>${x.sessions} sessions<br/>${x.avgHeadcount.toFixed(1)} avg per session<br/>${x.unique} unique devotees`
            },
          },
          xAxis: { ...t.categoryAxis, data: m.map((x) => fmtMonth(x.month)) },
          yAxis: { ...t.valueAxis, name: 'devotees', minInterval: 1 },
          series: [
            {
              name: 'Avg per session',
              type: 'bar',
              barMaxWidth: 24,
              barGap: '10%',
              data: m.map((x) => Math.round(x.avgHeadcount * 10) / 10),
              itemStyle: { color: t.colors.s1, ...barTop },
            },
            {
              name: 'Unique devotees',
              type: 'bar',
              barMaxWidth: 24,
              data: m.map((x) => x.unique),
              itemStyle: { color: t.colors.s3, ...barTop },
            },
          ],
        }
      }}
    />
  )
}
