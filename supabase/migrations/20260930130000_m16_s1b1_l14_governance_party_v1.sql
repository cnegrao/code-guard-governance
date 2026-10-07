-- M16-S1B.1: GOVERNANCE_PARTY governed registry + PII boundary (DB only, ADDITIVE on S1B.0).
-- Architecture: docs/architecture/ADR-GOVIA-OWNERSHIP-BUSINESS-POLICY-CONTROL-ENRICHMENT-v1.md
-- §§4, 6-7, 10, 13-14, 17 plus the S1B architecture-owner decisions (D-1..D-14 FROZEN) and the
-- M16-S1B.1 gate. The audited S0 / S1A / S1B.0 migrations are NOT edited and no Authority Policy
-- RPC, parser, evaluator or S1B.0 helper is replaced. Never run against a hosted DB from this slice.
--
-- This migration:
--   A. Immutable GovernanceParty identity/admission (organisation_id + DB-minted opaque UUID; never
--      caller supplied; never derived from email / user id / name / external identity / profile),
--      pinned to its exact ALLOW / GOVERNANCE_PARTY / ADMIT authorization.
--   B. Typed immutable Party proposal detail (VALIDATE: no target; REVOKE: exact VALIDATED Party
--      state) and typed immutable Party state detail over the common l14_registry_states envelope,
--      with a linear, same-Party, alternating VALIDATED -> REVOKED -> VALIDATED lineage.
--   C. Technical Party head (latest_state_id NULL after ADMIT; RPC-only; advanced along lineage).
--   D. gov_repo.governance_party_directory_profiles: the MUTABLE, NON-AUTHORITATIVE directory/profile
--      surface (deliberately not l14-prefixed) — the ONLY place Party PII may live. No application
--      privilege and NO public RPC in this slice: it exists to prove the physical PII boundary.
--   E. Owner-only helpers: per-command guard, Party result projection, bitemporal Party resolver.
--   F. Three public SECURITY DEFINER RPCs (service_role only): ADMIT, SUBMIT, DECIDE, all replay-first:
--      base session -> syntactic shape -> syntactic support -> DB fingerprint -> AP guard SHARED ->
--      registry subject guard (existing subject) -> command guard -> replay arbitration ->
--      tenant/reference/support resolution -> effective Authority Policy -> rule evaluation ->
--      mutation -> final base-eligibility recheck.
-- Authority: ONLY the CURRENT effective Authority Policy (exact immutable content hash) over the
-- actor's CURRENT locked persisted roles; ADMIT = L14_PARTY_ADMIT, decisions = L14_PARTY_VALIDATE
-- with the exact requested action. No bootstrap, no JWT role/email, no service_role authority.
-- D-14 (frozen) stays an insertion invariant (S1B.0); nothing here touches the AP parser.
-- F2 untouched: no canonical_relationships DDL/DML.
BEGIN;

-- ---------------------------------------------------------------------------------------
-- A. Immutable Party identity + admission.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_governance_parties (
  organisation_id uuid NOT NULL REFERENCES gov_repo.organisations (organisation_id),
  -- Opaque, random, minted by PostgreSQL. No RPC accepts it as input.
  governance_party_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')),
  source_class text NOT NULL CHECK (source_class IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION')),
  admitted_by_actor_user_id uuid NOT NULL REFERENCES gov_repo.governance_users (user_id),
  admission_authorization_decision_id uuid NOT NULL,
  admission_authorization_result text NOT NULL DEFAULT 'ALLOW' CHECK (admission_authorization_result = 'ALLOW'),
  admission_subject_kind text NOT NULL DEFAULT 'GOVERNANCE_PARTY' CHECK (admission_subject_kind = 'GOVERNANCE_PARTY'),
  admission_requested_action text NOT NULL DEFAULT 'ADMIT' CHECK (admission_requested_action = 'ADMIT'),
  support_status text NOT NULL CHECK (support_status IN ('NONE','PRESENT')),
  admitted_at timestamptz NOT NULL,
  CONSTRAINT l14_governance_parties_pkey PRIMARY KEY (organisation_id, governance_party_id),
  CONSTRAINT l14_governance_parties_kind_unique UNIQUE (organisation_id, governance_party_id, party_kind),
  -- One admitted Party per ALLOW ADMIT authorization (the durable result derives the minted id from it).
  CONSTRAINT l14_governance_parties_admission_unique UNIQUE (organisation_id, admission_authorization_decision_id),
  CONSTRAINT l14_governance_parties_admission_fkey
    FOREIGN KEY (organisation_id, admission_authorization_decision_id, admission_authorization_result,
                 admission_subject_kind, admission_requested_action)
    REFERENCES gov_repo.l14_authorization_decisions (organisation_id, authorization_decision_id, result,
                 subject_kind, requested_action)
);

-- ---------------------------------------------------------------------------------------
-- B1. Typed immutable Party state detail over the common envelope. No PII.
--     Lineage per Party is linear and alternating: the first state is VALIDATED; a REVOKED state
--     follows (and revokes) exactly its VALIDATED predecessor; a re-validation follows a tombstone.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_governance_party_states (
  organisation_id uuid NOT NULL,
  state_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'GOVERNANCE_PARTY' CHECK (subject_kind = 'GOVERNANCE_PARTY'),
  state_kind text NOT NULL CHECK (state_kind IN ('VALIDATED','REVOKED')),
  governance_party_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')),
  predecessor_state_id uuid,                     -- copy of the envelope value (verified on insert)
  predecessor_state_kind text GENERATED ALWAYS AS (
    CASE WHEN predecessor_state_id IS NULL THEN NULL
         WHEN state_kind = 'VALIDATED' THEN 'REVOKED' ELSE 'VALIDATED' END) STORED,
  revokes_state_id uuid,                         -- copy of the envelope value (verified on insert)
  revoked_state_kind text GENERATED ALWAYS AS (
    CASE WHEN revokes_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  CONSTRAINT l14_governance_party_states_pkey PRIMARY KEY (organisation_id, state_id),
  CONSTRAINT l14_governance_party_states_party_unique UNIQUE (organisation_id, state_id, governance_party_id, party_kind),
  CONSTRAINT l14_governance_party_states_kind_unique
    UNIQUE (organisation_id, state_id, governance_party_id, party_kind, state_kind),
  CONSTRAINT l14_governance_party_states_shape_check CHECK (
    (state_kind = 'VALIDATED' AND revokes_state_id IS NULL)
    OR (state_kind = 'REVOKED' AND revokes_state_id IS NOT NULL AND predecessor_state_id = revokes_state_id)),
  -- The envelope row of exactly this subject kind and state kind.
  CONSTRAINT l14_governance_party_states_envelope_fkey
    FOREIGN KEY (organisation_id, state_id, subject_kind, state_kind)
    REFERENCES gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind),
  CONSTRAINT l14_governance_party_states_party_fkey
    FOREIGN KEY (organisation_id, governance_party_id, party_kind)
    REFERENCES gov_repo.l14_governance_parties (organisation_id, governance_party_id, party_kind),
  -- Same Party, alternating kinds (never VALIDATED -> VALIDATED: no overlapping validity).
  CONSTRAINT l14_governance_party_states_predecessor_fkey
    FOREIGN KEY (organisation_id, predecessor_state_id, governance_party_id, party_kind, predecessor_state_kind)
    REFERENCES gov_repo.l14_governance_party_states (organisation_id, state_id, governance_party_id, party_kind, state_kind),
  CONSTRAINT l14_governance_party_states_revokes_fkey
    FOREIGN KEY (organisation_id, revokes_state_id, governance_party_id, party_kind, revoked_state_kind)
    REFERENCES gov_repo.l14_governance_party_states (organisation_id, state_id, governance_party_id, party_kind, state_kind)
);
-- Exactly one lineage root per Party, and one successor per state.
CREATE UNIQUE INDEX l14_governance_party_states_root_uidx
  ON gov_repo.l14_governance_party_states (organisation_id, governance_party_id) WHERE predecessor_state_id IS NULL;
CREATE UNIQUE INDEX l14_governance_party_states_successor_uidx
  ON gov_repo.l14_governance_party_states (organisation_id, predecessor_state_id) WHERE predecessor_state_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- B2. Typed immutable Party proposal detail over l14_proposals. No PII.
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_governance_party_proposals (
  organisation_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  subject_kind text NOT NULL DEFAULT 'GOVERNANCE_PARTY' CHECK (subject_kind = 'GOVERNANCE_PARTY'),
  intent text NOT NULL CHECK (intent IN ('VALIDATE','REVOKE')),
  governance_party_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')),
  requested_effective_from timestamptz,          -- NULL = IMMEDIATE (DB transaction instant)
  target_state_id uuid,                          -- exact REVOKE target
  target_state_kind text GENERATED ALWAYS AS (
    CASE WHEN target_state_id IS NULL THEN NULL ELSE 'VALIDATED' END) STORED,
  CONSTRAINT l14_governance_party_proposals_pkey PRIMARY KEY (organisation_id, proposal_id),
  CONSTRAINT l14_governance_party_proposals_envelope_fkey
    FOREIGN KEY (organisation_id, proposal_id, subject_kind, intent)
    REFERENCES gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent),
  CONSTRAINT l14_governance_party_proposals_party_fkey
    FOREIGN KEY (organisation_id, governance_party_id, party_kind)
    REFERENCES gov_repo.l14_governance_parties (organisation_id, governance_party_id, party_kind),
  CONSTRAINT l14_governance_party_proposals_target_check CHECK (
    (intent = 'VALIDATE' AND target_state_id IS NULL) OR (intent = 'REVOKE' AND target_state_id IS NOT NULL)),
  -- A REVOKE pins an exact VALIDATED state of the SAME Party.
  CONSTRAINT l14_governance_party_proposals_target_fkey
    FOREIGN KEY (organisation_id, target_state_id, governance_party_id, party_kind, target_state_kind)
    REFERENCES gov_repo.l14_governance_party_states (organisation_id, state_id, governance_party_id, party_kind, state_kind)
);

