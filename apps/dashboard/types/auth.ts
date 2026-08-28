export interface User {
  user_id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  status: string;
  role_ids: string[];
}

export interface Organisation {
  organisation_id: string;
  name: string;
  code: string;
  country: string;
  external_refs: Record<string, unknown>;
}

export interface LegacyAuthRole {
  source: "LEGACY";
  value: string;
}

export interface AuthContext {
  userId: string;
  organisationId: string;
  email: string;
  role: LegacyAuthRole;
}

export interface AuthSession {
  user: Pick<User, "user_id" | "email" | "full_name">;
  org: Pick<Organisation, "organisation_id" | "name"> & {
    industry: string;
  };
}

export interface LegacyAuthResult {
  token: string;
  session: AuthSession;
}
