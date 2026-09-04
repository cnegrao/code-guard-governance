import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { signupSchema } from "@/lib/validation";
import { setTokenCookie } from "@/lib/auth";
import * as authService from "@/services/auth";
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = signupSchema.parse(body);

    const result = await authService.signup(input);

    if (!result.session) {
      return NextResponse.json({ error: GENERIC_AUTH_ERROR_MESSAGE }, { status: 500 });
    }

    const response = NextResponse.json({
      success: true,
      user: result.session.user,
      org: result.session.org,
    }, { status: 201 });
    response.headers.set("Set-Cookie", setTokenCookie(result.session.token));
    return response;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    if (error instanceof AuthPublicError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: GENERIC_AUTH_ERROR_MESSAGE }, { status: 500 });
  }
}
