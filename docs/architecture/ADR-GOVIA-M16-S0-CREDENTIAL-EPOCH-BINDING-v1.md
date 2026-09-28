# M16-S0 credential epoch binding V1

Status: **ACCEPTED / FROZEN CLARIFICATION**. Architecture: **GOVIA-L0L16-CIA-v1.0**
— unchanged. Milestone: **M16-S0 security prerequisite** (slice S0.3.2R). Authority:
explicit architecture-owner instruction following the independent adversarial review
of S0.3.2. This is a narrow addendum; it does not rewrite the M16 functional
architecture and does not rewrite history.

## Unchanged

- M16 functional scope is unchanged.
- The five authoritative fact families are unchanged.
- L14 is unchanged; no Authority Policy or L14 permission is introduced here.
- O07 and O52 retain strict credential-invalidation semantics: a credential
  mutation invalidates **every** previously issued governance session.
- No bounded stale-session residual is accepted.

## Defect this clarification closes

The backend clock may legitimately be up to +5 seconds ahead of the database clock.
With `verified_session_iat > floor(epoch(password_changed_at))` as the only revocation
proof, a token that was truly issued *before* a credential rotation can carry an `iat`
numerically later than the DB-authored epoch of the rotation and stay eligible. That
contradicts the requirement above and is not accepted.

## Decision

1. **Exact DB-authored credential epoch binding is the authoritative revocation
   mechanism.** Every governance session token carries, in a private claim
   `credential_epoch`, the exact `governance_users.password_changed_at` value that
   the database returned for the credential used to establish the session.
2. The database remains the sole author of that value. The backend never invents,
   rounds, advances or replaces it, never derives it from `iat`/JWT timestamps and
   never sources it from `Date.now()`. PostgreSQL microsecond precision and the
   timezone offset are preserved verbatim.
3. At authoritative command eligibility, the verified `credential_epoch` MUST equal
   (PostgreSQL `timestamptz` equality) the `password_changed_at` of the **locked**
   `governance_users` row. A NULL or different value fails with `GV002 /
   M16_ELIGIBILITY_CREDENTIAL_STALE` (detail `CREDENTIAL_EPOCH_MISMATCH`), regardless
   of backend/DB wall-clock skew.
4. `iat > floor(epoch(password_changed_at))` remains, as issuance temporal validation
   and defence in depth. It is no longer the sole credential-revocation proof; both
   checks must pass.
5. `iat` is temporal metadata, not a credential-version identity.
6. The +5 second future-`iat` allowance applies **only** as a backend-vs-DB clock
   sanity bound. It never weakens or bypasses the exact epoch equality.
7. Tokens lacking a well-formed `credential_epoch` claim fail verification (fail
   closed) from this cutover. No backward compatibility lets an old token authorize
   an M16 write.
8. The verified governance principal exposes the verified credential epoch.
   S0.3.3 wrappers MUST pass that verified value into transactional eligibility.
   No application-supplied credential epoch is trusted outside the verified JWT
   principal.
9. There is exactly one canonical eligibility primitive:
   `gov_repo.lock_and_resolve_governance_session_eligibility_v1(p_organisation_id,
   p_actor_user_id, p_verified_session_iat, p_verified_session_exp,
   p_verified_credential_epoch timestamptz)`. The prior four-argument signature is
   dropped; no bypass overload remains. Its `search_path` is pinned to
   `pg_catalog, pg_temp` (pg_catalog first, pg_temp explicitly last).

## Issuance (S0.3.1R preserved)

credential verification → exact DB epoch E1 → wait for the existing issuance
boundary → sign (token carries E1) → exact DB epoch re-read → return only if the row
still has E1. A rotation during bcrypt, the wait or signing is still rejected by the
post-sign recheck.

## Out of scope

S0.3.3 wrappers, production write RPC families, L14 Authority Policy/Proposal,
governance decisions, M16 fact families, policy/control UI, GraphOS and M17+.
