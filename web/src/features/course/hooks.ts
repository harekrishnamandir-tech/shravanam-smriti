import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export function useCourses() {
  return useQuery({ queryKey: ['courses'], queryFn: api.courses })
}

export function useCourseBySlug(slug: string | undefined) {
  const q = useCourses()
  return { ...q, course: q.data?.find((c) => c.slug === slug) }
}

export function useDashboard(courseId: string | undefined, opts: { from?: string; to?: string; minMinutes?: number }) {
  return useQuery({
    queryKey: ['dashboard', courseId, opts.from ?? '', opts.to ?? '', opts.minMinutes ?? null],
    queryFn: () => api.dashboard(courseId!, opts),
    enabled: Boolean(courseId),
    placeholderData: (prev) => (prev?.course.id === courseId ? prev : undefined),
  })
}
