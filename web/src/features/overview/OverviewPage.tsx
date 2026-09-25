import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Empty, ErrorBox, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import type { CourseCard } from '../../lib/types'
import { useAuth } from '../auth/AuthProvider'

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-10" />
  const w = 160
  const h = 40
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - (v / max) * (h - 8)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-40" aria-label={`Recent headcounts: ${values.join(', ')}`} role="img">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="var(--s1)" opacity="0.1" />
      <path d={d} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--s1)" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xl font-semibold text-ink">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

function CourseTile({ c }: { c: CourseCard }) {
  return (
    <Link
      to={`/c/${c.slug}`}
      className="group block rounded-2xl border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl leading-tight font-semibold text-ink group-hover:text-brand">{c.name}</h3>
          {c.schedule_note && <p className="mt-0.5 text-sm text-muted">{c.schedule_note}</p>}
        </div>
        {c.status !== 'active' && <Badge tone={c.status === 'paused' ? 'gold' : 'neutral'}>{c.status}</Badge>}
      </div>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="grid grid-cols-3 gap-5">
          <Stat label="sessions" value={c.sessions} />
          <Stat label="devotees" value={c.participants} />
          <Stat label="avg / session" value={c.avg_headcount ?? '—'} />
        </div>
        <Sparkline values={c.spark} />
      </div>
      <p className="mt-4 text-xs text-muted">Last session: {fmtDate(c.last_session_date)}</p>
    </Link>
  )
}

export function OverviewPage() {
  const { me } = useAuth()
  const [showArchived, setShowArchived] = useState(false)
  const q = useQuery({ queryKey: ['overview'], queryFn: api.coursesOverview })

  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorBox error={q.error} />
  const all = q.data ?? []
  const courses = all.filter((c) => showArchived || c.status !== 'archived')
  const archived = all.length - all.filter((c) => c.status !== 'archived').length

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold text-ink">Courses</h1>
          <p className="mt-1 text-sm text-muted">Who is hearing, how often, and for how long.</p>
        </div>
        <div className="flex gap-2">
          {archived > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archived})
            </Button>
          )}
          <Link to="/upload">
            <Button variant="primary">Upload attendance</Button>
          </Link>
        </div>
      </div>
      {courses.length === 0 ? (
        <Empty title="No courses yet">
          {me?.role === 'super_admin' ? (
            <Link className="text-brand underline" to="/admin/courses">
              Create the first course
            </Link>
          ) : (
            'Ask a super admin to assign you a course.'
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <CourseTile key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}
