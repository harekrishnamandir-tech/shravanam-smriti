/** A peacock feather — Krishna's crown ornament. */
export function Feather({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M32 60 C31 44 30 30 32 6" stroke="#8a6a1f" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M32 6 C16 16 12 34 22 48 C27 54 31 56 32 58 C33 56 37 54 42 48 C52 34 48 16 32 6 Z" fill="#1f7a6e" />
      <path d="M32 14 C21 22 19 34 25 44 C28 48 31 50 32 51 C33 50 36 48 39 44 C45 34 43 22 32 14 Z" fill="#2a78d6" />
      <ellipse cx="32" cy="32" rx="8" ry="10" fill="#e8b020" />
      <ellipse cx="32" cy="32" rx="5" ry="6.5" fill="#12306b" />
      <ellipse cx="32" cy="31" rx="2.2" ry="3" fill="#3fb3a6" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Feather className="h-8 w-8" />
      <span className="leading-tight">
        <span className="block font-display text-xl font-semibold tracking-wide text-ink">Shravanam Smriti</span>
        <span className="block text-[11px] tracking-[0.18em] text-muted uppercase">hear · remember · grow</span>
      </span>
    </span>
  )
}

/** A flute line used as a section divider. */
export function FluteDivider() {
  return (
    <svg viewBox="0 0 240 12" className="mx-auto h-3 w-60 text-gold" aria-hidden="true">
      <rect x="10" y="4" width="220" height="4" rx="2" fill="currentColor" opacity="0.55" />
      {[40, 70, 100, 130, 160, 190].map((x) => (
        <circle key={x} cx={x} cy="6" r="1.4" fill="var(--surface)" />
      ))}
      <path d="M232 6 q6 -6 6 -2 q0 4 -6 2" fill="#1f7a6e" />
    </svg>
  )
}
