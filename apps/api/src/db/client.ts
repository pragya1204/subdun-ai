import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://recovery:recovery@localhost:5432/recovery";

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
