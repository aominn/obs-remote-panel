import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/obs-remote-panel/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'OBS Remote Panel',
        short_name: 'OBS Panel',
        description: 'tailnet内のOBS Studioを安全に遠隔操作するパネル',
        theme_color: '#0d1017',
        background_color: '#0d1017',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/obs-remote-panel/',
        scope: '/obs-remote-panel/',
        lang: 'ja',
        icons: [
          {
            src: '/obs-remote-panel/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/obs-remote-panel/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: []
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true
  }
})
