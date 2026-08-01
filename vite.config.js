import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdir, readFile, stat, writeFile } from 'fs/promises';

async function listBuildFiles(directory, root = directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry);
    if ((await stat(absolutePath)).isDirectory()) {
      files.push(...await listBuildFiles(absolutePath, root));
    } else {
      files.push(absolutePath.slice(root.length + 1).replaceAll('\\', '/'));
    }
  }
  return files;
}

function offlinePrecachePlugin() {
  return {
    name: 'offline-precache-assets',
    apply: 'build',
    async closeBundle() {
      const outputDirectory = resolve(__dirname, 'dist');
      const serviceWorkerPath = resolve(outputDirectory, 'sw.js');
      const generatedAssets = (await listBuildFiles(outputDirectory))
        .filter(file => file !== 'sw.js' && !file.endsWith('.map'))
        .map(file => `./${file}`)
        .sort();
      const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
      const precache = `const BUILD_ASSETS = /* __PRECACHE_ASSETS__ */ ${JSON.stringify(generatedAssets)};`;
      await writeFile(
        serviceWorkerPath,
        serviceWorker.replace(/const BUILD_ASSETS = \/\* __PRECACHE_ASSETS__ \*\/ \[\];/, precache),
        'utf8'
      );
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [offlinePrecachePlugin()],
  server: {
    port: 3000,
    open: false,
    host: true // allows accessing from local network devices (e.g. testing on real iOS/Android comanderos)
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        kds: resolve(__dirname, 'kds.html'),
        ticket: resolve(__dirname, 'ticket.html'),
        accounting: resolve(__dirname, 'accounting.html')
      }
    }
  }
});
