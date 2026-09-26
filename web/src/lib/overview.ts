// Aggregations for the home analytics page. The server returns compact rows
// for every accessible course; everything here runs on the selected subset.

export interface OverviewCourse {
  id: string
  slug: string
  name: string
  status: string
  timezone: string
  regular_threshold_pct: number
  min_present_minutes: number
}

/** [id, course_id, date, started_at, duration_sec, headcount, new_count, avg_seconds] */
export type OverviewSession = [string, string, string, string, number, number, number, number]
/** [participant_id, course_id, sessions, seconds, last_date, first_date] */
export type OverviewPerson = [string, string, number, number, string, string]

export interface OverviewData {
  courses: OverviewCourse[]
  sessions: OverviewSession[]
  people: OverviewPerson[]
  names: Record<string, string>
}

export interface Devotee {
  id: string
  name: string
  sessions: number
  seconds: number
  lastDate: string
  firstDate: string
  courseIds: string[]
  /** sessions held in their courses (within the period) since they first attended */
  held: number
  rate: number
}

const DAY = 86400000
const toTime = (d: string) => new Date(d + 'T12:00:00Z').getTime()
export const addDays = (d: string, n: number) => new Date(toTime(d) + n * DAY).toISOString().slice(0, 10)

/** Monday of the ISO week containing `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const dow = (new Date(toTime(date)).getUTCDay() + 6) % 7
  return addDays(date, -dow)
}

export function select(d: OverviewData, courseIds: Set<string>) {
  const courses = d.courses.filter((c) => courseIds.has(c.id))
  const sessions = d.sessions.filter((s) => courseIds.has(s[1]))
  const people = d.people.filter((p) => courseIds.has(p[1]))
  return { courses, sessions, people }
}

export function devotees(d: OverviewData, courseIds: Set<string>): Devotee[] {
  const { sessions, people } = select(d, courseIds)
  const datesByCourse = new Map<string, string[]>()
  for (const s of sessions) datesByCourse.set(s[1], [...(datesByCourse.get(s[1]) ?? []), s[2]])
  const out = new Map<string, Devotee>()
  for (const [pid, cid, n, sec, last, first] of people) {
    const held = (datesByCourse.get(cid) ?? []).filter((x) => x >= first).length
    const e = out.get(pid) ?? { id: pid, name: d.names[pid] ?? 'Unknown', sessions: 0, seconds: 0, lastDate: last, firstDate: first, courseIds: [], held: 0, rate: 0 }
    e.sessions += n
    e.seconds += sec
    e.held += held
    if (last > e.lastDate) e.lastDate = last
    if (first < e.firstDate) e.firstDate = first
    e.courseIds.push(cid)
    out.set(pid, e)
  }
  return [...out.values()].map((e) => ({ ...e, rate: e.held ? Math.min(e.sessions / e.held, 1) : 0 }))
}

export function kpis(d: OverviewData, courseIds: Set<string>, periodStart: string | null) {
  const { courses, sessions } = select(d, courseIds)
  const people = devotees(d, courseIds)
  const visits = sessions.reduce((a, s) => a + s[5], 0)
  const seconds = people.reduce((a, p) => a + p.seconds, 0)
  const start = periodStart ?? sessions[0]?.[2] ?? null
  return {
    courses: courses.length,
    sessions: sessions.length,
    devotees: people.length,
    avgPerSession: sessions.length ? visits / sessions.length : 0,
    seconds,
    avgSecondsPerVisit: visits ? seconds / visits : 0,
    newDevotees: start ? people.filter((p) => p.firstDate >= start).length : people.length,
  }
}

/** Weekly average headcount per course (null when a course had no session that week). */
export function weeklyByCourse(d: OverviewData, courseIds: Set<string>) {
  const { courses, sessions } = select(d, courseIds)
  const weeks = [...new Set(sessions.map((s) => weekStart(s[2])))].sort()
  const series = courses.map((c) => {
    const acc = new Map<string, { n: number; total: number }>()
    for (const s of sessions) {
      if (s[1] !== c.id) continue
      const w = weekStart(s[2])
      const e = acc.get(w) ?? { n: 0, total: 0 }
      e.n++
      e.total += s[5]
      acc.set(w, e)
    }
    return { course: c, values: weeks.map((w) => (acc.has(w) ? Math.round((acc.get(w)!.total / acc.get(w)!.n) * 10) / 10 : null)) }
  })
  return { weeks, series }
}

/** Weekly visits split into first-time and returning. */
export function weeklyVisits(d: OverviewData, courseIds: Set<string>) {
  const { sessions } = select(d, courseIds)
  const m = new Map<string, { first: number; returning: number }>()
  for (const s of sessions) {
    const w = weekStart(s[2])
    const e = m.get(w) ?? { first: 0, returning: 0 }
    e.first += s[6]
    e.returning += s[5] - s[6]
    m.set(w, e)
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v }))
}

export function courseTable(d: OverviewData, courseIds: Set<string>) {
  const { courses, sessions } = select(d, courseIds)
  return courses.map((c) => {
    const cs = sessions.filter((s) => s[1] === c.id)
    const people = devotees(d, new Set([c.id]))
    const visits = cs.reduce((a, s) => a + s[5], 0)
    const weighted = cs.reduce((a, s) => a + s[7] * s[5], 0)
    return {
      course: c,
      sessions: cs.length,
      devotees: people.length,
      avgPerSession: cs.length ? visits / cs.length : 0,
      avgMinutes: visits ? weighted / visits / 60 : 0,
      regulars: people.filter((p) => p.rate * 100 >= c.regular_threshold_pct).length,
      lastDate: cs.at(-1)?.[2] ?? null,
      spark: cs.slice(-16).map((s) => s[5]),
    }
  })
}

/** Regulars who have stopped coming: 3+ sessions, but none in the last `days`. */
export function needsCall(people: Devotee[], endDate: string, days = 14): Devotee[] {
  const cutoff = addDays(endDate, -days)
  return people
    .filter((p) => p.sessions >= 3 && p.lastDate < cutoff)
    .sort((a, b) => b.sessions - a.sessions || b.lastDate.localeCompare(a.lastDate))
}

export function newcomers(people: Devotee[], endDate: string, days = 14): Devotee[] {
  const cutoff = addDays(endDate, -days)
  return people.filter((p) => p.firstDate > cutoff).sort((a, b) => b.firstDate.localeCompare(a.firstDate) || b.sessions - a.sessions)
}