-- ---------------------------------------------------------------------------------------
-- C. Technical Party head (pointer only; never authoritative on its own).
-- ---------------------------------------------------------------------------------------
CREATE TABLE gov_repo.l14_governance_party_heads (
  organisation_id uuid NOT NULL,
  governance_party_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')),
  latest_state_id uuid,
  CONSTRAINT l14_governance_party_heads_pkey PRIMARY KEY (organisation_id, governance_party_id),
  CONSTRAINT l14_governance_party_heads_party_fkey FOREIGN KEY (organisation_id, governance_party_id, party_kind)
    REFERENCES gov_repo.l14_governance_parties (organisation_id, governance_party_id, party_kind),
  CONSTRAINT l14_governance_party_heads_state_fkey
    FOREIGN KEY (organisation_id, latest_state_id, governance_party_id, party_kind)
    REFERENCES gov_repo.l14_governance_party_states (organisation_id, state_id, governance_party_id, party_kind)
);

-- ---------------------------------------------------------------------------------------
-- D. Mutable, NON-AUTHORITATIVE directory/profile surface. The only Party PII storage.
-- ---------------------------------------------------------------------------------------
-- Tenant-consistent mapping target for the PERSON -> governance user link.
ALTER TABLE gov_repo.governance_users
  ADD CONSTRAINT governance_users_organisation_user_unique UNIQUE (organisation_id, user_id);

CREATE TABLE gov_repo.governance_party_directory_profiles (
  organisation_id uuid NOT NULL,
  governance_party_id uuid NOT NULL,
  party_kind text NOT NULL CHECK (party_kind IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')),
  display_name text CHECK (display_name IS NULL OR pg_catalog.length(display_name) BETWEEN 1 AND 500),
  email text CHECK (email IS NULL OR pg_catalog.length(email) BETWEEN 3 AND 320),
  phone text CHECK (phone IS NULL OR pg_catalog.length(phone) BETWEEN 1 AND 64),
  profile_text text CHECK (profile_text IS NULL OR pg_catalog.length(profile_text) BETWEEN 1 AND 10000),
  governance_user_id uuid,
  external_identity_ref text CHECK (external_identity_ref IS NULL OR pg_catalog.length(external_identity_ref) BETWEEN 1 AND 500),
  erasure_state text NOT NULL DEFAULT 'ACTIVE' CHECK (erasure_state IN ('ACTIVE','PSEUDONYMISED','ERASED')),
  updated_at timestamptz NOT NULL,
  updated_by_actor_user_id uuid REFERENCES gov_repo.governance_users (user_id) ON DELETE SET NULL,
  CONSTRAINT governance_party_directory_profiles_pkey PRIMARY KEY (organisation_id, governance_party_id),
  -- The immutable Party identity can be neither deleted nor re-keyed underneath a profile.
  CONSTRAINT governance_party_directory_profiles_party_fkey
    FOREIGN KEY (organisation_id, governance_party_id, party_kind)
    REFERENCES gov_repo.l14_governance_parties (organisation_id, governance_party_id, party_kind)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Same-tenant user mapping; deleting the user clears ONLY the mapping column.
  CONSTRAINT governance_party_directory_profiles_user_fkey
    FOREIGN KEY (organisation_id, governance_user_id)
    REFERENCES gov_repo.governance_users (organisation_id, user_id)
    ON DELETE SET NULL (governance_user_id) ON UPDATE RESTRICT,
  -- At most one Party per organisation + governance user.
  CONSTRAINT governance_party_directory_profiles_user_unique UNIQUE (organisation_id, governance_user_id),
  CONSTRAINT governance_party_directory_profiles_mapping_kind_check CHECK (
    governance_user_id IS NULL OR party_kind = 'PERSON'),
  -- PSEUDONYMISED keeps no direct identifier; ERASED keeps no PII and no mapping at all.
  CONSTRAINT governance_party_directory_profiles_erasure_check CHECK (
    erasure_state = 'ACTIVE'
    OR (erasure_state = 'PSEUDONYMISED' AND email IS NULL AND phone IS NULL AND governance_user_id IS NULL
        AND external_identity_ref IS NULL)
    OR (erasure_state = 'ERASED' AND display_name IS NULL AND email IS NULL AND phone IS NULL AND profile_text IS NULL
        AND governance_user_id IS NULL AND external_identity_ref IS NULL))
);

-- ---------------------------------------------------------------------------------------
-- E. Immutability + structural guards.
-- ---------------------------------------------------------------------------------------
DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'l14_governance_parties','l14_governance_party_states','l14_governance_party_proposals'
  ] LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON gov_repo.%I FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_history_immutable_v1()',
      v_table || '_immutable', v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON gov_repo.%I FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_history_immutable_v1()',
      v_table || '_no_truncate', v_table);
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I', v_table, v_table || '_immutable');
    EXECUTE pg_catalog.format('ALTER TABLE gov_repo.%I ENABLE ALWAYS TRIGGER %I', v_table, v_table || '_no_truncate');
  END LOOP;
END;
$triggers$;

-- A Party state detail must mirror its envelope exactly, belong to the proposal the envelope's
-- governance decision decided, and respect the Party interval rules (defence in depth: the RPC
-- checks the same rules first with the same closed errors).
CREATE FUNCTION gov_repo.l14_governance_party_state_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $guard$
DECLARE
  v_envelope record;
  v_proposal record;
  v_related_from timestamptz;
