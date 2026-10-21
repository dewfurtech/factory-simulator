// Runs a TypeScript file under Node for quick experiments: bundles it with the project's esbuild (imports without
// extensions, JSON, the lot) into node_modules/.cache and runs it with the remaining arguments.
//
//   node scripts/ts-run.mjs scripts/pdfplan-dump.ts "C:\plans\factory.pdf"
//
// Packages stay external, so `pdfjs-dist/legacy/build/pdf.mjs` and friends load from node_modules as usual.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  console.error('usage: node scripts/ts-run.mjs <file.ts> [args…]');
  process.exit(2);
}
const outdir = resolve('node_modules/.cache/ts-run');
mkdirSync(outdir, { recursive: true });
const outfile = resolve(outdir, basename(entry).replace(/\.tsx?$/, '') + '-' + Date.now() + '.mjs');
await build({ entryPoints: [resolve(entry)], outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', sourcemap: 'inline', logLevel: 'error' });
process.argv = [process.argv[0], outfile, ...rest];
await import(pathToFileURL(outfile).href);
