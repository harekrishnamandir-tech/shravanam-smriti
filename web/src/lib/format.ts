export function fmtMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`
}

export function fmtHours(seconds: number): string {
  const h = seconds / 3600
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** `YYYY-MM-DD` -> "23 Sep 2026" without timezone drift. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return dateFmt.format(new Date(d.slice(0, 10) + 'T12:00:00'))
}

export function fmtShortDate(d: string): string {
  return shortDateFmt.format(new Date(d.slice(0, 10) + 'T12:00:00'))
}

export function fmtDateTime(ts: string | null | undefined): string {
  return ts ? dateTimeFmt.format(new Date(ts)) : '—'
}

export function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n)}%`
}

export function monthKey(d: string): string {
  return d.slice(0, 7)
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
export function fmtMonth(key: string): string {
  return monthFmt.format(new Date(key + '-15T12:00:00'))
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
