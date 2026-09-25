import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nameKey } from './nameKey'
import { MeetParseError, normalizeTimestamp, parseDuration, parseMeetCsv } from './parseMeetCsv'

const sample = readFileSync(new URL('../test/fixtures/sample-meet.csv', import.meta.url), 'utf8')

describe('parseDuration', () => {
  it.each([
    ['01:00:19', 3619],
    ['00:21:14', 1274],
    ['05:30', 330],
    ['1 hr 5 min', 3900],
    ['45 min 10 sec', 2710],
  ])('%s -> %i', (input, expected) => expect(parseDuration(input)).toBe(expected))

  it('rejects junk', () => {
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('00:75:00')).toBeNull()
  })
})

describe('normalizeTimestamp', () => {
  it('pads and validates', () => {
    expect(normalizeTimestamp('Created on 2026-09-23 8:21')).toBe('2026-09-23 08:21:00')
    expect(normalizeTimestamp('2026-09-23 25:00:00')).toBeNull()
  })
})

describe('nameKey', () => {
  it('matches the SQL normalisation', () => {
    expect(nameKey('  RADHA   Govinda ')).toBe('radha govinda')
    expect(nameKey('José Álvarez')).toBe('jose alvarez')
  })
})

describe('parseMeetCsv', () => {
  const m = parseMeetCsv(sample, 'meeting_9-23-2026_8-21-01 PM_abc-defg-hij.csv')

  it('reads the preamble', () => {
    expect(m.meetingCode).toBe('abc-defg-hij')
    expect(m.startedAt).toBe('2026-09-23 20:21:01')
    expect(m.endedAt).toBe('2026-09-23 21:21:21')
    expect(m.sessionDate).toBe('2026-09-23')
    expect(m.durationSec).toBe(3620)
  })

  it('reads rows, including quoted names with commas', () => {
    expect(m.rows).toHaveLength(6)
    expect(m.rows[1]).toEqual({ name: 'Host Desk', firstSeen: '2026-09-23 20:21:01', seconds: 3619 })
    expect(m.rows.map((r) => r.name)).toContain('Keshav, Nair')
  })

  it('warns about skipped rows and duplicate names', () => {
    expect(m.warnings.some((w) => w.includes('1 row(s) skipped'))).toBe(true)
    expect(m.warnings.some((w) => w.includes('more than once'))).toBe(true)
  })

  it('falls back to the filename for the meeting code', () => {
    const noCode = sample.replace('"*     Meeting code: abc-defg-hij"\n', '')
    expect(parseMeetCsv(noCode, 'meeting_x_pqr-stuv-wxy.csv').meetingCode).toBe('pqr-stuv-wxy')
  })

  it('estimates missing bounds', () => {
    const bare = sample.split('\n').filter((l) => !l.startsWith('"*')).join('\n')
    const r = parseMeetCsv(bare)
    expect(r.startedAt).toBe('2026-09-23 20:21:01')
    expect(r.durationSec).toBeGreaterThan(0)
  })

  it('rejects files without a header', () => {
    expect(() => parseMeetCsv('hello,world\n1,2')).toThrow(MeetParseError)
  })
})
