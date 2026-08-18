import { createClient } from "@supabase/supabase-js";
import "server-only";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL");
const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const commonOptions = {
  db: { schema: "gov_repo" },
  global: {
    headers: {
      "x-codeguard-client": "governance-os",
    },
  },
};

export const db = {
  read: createClient(supabaseUrl, supabaseServiceRoleKey, commonOptions),
  write: createClient(supabaseUrl, supabaseServiceRoleKey, commonOptions),
};