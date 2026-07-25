/** Each app reads its OWN .env (from its cwd). No root .env — inline FOO=bar still wins. */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