BEGIN
  SELECT s.state_kind, s.predecessor_state_id, s.revokes_state_id, s.effective_from, s.governance_decision_id
  INTO v_envelope
  FROM gov_repo.l14_registry_states AS s
  WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.state_id AND s.subject_kind = 'GOVERNANCE_PARTY';
  IF NOT FOUND OR v_envelope.state_kind IS DISTINCT FROM NEW.state_kind
     OR v_envelope.predecessor_state_id IS DISTINCT FROM NEW.predecessor_state_id
     OR v_envelope.revokes_state_id IS DISTINCT FROM NEW.revokes_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_STATE_ENVELOPE_MISMATCH';
  END IF;
  SELECT t.governance_party_id, t.party_kind, t.intent, t.target_state_id INTO v_proposal
  FROM gov_repo.l14_governance_decisions AS d
  JOIN gov_repo.l14_governance_party_proposals AS t
    ON t.organisation_id = d.organisation_id AND t.proposal_id = d.proposal_id
  WHERE d.organisation_id = NEW.organisation_id AND d.governance_decision_id = v_envelope.governance_decision_id;
  IF NOT FOUND OR v_proposal.governance_party_id IS DISTINCT FROM NEW.governance_party_id
     OR v_proposal.party_kind IS DISTINCT FROM NEW.party_kind
     OR v_proposal.intent IS DISTINCT FROM (CASE NEW.state_kind WHEN 'VALIDATED' THEN 'VALIDATE' ELSE 'REVOKE' END)
     OR v_proposal.target_state_id IS DISTINCT FROM NEW.revokes_state_id THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_STATE_PROPOSAL_MISMATCH';
  END IF;
  IF NEW.predecessor_state_id IS NOT NULL THEN
    SELECT s.effective_from INTO v_related_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.predecessor_state_id;
    -- REVOKED: strictly inside the target's validity. Re-validation: never before the tombstone.
    IF NEW.state_kind = 'REVOKED' AND NOT (v_envelope.effective_from > v_related_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_NOT_AFTER_TARGET_EFFECTIVE';
    END IF;
    IF NEW.state_kind = 'VALIDATED' AND NOT (v_envelope.effective_from >= v_related_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER l14_governance_party_states_guard BEFORE INSERT ON gov_repo.l14_governance_party_states
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_governance_party_state_guard_v1();
ALTER TABLE gov_repo.l14_governance_party_states ENABLE ALWAYS TRIGGER l14_governance_party_states_guard;

-- The head is the only mutable Party L14 table: created with no state, identity fixed, never
-- deleted/truncated, and only ever advanced to the direct lineage successor of its current state.
CREATE FUNCTION gov_repo.l14_governance_party_head_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $head$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_governance_party_heads:' || TG_OP;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_state_id IS NOT NULL THEN
      RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_governance_party_heads:INSERT_WITH_STATE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.governance_party_id IS DISTINCT FROM OLD.governance_party_id
     OR NEW.party_kind IS DISTINCT FROM OLD.party_kind
     OR (OLD.latest_state_id IS NOT NULL AND NEW.latest_state_id IS NULL) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_governance_party_heads:IDENTITY';
  END IF;
  IF NEW.latest_state_id IS DISTINCT FROM OLD.latest_state_id AND NOT EXISTS (
       SELECT 1 FROM gov_repo.l14_governance_party_states AS s
       WHERE s.organisation_id = NEW.organisation_id AND s.state_id = NEW.latest_state_id
         AND s.governance_party_id = NEW.governance_party_id
         AND s.predecessor_state_id IS NOT DISTINCT FROM OLD.latest_state_id) THEN
    RAISE EXCEPTION 'L14_HISTORY_IMMUTABLE' USING ERRCODE = '55000', DETAIL = 'l14_governance_party_heads:LINEAGE';
  END IF;
  RETURN NEW;
END;
$head$;
CREATE TRIGGER l14_governance_party_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON gov_repo.l14_governance_party_heads
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_governance_party_head_guard_v1();
CREATE TRIGGER l14_governance_party_heads_no_truncate BEFORE TRUNCATE ON gov_repo.l14_governance_party_heads
  FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.l14_governance_party_head_guard_v1();
ALTER TABLE gov_repo.l14_governance_party_heads ENABLE ALWAYS TRIGGER l14_governance_party_heads_guard;
ALTER TABLE gov_repo.l14_governance_party_heads ENABLE ALWAYS TRIGGER l14_governance_party_heads_no_truncate;

-- The profile is mutable, but its binding to the Party identity is not.
CREATE FUNCTION gov_repo.l14_governance_party_profile_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $profile$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.governance_party_id IS DISTINCT FROM OLD.governance_party_id
     OR NEW.party_kind IS DISTINCT FROM OLD.party_kind THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROFILE_PARTY_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$profile$;
CREATE TRIGGER governance_party_directory_profiles_guard BEFORE UPDATE ON gov_repo.governance_party_directory_profiles
  FOR EACH ROW EXECUTE FUNCTION gov_repo.l14_governance_party_profile_guard_v1();
ALTER TABLE gov_repo.governance_party_directory_profiles ENABLE ALWAYS TRIGGER governance_party_directory_profiles_guard;

-- ---------------------------------------------------------------------------------------
-- F. Owner-only helpers.
-- ---------------------------------------------------------------------------------------

-- EXCLUSIVE per-command guard (organisation + command_id): the same command id is serialized so a
-- concurrent duplicate replays the ORIGINAL result instead of racing the unique command identity.
CREATE FUNCTION gov_repo.l14_lock_command_guard_v1(p_organisation_id uuid, p_command_id text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF p_organisation_id IS NULL OR p_command_id IS NULL OR pg_catalog.length(p_command_id) NOT BETWEEN 1 AND 200
     OR p_command_id <> pg_catalog.btrim(p_command_id) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'GUARD_KEY_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    gov_repo.frame_identity(ARRAY[p_organisation_id::text, 'l14-command-guard-v1', p_command_id]), 0));
END;
$guard$;

-- F-4 attempted-content evidence for a Party ADMIT: the kind is the whole authoritative content.
CREATE FUNCTION gov_repo.l14_governance_party_content_hash_v1(p_party_kind text)
RETURNS text
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$ SELECT gov_repo.l14_sha256_frame_v1(ARRAY['L14_GOVERNANCE_PARTY_CONTENT_V1', p_party_kind]) $$;

-- The ORIGINAL durable Party result, exactly as stored. The minted Party id is derived from the
-- immutable admission (unique per ALLOW authorization) or the immutable typed proposal; no PII.
CREATE FUNCTION gov_repo.l14_governance_party_command_result_v1(p_organisation_id uuid, p_command_id text, p_replay boolean)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, governance_party_id uuid, party_kind text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_replay, c.command_id, c.command_kind, c.subject_kind, c.outcome, c.command_fingerprint,
         c.authorization_decision_id, a.result, a.deny_reason, c.proposal_id, c.governance_decision_id,
         COALESCE(gp.governance_party_id, pp.governance_party_id), COALESCE(gp.party_kind, pp.party_kind),
         c.registry_state_id, s.state_kind, s.effective_from, c.recorded_at
  FROM gov_repo.l14_command_results AS c
  LEFT JOIN gov_repo.l14_authorization_decisions AS a
    ON a.organisation_id = c.organisation_id AND a.authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_governance_parties AS gp
    ON c.command_kind = 'ADMIT_GOVERNANCE_PARTY' AND gp.organisation_id = c.organisation_id
   AND gp.admission_authorization_decision_id = c.authorization_decision_id
  LEFT JOIN gov_repo.l14_governance_party_proposals AS pp
    ON pp.organisation_id = c.organisation_id AND pp.proposal_id = c.proposal_id
  LEFT JOIN gov_repo.l14_registry_states AS s
    ON s.organisation_id = c.organisation_id AND s.state_id = c.registry_state_id
  WHERE c.organisation_id = p_organisation_id AND c.command_id = p_command_id AND c.subject_kind = 'GOVERNANCE_PARTY'
$$;

-- S1C dependency contract. The exact VALIDATED Party state valid at business instant p_effective_at
-- as known at system cutoff p_recorded_cutoff: recorded_at <= cutoff, effective_from <= instant,
-- and no visible REVOKED tombstone targeting it EXACTLY with effective_from <= instant. Returns no
-- row otherwise; ambiguity fails closed (no row). Never falls back to another Party, a governance
-- user, or any profile mapping.
CREATE FUNCTION gov_repo.l14_governance_party_valid_state_v1(
  p_organisation_id uuid, p_governance_party_id uuid, p_effective_at timestamptz, p_recorded_cutoff timestamptz)
RETURNS TABLE (state_id uuid, effective_from timestamptz, recorded_at timestamptz)
LANGUAGE sql
STABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  WITH visible AS (
    SELECT s.state_id, s.state_kind, s.revokes_state_id, s.effective_from, s.recorded_at
    FROM gov_repo.l14_registry_states AS s
    JOIN gov_repo.l14_governance_party_states AS d
      ON d.organisation_id = s.organisation_id AND d.state_id = s.state_id AND d.state_kind = s.state_kind
    WHERE s.organisation_id = p_organisation_id AND s.subject_kind = 'GOVERNANCE_PARTY'
      AND d.governance_party_id = p_governance_party_id AND s.recorded_at <= p_recorded_cutoff
  ), candidates AS (
    SELECT v.state_id, v.effective_from, v.recorded_at FROM visible AS v
    WHERE v.state_kind = 'VALIDATED' AND v.effective_from <= p_effective_at
      AND NOT EXISTS (SELECT 1 FROM visible AS r
                      WHERE r.state_kind = 'REVOKED' AND r.revokes_state_id = v.state_id
                        AND r.effective_from <= p_effective_at)
  )
  SELECT c.state_id, c.effective_from, c.recorded_at FROM candidates AS c
  WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1
$$;

-- ---------------------------------------------------------------------------------------
-- G1. RPC — ADMIT a GovernanceParty (PostgreSQL mints the id; no governance decision, no state).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_admit_governance_party_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_expectation_kind text,                 -- must be EXPECTED_NONE: a new identity is always minted
  p_party_kind text,
  p_source_class text,
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text                -- assertion only; PostgreSQL recomputes
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, governance_party_id uuid, party_kind text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $admit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_party uuid;
BEGIN
  -- 1. Base session eligibility (GV001-GV005/55P03 raise; nothing consumed).
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape (no table read).
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_expectation_kind IS DISTINCT FROM 'EXPECTED_NONE' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'EXPECTATION_MALFORMED';
  END IF;
  IF p_party_kind IS NULL OR p_party_kind NOT IN ('PERSON','GROUP','ORGANISATIONAL_UNIT') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_KIND_UNKNOWN';
  END IF;
  IF p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;

  -- 3. Syntactic support canonicalization (existence is resolved only after replay arbitration).
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);

  -- 4. PostgreSQL-authoritative fingerprint. No PII exists to bind.
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'ADMIT_GOVERNANCE_PARTY', v_org::text, v_actor::text,
          'ADMIT', 'GOVERNANCE_PARTY', p_party_kind, p_source_class, 'EXPECTED_NONE']
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-6. Authority Policy guard SHARED (no subject exists yet), then the command guard.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);

  -- 7. Replay arbitration BEFORE any L14 evaluation: the ORIGINAL result (same minted Party id).
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant/support resolution.
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9-10. The CURRENT effective Authority Policy (exact recomputed hash) is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_PARTY_ADMIT', 'ADMIT', false, 'IMMEDIATE') AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, attempted_content_hash, expectation_kind)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    'ADMIT', 'GOVERNANCE_PARTY', 'ALL_ALLOWED_TARGETS', p_source_class, NULL, NULL,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    gov_repo.l14_governance_party_content_hash_v1(p_party_kind), 'EXPECTED_NONE');
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    -- 11 (DENY). Durable authorization + result only: no Party id is minted.
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_GOVERNANCE_PARTY', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, 'DENIED',
      v_authz, v_now);
  ELSE
    -- 11 (ALLOW). PostgreSQL mints the opaque identity (column DEFAULT). No decision, no state.
    INSERT INTO gov_repo.l14_governance_parties (organisation_id, party_kind, source_class, admitted_by_actor_user_id,
      admission_authorization_decision_id, support_status, admitted_at)
    VALUES (v_org, p_party_kind, p_source_class, v_actor, v_authz, p_support_status, v_now)
    RETURNING governance_party_id INTO v_party;
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind,
      admission_authorization_decision_id, admission_authorization_result, admission_subject_kind,
      admission_requested_action, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'ADMISSION', v_authz, 'ALLOW', 'GOVERNANCE_PARTY', 'ADMIT', i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
    INSERT INTO gov_repo.l14_governance_party_heads (organisation_id, governance_party_id, party_kind, latest_state_id)
    VALUES (v_org, v_party, p_party_kind, NULL);
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, recorded_at)
    VALUES (v_org, p_command_id, 'ADMIT_GOVERNANCE_PARTY', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, 'ADMITTED',
      v_authz, v_now);
  END IF;

  -- 12. Base session eligibility must still hold at commitment (fresh DB clock).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, false);
