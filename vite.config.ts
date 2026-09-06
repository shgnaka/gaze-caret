import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  define: { __BUILD_COMMIT__: JSON.stringify(process.env.GITHUB_SHA || 'local-development') },
  build: { target: 'es2022' },
});
