import Papa from 'papaparse'
import { cleanName, nameKey } from './nameKey'

export interface MeetRow {
  name: string
  /** Local wall-clock time, `YYYY-MM-DD HH:MM:SS` */
  firstSeen: string
  seconds: number
}

export interface ParsedMeeting {
  fileName: string
  meetingCode: string | null
  /** Local wall-clock time, `YYYY-MM-DD HH:MM:SS` */
  startedAt: string
  endedAt: string
  sessionDate: string
  durationSec: number
  rows: MeetRow[]
  warnings: string[]
}

export class MeetParseError extends Error {}

const MAX_ROWS = 2000
const TS_RE = /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/

/** Normalise a timestamp to `YYYY-MM-DD HH:MM:SS`, or null. */
export function normalizeTimestamp(value: string): string | null {
  const m = TS_RE.exec(value)
  if (!m) return null
  const [, date, h, mi, s = '00'] = m
  const hh = Number(h)
  if (hh > 23 || Number(mi) > 59 || Number(s) > 59) return null
  return `${date} ${String(hh).padStart(2, '0')}:${mi}:${s.padStart(2, '0')}`
}

/** Parse "HH:MM:SS", "MM:SS" or "1 hr 5 min 3 sec" into seconds. */
export function parseDuration(value: string): number | null {
  const v = value.trim()
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) {
    const parts = v.split(':').map(Number)
    if (parts.slice(1).some((p) => p > 59)) return null
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  const units = [...v.matchAll(/(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi)]
  if (units.length === 0) return null
  return units.reduce((acc, [, n, u]) => {
    const k = u.toLowerCase()[0]
    return acc + Number(n) * (k === 'h' ? 3600 : k === 'm' ? 60 : 1)
  }, 0)
}

function toDate(ts: string): Date {
  return new Date(ts.replace(' ', 'T') + 'Z')
}

function fromDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function diffSec(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 1000)
}

function findColumn(header: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h))
    if (i >= 0) return i
  }
  return -1
}

/** Meeting code from a filename like `meeting_9-23-2026_8-21-01 PM_abc-defg-hij.csv`. */
function codeFromFileName(fileName: string): string | null {
  const m = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i.exec(fileName)
  return m ? m[1].toLowerCase() : null
}

/**
 * Parse a Google Meet attendance export. The file is processed entirely in the
 * browser; only the resulting rows are sent to the database.
 */
export function parseMeetCsv(text: string, fileName = 'attendance.csv'): ParsedMeeting {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  const lines = parsed.data.filter((r) => r.some((c) => c.trim() !== ''))
  const warnings: string[] = []

  let meetingCode: string | null = null
  let created: string | null = null
  let ended: string | null = null
  let headerIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const first = lines[i][0]?.trim() ?? ''
    if (first.startsWith('*')) {
      const body = first.replace(/^\*\s*/, '')
      const code = /meeting code:\s*([a-z0-9-]+)/i.exec(body)
      if (code) meetingCode = code[1].toLowerCase()
      if (/^created/i.test(body)) created = normalizeTimestamp(body)
      if (/^ended/i.test(body)) ended = normalizeTimestamp(body)
      continue
    }
    if (lines[i].some((c) => /name/i.test(c))) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) throw new MeetParseError('Could not find the header row (expected a "Full Name" column).')

  const header = lines[headerIdx].map((h) => h.trim())
  const nameCol = findColumn(header, [/^full name$/i, /name/i])
  const seenCol = findColumn(header, [/first seen/i, /joined/i, /join time/i])
  const durCol = findColumn(header, [/time in call/i, /duration/i, /time/i])
  if (nameCol < 0 || durCol < 0 || durCol === nameCol) {
    throw new MeetParseError('Expected "Full Name" and "Time in Call" columns.')
  }

  const rows: MeetRow[] = []
  let skipped = 0
  for (const line of lines.slice(headerIdx + 1)) {
    const name = cleanName(line[nameCol] ?? '')
    const seconds = parseDuration(line[durCol] ?? '')
    const seen = seenCol >= 0 ? normalizeTimestamp(line[seenCol] ?? '') : null
    if (!name || nameKey(name) === '' || seconds === null || name.length > 200) {
      skipped++
      continue
    }
    rows.push({ name, firstSeen: seen ?? created ?? '', seconds: Math.min(seconds, 86400) })
  }
  if (skipped) warnings.push(`${skipped} row(s) skipped because the name or time was unreadable.`)
  if (rows.length === 0) throw new MeetParseError('No attendance rows found.')
  if (rows.length > MAX_ROWS) throw new MeetParseError(`Too many rows (${rows.length}); the limit is ${MAX_ROWS}.`)

  // Fill in missing session bounds from the rows themselves.
  if (!created) {
    const seen = rows.map((r) => r.firstSeen).filter(Boolean).sort()
    if (!seen.length) throw new MeetParseError('The file has no meeting start time and no "First Seen" column.')
    created = seen[0]
    warnings.push('Meeting start time missing; using the earliest join time.')
  }
  for (const r of rows) if (!r.firstSeen) r.firstSeen = created
  if (!ended) {
    const last = Math.max(...rows.map((r) => toDate(r.firstSeen).getTime() + r.seconds * 1000))
    ended = fromDate(new Date(last))
    warnings.push('Meeting end time missing; estimated from the last participant.')
  }

  const durationSec = diffSec(created, ended)
  if (durationSec <= 0 || durationSec > 86400) {
    throw new MeetParseError('Meeting end time must be after the start time (and within 24 hours).')
  }

  if (!meetingCode) meetingCode = codeFromFileName(fileName)
  if (!meetingCode) warnings.push('No meeting code found; choose the course manually.')

  const keys = new Map<string, number>()
  for (const r of rows) keys.set(nameKey(r.name), (keys.get(nameKey(r.name)) ?? 0) + 1)
  const dupes = [...keys.values()].filter((n) => n > 1).length
  if (dupes) warnings.push(`${dupes} name(s) appear more than once; their time will be combined.`)

  return {
    fileName,
    meetingCode,
    startedAt: created,
    endedAt: ended,
    sessionDate: created.slice(0, 10),
    durationSec,
    rows,
    warnings,
  }
}
