import type {
  AcquisitionRunId,
  OrganisationId,
  SourceConnectionId,
} from "@council/canonical-contracts";

/**
 * Governed Discovery Machine Boundary — S1 contracts
 * (ADR-GOVIA-GOVERNED-DISCOVERY-MACHINE-EXECUTION-BOUNDARY-v1).
 *
 * Persistence-neutral vocabulary only. Nothing here authenticates a machine,
 * grants a capability or authorizes a command: in later slices the database
 * resolves the authenticated LOGIN to its current credential generation,
 * principal, execution binding and closed capability on every command. A
 * TypeScript type or runtime parser is defence in depth, never authority.
 */

declare const machineIdentifierBrand: unique symbol;

type MachineIdentifier<Name extends string> = string & {
  readonly [machineIdentifierBrand]: Name;
};

/** Stable logical Discovery workload principal (DB-generated). */
export type MachinePrincipalId = MachineIdentifier<"MachinePrincipalId">;
/** One credential generation of a principal (DB-generated); authenticates, never scopes. */
export type CredentialGenerationId = MachineIdentifier<"CredentialGenerationId">;
/** Immutable, never-reused execution binding identity (DB-generated). */
export type ExecutionBindingId = MachineIdentifier<"ExecutionBindingId">;
/** Identifies one machine invocation audit record (DB-generated). */
export type MachineInvocationId = MachineIdentifier<"MachineInvocationId">;

