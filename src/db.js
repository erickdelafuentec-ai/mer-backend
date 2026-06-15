import pg from "pg";
import "dotenv/config";

const needsSSL = /neon\.tech|supabase|render|railway|amazonaws/.test(process.env.DATABASE_URL || "");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

export const q = (text, params) => pool.query(text, params);
