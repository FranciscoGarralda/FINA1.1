/**
 * macOS a veces deja copias tipo "react 2" dentro de node_modules/@types;
 * TypeScript las toma como librerías implícitas y falla con TS2688.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typesDir = path.join(__dirname, '..', 'node_modules', '@types');

if (!fs.existsSync(typesDir)) process.exit(0);

for (const name of fs.readdirSync(typesDir, { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  if (!name.name.includes(' 2')) continue;
  fs.rmSync(path.join(typesDir, name.name), { recursive: true, force: true });
  console.warn('[postinstall] Eliminada carpeta duplicada en @types:', name.name);
}
