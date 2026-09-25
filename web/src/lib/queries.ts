import type { QueryClient } from '@tanstack/react-query'

/** Refresh everything derived from a course's sessions after a write. */
export function invalidateCourseData(qc: QueryClient) {
  for (const k of ['dashboard', 'overview', 'sessions', 'uploadLog', 'directory']) qc.invalidateQueries({ queryKey: [k] })
}
