import { rm, mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

const entries = [
  ['publisher-sdk', 'src/sites/publisher-sdk.js'],
  ['quiz-rush', 'src/sites/quiz-rush.js'],
  ['jobguidematch', 'src/sites/jobguidematch.js'],
  ['playloft.fun', 'src/sites/playloft.fun.js'],
  ['reviewboxes.com', 'src/sites/reviewboxes.com.js'],
  ['cosmicseek.com', 'src/sites/cosmicseek.com.js'],
  ['duniyaa.in', 'src/sites/duniyaa.in.js']
];

const exactAliasBundles = new Map([
  ['jobguidematch', ['jobguidematch.com']]
]);

await rm('dist', { recursive: true, force: true });
await mkdir('dist/sourcemaps', { recursive: true });

for (const [name, entryPoint] of entries) {
  const outfile = `dist/${name}.js`;
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'iife',
    globalName: `PublisherExperience_${name.replace(/[^a-z0-9]/gi, '_')}`,
    target: ['es2018'],
    minify: true,
    sourcemap: 'external',
    sourcesContent: false,
    legalComments: 'none',
    logLevel: 'silent'
  });

  const bundled = await readFile(outfile, 'utf8');
  await writeFile(outfile, bundled.replace(/\n?\/\/# sourceMappingURL=.*\.map\s*$/u, ''), 'utf8');
  const sourceMapFile = `dist/sourcemaps/${name}.js.map`;
  await rename(`${outfile}.map`, sourceMapFile);

  for (const alias of exactAliasBundles.get(name) ?? []) {
    const aliasOutfile = `dist/${alias}.js`;
    await copyFile(outfile, aliasOutfile);
    await copyFile(sourceMapFile, `dist/sourcemaps/${alias}.js.map`);

    const [primaryBytes, aliasBytes] = await Promise.all([
      readFile(outfile),
      readFile(aliasOutfile)
    ]);
    if (!primaryBytes.equals(aliasBytes)) {
      throw new Error(`${aliasOutfile} must be an exact byte-for-byte alias of ${outfile}`);
    }
  }
}
