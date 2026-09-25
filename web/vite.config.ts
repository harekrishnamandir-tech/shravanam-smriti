/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Content-Security-Policy for production builds only (dev needs inline HMR scripts).
function csp(supabaseUrl: string): Plugin {
  const api = supabaseUrl.replace(/\/$/, '')
  const ws = api.replace(/^http/, 'ws')
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.googleusercontent.com",
    `connect-src 'self' ${api} ${ws}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_BASE_PATH || '/shravanam-smriti/',
    plugins: [react(), tailwindcss(), csp(env.VITE_SUPABASE_URL || '')],
    test: { environment: 'node' },
  }
})
