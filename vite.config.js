import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // Penting untuk GitHub Pages
  build: {
    outDir: 'dist'
  }
})
