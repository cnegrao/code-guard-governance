import type { DefinerInventoryEntry } from './m17-l15-security-profile';

/**
 * L15 SECURITY DEFINER inventories (owner, body SHA-256, config) per M17 slice. Any change requires re-review. The S1 entries are
 * copied verbatim from tests/postgres-m16/m17-s1-security.test.ts (that historical suite keeps its own copy).
 */
export const CFG = 'search_path=pg_catalog, pg_temp;lock_timeout=5s';
/** The seven S1 L15 definers, unchanged by S2 (copied verbatim from m17-s1-security.test.ts; asserted byte-identical below). */
export const L15_S1_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_admit_human_hypothesis_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '9b44f7d25a87151776f51756c34bf54c654c6445c7b4c3b8e7cf642b10dfee46', cfg: CFG },
  { sig: 'gov_repo.l15_admit_human_signal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,timestamp with time zone,text[],text[])', owner: 'postgres', sha: '5d9906f8e699f915dc925f7b185103075942d98eccdcd2fec0e48e1e55e4cf60', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_hypothesis_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,uuid[])', owner: 'postgres', sha: '75934cfdbcd0684c7c20751e0e599c51a32757a5e8079be2827da94ac5401675', cfg: CFG },
  { sig: 'gov_repo.l15_admit_machine_signal_v1(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text,text,uuid,text[],text[])', owner: 'postgres', sha: '1122d2f1a6f1925c5ccd8dc8e62907af12c7e6b60f39bdbbb974c627ee5f6d98', cfg: CFG },
  { sig: 'gov_repo.l15_read_hypothesis_dispositions_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '759086fea06b757f854963ffd9fa507606aeb3c4ead241f02d194e44adc3b487', cfg: CFG },
  { sig: 'gov_repo.l15_read_signals_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text)', owner: 'postgres', sha: '2e7809bbbf935582b9e95cfcd7deb7665ddf61f7c3866d7cce23e1b5e9ac0fd4', cfg: CFG },
  { sig: 'gov_repo.l15_support_completeness_guard_v1()', owner: 'postgres', sha: '93411b42b31461bc4e407cf2c275168068dfc5ff4463050c4b6458c5f6b4822d', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** The seven NEW L15 SECURITY DEFINER routines of S2 (owner, body SHA-256, config). Any change requires re-review. */
export const L15_S2_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_admit_methodology_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text[],integer[],text[],text[],text[],integer[],text[],text[],text[],text[],text[],interval,text,text,text)', owner: 'postgres', sha: '3641a97407bd75c4a066a34c5f648201e2df1765813166b6d5bbe98e7aa3e1c4', cfg: CFG },
  { sig: 'gov_repo.l15_admit_scenario_version_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,uuid,text,uuid,text,text[],text[],text[],text,text,text)', owner: 'postgres', sha: 'c45547e09b4d3729b4a146aef750a4835e90223a8efe17425c7aecfccdfc26cf', cfg: CFG },
  { sig: 'gov_repo.l15_decide_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'cfaa6eef826731d44d2f53aab7273c544d508c08d21fd4f252ddd6c3732f0e7f', cfg: CFG },
  { sig: 'gov_repo.l15_decide_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: '8897b4cbc05f526bcbd244d09caaa5babf054829368dd4f9224c0bf9e1e1867f', cfg: CFG },
  { sig: 'gov_repo.l15_submit_methodology_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'd76e90dad660e532f3cb9f1b359710191257f28c85f53f79175077bb2c8bfc1a', cfg: CFG },
  { sig: 'gov_repo.l15_submit_scenario_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,uuid,text,timestamp with time zone,uuid,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'bc7bb094235d241f2893ddf00d14593dfaba5379f319c6357fa34e98330becad', cfg: CFG },
  { sig: 'gov_repo.l15_registry_commit_guard_v1()', owner: 'postgres', sha: 'fd7fc610a3659d2efcc552f1c934b341d1b235b1edfa6eea391871837c6d196d', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** M17-S2R1: the root D-01 ALLOW guard, now owner-only SECURITY DEFINER with its M17-S0 body unchanged. */
export const L15_S2R1_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_authorization_allow_guard_v1()', owner: 'postgres', sha: 'ee7885662da87a4946ad06596dbcd9f1af9bbb52de0e86fb7b16fd17731b5236', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** M17-S3: the three GOVERNED_RISK RPCs + the owner-only deferred support-integrity guard (owner, body SHA-256, config). */
export const L15_S3_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_submit_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,text,text,text,uuid,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'e6d8587dacea996a38c7f15bb50db3c3937cdc32a574f61e67a20a5e035531f5', cfg: CFG },
  { sig: 'gov_repo.l15_decide_governed_risk_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: '73e0d2401cf073e67d27cc6510d05b7ce0f556dbe397ff6baa8ae07128f60038', cfg: CFG },
  { sig: 'gov_repo.l15_read_governed_risk_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,text,text,uuid,timestamp with time zone,timestamp with time zone)', owner: 'postgres', sha: '9425fa2272293d5148d3aa6433407afc85cc09825432844cd4a440d489326862', cfg: CFG },
  { sig: 'gov_repo.l15_governed_risk_commit_guard_v1()', owner: 'postgres', sha: 'b9b88cf166ad7294fc47264893fc4e8051ce381009e4fcc32111c3bedf26ad5c', cfg: 'search_path=pg_catalog, pg_temp' },
];
/** M17-S4: the three RISK_ASSESSMENT RPCs + the owner-only deferred support-integrity guard (owner, body SHA-256, config). */
export const L15_S4_DEFINER_INVENTORY: readonly DefinerInventoryEntry[] = [
  { sig: 'gov_repo.l15_submit_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,text,text,uuid,text,uuid,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'fb44d9beab311e29d11c5188f3831aa6200068856e9b276d8961f48e5dfb331b', cfg: CFG },
  { sig: 'gov_repo.l15_decide_risk_assessment_proposal_v1(uuid,uuid,bigint,bigint,timestamp with time zone,text,uuid,text,text,uuid,text,text[],text[],text)', owner: 'postgres', sha: 'd39a4505473f169f246bf40ff60749a73820cf8ab40e9e03117fd20ec6ceddda', cfg: CFG },
  { sig: 'gov_repo.l15_read_risk_assessment_v1(uuid,uuid,bigint,bigint,timestamp with time zone,uuid,text,timestamp with time zone,timestamp with time zone)', owner: 'postgres', sha: '8ee008ad3911d82887c46d090a91fc3da84a345373dcab80350e34a6c856df66', cfg: CFG },
  { sig: 'gov_repo.l15_risk_assessment_commit_guard_v1()', owner: 'postgres', sha: 'afed637992ab3fdf692e56d9409854283020d0f8214ffae70c4eae5187b87e37', cfg: 'search_path=pg_catalog, pg_temp' },
];
