import { NextResponse } from "next/server";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import * as reportRepo from "@/repositories/reports";
import { generateDORAReport } from "@/services/reports";

export async function GET() {
  try {
    const { organisationId: orgId } = await requireVerifiedGovernancePrincipal();
    const data = await reportRepo.gatherReportData(orgId);

    if (data.org.industry !== "financial_services" && data.org.industry !== "insurance") {
      return NextResponse.json(
        { error: "DORA report is only available for Financial Services and Insurance" },
        { status: 403 }
      );
    }

    const pdf = generateDORAReport(data);

    return new NextResponse(pdf.slice(0), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dora-readiness-report-${data.org.date}.pdf"`,
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