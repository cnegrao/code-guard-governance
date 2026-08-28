import { getAuthContext } from "@/lib/auth";
import type { AuthContext } from "@/types/auth";
import { LegacyRoleAuthorizationAdapter } from "./legacy-role-authorization-adapter";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  type AuthorizationPolicy,
  type Permission,
} from "./types";

export {
  AuthenticationRequiredError,
  PERMISSIONS,
  PermissionDeniedError,
} from "./types";
export { LegacyRoleAuthorizationAdapter } from "./legacy-role-authorization-adapter";
export type { AuthorizationPolicy, Permission } from "./types";

export type AuthContextProvider = () => Promise<AuthContext | null>;

export function createRequireAuth(
  provider: AuthContextProvider
): () => Promise<AuthContext> {
  return async function requireAuth(): Promise<AuthContext> {
    const context = await provider();
    if (!context) throw new AuthenticationRequiredError();
    return context;
  };
}

export function createRequirePermission(
  policy: AuthorizationPolicy
): (context: AuthContext, permission: Permission) => Promise<void> {
  return async function requirePermission(
    context: AuthContext,
    permission: Permission
  ): Promise<void> {
    const permissions = await policy.permissionsFor(context);
    if (!permissions.has(permission)) throw new PermissionDeniedError();
  };
}

const authorizationPolicy: AuthorizationPolicy =
  new LegacyRoleAuthorizationAdapter();

export const requireAuth = createRequireAuth(getAuthContext);
export const requirePermission = createRequirePermission(authorizationPolicy);
