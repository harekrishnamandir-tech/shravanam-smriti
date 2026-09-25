import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'ss-theme'
const listeners = new Set<() => void>()

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function system(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || stored() || system()
}

export function applyTheme(t: Theme, persist = false): void {
  document.documentElement.dataset.theme = t
  if (persist) {
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* storage blocked */
    }
  }
  listeners.forEach((l) => l())
}

export function initTheme(): void {
  applyTheme(stored() || system())
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!stored()) applyTheme(system())
  })
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    currentTheme,
    () => 'light',
  )
}

/** Resolve a CSS custom property to its current value (for canvas charts). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
