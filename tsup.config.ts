import { defineConfig } from 'tsup';

export default defineConfig([
  // Node Build
  {
    entry: [
      'src/**/*.ts',
      '!src/index.web.ts',
      '!src/provers/web/**/*',
    ],
    outDir: 'dist/node',
    format: ['esm'],
    platform: 'node',
    target: 'es2020', // Match tsconfig.json
    bundle: false,
    treeshake: false,
    sourcemap: true,
    splitting: false,
    dts: false, // Generate .d.ts declaration files
    esbuildOptions(options) {
      options.define = {
        'process.env.NODE_ENV': JSON.stringify('production'),
      };
    },
  },

  // Web Build
  {
    entry: [
      'src/**/*.ts',
      '!src/index.node.ts',
      '!src/cli.ts',
      '!src/provers/node/**/*',
    ],
    outDir: 'dist/web',
    format: ['esm'],
    platform: 'browser',
    target: 'es2020', // Match tsconfig.json
    bundle: false,
    treeshake: false,
    sourcemap: true,
    splitting: false,
    dts: false, // Generate .d.ts declaration files
  },
]);
