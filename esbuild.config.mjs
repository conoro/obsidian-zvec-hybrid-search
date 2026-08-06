import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import process from 'node:process';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  banner: {
    js: '/* ZVec Hybrid Search for Obsidian — local, isolated retrieval. */',
  },
  bundle: true,
  entryPoints: ['main.ts'],
  external: [
    'obsidian',
    'electron',
    '@huggingface/transformers',
    '@zvec/zvec',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: 'main.js',
  platform: 'node',
  sourcemap: production ? false : 'inline',
  target: 'es2022',
  treeShaking: true,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
