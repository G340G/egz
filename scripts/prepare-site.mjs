import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const site = path.join(root, '_site');

// The game loads the pinned Three.js release from jsDelivr at runtime. This
// build step only assembles a clean GitHub Pages artifact; it needs no npm
// packages and does not depend on a locally installed Three.js copy.
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
for (const file of ['index.html', 'style.css', 'ASSET_CREDITS.md', 'favicon.svg']) {
  await cp(path.join(root, file), path.join(site, file));
}
await cp(path.join(root, 'js'), path.join(site, 'js'), { recursive: true });
await cp(path.join(root, 'assets'), path.join(site, 'assets'), { recursive: true });
await writeFile(path.join(site, '.nojekyll'), '');
console.log('Prepared _site/ for GitHub Pages. Three.js 0.160.0 is loaded from jsDelivr.');
