import { describe, expect, it } from 'vitest'
import { sessionLabeler } from './format'

describe('sessionLabeler', () => {
  const sessions = [
    { date: '2026-09-20', started_at: '2026-09-20T01:00:00Z' },
    { date: '2026-09-20', started_at: '2026-09-20T15:00:00Z' },
    { date: '2026-09-21', started_at: '2026-09-21T15:00:00Z' },
  ]
  const label = sessionLabeler(sessions, 'Asia/Kolkata')

  it('adds the time only on days with several sessions', () => {
    expect(label(sessions[0])).toMatch(/20.*6:30/)
    expect(label(sessions[1])).toMatch(/20.*8:30/)
    expect(label(sessions[2])).not.toMatch(/:/)
  })
})
