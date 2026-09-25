import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import { useAuth } from '../auth/AuthProvider'
import { useCourses } from '../course/hooks'
import { CourseForm, emptyDraft, type CourseDraft } from './CourseForm'

export function CoursesAdminPage() {
  const { me } = useAuth()
  const courses = useCourses()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const create = useMutation({
    mutationFn: (d: CourseDraft) => api.createCourse(d),
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['courses'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      navigate(`/admin/courses/${id}`)
    },
  })

  if (courses.isLoading) return <Spinner />
  if (courses.error) return <ErrorBox error={courses.error} />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold text-ink">Manage courses</h1>
          <p className="mt-1 text-sm text-muted">Every setting can be changed later - stats recalculate automatically.</p>
        </div>
        {me?.role === 'super_admin' && !creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New course
          </Button>
        )}
      </div>

      {creating && (
        <Card>
          <CardHeader title="New course" actions={<Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>} />
          {create.error && (
            <div className="mb-4">
              <ErrorBox error={create.error} />
            </div>
          )}
          <CourseForm initial={emptyDraft} isNew submitLabel="Create course" busy={create.isPending} onSubmit={(d) => create.mutate(d)} />
        </Card>
      )}

      {!courses.data?.length ? (
        <Empty title="No courses yet" />
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-[var(--line)]">
            {courses.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {c.name} {c.status !== 'active' && <Badge tone={c.status === 'paused' ? 'gold' : 'neutral'}>{c.status}</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    /{c.slug} · present ≥ {c.min_present_minutes} min · updated {fmtDate(c.updated_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/c/${c.slug}`}>
                    <Button size="sm" variant="ghost">
                      Dashboard
                    </Button>
                  </Link>
                  <Link to={`/admin/courses/${c.id}`}>
                    <Button size="sm">Edit</Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