END;
$admit$;

-- ---------------------------------------------------------------------------------------
-- G2. RPC — Party proposal submission (any ACTIVE same-tenant member; no authority, no
--     decision, no state/head mutation).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_submit_governance_party_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_intent text,
  p_source_class text,
  p_governance_party_id uuid,
  p_party_kind text,
  p_requested_effective_from timestamptz,   -- NULL = IMMEDIATE intent
  p_target_state_id uuid,                   -- REVOKE only: the exact VALIDATED Party state
  p_prior_proposal_id uuid,                 -- correction link (same Party)
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, governance_party_id uuid, party_kind text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $submit$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_support text[];
  v_fingerprint text;
  v_target record;
  v_latest uuid;
  v_proposal uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz;
BEGIN
  -- 1. Any verified ACTIVE same-tenant member (no L14 permission is required to submit).
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);

  -- 2. Syntactic shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_intent IS NULL OR p_intent NOT IN ('VALIDATE','REVOKE')
     OR p_party_kind IS NULL OR p_party_kind NOT IN ('PERSON','GROUP','ORGANISATIONAL_UNIT')
     OR p_source_class IS NULL OR p_source_class NOT IN ('SYSTEM_SEED','LOCAL_HUMAN','SOURCE_CONNECTION') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_VOCABULARY_UNKNOWN';
  END IF;
  IF p_source_class <> 'LOCAL_HUMAN' THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'SOURCE_CLASS_NOT_EXECUTABLE';
  END IF;
  IF p_governance_party_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_REQUIRED';
  END IF;
  IF p_intent = 'VALIDATE' AND p_target_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_PERMITTED';
  END IF;
  IF p_intent = 'REVOKE' AND p_target_state_id IS NULL THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_REQUIRED';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'SUBMIT_PROPOSAL', v_org::text, v_actor::text, 'GOVERNANCE_PARTY', p_intent,
          p_source_class, p_governance_party_id::text, p_party_kind]
    || CASE WHEN p_requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(p_requested_effective_from)] END
    || CASE WHEN p_target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', p_target_state_id::text] END
    || CASE WHEN p_prior_proposal_id IS NULL THEN ARRAY['NO_PRIOR_PROPOSAL']
            ELSE ARRAY['PRIOR_PROPOSAL', p_prior_proposal_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, subject, command), then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'GOVERNANCE_PARTY', p_governance_party_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Tenant/reference/support resolution: exact Party + kind of THIS organisation.
  PERFORM 1 FROM gov_repo.l14_governance_parties AS gp
  WHERE gp.organisation_id = v_org AND gp.governance_party_id = p_governance_party_id AND gp.party_kind = p_party_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_UNRESOLVED';
  END IF;
  IF p_intent = 'REVOKE' THEN
    -- The exact, currently governed (never revoked) VALIDATED state of this Party.
    SELECT s.state_kind, s.governance_party_id, s.party_kind INTO v_target
    FROM gov_repo.l14_governance_party_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = p_target_state_id;
    IF NOT FOUND OR v_target.governance_party_id <> p_governance_party_id OR v_target.party_kind <> p_party_kind THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_UNRESOLVED';
    END IF;
    IF v_target.state_kind <> 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_VALIDATED';
    END IF;
    PERFORM 1 FROM gov_repo.l14_governance_party_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = p_target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    SELECT h.latest_state_id INTO v_latest
    FROM gov_repo.l14_governance_party_heads AS h
    WHERE h.organisation_id = v_org AND h.governance_party_id = p_governance_party_id;
    IF v_latest IS DISTINCT FROM p_target_state_id THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
  END IF;
  IF p_prior_proposal_id IS NOT NULL THEN
    PERFORM 1 FROM gov_repo.l14_governance_party_proposals AS pp
    WHERE pp.organisation_id = v_org AND pp.proposal_id = p_prior_proposal_id
      AND pp.governance_party_id = p_governance_party_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PRIOR_PROPOSAL_UNRESOLVED';
    END IF;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. Envelope + typed detail + support + durable result. Nothing else.
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO gov_repo.l14_proposals (organisation_id, proposal_id, subject_kind, intent, source_class,
    submitted_by_actor_user_id, prior_proposal_id, support_status, submitted_at)
  VALUES (v_org, v_proposal, 'GOVERNANCE_PARTY', p_intent, p_source_class, v_actor, p_prior_proposal_id,
    p_support_status, v_now);
  INSERT INTO gov_repo.l14_governance_party_proposals (organisation_id, proposal_id, subject_kind, intent,
    governance_party_id, party_kind, requested_effective_from, target_state_id)
  VALUES (v_org, v_proposal, 'GOVERNANCE_PARTY', p_intent, p_governance_party_id, p_party_kind,
    p_requested_effective_from, p_target_state_id);
  INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, proposal_id, evidence_id)
  SELECT v_org, pg_catalog.gen_random_uuid(), 'PROPOSAL', v_proposal, i.id
  FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
  INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
    command_fingerprint, actor_user_id, outcome, proposal_id, recorded_at)
  VALUES (v_org, p_command_id, 'SUBMIT_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, 'SUBMITTED',
    v_proposal, v_now);

  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, false);
