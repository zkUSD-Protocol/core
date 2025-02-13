import { defineConfig } from 'tsup';

export default defineConfig([
  // Node Build
  {
    entry: [
      'src/**/*.ts',         // Include everything else EXCEPT index.web.ts
      // Exclude web-specific entry point
      '!src/index.web.ts',
      '!src/provers/web/**/*', // Exclude web-specific files
    ],
    outDir: 'dist/node',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    bundle: false,
    treeshake: false,
    sourcemap: true,
    splitting: false,
  },

  // Web Build
  {
    entry: [
      'src/**/*.ts',         // Include everything else EXCEPT index.node.ts
      '!src/index.node.ts', // Exclude node-specific entry point
      '!src/cli.ts', // Exclude node-specific entry point
      '!src/provers/node/**/*', // Exclude web-specific files
    ],
    outDir: 'dist/web',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    bundle: false,
    treeshake: false,
    sourcemap: true,
    splitting: false,
  },
]);
