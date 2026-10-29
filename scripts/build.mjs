import { cp, mkdir, rm } from 'node:fs/promises';
// Only public site files enter the deployment artifact.
const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', '.nojekyll', 'js', 'data', 'vendor']) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, output), { recursive: true });
}
console.log('Static site ready in dist/');