END;
$submit$;

-- ---------------------------------------------------------------------------------------
-- G3. RPC — governance decision on a Party proposal. VALIDATE intent: VALIDATE / REJECT / DEFER.
--     REVOKE intent: REVOKE / REJECT / DEFER. DEFER is nonterminal.
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION gov_repo.l14_decide_governance_party_proposal_v1(
  p_verified_organisation_id uuid,
  p_verified_actor_user_id uuid,
  p_verified_session_iat bigint,
  p_verified_session_exp bigint,
  p_verified_credential_epoch timestamptz,
  p_command_id text,
  p_proposal_id uuid,
  p_outcome text,
  p_reason_code text,
  p_expected_current_state_id uuid,         -- NULL = explicit expected-none
  p_support_status text,
  p_support_evidence_ids text[],
  p_caller_fingerprint text
)
RETURNS TABLE (
  replay boolean, command_id text, command_kind text, subject_kind text, outcome text, command_fingerprint text,
  authorization_decision_id uuid, authorization_result text, deny_reason text, proposal_id uuid,
  governance_decision_id uuid, governance_party_id uuid, party_kind text, registry_state_id uuid, state_kind text,
  effective_from timestamptz, recorded_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $decide$
#variable_conflict use_column
DECLARE
  v_org uuid := p_verified_organisation_id;
  v_actor uuid := p_verified_actor_user_id;
  v_role_ids uuid[];
  v_support text[];
  v_fingerprint text;
  v_proposal record;
  v_head record;
  v_latest_kind text;
  v_latest_from timestamptz;
  v_target_state_id uuid;
  v_has_basis boolean := false;
  v_basis_policy uuid;
  v_basis_version uuid;
  v_basis_hash text;
  v_deny text;
  v_ordinals integer[];
  v_self boolean;
  v_temporal text := 'IMMEDIATE';
  v_effective_from timestamptz;
  v_now timestamptz;
  v_authz uuid := pg_catalog.gen_random_uuid();
  v_decision uuid := pg_catalog.gen_random_uuid();
  v_state uuid := pg_catalog.gen_random_uuid();
  v_state_kind text;
BEGIN
  -- 1. Base session eligibility.
  SELECT b.role_ids INTO v_role_ids
  FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat, p_verified_session_exp,
    p_verified_credential_epoch) AS b;

  -- 2. Syntactic shape.
  PERFORM gov_repo.l14_validate_command_id_v1(p_command_id, p_caller_fingerprint);
  IF p_outcome IS NULL OR p_outcome NOT IN ('VALIDATE','REJECT','DEFER','REVOKE')
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'GOVERNANCE_PARTY_VALIDATED','GOVERNANCE_PARTY_REJECTED','GOVERNANCE_PARTY_DEFERRED','GOVERNANCE_PARTY_REVOKED')
     OR NOT ((p_outcome = 'VALIDATE' AND p_reason_code = 'GOVERNANCE_PARTY_VALIDATED')
          OR (p_outcome = 'REJECT' AND p_reason_code = 'GOVERNANCE_PARTY_REJECTED')
          OR (p_outcome = 'DEFER' AND p_reason_code = 'GOVERNANCE_PARTY_DEFERRED')
          OR (p_outcome = 'REVOKE' AND p_reason_code = 'GOVERNANCE_PARTY_REVOKED')) THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'DECISION_VOCABULARY_INVALID';
  END IF;
  -- The immutable proposal defines the command identity (fingerprint + subject key); it is the only
  -- row read before replay arbitration, and it can never change or disappear.
  SELECT p.proposal_id, p.intent, p.source_class, p.submitted_by_actor_user_id,
         t.governance_party_id, t.party_kind, t.requested_effective_from, t.target_state_id
  INTO v_proposal
  FROM gov_repo.l14_proposals AS p
  JOIN gov_repo.l14_governance_party_proposals AS t
    ON t.organisation_id = p.organisation_id AND t.proposal_id = p.proposal_id
  WHERE p.organisation_id = v_org AND p.proposal_id = p_proposal_id AND p.subject_kind = 'GOVERNANCE_PARTY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_UNRESOLVED';
  END IF;
  IF (p_outcome = 'VALIDATE' AND v_proposal.intent <> 'VALIDATE')
     OR (p_outcome = 'REVOKE' AND v_proposal.intent <> 'REVOKE') THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'OUTCOME_INTENT_INCOMPATIBLE';
  END IF;

  -- 3-4. Syntactic support, then the PostgreSQL-authoritative fingerprint.
  v_support := gov_repo.l14_support_syntactic_parts_v1(p_support_status, p_support_evidence_ids);
  v_fingerprint := gov_repo.l14_sha256_frame_v1(
    ARRAY['L14_COMMAND_FINGERPRINT_V1', 'DECIDE_PROPOSAL', v_org::text, v_actor::text, p_outcome, p_reason_code,
          v_proposal.proposal_id::text, 'GOVERNANCE_PARTY', v_proposal.intent, v_proposal.source_class,
          v_proposal.governance_party_id::text, v_proposal.party_kind]
    || CASE WHEN v_proposal.requested_effective_from IS NULL THEN ARRAY['IMMEDIATE']
            ELSE ARRAY['EXPLICIT', gov_repo.l14_canonical_instant_v1(v_proposal.requested_effective_from)] END
    || CASE WHEN v_proposal.target_state_id IS NULL THEN ARRAY['NO_TARGET_STATE']
            ELSE ARRAY['TARGET_STATE', v_proposal.target_state_id::text] END
    || CASE WHEN p_expected_current_state_id IS NULL THEN ARRAY['EXPECTED_NONE']
            ELSE ARRAY['EXPECTED_CURRENT', p_expected_current_state_id::text] END
    || v_support);
  IF v_fingerprint IS DISTINCT FROM p_caller_fingerprint THEN
    RAISE EXCEPTION 'L14_FINGERPRINT_MISMATCH' USING ERRCODE = 'GV008', DETAIL = 'CALLER_FINGERPRINT_DIFFERS';
  END IF;

  -- 5-7. Guards (AP shared, subject, command), then replay arbitration.
  PERFORM gov_repo.l14_lock_authority_policy_guard_shared_v1(v_org);
  PERFORM gov_repo.l14_lock_registry_subject_guard_v1(v_org, 'GOVERNANCE_PARTY', v_proposal.governance_party_id::text);
  PERFORM gov_repo.l14_lock_command_guard_v1(v_org, p_command_id);
  IF gov_repo.l14_replay_arbitrate_v1(v_org, p_command_id, v_fingerprint) THEN
    PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
      p_verified_session_exp, p_verified_credential_epoch);
    RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, true);
    RETURN;
  END IF;

  -- 8. Resolution (all under the subject guard): terminality, head expectation, subject rules.
  PERFORM 1 FROM gov_repo.l14_governance_decisions AS d
  WHERE d.organisation_id = v_org AND d.proposal_id = p_proposal_id AND d.outcome IN ('VALIDATE','REJECT','REVOKE');
  IF FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PROPOSAL_TERMINAL';
  END IF;
  SELECT h.latest_state_id INTO v_head
  FROM gov_repo.l14_governance_party_heads AS h
  WHERE h.organisation_id = v_org AND h.governance_party_id = v_proposal.governance_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_UNRESOLVED';
  END IF;
  IF p_expected_current_state_id IS NULL AND v_head.latest_state_id IS NOT NULL THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXISTS';
  END IF;
  IF p_expected_current_state_id IS DISTINCT FROM v_head.latest_state_id THEN
    RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXPECTATION_MISMATCH';
  END IF;
  IF v_head.latest_state_id IS NOT NULL THEN
    SELECT s.state_kind, s.effective_from INTO v_latest_kind, v_latest_from
    FROM gov_repo.l14_registry_states AS s
    WHERE s.organisation_id = v_org AND s.state_id = v_head.latest_state_id;
  END IF;
  IF p_outcome = 'VALIDATE' AND v_latest_kind = 'VALIDATED' THEN
    -- Never a second overlapping VALIDATED state: re-validation only after a tombstone.
    RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'PARTY_ALREADY_VALIDATED';
  END IF;
  IF p_outcome = 'REVOKE' THEN
    PERFORM 1 FROM gov_repo.l14_governance_party_states AS s
    WHERE s.organisation_id = v_org AND s.state_kind = 'REVOKED' AND s.revokes_state_id = v_proposal.target_state_id;
    IF FOUND THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_ALREADY_REVOKED';
    END IF;
    IF v_head.latest_state_id IS DISTINCT FROM v_proposal.target_state_id OR v_latest_kind IS DISTINCT FROM 'VALIDATED' THEN
      RAISE EXCEPTION 'L14_INVALID_COMMAND' USING ERRCODE = 'GV010', DETAIL = 'TARGET_STATE_NOT_CURRENT';
    END IF;
    v_target_state_id := v_proposal.target_state_id;
  END IF;
  PERFORM gov_repo.l14_resolve_support_v1(v_org, p_support_evidence_ids);

  -- 9. One DB evaluation instant; temporal class; the CURRENT effective policy is the ONLY basis.
  v_now := pg_catalog.clock_timestamp();
  IF p_outcome IN ('VALIDATE','REVOKE') THEN
    IF v_proposal.requested_effective_from IS NULL OR v_proposal.requested_effective_from = v_now THEN
      v_effective_from := v_now;
    ELSIF v_proposal.requested_effective_from < v_now THEN
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'BACKDATED';
    ELSE
      v_effective_from := v_proposal.requested_effective_from;
      v_temporal := 'FUTURE_DATED';
    END IF;
  END IF;
  v_self := v_proposal.submitted_by_actor_user_id = v_actor;
  SELECT b.authority_policy_id, b.version_id, b.content_hash INTO v_basis_policy, v_basis_version, v_basis_hash
  FROM gov_repo.l14_effective_authority_basis_v1(v_org, v_now) AS b;
  v_has_basis := FOUND;
  IF NOT v_has_basis THEN
    v_deny := 'NO_EFFECTIVE_AUTHORITY';
  ELSE
    SELECT e.deny_reason, e.rule_ordinals INTO v_deny, v_ordinals
    FROM gov_repo.l14_evaluate_authority_rules_v1(v_org, v_basis_policy, v_basis_version, v_role_ids,
      'L14_PARTY_VALIDATE', p_outcome, p_outcome = 'VALIDATE' AND v_self, v_temporal) AS e;
  END IF;

  INSERT INTO gov_repo.l14_authorization_decisions (
    organisation_id, authorization_decision_id, command_id, command_fingerprint, actor_user_id,
    requested_action, subject_kind, scope_tag, source_class, proposal_id, is_self_validation,
    authority_basis, basis_authority_policy_id, basis_version_id, basis_content_hash, result, deny_reason,
    evaluated_at, expectation_kind, expected_current_state_id)
  VALUES (
    v_org, v_authz, p_command_id, v_fingerprint, v_actor,
    p_outcome, 'GOVERNANCE_PARTY', 'ALL_ALLOWED_TARGETS', v_proposal.source_class, p_proposal_id, v_self,
    CASE WHEN v_has_basis THEN 'AUTHORITY_POLICY_VERSION' END,
    CASE WHEN v_has_basis THEN v_basis_policy END,
    CASE WHEN v_has_basis THEN v_basis_version END,
    CASE WHEN v_has_basis THEN v_basis_hash END,
    CASE WHEN v_deny IS NULL THEN 'ALLOW' ELSE 'DENY' END, v_deny, v_now,
    CASE WHEN p_expected_current_state_id IS NULL THEN 'EXPECTED_NONE' ELSE 'EXPECTED_CURRENT' END,
    p_expected_current_state_id);
  PERFORM gov_repo.l14_snapshot_roles_v1(v_org, v_authz, v_role_ids);
  IF v_has_basis THEN
    PERFORM gov_repo.l14_snapshot_policy_rules_v1(v_org, v_authz, v_basis_policy, v_basis_version, v_ordinals);
  END IF;

  IF v_deny IS NOT NULL THEN
    INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
      command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, recorded_at)
    VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, 'DENIED', v_authz,
      p_proposal_id, v_now);
  ELSE
    -- 10. Party interval rules (authorized commands only; a violation raises and rolls back).
    IF p_outcome = 'REVOKE' AND NOT (v_effective_from > v_latest_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVOKE_NOT_AFTER_TARGET_EFFECTIVE';
    END IF;
    IF p_outcome = 'VALIDATE' AND v_latest_kind = 'REVOKED' AND NOT (v_effective_from >= v_latest_from) THEN
      RAISE EXCEPTION 'L14_CONTINUITY_VIOLATION' USING ERRCODE = 'GV011', DETAIL = 'REVALIDATION_OVERLAPS_PRIOR_INTERVAL';
    END IF;

    INSERT INTO gov_repo.l14_governance_decisions (organisation_id, governance_decision_id, proposal_id,
      subject_kind, outcome, reason_code, authorization_decision_id, actor_user_id, support_status, decided_at)
    VALUES (v_org, v_decision, p_proposal_id, 'GOVERNANCE_PARTY', p_outcome, p_reason_code, v_authz, v_actor,
      p_support_status, v_now);
    INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, governance_decision_id, evidence_id)
    SELECT v_org, pg_catalog.gen_random_uuid(), 'GOVERNANCE_DECISION', v_decision, i.id
    FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);

    IF p_outcome IN ('VALIDATE','REVOKE') THEN
      v_state_kind := CASE WHEN p_outcome = 'VALIDATE' THEN 'VALIDATED' ELSE 'REVOKED' END;
      -- Append-only: predecessor = the expected head state; the target state is never modified.
      INSERT INTO gov_repo.l14_registry_states (organisation_id, state_id, subject_kind, state_kind,
        predecessor_state_id, revokes_state_id, effective_from, recorded_at, governance_decision_id,
        authorization_decision_id, authority_policy_id, authority_policy_version_id, authority_policy_content_hash,
        trust_state, source_class, support_status)
      VALUES (v_org, v_state, 'GOVERNANCE_PARTY', v_state_kind, v_head.latest_state_id, v_target_state_id,
        v_effective_from, v_now, v_decision, v_authz, v_basis_policy, v_basis_version, v_basis_hash,
        'VALIDATED', v_proposal.source_class, p_support_status);
      INSERT INTO gov_repo.l14_governance_party_states (organisation_id, state_id, subject_kind, state_kind,
        governance_party_id, party_kind, predecessor_state_id, revokes_state_id)
      VALUES (v_org, v_state, 'GOVERNANCE_PARTY', v_state_kind, v_proposal.governance_party_id, v_proposal.party_kind,
        v_head.latest_state_id, v_target_state_id);
      -- Technical head: compare-and-set on the exact expectation.
      UPDATE gov_repo.l14_governance_party_heads AS h SET latest_state_id = v_state
      WHERE h.organisation_id = v_org AND h.governance_party_id = v_proposal.governance_party_id
        AND h.latest_state_id IS NOT DISTINCT FROM p_expected_current_state_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'L14_STALE_EXPECTATION' USING ERRCODE = 'GV009', DETAIL = 'PARTY_STATE_EXPECTATION_MISMATCH';
      END IF;
      INSERT INTO gov_repo.l14_support_links (organisation_id, support_link_id, owner_kind, registry_state_id, evidence_id)
      SELECT v_org, pg_catalog.gen_random_uuid(), 'REGISTRY_STATE', v_state, i.id
      FROM pg_catalog.unnest(p_support_evidence_ids) AS i(id);
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        registry_state_id, recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor, v_state_kind,
        v_authz, p_proposal_id, v_decision, v_state, v_now);
    ELSE
      -- REJECT / DEFER: governance decision only; no state, no head change.
      INSERT INTO gov_repo.l14_command_results (organisation_id, command_id, command_kind, subject_kind,
        command_fingerprint, actor_user_id, outcome, authorization_decision_id, proposal_id, governance_decision_id,
        recorded_at)
      VALUES (v_org, p_command_id, 'DECIDE_PROPOSAL', 'GOVERNANCE_PARTY', v_fingerprint, v_actor,
        CASE WHEN p_outcome = 'REJECT' THEN 'REJECTED' ELSE 'DEFERRED' END, v_authz, p_proposal_id, v_decision, v_now);
    END IF;
  END IF;

  -- 11. Base session eligibility at commitment.
  PERFORM 1 FROM gov_repo.l14_session_basis_v1(v_org, v_actor, p_verified_session_iat,
    p_verified_session_exp, p_verified_credential_epoch);
  RETURN QUERY SELECT * FROM gov_repo.l14_governance_party_command_result_v1(v_org, p_command_id, false);
