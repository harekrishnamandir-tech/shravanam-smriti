import { describe, expect, it } from 'vitest'
import { byMonth, filterParticipants, histogram, joinBuckets, milestones, participantTimeline, weekdayOf } from './derive'
import type { Dashboard, ParticipantStat, SessionStat } from './types'

const s = (id: string, date: string, headcount: number): SessionStat => ({
  id, date, seq: 1, started_at: date + 'T15:00:00Z', ended_at: date + 'T16:00:00Z', duration_sec: 3600,
  meeting_code: null, headcount, new_count: 0, returning_count: headcount, avg_seconds: 1800, full_count: 0, raw_count: headcount,
})
const p = (id: string, name: string, extra: Partial<ParticipantStat> = {}): ParticipantStat => ({
  id, name, sessions_attended: 2, attendance_pct: 66, total_seconds: 3600, avg_seconds: 1800, avg_pct_of_session: 50,
  first_date: '2026-08-01', last_date: '2026-09-02', first_ever_date: '2026-08-01', avg_join_delay_sec: 60,
  longest_streak: 2, current_streak: 1, segment: 'regular', ...extra,
})

const dash: Dashboard = {
  course: {} as Dashboard['course'],
  min_minutes: 10,
  sessions: [s('s1', '2026-08-31', 2), s('s2', '2026-09-01', 1), s('s3', '2026-09-02', 2)],
  participants: [p('a', 'Arjun'), p('b', 'Radhika', { segment: 'new', sessions_attended: 1, longest_streak: 1 })],
  attendance: [
    ['s1', 'a', 1800, 0],
    ['s1', 'b', 900, 30],
    ['s2', 'a', 300, 600],
    ['s3', 'a', 2400, 0],
    ['s3', 'b', 3000, 0],
  ],
}

describe('derive', () => {
  it('filters by session using the present threshold', () => {
    const base = { q: '', minSessions: 0, minStreak: 0, segment: 'all' as const, sessionId: null }
    expect(filterParticipants(dash, { ...base, sessionId: 's2' })).toHaveLength(0) // 5 min < 10 min threshold
    expect(filterParticipants(dash, { ...base, sessionId: 's1' }).map((x) => x.id)).toEqual(['a', 'b'])
    expect(filterParticipants(dash, { ...base, q: 'rad' }).map((x) => x.id)).toEqual(['b'])
    expect(filterParticipants(dash, { ...base, minStreak: 2 }).map((x) => x.id)).toEqual(['a'])
  })

  it('bins histograms with an open last bin', () => {
    const h = histogram([0, 4, 5, 99], 5, 3)
    expect(h.map((b) => b.count)).toEqual([2, 1, 1])
    expect(h[2].label).toBe('10+')
    expect(joinBuckets([0, 200, 5000]).map((b) => b.count)).toEqual([1, 1, 0, 0, 1])
  })

  it('groups months with unique people', () => {
    const m = byMonth(dash)
    expect(m.map((x) => [x.month, x.sessions, x.unique])).toEqual([
      ['2026-08', 1, 2],
      ['2026-09', 2, 2],
    ])
  })

  it('weekday is Monday-first', () => {
    expect(weekdayOf('2026-09-21')).toBe(0) // Monday
    expect(weekdayOf('2026-09-27')).toBe(6) // Sunday
  })

  it('builds a participant timeline and milestones', () => {
    const tl = participantTimeline(dash, 'a')
    expect(tl.map((t) => t.present)).toEqual([true, false, true])
    expect(milestones(tl)[0]).toEqual({ count: 1, date: '2026-08-31' })
  })
})
