// Fails if public/styles.css isn't what `npm run build:css` produces from the current
// classes and config (someone added a class without rebuilding). Part of npm test.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'css-'));
try {
  const out = join(dir, 'styles.css');
  execFileSync('npx', ['tailwindcss', '-i', 'src/styles.css', '-o', out, '--minify'], { stdio: 'pipe' });
  if (readFileSync(out, 'utf8') !== readFileSync('public/styles.css', 'utf8')) {
    console.error('public/styles.css is out of date. Run: npm run build:css (and commit it).');
    process.exit(1);
  }
  console.log('public/styles.css is up to date.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
