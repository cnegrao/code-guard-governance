import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation";
import {
  assertLegacyAuthConfigured,
  createLegacySessionResponse,
} from "@/lib/auth";
import { LegacyAuthConfigurationError } from "@/lib/auth/token";
import * as authService from "@/services/auth";

export async function POST(request: Request) {
  try {
    assertLegacyAuthConfigured();

    const body = await request.json();
    const input = loginSchema.parse(body);

    const result = await authService.login(input.email, input.password);
    return createLegacySessionResponse(result);
  } catch (error) {
    if (
      error instanceof LegacyAuthConfigurationError ||
      error instanceof authService.LegacyLoginRoleResolutionError
    ) {
      return NextResponse.json(
        { error: "Authentication unavailable" },
        { status: 503 }
      );
    }
    if (
      error instanceof Error &&
      (error.message === "Invalid email or password" ||
        error.message === "Account is not active")
    ) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 400 }
    );
  }
}
