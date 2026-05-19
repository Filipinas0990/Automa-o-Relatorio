import 'dotenv/config';
import { Pool }    from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://farmacia:farmacia123@localhost:5432/farmacia_monitor',
});

export const db = drizzle(pool, { schema });
