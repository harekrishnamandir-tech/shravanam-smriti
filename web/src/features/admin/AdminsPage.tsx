import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Select, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import type { AdminRole } from '../../lib/types'
import { useAuth } from '../auth/AuthProvider'
import { useCourses } from '../course/hooks'

export function AdminsPage() {
  const { me } = useAuth()
  const qc = useQueryClient()
  const courses = useCourses()
  const admins = useQuery({ queryKey: ['admins'], queryFn: api.admins })
  const links = useQuery({ queryKey: ['courseAdmins'], queryFn: api.courseAdmins })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AdminRole>('course_admin')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admins'] })
    qc.invalidateQueries({ queryKey: ['courseAdmins'] })
  }
  const upsert = useMutation({
    mutationFn: ({ e, r }: { e: string; r: AdminRole }) => api.upsertAdmin(e, r),
    onSuccess: () => {
      setEmail('')
      refresh()
    },
  })
  const remove = useMutation({ mutationFn: (e: string) => api.removeAdmin(e), onSuccess: refresh })
  const assign = useMutation({ mutationFn: ({ e, ids }: { e: string; ids: string[] }) => api.setAdminCourses(e, ids), onSuccess: refresh })

  if (admins.isLoading || links.isLoading) return <Spinner />
  const err = admins.error || links.error || upsert.error || remove.error || assign.error
  const coursesOf = (e: string) => (links.data ?? []).filter((l) => l.email === e).map((l) => l.course_id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold text-ink">Admins</h1>
        <p className="mt-1 text-sm text-muted">
          Access is granted by email - the person signs in with that Google account. Super admins see every course; course admins see
          only the courses ticked below.
        </p>
      </div>
      {err && <ErrorBox error={err} />}

      <Card>
        <CardHeader title="Add an admin" />
        <form
          className="grid gap-3 md:grid-cols-[1fr_14rem_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            upsert.mutate({ e: email, r: role })
          }}
        >
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              <option value="course_admin">Course admin</option>
              <option value="super_admin">Super admin</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={upsert.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Card>

      <Card className="!p-0">
        <ul className="divide-y divide-[var(--line)]">
          {admins.data?.map((a) => {
            const mine = coursesOf(a.email)
            const self = a.email === me?.email
            return (
              <li key={a.email} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-ink">
                    {a.email} <Badge tone={a.role === 'super_admin' ? 'gold' : 'brand'}>{a.role === 'super_admin' ? 'Super admin' : 'Course admin'}</Badge>{' '}
                    {self && <Badge>you</Badge>}
                  </p>
                  {!self && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => upsert.mutate({ e: a.email, r: a.role === 'super_admin' ? 'course_admin' : 'super_admin' })}>
                        Make {a.role === 'super_admin' ? 'course admin' : 'super admin'}
                      </Button>
                      <Button size="sm" variant="ghost" className="!text-danger" onClick={() => remove.mutate(a.email)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
                {a.role === 'course_admin' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {courses.data?.map((c) => {
                      const on = mine.includes(c.id)
                      return (
                        <label
                          key={c.id}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${on ? 'border-brand bg-brand text-brand-ink' : 'border-line text-ink-2'}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={on}
                            onChange={() => assign.mutate({ e: a.email, ids: on ? mine.filter((x) => x !== c.id) : [...mine, c.id] })}
                          />
                          {on ? '✓ ' : ''}
                          {c.name}
                        </label>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
