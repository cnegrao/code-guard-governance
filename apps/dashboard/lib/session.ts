import { getAuthContext } from "@/lib/auth";
import type { AuthContext } from "@/types/auth";

async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new Error("Not authenticated");
  return context;
}

export async function getOrgId(): Promise<string> {
  const context = await requireAuthContext();
  return context.organisationId;
}

export async function getUserId(): Promise<string> {
  const context = await requireAuthContext();
  return context.userId;
}

export async function getSessionContext(): Promise<AuthContext> {
  return requireAuthContext();
}
