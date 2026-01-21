import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(input?: string): string {
  // Vite's `base` must start and end with `/` for correct asset resolution.
  // For GitHub Pages project sites the base is typically `/<repo>/`.
  if (!input) return '/';
  let s = input.trim();
  if (!s) return '/';
  if (!s.startsWith('/')) s = `/${s}`;
  if (!s.endsWith('/')) s = `${s}/`;
  return s;
}

export default defineConfig(() => {
  const base = normalizeBasePath(process.env.VITE_BASE);
  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
    },
    test: {
      environment: 'node',
    },
  };
});
