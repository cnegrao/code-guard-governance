import 'server-only';
import type { PassportProfileGovernance } from './agent-passport';
import type { PassportReader, ProfileRow } from './passport-read-store';

/** Audit references only. Never merge identity decision support into field evidence or trust. */
export async function readProfileGovernance(read: PassportReader, profile: ProfileRow): Promise<PassportProfileGovernance> {
  const invalid = (): never => { throw new Error('PASSPORT_PROFILE_LINEAGE_INVALID'); };
  const versionId = profile.canonical_object_id;
  const receipts = await read('agent_version_technical_profile_materializations', { canonical_object_id: versionId });
  if (receipts.some(r => r.canonical_object_id !== versionId || r.status !== 'APPLIED')) invalid();
  const proposalIds = [...new Set([profile.source_proposal_id, ...receipts.map(r => r.proposal_id)])].sort();
  const applications: PassportProfileGovernance['applications'][number][] = [];
  for (const proposalId of proposalIds) {
    const unknowns: string[] = [];
    const app: PassportProfileGovernance['applications'][number] = {
      proposalId, origin: proposalId === profile.source_proposal_id, certifications: [], reconciliations: [], unknowns,
    };
    const applied = receipts.filter(r => r.proposal_id === proposalId);
    if (applied.length > 1) invalid();
    if (applied[0]) app.materialization = { materializationId: applied[0].materialization_id, status: 'APPLIED', appliedAt: applied[0].applied_at, recordedAt: applied[0].created_at };
    else unknowns.push('Technical profile materialization: UNKNOWN.');
    const effectiveAt = Date.parse(app.materialization?.appliedAt ?? profile.updated_at);
    if (!Number.isFinite(effectiveAt)) invalid();
    function activeAtApplication(validFrom: string, validTo?: string | null) {
      const start = Date.parse(validFrom), end = validTo == null ? Infinity : Date.parse(validTo);
      if (!Number.isFinite(start) || Number.isNaN(end) || end < start) invalid();
      return start <= effectiveAt && effectiveAt < end;
    }
    const proposals = await read('agent_version_technical_profile_proposals', { proposal_id: proposalId });
    if (proposals.length > 1) invalid();
    const proposal = proposals[0];
    if (!proposal) {
      unknowns.push('Technical proposal, source candidate and version governance: UNKNOWN.'); applications.push(app); continue;
    }
    if (proposal.proposal_id !== proposalId) invalid();
    app.proposedAt = proposal.created_at; app.candidateId = proposal.agent_version_candidate_id;
    const [candidate] = await read('discovery_candidates', { candidate_id: proposal.agent_version_candidate_id });
    if (!candidate) {
      unknowns.push('Discovery candidate and linked version governance: UNKNOWN.'); applications.push(app); continue;
    }
    if (candidate.candidate_kind !== 'AGENT_VERSION' || candidate.candidate_id !== proposal.agent_version_candidate_id) invalid();
    app.discovery = { findingId: candidate.finding_id, connectionId: candidate.source_connection_id, externalType: candidate.source_external_type, externalId: candidate.source_external_id };
    // Candidate identity is authoritative for this join; path co-presence is never enough.
    const normalized = await read('canonical_normalized_object_mappings', { candidate_id: candidate.candidate_id });
    if (normalized.length > 1 || normalized.some(m => m.canonical_object_id !== versionId || m.canonical_object_kind !== 'AGENT_VERSION'
      || m.normalized_object_identity !== candidate.candidate_id || m.source_connection_id !== candidate.source_connection_id
      || m.source_external_type !== candidate.source_external_type || m.source_external_id !== candidate.source_external_id || !activeAtApplication(m.valid_from))) invalid();
    const mappings = normalized.length ? normalized : (await read('canonical_object_source_mappings', {
      canonical_object_id: versionId, canonical_object_kind: 'AGENT_VERSION', source_connection_id: candidate.source_connection_id,
      source_external_type: candidate.source_external_type, source_external_id: candidate.source_external_id,
    })).filter(m => activeAtApplication(m.valid_from, m.valid_to));
    if (mappings.length > 1) invalid();
    const reconciliations: typeof app.reconciliations[number][] = [];
    const certifications = new Map<string, typeof app.certifications[number]>();
    for (const decisionId of [...new Set(mappings.map(m => m.created_by_decision_id))]) {
      const [decision] = await read('reconciliation_decisions', { decision_id: decisionId });
      if (!decision) continue;
      if (decision.family !== 'OBJECT' || decision.subject_candidate_id !== candidate.candidate_id || decision.canonical_object_id !== versionId
        || decision.canonical_object_kind !== 'AGENT_VERSION' || !['CREATE_NEW','MATCH_EXISTING'].includes(decision.outcome)
        || decision.authority_kind !== 'HUMAN' || !decision.authority_reference) invalid();
      const invocations = await read('reconciliation_invocations', { reconciliation_decision_id: decisionId });
      const reviewIds = new Set<string>();
      for (const invocation of invocations) {
        if (invocation.actor_kind !== 'HUMAN' || invocation.actor_reference !== decision.authority_reference) invalid();
        if (!invocation.review_subject_id) continue;
        const [review] = await read('review_subjects', { review_subject_id: invocation.review_subject_id });
        if (!review) continue;
        if (review.finding_id !== candidate.finding_id || review.candidate_kind !== 'AGENT_VERSION') invalid();
        reviewIds.add(review.review_subject_id);
        const events = await read('review_audit_events', { review_subject_id: review.review_subject_id, new_state: 'CERTIFIED', actor_kind: 'HUMAN' });
        for (const event of events) {
          if (event.review_subject_id !== review.review_subject_id || event.finding_id !== candidate.finding_id
            || event.new_state !== 'CERTIFIED' || event.actor_kind !== 'HUMAN' || !event.actor_reference) invalid();
          // Historical certification events, never a fabricated per-field approval or a latest-event choice.
          const time = Date.parse(event.occurred_at), decidedAt = Date.parse(decision.decided_at);
          if (!Number.isFinite(time) || !Number.isFinite(decidedAt)) invalid();
          if (time <= decidedAt) certifications.set(event.event_id, { eventId: event.event_id, reviewSubjectId: review.review_subject_id,
            actorReference: event.actor_reference!, occurredAt: event.occurred_at, recordedAt: event.recorded_at });
        }
      }
      reconciliations.push({ decisionId, outcome: decision.outcome, actorReference: decision.authority_reference!, decidedAt: decision.decided_at,
        mappingIds: mappings.filter(m => m.created_by_decision_id === decisionId).map(m => m.mapping_id).sort(), reviewSubjectIds: [...reviewIds].sort() });
    }
    app.reconciliations = reconciliations;
    app.certifications = [...certifications.values()].sort((a,b) => a.eventId.localeCompare(b.eventId));
    if (!app.reconciliations.length) unknowns.push('AgentVersion identity reconciliation: UNKNOWN.');
    if (!app.certifications.length) unknowns.push('Human certification of the AgentVersion review: UNKNOWN.');
    applications.push(app);
  }
  return { versionId, originProposalId: profile.source_proposal_id, applications };
}