declare const bindingRevisionBrand: unique symbol;
/** Monotonic per binding_id, never reset; a revision alone is not an identity. */
export type BindingRevision = number & { readonly [bindingRevisionBrand]: "BindingRevision" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function asUuidIdentifier<Name extends string>(value: string, label: Name): MachineIdentifier<Name> {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase UUID`);
  }
  return value as MachineIdentifier<Name>;
}

export const asMachinePrincipalId = (value: string): MachinePrincipalId =>
  asUuidIdentifier(value, "MachinePrincipalId");
export const asCredentialGenerationId = (value: string): CredentialGenerationId =>
  asUuidIdentifier(value, "CredentialGenerationId");
export const asExecutionBindingId = (value: string): ExecutionBindingId =>
  asUuidIdentifier(value, "ExecutionBindingId");
export const asMachineInvocationId = (value: string): MachineInvocationId =>
  asUuidIdentifier(value, "MachineInvocationId");

export function asBindingRevision(value: number): BindingRevision {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("BindingRevision must be a positive safe integer");
  }
  return value as BindingRevision;
}

/** Closed: intake authorization never implies PROPOSE authorization. */
export const MACHINE_CAPABILITY = {
  DISCOVERY_INTAKE: "DISCOVERY_INTAKE",
  DISCOVERY_PROPOSE: "DISCOVERY_PROPOSE",
} as const;

export type MachineCapability = (typeof MACHINE_CAPABILITY)[keyof typeof MACHINE_CAPABILITY];

/**
 * The only proposal rule in V1. It identifies proposal semantics
 * (DETERMINISTIC_RULE, DETECTED -> PROPOSED) and is fixed by the database,
 * never selected by a caller. Detector codes/versions are unrelated.
 */
export const MACHINE_PROPOSAL_RULE = Object.freeze({
  code: "PASS_THROUGH_V1",
  version: "1.0",
} as const);

export const MACHINE_COMMAND_OUTCOME = {
  APPLIED: "APPLIED",
  REPLAYED: "REPLAYED",
  DENIED: "DENIED",
  CONTENT_CONFLICT: "CONTENT_CONFLICT",
  STATE_CONFLICT: "STATE_CONFLICT",
} as const;

export type MachineCommandOutcome = (typeof MACHINE_COMMAND_OUTCOME)[keyof typeof MACHINE_COMMAND_OUTCOME];

/**
 * Closed denial vocabulary (ADR section 17). Scope failures deliberately share
 * one code so a denial never discloses foreign-tenant or foreign-source
 * existence. Transport/DB failures are classified errors, not denials.
 */
export const MACHINE_DENIAL_CODE = {
  /** Unknown, retired or expired credential generation. */
  CREDENTIAL_NOT_ELIGIBLE: "CREDENTIAL_NOT_ELIGIBLE",
  /** Missing catalog role, role OID mismatch or role name mismatch. */
  ROLE_IDENTITY_MISMATCH: "ROLE_IDENTITY_MISMATCH",
  PRINCIPAL_DISABLED: "PRINCIPAL_DISABLED",
  /** Disabled, revoked, deleted or unknown binding. */
  BINDING_NOT_ELIGIBLE: "BINDING_NOT_ELIGIBLE",
  BINDING_REVISION_STALE: "BINDING_REVISION_STALE",
  /** Wrong tenant, connection, locator, ref, provider pin, adapter/version or source version. */
  SCOPE_MISMATCH: "SCOPE_MISMATCH",
  CAPABILITY_DISABLED: "CAPABILITY_DISABLED",
  RULE_NOT_PERMITTED: "RULE_NOT_PERMITTED",
  /** Missing/inconsistent evidence, finding or candidate linkage, or support not admitted under this run. */
  SUPPORT_NOT_ADMITTED: "SUPPORT_NOT_ADMITTED",
  /** PROPOSE never creates a ReviewSubject implicitly. */
  SUBJECT_MISSING: "SUBJECT_MISSING",
  MALFORMED_COMMAND: "MALFORMED_COMMAND",
} as const;

export type MachineDenialCode = (typeof MACHINE_DENIAL_CODE)[keyof typeof MACHINE_DENIAL_CODE];

export interface MachineCommandDenial {
  readonly outcome: typeof MACHINE_COMMAND_OUTCOME.DENIED;
  readonly denialCode: MachineDenialCode;
}

export interface MachineContentConflict {
  readonly outcome: typeof MACHINE_COMMAND_OUTCOME.CONTENT_CONFLICT;
}

/** Result of a closed admission/proposal command. Success carries no authority. */
export type MachineCommandResult<Success extends object> =
  | (Success & {
      readonly outcome: typeof MACHINE_COMMAND_OUTCOME.APPLIED | typeof MACHINE_COMMAND_OUTCOME.REPLAYED;
    })
  | MachineCommandDenial
  | MachineContentConflict;

/** Result of an exact, scope-bound read. */
export const MACHINE_READ_OUTCOME = { READ: "READ", DENIED: "DENIED" } as const;
export type MachineReadOutcome = (typeof MACHINE_READ_OUTCOME)[keyof typeof MACHINE_READ_OUTCOME];

/** Intake preconditions can fail after a run concludes; no governance state is implied. */
export type MachineIntakeMutationResult<Success extends object> =
  | MachineCommandResult<Success>
  | { readonly outcome: typeof MACHINE_COMMAND_OUTCOME.STATE_CONFLICT };

export type MachineReadResult<Value extends object> =
  | (Value & { readonly outcome: typeof MACHINE_READ_OUTCOME.READ })
  | MachineCommandDenial;

/**
 * Run binding provenance as the database records it at admission (read model).
 * Non-authoritative here: the persisted execution binding is the authorization
 * root; these values identify which binding/revision admitted the run and what
 * the acquisition reported. Provider pin and resolved version are reported by
 * the worker and are consistency signals, not independent proof of origin.
 */
export interface RunBindingProvenance {
  readonly acquisitionRunId: AcquisitionRunId;
  readonly bindingId: ExecutionBindingId;
  readonly bindingRevision: BindingRevision;
  readonly organisationId: OrganisationId;
  readonly sourceConnectionId: SourceConnectionId;
  readonly providerCode: string;
  /** Exact configured locator (identity descriptor). */
  readonly configuredLocator: string;
  /** Scope-comparison form only. */
  readonly normalizedLocator: string;
  /** Provider-scoped authenticity metadata; absent when the provider exposes none. */
  readonly providerSourceId?: string;
  /** Exact, case-sensitive configured ref. */
  readonly authorizedRef: string;
  readonly adapterName: string;
  readonly adapterVersion: string;
  /** Absent when unknown; never fabricated. */
  readonly resolvedSourceVersion?: string;
  /** Generation that admitted the run (provenance only; never permission to keep using it). */
  readonly admissionCredentialGenerationId: CredentialGenerationId;
}
