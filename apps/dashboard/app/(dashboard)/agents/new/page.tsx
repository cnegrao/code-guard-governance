import { AgentForm } from "@/components/agents/AgentForm";
import { redirect } from "next/navigation";
import { requireVerifiedGovernancePrincipal, SessionAuthenticationError } from "@/lib/auth";
import { getUsersByOrg } from "@/repositories/users";

export default async function NewAgentPage() {
  let principal;
  try {
    principal = await requireVerifiedGovernancePrincipal();
  } catch (error) {
    if (error instanceof SessionAuthenticationError) redirect("/login");
    throw error;
  }
  const owners = (await getUsersByOrg(principal.organisationId))
    .map(({ user_id, full_name }) => ({ user_id, full_name }));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">Register Agent</h2>
        <p className="text-sm text-gray-400 mt-1">
          Add a new AI agent to the governance registry
        </p>
      </div>
      <AgentForm owners={owners} />
    </div>
  );
}
