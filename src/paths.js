import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA = process.env.UCAS_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
