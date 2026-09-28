import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as reportRepo from "@/repositories/reports";
import { generateAIActReport } from "@/services/reports";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const data = await reportRepo.gatherReportData(orgId);
    const pdf = generateAIActReport(data);

    return new NextResponse(pdf.slice(0), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ai-act-report-${data.org.date}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof SessionAuthenticationError) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report generation failed" },
      { status: 500 }
    );
  }
}