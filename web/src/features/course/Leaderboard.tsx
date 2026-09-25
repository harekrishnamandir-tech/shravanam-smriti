import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button } from '../../components/ui'
import { downloadCsv } from '../../lib/csvExport'
import { fmtDate, fmtHours } from '../../lib/format'
import type { ParticipantStat } from '../../lib/types'
import { SEGMENT_META } from './segments'

type Key = 'name' | 'sessions_attended' | 'attendance_pct' | 'total_seconds' | 'avg_seconds' | 'longest_streak' | 'current_streak' | 'last_date'

const COLS: { key: Key; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Devotee' },
  { key: 'sessions_attended', label: 'Sessions', numeric: true },
  { key: 'attendance_pct', label: 'Attendance', numeric: true },
  { key: 'total_seconds', label: 'Total hours', numeric: true },
  { key: 'avg_seconds', label: 'Avg min', numeric: true },
  { key: 'longest_streak', label: 'Best streak', numeric: true },
  { key: 'current_streak', label: 'Current streak', numeric: true },
  { key: 'last_date', label: 'Last attended' },
]

export function Leaderboard({
  people,
  slug,
  courseName,
  sessionMinutes,
}: {
  people: ParticipantStat[]
  slug: string
  courseName: string
  /** When a single session is selected: minutes each devotee spent in it. */
  sessionMinutes?: Map<string, number>
}) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'sessions_attended', dir: -1 })
  const [limit, setLimit] = useState(50)

  const rows = useMemo(() => {
    const r = [...people]
    r.sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return c * sort.dir || b.total_seconds - a.total_seconds
    })
    return r
  }, [people, sort])

  const exportCsv = () =>
    downloadCsv(
      `${slug}-devotees.csv`,
      ['Name', 'Segment', 'Sessions', 'Attendance %', 'Total hours', 'Avg minutes', 'Best streak', 'Current streak', 'First attended', 'Last attended'],
      rows.map((p) => [
        p.name,
        SEGMENT_META[p.segment].label,
        p.sessions_attended,
        p.attendance_pct,
        (p.total_seconds / 3600).toFixed(1),
        Math.round(p.avg_seconds / 60),
        p.longest_streak,
        p.current_streak,
        p.first_date,
        p.last_date,
      ]),
    )

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {people.length} devotee{people.length === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={exportCsv} disabled={!rows.length} title={`Export ${courseName} devotees as CSV`}>
          Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-xs tracking-wide text-ink-2 uppercase">
            <tr>
              <th className="w-10 px-3 py-2.5">#</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 font-medium ${c.numeric ? 'text-right' : ''}`}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    className="inline-flex items-center gap-1 hover:text-ink"
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : c.numeric ? -1 : 1 }))}
                  >
                    {c.label}
                    <span aria-hidden="true" className="text-muted">
                      {sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
              {sessionMinutes && <th className="px-3 py-2.5 text-right font-medium">This session</th>}
            </tr>
          </thead>
          <tbody className="tabular divide-y divide-[var(--line)]">
            {rows.slice(0, limit).map((p, i) => (
              <tr key={p.id} className="hover:bg-surface-2/60">
                <td className="px-3 py-2 text-muted">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link to={`/c/${slug}/p/${p.id}`} className="font-medium text-ink hover:text-brand">
                    {p.name}
                  </Link>{' '}
                  <span title={SEGMENT_META[p.segment].hint}>
                    <Badge tone={SEGMENT_META[p.segment].tone}>{SEGMENT_META[p.segment].label}</Badge>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{p.sessions_attended}</td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 sm:inline-block">
                      <span className="block h-full rounded-full bg-[var(--s1)]" style={{ width: `${Math.min(p.attendance_pct, 100)}%` }} />
                    </span>
                    {Math.round(p.attendance_pct)}%
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{fmtHours(p.total_seconds)}</td>
                <td className="px-3 py-2 text-right">{Math.round(p.avg_seconds / 60)}</td>
                <td className="px-3 py-2 text-right">{p.longest_streak}</td>
                <td className="px-3 py-2 text-right">{p.current_streak || '—'}</td>
                <td className="px-3 py-2">{fmtDate(p.last_date)}</td>
                {sessionMinutes && <td className="px-3 py-2 text-right">{sessionMinutes.get(p.id) ?? '—'} min</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="mt-3 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 100)}>
            Show more ({rows.length - limit} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
