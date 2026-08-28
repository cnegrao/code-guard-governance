import type { AuthContext } from "@/types/auth";

export const PERMISSIONS = [
  "portfolio:read",
  "agents:read",
  "agents:write",
  "agents:assess",
  "systems:read",
  "systems:write",
  "systems:assess",
  "ownership:assign",
  "discovery:read",
  "discovery:execute",
  "discovery:review",
  "audit:read",
  "reports:read",
  "graph:read",
  "governance:query",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface AuthorizationPolicy {
  permissionsFor(context: AuthContext): Promise<ReadonlySet<Permission>>;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "AuthenticationRequiredError";
  }
}

export class PermissionDeniedError extends Error {
  constructor() {
    super("Permission denied");
    this.name = "PermissionDeniedError";
  }
}