END;
$decide$;

-- ---------------------------------------------------------------------------------------
-- H. Privileges. The hostile 20260818013113 defaults hand every new gov_repo table/routine to
--    service_role and PostgreSQL grants PUBLIC EXECUTE on new functions: both are removed. No
--    application role gets any table privilege (authoritative tables AND the profile table).
--    Exactly the three Party RPCs become service_role-executable. No profile RPC exists.
-- ---------------------------------------------------------------------------------------
ALTER TABLE gov_repo.l14_governance_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_governance_party_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_governance_party_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.l14_governance_party_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_repo.governance_party_directory_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  gov_repo.l14_governance_parties, gov_repo.l14_governance_party_states, gov_repo.l14_governance_party_proposals,
  gov_repo.l14_governance_party_heads, gov_repo.governance_party_directory_profiles
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  gov_repo.l14_governance_party_state_guard_v1(),
  gov_repo.l14_governance_party_head_guard_v1(),
  gov_repo.l14_governance_party_profile_guard_v1(),
  gov_repo.l14_lock_command_guard_v1(uuid, text),
  gov_repo.l14_governance_party_content_hash_v1(text),
  gov_repo.l14_governance_party_command_result_v1(uuid, text, boolean),
  gov_repo.l14_governance_party_valid_state_v1(uuid, uuid, timestamptz, timestamptz),
  gov_repo.l14_admit_governance_party_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text[], text),
  gov_repo.l14_submit_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  gov_repo.l14_admit_governance_party_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, text, text, text[], text),
  gov_repo.l14_submit_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, text, text, uuid, text, timestamptz, uuid, uuid, text, text[], text),
  gov_repo.l14_decide_governance_party_proposal_v1(uuid, uuid, bigint, bigint, timestamptz, text, uuid, text, text, uuid, text, text[], text)
