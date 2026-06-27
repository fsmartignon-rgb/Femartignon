import { defineConfig } from 'vite';

// `.wgsl?raw` works out of the box in Vite; declared in src/vite-env.d.ts.
export default defineConfig({
  base: './',
  build: {
    target: 'esnext', // top-level await + modern WebGPU APIs
    sourcemap: true,
  },
});
