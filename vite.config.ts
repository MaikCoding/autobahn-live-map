import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build runs under any sub-path (GitHub Pages: /<repo>/).
  base: './',
  build: {
    // MapLibre alone is about 1 MB minified (≈ 300 kB gzip); splitting it would gain nothing.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Some static hosts still serve .mjs as text/plain, which browsers refuse for module
        // workers. Every host knows .js.
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
