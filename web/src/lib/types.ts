export type AdminRole = 'super_admin' | 'course_admin'
export type CourseStatus = 'active' | 'paused' | 'archived'
export type Segment = 'regular' | 'occasional' | 'new' | 'lapsed'

export interface Me {
  email: string
  role: AdminRole
  course_ids: string[]
}

export interface Course {
  id: string
  slug: string
  name: string
  description: string
  timezone: string
  host_names: string[]
  min_present_minutes: number
  regular_threshold_pct: number
  schedule_note: string
  start_date: string | null
  end_date: string | null
  status: CourseStatus
  created_at: string
  updated_at: string
}

export interface CourseCard {
  id: string
  slug: string
  name: string
  description: string
  status: CourseStatus
  schedule_note: string
  sessions: number
  participants: number
  avg_headcount: number | null
  last_session_date: string | null
  spark: number[]
}

export interface SessionStat {
  id: string
  date: string
  seq: number
  started_at: string
  ended_at: string
  duration_sec: number
  meeting_code: string | null
  headcount: number
  new_count: number
  returning_count: number
  avg_seconds: number
  full_count: number
  raw_count: number
}

export interface ParticipantStat {
  id: string
  name: string
  sessions_attended: number
  attendance_pct: number
  total_seconds: number
  avg_seconds: number
  avg_pct_of_session: number
  first_date: string
  last_date: string
  first_ever_date: string | null
  avg_join_delay_sec: number
  longest_streak: number
  current_streak: number
  segment: Segment
}

/** [session_id, participant_id, seconds_in_call, join_delay_sec] */
export type AttendanceCell = [string, string, number, number]

export interface Dashboard {
  course: Course
  min_minutes: number
  sessions: SessionStat[]
  participants: ParticipantStat[]
  attendance: AttendanceCell[]
}

export interface SessionRecord {
  id: string
  course_id: string
  session_date: string
  seq: number
  meeting_code: string | null
  started_at: string
  ended_at: string
  duration_sec: number
  source_filename: string | null
  uploaded_by_email: string | null
  uploaded_at: string
  replaced_at: string | null
  rows: number
  /** upload_preview only: overlaps the uploaded file's time window */
  overlaps?: boolean
}

export interface UploadLogEntry {
  id: number
  email: string | null
  course_id: string | null
  session_id: string | null
  action: 'create' | 'replace' | 'delete'
  rows: number
  details: Record<string, unknown>
  at: string
}

export interface NamePreview {
  name: string
  key: string
  participant_id: string | null
  is_new: boolean
  suggestions: { id: string; name: string; score: number }[]
}

export interface UploadPreview {
  existing: SessionRecord[]
  names: NamePreview[]
}

export type IngestMode = 'create' | 'replace' | 'append'

export type IngestResult =
  | { status: 'ok'; action: 'create' | 'replace'; session: SessionRecord; new_participants: number }
  | { status: 'exists'; existing: SessionRecord }

export interface DirectoryEntry {
  id: string
  name: string
  key: string
  external_id: string | null
  aliases: string[]
  sessions: number
  last_date: string | null
  courses: string[]
}

export interface AdminRow {
  email: string
  role: AdminRole
  created_at: string
}
