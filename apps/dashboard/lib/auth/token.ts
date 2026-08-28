import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const JWT_EXPIRY = "24h";

export const LEGACY_SESSION_COOKIE_NAME = "codeguard-token";

export interface LegacyTokenInput {
  sub: string;
  org: string;
  email: string;
  role: string;
}

export interface LegacyTokenPayload extends LegacyTokenInput {
  iat: number;
  exp: number;
}

const legacyTokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  org: z.string().uuid(),
  email: z.string().email(),
  role: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});

export class LegacyAuthConfigurationError extends Error {
  constructor() {
    super("Legacy authentication is not configured");
    this.name = "LegacyAuthConfigurationError";
  }
}

export function getRequiredJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new LegacyAuthConfigurationError();
  }

  return new TextEncoder().encode(secret);
}

export async function verifyLegacyToken(
  token: string
): Promise<LegacyTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getRequiredJwtSecret(), {
      algorithms: ["HS256"],
    });

    const parsed = legacyTokenPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function signLegacyToken(
  payload: LegacyTokenInput
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getRequiredJwtSecret());
}
