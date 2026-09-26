import { supabase } from './supabase'
import type {
  AccessRequest,
  AdminEntry,
  AdminLogEntry,
  AdminRole,
  Course,
  CourseCard,
  Dashboard,
  DirectoryEntry,
  IngestMode,
  IngestResult,
  Me,
  SessionRecord,
  UploadLogEntry,
  UploadPreview,
} from './types'
import type { OverviewData } from './overview'
import type { ParsedMeeting } from './parseMeetCsv'

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new ApiError(error.message, error.code)
  return data as T
}

async function select<T>(query: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new ApiError(error.message, error.code)
  return data as T
}

export const api = {
  me: () => rpc<Me | null>('me'),
  coursesOverview: () => rpc<CourseCard[]>('courses_overview'),
  overview: (from?: string, to?: string) =>
    rpc<OverviewData>('overview_dashboard', { p_from: from || null, p_to: to || null, p_include_archived: false }),
  courses: () => select<Course[]>(supabase.from('courses').select('*').order('name')),
  meetingCodes: () =>
    select<{ meeting_code: string; course_id: string }[]>(supabase.from('course_meeting_codes').select('meeting_code, course_id')),

  dashboard: (courseId: string, opts: { from?: string; to?: string; minMinutes?: number } = {}) =>
    rpc<Dashboard>('course_dashboard', {
      p_course: courseId,
      p_from: opts.from || null,
      p_to: opts.to || null,
      p_min_minutes: opts.minMinutes ?? null,
    }),
  sessions: (courseId: string) => rpc<SessionRecord[]>('course_sessions', { p_course: courseId }),
  uploadLog: (courseId: string) => rpc<UploadLogEntry[]>('course_upload_log', { p_course: courseId, p_limit: 100 }),
  directory: (courseId?: string) => rpc<DirectoryEntry[]>('participant_directory', { p_course: courseId ?? null }),

  uploadPreview: (courseId: string, m: Pick<ParsedMeeting, 'sessionDate' | 'startedAt' | 'endedAt'>, names: string[]) =>
    rpc<UploadPreview>('upload_preview', {
      p_course: courseId,
      p_session_date: m.sessionDate,
      p_names: names,
      p_started_at: m.startedAt,
      p_ended_at: m.endedAt,
    }),
  ingest: (
    m: ParsedMeeting,
    opts: {
      courseId: string
      mode: IngestMode
      sessionId?: string
      saveMeetingCode: boolean
      aliases: { name: string; participant_id: string }[]
    },
  ) =>
    rpc<IngestResult>('ingest_session', {
      payload: {
        course_id: opts.courseId,
        mode: opts.mode,
        ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
        meeting_code: m.meetingCode,
        save_meeting_code: opts.saveMeetingCode,
        started_at: m.startedAt,
        ended_at: m.endedAt,
        source_filename: m.fileName,
        rows: m.rows.map((r) => ({ name: r.name, first_seen: r.firstSeen, seconds: r.seconds })),
        aliases: opts.aliases,
      },
    }),
  deleteSession: (sessionId: string) => rpc<{ status: string }>('delete_session', { p_session: sessionId }),

  createCourse: (p: Partial<Course>) => rpc<string>('create_course', { p }),
  updateCourse: (id: string, p: Partial<Course>) => rpc<void>('update_course', { p_course: id, p }),
  setMeetingCodes: (id: string, codes: string[]) => rpc<void>('set_meeting_codes', { p_course: id, p_codes: codes }),
  deleteCourse: (id: string, slug: string) => rpc<void>('delete_course', { p_course: id, p_confirm_slug: slug }),

  renameParticipant: (id: string, name: string) => rpc<void>('rename_participant', { p_participant: id, p_name: name }),
  mergeParticipants: (keep: string, merge: string) => rpc<void>('merge_participants', { p_keep: keep, p_merge: merge }),
  removeAlias: (key: string) => rpc<void>('remove_alias', { p_alias_key: key }),

  participant: (id: string) =>
    select<{ id: string; display_name: string; external_id: string | null; created_at: string; participant_aliases: { alias_key: string }[] } | null>(
      supabase.from('participants').select('id, display_name, external_id, created_at, participant_aliases(alias_key)').eq('id', id).maybeSingle(),
    ),
  /** Course ids a devotee has attended (limited by RLS to the caller's courses). */
  participantCourseIds: (id: string) => rpc<string[]>('participant_courses', { p_participant: id }),

  adminDirectory: () => rpc<AdminEntry[]>('admin_directory'),
  accessRequests: () => rpc<AccessRequest[]>('access_requests'),
  adminActivity: () => rpc<AdminLogEntry[]>('admin_activity', { p_limit: 50 }),
  inviteAdmin: (email: string, role: AdminRole, courseIds: string[]) =>
    rpc<void>('invite_admin', { p_email: email, p_role: role, p_courses: courseIds }),
  dismissAccessRequest: (email: string) => rpc<void>('dismiss_access_request', { p_email: email }),
  upsertAdmin: (email: string, role: AdminRole) => rpc<void>('upsert_admin', { p_email: email, p_role: role }),
  removeAdmin: (email: string) => rpc<void>('remove_admin', { p_email: email }),
  setAdminCourses: (email: string, courseIds: string[]) =>
    rpc<void>('set_admin_courses', { p_email: email, p_courses: courseIds }),
}
