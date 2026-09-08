import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packServer } from './server-bundle.mjs';

if (process.argv.slice(2).some((arg) => arg !== '--with-releases'))
  throw new Error('Usage : npm run pack:server -- [--with-releases]');
console.log(
  await packServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    includeReleases: process.argv.includes('--with-releases'),
  }),
);
