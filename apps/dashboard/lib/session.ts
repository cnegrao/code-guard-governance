import { requireAuth } from "@/lib/authorization";
import type { AuthContext } from "@/types/auth";

export { requireAuth } from "@/lib/authorization";

export async function getOrgId(): Promise<string> {
  const context = await requireAuth();
  return context.organisationId;
}

export async function getUserId(): Promise<string> {
  const context = await requireAuth();
  return context.userId;
}

export async function getSessionContext(): Promise<AuthContext> {
  return requireAuth();
}
