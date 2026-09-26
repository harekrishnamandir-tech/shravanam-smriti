import { describe, expect, it } from 'vitest'
import { courseTable, devotees, kpis, needsCall, newcomers, weekStart, weeklyByCourse, weeklyVisits, type OverviewData } from './overview'

const course = (id: string, name: string) => ({ id, slug: id, name, status: 'active', timezone: 'Asia/Kolkata', regular_threshold_pct: 50, min_present_minutes: 10 })

const d: OverviewData = {
  courses: [course('g', 'Gita'), course('b', 'Bhagavatam')],
  sessions: [
    ['s1', 'g', '2026-09-07', '2026-09-07T15:00:00Z', 3600, 3, 3, 1800], // Monday
    ['s2', 'g', '2026-09-09', '2026-09-09T15:00:00Z', 3600, 2, 0, 2400],
    ['s3', 'b', '2026-09-13', '2026-09-13T01:30:00Z', 3600, 2, 1, 3000], // Sunday, same week
    ['s4', 'g', '2026-09-14', '2026-09-14T15:00:00Z', 3600, 1, 0, 1200],
  ],
  people: [
    ['a', 'g', 3, 5400, '2026-09-14', '2026-09-07'],
    ['a', 'b', 1, 3000, '2026-09-13', '2026-09-13'],
    ['r', 'g', 2, 3000, '2026-09-09', '2026-09-07'],
    ['k', 'g', 1, 1800, '2026-09-07', '2026-09-07'],
    ['n', 'b', 1, 3000, '2026-09-13', '2026-09-13'],
  ],
  names: { a: 'Arjun', r: 'Radhika', k: 'Keshav', n: 'Nanda' },
}
const all = new Set(['g', 'b'])

describe('overview', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-09-13')).toBe('2026-09-07')
    expect(weekStart('2026-09-07')).toBe('2026-09-07')
  })

  it('merges a devotee across courses', () => {
    const a = devotees(d, all).find((p) => p.id === 'a')!
    expect(a).toMatchObject({ sessions: 4, courseIds: ['g', 'b'], firstDate: '2026-09-07', lastDate: '2026-09-14', held: 4 })
    expect(a.rate).toBe(1)
  })

  it('computes KPIs for the selected courses only', () => {
    expect(kpis(d, new Set(['g']), null)).toMatchObject({ courses: 1, sessions: 3, devotees: 3, avgPerSession: 2 })
    expect(kpis(d, all, '2026-09-10').newDevotees).toBe(1) // only Nanda first came after the 10th
  })

  it('buckets weekly averages per course', () => {
    const w = weeklyByCourse(d, all)
    expect(w.weeks).toEqual(['2026-09-07', '2026-09-14'])
    expect(w.series.find((s) => s.course.id === 'g')!.values).toEqual([2.5, 1])
    expect(w.series.find((s) => s.course.id === 'b')!.values).toEqual([2, null])
    expect(weeklyVisits(d, all)[0]).toEqual({ week: '2026-09-07', first: 4, returning: 3 })
  })

  it('course table and outreach lists', () => {
    const g = courseTable(d, all).find((r) => r.course.id === 'g')!
    expect(g).toMatchObject({ sessions: 3, devotees: 3, lastDate: '2026-09-14' })
    const ppl = devotees(d, all)
    expect(needsCall(ppl, '2026-10-01').map((p) => p.id)).toEqual(['a'])
    expect(newcomers(ppl, '2026-09-20', 10).map((p) => p.id)).toEqual(['n']) // Arjun is new to Bhagavatam, not to the community
  })
})