TO service_role;

COMMENT ON TABLE gov_repo.l14_governance_parties IS 'M16-S1B.1 immutable GovernanceParty identity + admission: organisation_id + PostgreSQL-minted opaque governance_party_id (never caller supplied, never derived from user/email/name/external identity/profile), kind, source, exact ALLOW GOVERNANCE_PARTY ADMIT authorization. Holds NO PII. Never an authorization basis.';
COMMENT ON TABLE gov_repo.l14_governance_party_states IS 'M16-S1B.1 immutable typed GOVERNANCE_PARTY detail of l14_registry_states: exact Party + kind; linear, same-Party, alternating VALIDATED/REVOKED lineage (lineage copies verified against the envelope). Holds NO PII.';
COMMENT ON TABLE gov_repo.l14_governance_party_proposals IS 'M16-S1B.1 immutable typed GOVERNANCE_PARTY proposal: exact Party + kind, requested_effective_from (NULL = IMMEDIATE), target_state_id (REVOKE only, exact VALIDATED state of the same Party). Holds NO PII.';
COMMENT ON TABLE gov_repo.l14_governance_party_heads IS 'M16-S1B.1 technical pointer only (latest Party state, NULL after ADMIT); RPC-maintained compare-and-set, advanced only to the direct lineage successor; never authoritative on its own.';
COMMENT ON TABLE gov_repo.governance_party_directory_profiles IS 'M16-S1B.1 MUTABLE, NON-AUTHORITATIVE Party directory/profile: the only Party PII storage (display name, email, phone, profile text, PERSON-only governance-user mapping, external identity reference, erasure state). Never copied into L14 history, fingerprints or results. No application privilege and no public RPC: a later explicit access contract governs mutation.';
COMMENT ON FUNCTION gov_repo.l14_governance_party_valid_state_v1(uuid, uuid, timestamptz, timestamptz) IS 'M16-S1B.1 owner-only bitemporal Party dependency resolver (S1C contract): exact VALIDATED state valid at a business instant as known at a recorded cutoff; no row otherwise; ambiguity fails closed; no fallback.';
COMMENT ON FUNCTION gov_repo.l14_lock_command_guard_v1(uuid, text) IS 'M16-S1B.1 owner-only EXCLUSIVE per-command guard keyed by frame_identity(organisation, command_id): a concurrent duplicate command replays its original result.';

