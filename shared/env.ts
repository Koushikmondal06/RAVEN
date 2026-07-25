/** App .env wins over the repo-root .env; inline FOO=bar wins over both (dotenv never overrides). */
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '..', '.env'), quiet: true });
