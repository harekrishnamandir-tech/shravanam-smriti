// Values starting with these characters are interpreted as formulas by
// spreadsheet apps; prefix them so exported names can't execute.
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadCsv(fileName: string, header: string[], rows: unknown[][]): void {
  const blob = new Blob(['﻿' + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
