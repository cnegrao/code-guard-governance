import { NextResponse } from "next/server";
import { signupSchema } from "@/lib/validation";
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
    const input = signupSchema.parse(body);

    const result = await authService.signup(input);
    return createLegacySessionResponse(result, 201);
  } catch (error) {
    if (error instanceof LegacyAuthConfigurationError) {
      return NextResponse.json(
        { error: "Authentication unavailable" },
        { status: 503 }
      );
    }
    if (error instanceof Error && error.message === "A user with this email already exists") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Signup failed" },
      { status: 400 }
    );
  }
}