-- ---------------------------------------------------------------------------------------
-- I. ACL / structure / PII postflight (after ALL grants, including the broad legacy defaults).
-- ---------------------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_expected_tables CONSTANT text[] := ARRAY[
    'l14_authority_policies','l14_authority_policy_heads','l14_authority_policy_rules',
    'l14_authority_policy_states','l14_authority_policy_version_proposals','l14_authority_policy_versions',
    'l14_authorization_decision_roles','l14_authorization_decision_rules','l14_authorization_decisions',
    'l14_command_results','l14_governance_decisions','l14_governance_parties','l14_governance_party_heads',
    'l14_governance_party_proposals','l14_governance_party_states','l14_proposals','l14_registry_states',
    'l14_support_links'];
  v_mutable_heads CONSTANT text[] := ARRAY['l14_authority_policy_heads','l14_governance_party_heads'];
  v_public_rpcs CONSTANT text[] := ARRAY[
    'l14_admit_authority_policy_version_v1','l14_admit_governance_party_v1','l14_decide_authority_policy_proposal_v1',
    'l14_decide_governance_party_proposal_v1','l14_submit_governance_party_proposal_v1','l14_submit_proposal_v1'];
  v_pii_columns CONSTANT text[] := ARRAY[
    'name','full_name','display_name','email','phone','profile_text','external_identity_ref','external_id',
    'governance_user_id','erasure_state'];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  v_profile regclass := 'gov_repo.governance_party_directory_profiles'::regclass;
  v_rel record;
  v_fn record;
  v_role text;
  v_privilege text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer >= 170000 THEN
    v_privileges := pg_catalog.array_append(v_privileges, 'MAINTAIN'::text);
  END IF;
  IF (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C")
      FROM pg_catalog.pg_class AS c
      WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\'
        AND c.relkind IN ('r','p','v','m','S','f')) IS DISTINCT FROM v_expected_tables THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: unexpected l14 relation set (tables only; no views/sequences)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite AS w
             JOIN pg_catalog.pg_depend AS d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = w.oid
             JOIN pg_catalog.pg_class AS t ON t.oid = d.refobjid
             WHERE t.relnamespace = 'gov_repo'::regnamespace
               AND (t.relname LIKE 'l14\_%' ESCAPE '\' OR t.oid = v_profile)
               AND w.ev_class <> t.oid) THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: a view exposes an l14 table or the Party profile table';
  END IF;
  FOR v_rel IN
    SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity
    FROM pg_catalog.pg_class AS c
    WHERE c.relnamespace = 'gov_repo'::regnamespace AND (c.relname::text = ANY (v_expected_tables) OR c.oid = v_profile)
  LOOP
    IF v_rel.relkind <> 'r' OR NOT v_rel.relrowsecurity THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % must be an RLS-enabled ordinary table', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rel.relacl, pg_catalog.acldefault('r', v_rel.relowner))) AS a
               WHERE a.grantee <> v_rel.relowner) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % has a non-owner table grant', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att WHERE att.attrelid = v_rel.oid AND att.attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % has column-level grants', v_rel.relname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      FOREACH v_privilege IN ARRAY v_privileges LOOP
        IF pg_catalog.has_table_privilege(v_role, v_rel.oid, v_privilege) THEN
          RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % holds % on %', v_role, v_privilege, v_rel.relname;
        END IF;
      END LOOP;
      IF pg_catalog.has_any_column_privilege(v_role, v_rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % holds a column privilege on %', v_role, v_rel.relname;
      END IF;
    END LOOP;
    -- No JSON/EAV authority storage (and no JSON profile blob either).
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.atttypid IN ('json'::regtype, 'jsonb'::regtype)) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % has a JSON column', v_rel.relname;
    END IF;
    IF v_rel.oid = v_profile THEN
      CONTINUE;
    END IF;
    -- PII boundary: no immutable L14 structure can even represent Party PII.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_rel.oid AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.attname::text = ANY (v_pii_columns)) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % has a PII column', v_rel.relname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k WHERE k.conrelid = v_rel.oid AND k.confrelid = v_profile) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % references the Party profile table', v_rel.relname;
    END IF;
    -- Every table except the RPC-maintained heads carries ALWAYS raising UPDATE/DELETE + TRUNCATE triggers.
    IF v_rel.relname::text <> ALL (v_mutable_heads) AND (
       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) <> 0 AND (t.tgtype & 8) <> 0 AND (t.tgtype & 16) <> 0)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger AS t
                   WHERE t.tgrelid = v_rel.oid AND NOT t.tgisinternal AND t.tgenabled = 'A'
                     AND t.tgfoid = 'gov_repo.l14_history_immutable_v1()'::regprocedure
                     AND (t.tgtype & 2) <> 0 AND (t.tgtype & 32) <> 0)) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % lacks ALWAYS raising BEFORE UPDATE/DELETE and TRUNCATE triggers', v_rel.relname;
    END IF;
  END LOOP;
  -- Structural guards stay ALWAYS enabled.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS t
      WHERE t.tgenabled = 'A' AND NOT t.tgisinternal AND (
        (t.tgrelid = 'gov_repo.l14_governance_party_states'::regclass AND t.tgname = 'l14_governance_party_states_guard')
        OR (t.tgrelid = 'gov_repo.l14_governance_party_heads'::regclass
            AND t.tgname IN ('l14_governance_party_heads_guard','l14_governance_party_heads_no_truncate'))
        OR (t.tgrelid = v_profile AND t.tgname = 'governance_party_directory_profiles_guard'))) <> 4 THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: Party structural guard trigger missing or not ALWAYS';
  END IF;
  -- Profile boundary shape: PERSON-only unique tenant-consistent mapping; user deletion nulls ONLY the mapping.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                 WHERE k.conrelid = v_profile AND k.contype = 'f'
                   AND k.confrelid = 'gov_repo.governance_users'::regclass AND k.confdeltype = 'n'
                   AND k.confdelsetcols = ARRAY[(SELECT att.attnum FROM pg_catalog.pg_attribute AS att
                                                 WHERE att.attrelid = v_profile AND att.attname = 'governance_user_id')]::int2[]
                   AND pg_catalog.cardinality(k.conkey) = 2)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = v_profile AND k.conname = 'governance_party_directory_profiles_user_unique' AND k.contype = 'u')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
                    WHERE k.conrelid = v_profile AND k.contype = 'f'
                      AND k.confrelid = 'gov_repo.l14_governance_parties'::regclass AND k.confdeltype = 'r' AND k.confupdtype = 'r') THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: Party profile mapping/identity constraints wrong';
  END IF;
  FOR v_fn IN
    SELECT p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl, pg_catalog.acldefault('f', v_fn.proowner))) AS a
               WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % has PUBLIC EXECUTE', v_fn.proname;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % executable by %', v_fn.proname, v_role;
      END IF;
    END LOOP;
    IF NOT COALESCE(v_fn.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: % search_path not pinned', v_fn.proname;
    END IF;
    IF v_fn.proname::text = ANY (v_public_rpcs) THEN
      IF NOT v_fn.prosecdef OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_fn.proacl) AS a
                    WHERE a.grantee NOT IN (v_fn.proowner, 'service_role'::regrole::oid)) THEN
        RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: public RPC % ACL/definer shape wrong', v_fn.proname;
      END IF;
    ELSIF v_fn.prosecdef OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_fn.proacl,
            pg_catalog.acldefault('f', v_fn.proowner))) AS a WHERE a.grantee <> v_fn.proowner) THEN
      RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: internal helper % must be owner-only SECURITY INVOKER', v_fn.proname;
    END IF;
  END LOOP;
  -- Exactly the three S1A RPCs + the three Party RPCs (no overloads, nothing else service_role-executable).
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\' AND p.prosecdef) <> 6
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname::text = ANY (v_public_rpcs)) <> 6
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p
      WHERE p.pronamespace = 'gov_repo'::regnamespace AND p.proname LIKE 'l14\_%' ESCAPE '\'
        AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')) <> 6 THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: the public L14 RPC surface must be exactly the three AP + three Party RPCs';
  END IF;
  -- No profile RPC: no application-executable routine anywhere in gov_repo touches the profile table.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
             WHERE p.pronamespace = 'gov_repo'::regnamespace
               AND p.prosrc LIKE '%governance\_party\_directory\_profiles%' ESCAPE '\'
               AND (p.prosecdef OR pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                    OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: a callable routine reaches the Party profile table';
  END IF;
  -- S0 wrapper/eligibility naming contracts stay intact.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE '%\_governed\_v1' ESCAPE '\') <> 6
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.pronamespace = 'gov_repo'::regnamespace
        AND p.proname LIKE 'l14\_%' ESCAPE '\' AND (p.proname LIKE '%eligibility%' OR p.proname LIKE '%governed%')) THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: S0 naming contract disturbed';
  END IF;
  -- F2: nothing on the L14 surface references canonical_relationships.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS k
             WHERE k.confrelid = 'gov_repo.canonical_relationships'::regclass
               AND k.conrelid IN (SELECT c.oid FROM pg_catalog.pg_class AS c
                                  WHERE c.relnamespace = 'gov_repo'::regnamespace AND c.relname LIKE 'l14\_%' ESCAPE '\')) THEN
    RAISE EXCEPTION 'M16_S1B1_POSTFLIGHT: F2 boundary violated';
  END IF;
END;
$postflight$;

COMMIT;
