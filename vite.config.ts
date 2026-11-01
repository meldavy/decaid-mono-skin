import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Decaid serves each skin from its own folder, so every asset path must be relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'chrome91',
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
})
