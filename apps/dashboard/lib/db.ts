import "server-only";
import { createClient } from "@supabase/supabase-js";

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

const supabaseUrl = getEnv("SUPABASE_URL");
const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const commonOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "gov_repo" },
  global: {
    headers: {
      "x-codeguard-client": "governance-os",
    },
  },
};

export const db = {
  // Anonymous compatibility client. Product server reads use the existing service
  // boundary below, with organisation_id bound by a verified session at ingress.
  read: createClient(supabaseUrl, supabaseAnonKey, commonOptions),
  write: createClient(supabaseUrl, supabaseServiceRoleKey, commonOptions),
};
