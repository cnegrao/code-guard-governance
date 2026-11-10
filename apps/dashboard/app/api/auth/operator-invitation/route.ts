import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from "@/lib/auth/errors";
import { operatorInvitationSchema, operatorEnrollmentSchema, previewOperatorInvitation, redeemOperatorInvitation } from "@/lib/auth/operator-invitation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function POST(request: Request) {
  try {
    // No untrusted Host-derived origin; configuration is supplied by deployment.
    const configured = process.env.NEXT_PUBLIC_APP_URL;
    if (!configured) throw new Error("Missing configured application origin");
    const origin = new URL(configured).origin;
    const secure = origin.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    // Next's internal request URL normalises 127.0.0.1 to localhost in dev.
    // Validate the actual incoming authority against configuration instead.
    if (!secure || request.headers.get("origin") !== origin || request.headers.get("host") !== new URL(configured).host) {
      return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers });
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "JSON request required." }, { status: 415, headers });
    }
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 2048) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400, headers }); }
    if (body && typeof body === "object" && "password" in body) {
      const input = operatorEnrollmentSchema.parse(body);
      await redeemOperatorInvitation(input.token, input.password);
      return NextResponse.json({ success: true }, { headers });
    }
    const input = operatorInvitationSchema.parse(body);
    return NextResponse.json(await previewOperatorInvitation(input.token), { headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Check the invitation code and password requirements." }, { status: 400, headers });
    if (error instanceof AuthPublicError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // No request body, bearer code, credential or database diagnostic is logged.
    return NextResponse.json({ error: GENERIC_AUTH_ERROR_MESSAGE }, { status: 500, headers });
  }
}
