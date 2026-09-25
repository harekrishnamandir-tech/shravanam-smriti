// Mirrors public.name_key() in SQL: strip accents, trim, collapse whitespace, lowercase.
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Tidy a display name the same way the database stores it. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips control characters
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ')
}
