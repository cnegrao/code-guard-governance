-- Administrative onboarding into an EXISTING organisation. No signup change,
-- Supabase Auth identity, canonical write, membership transfer or session issuance.
BEGIN;

CREATE TABLE gov_repo.governance_operator_invitations_v1 (
 invitation_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES gov_repo.organisations(organisation_id),
 email varchar(255) NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 full_name varchar(255) NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 255),
 role_id uuid NOT NULL REFERENCES gov_repo.governance_roles(role_id),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 issued_by_db_role text NOT NULL DEFAULT current_user,
 issued_by_session_user text NOT NULL DEFAULT session_user,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
 state text NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED','REDEEMED','REVOKED')),
 redeemed_user_id uuid REFERENCES gov_repo.governance_users(user_id),
 redeemed_at timestamptz,
 redeemed_by_db_role text,
 revoked_at timestamptz,
 CHECK (isfinite(issued_at) AND isfinite(expires_at) AND expires_at > issued_at AND expires_at <= issued_at + interval '24 hours'),
 CHECK ((state = 'ISSUED' AND redeemed_user_id IS NULL AND redeemed_at IS NULL AND redeemed_by_db_role IS NULL AND revoked_at IS NULL)
     OR (state = 'REDEEMED' AND redeemed_user_id IS NOT NULL AND redeemed_at IS NOT NULL AND redeemed_by_db_role IS NOT NULL AND revoked_at IS NULL)
     OR (state = 'REVOKED' AND redeemed_user_id IS NULL AND redeemed_at IS NULL AND redeemed_by_db_role IS NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX governance_operator_pending_email_v1
 ON gov_repo.governance_operator_invitations_v1(email) WHERE state = 'ISSUED';
ALTER TABLE gov_repo.governance_operator_invitations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gov_repo.governance_operator_invitations_v1 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON gov_repo.governance_operator_invitations_v1 TO service_role;
GRANT UPDATE(state, redeemed_user_id) ON gov_repo.governance_operator_invitations_v1 TO service_role;

-- This immutable administrative receipt is separate from human governance
-- decisions. The DB records the actual issuing/consuming technical authority.
CREATE FUNCTION gov_repo.guard_operator_invitation_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN
   RAISE EXCEPTION 'OPERATOR_INVITATION_IMMUTABLE' USING ERRCODE='42501';
 ELSIF TG_OP = 'INSERT' THEN
   IF current_user <> 'postgres' THEN RAISE EXCEPTION 'OPERATOR_INVITATION_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
   NEW.issued_at := clock_timestamp();
   NEW.issued_by_db_role := current_user;
   NEW.issued_by_session_user := session_user;
   IF NEW.state <> 'ISSUED' THEN RAISE EXCEPTION 'OPERATOR_INVITATION_INVALID_STATE'; END IF;
 ELSE
   IF (to_jsonb(NEW) - ARRAY['state','redeemed_user_id','redeemed_at','redeemed_by_db_role','revoked_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','redeemed_user_id','redeemed_at','redeemed_by_db_role','revoked_at'])
      OR OLD.state <> 'ISSUED' THEN
     RAISE EXCEPTION 'OPERATOR_INVITATION_IMMUTABLE' USING ERRCODE='42501';
   END IF;
   IF current_user = 'postgres' AND NEW.state = 'REVOKED' THEN
     NEW.revoked_at := clock_timestamp();
     NEW.redeemed_user_id := NULL; NEW.redeemed_at := NULL; NEW.redeemed_by_db_role := NULL;
   ELSIF current_user = 'service_role' AND NEW.state = 'REDEEMED' THEN
     IF OLD.expires_at <= clock_timestamp() OR NOT EXISTS (
       SELECT FROM gov_repo.governance_users u
       JOIN gov_repo.organisations o ON o.organisation_id=u.organisation_id AND o.is_active
       JOIN gov_repo.governance_roles r ON r.role_id=OLD.role_id AND r.role_code='GOVERNANCE_ADMIN' AND r.is_system_role
       WHERE u.user_id=NEW.redeemed_user_id AND u.email=OLD.email AND u.organisation_id=OLD.organisation_id
       AND u.status='active' AND u.role_ids=ARRAY[OLD.role_id] AND u.external_id LIKE 'bcrypt:%'
     ) THEN RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023'; END IF;
     NEW.redeemed_at := clock_timestamp(); NEW.redeemed_by_db_role := current_user; NEW.revoked_at := NULL;
   ELSE RAISE EXCEPTION 'OPERATOR_INVITATION_INVALID_TRANSITION' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION gov_repo.guard_operator_invitation_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER operator_invitation_row_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON gov_repo.governance_operator_invitations_v1 FOR EACH ROW EXECUTE FUNCTION gov_repo.guard_operator_invitation_v1();
ALTER TABLE gov_repo.governance_operator_invitations_v1 ENABLE ALWAYS TRIGGER operator_invitation_row_guard_v1;
CREATE TRIGGER operator_invitation_truncate_guard_v1 BEFORE TRUNCATE
 ON gov_repo.governance_operator_invitations_v1 FOR EACH STATEMENT EXECUTE FUNCTION gov_repo.guard_operator_invitation_v1();
ALTER TABLE gov_repo.governance_operator_invitations_v1 ENABLE ALWAYS TRIGGER operator_invitation_truncate_guard_v1;

CREATE FUNCTION gov_repo.issue_governance_operator_invitation_v1(
 p_organisation_id uuid, p_expected_org_code text, p_email text, p_full_name text,
 p_token_hash text, p_expires_at timestamptz, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_role uuid; v_id uuid; v_email text := lower(btrim(p_email));
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'OPERATOR_INVITATION_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM gov_repo.organisations WHERE organisation_id=p_organisation_id AND org_code=p_expected_org_code AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATOR_ORGANISATION_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 SELECT role_id INTO STRICT v_role FROM gov_repo.governance_roles WHERE role_code='GOVERNANCE_ADMIN' AND is_system_role FOR SHARE;
 IF EXISTS (SELECT FROM gov_repo.governance_users WHERE email=v_email) THEN
   RAISE EXCEPTION 'OPERATOR_IDENTITY_ALREADY_EXISTS' USING ERRCODE='23505';
 END IF;
 -- Reissue only within the same organisation. Never transfer an identity or
 -- silently revoke a different organisation's outstanding invitation.
 UPDATE gov_repo.governance_operator_invitations_v1 SET state='REVOKED'
 WHERE email=v_email AND organisation_id=p_organisation_id AND state='ISSUED';
 INSERT INTO gov_repo.governance_operator_invitations_v1
 (organisation_id,email,full_name,role_id,token_hash,expires_at,reason)
 VALUES(p_organisation_id,v_email,btrim(p_full_name),v_role,p_token_hash,p_expires_at,p_reason)
 RETURNING invitation_id INTO v_id;
 RETURN (SELECT jsonb_build_object('invitationId',invitation_id,'email',email,'organisationId',organisation_id,'expiresAt',expires_at)
 FROM gov_repo.governance_operator_invitations_v1 WHERE invitation_id=v_id);
END;
$$;
REVOKE ALL ON FUNCTION gov_repo.issue_governance_operator_invitation_v1(uuid,text,text,text,text,timestamptz,text)
 FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION gov_repo.preview_governance_operator_invitation_v1(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object('email',i.email,'fullName',i.full_name,'organisationName',o.legal_name,'organisationCode',o.org_code,
   'roleCode',r.role_code,'expiresAt',i.expires_at) INTO v_result
 FROM gov_repo.governance_operator_invitations_v1 i
 JOIN gov_repo.organisations o ON o.organisation_id=i.organisation_id AND o.is_active
 JOIN gov_repo.governance_roles r ON r.role_id=i.role_id AND r.role_code='GOVERNANCE_ADMIN' AND r.is_system_role
 WHERE i.token_hash=p_token_hash AND i.state='ISSUED' AND i.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT FROM gov_repo.governance_users u WHERE u.email=i.email);
 IF v_result IS NULL THEN RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION gov_repo.preview_governance_operator_invitation_v1(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION gov_repo.preview_governance_operator_invitation_v1(text) TO service_role;

CREATE FUNCTION gov_repo.redeem_governance_operator_invitation_v1(p_token_hash text,p_password_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_org uuid; v_role uuid; v_inv gov_repo.governance_operator_invitations_v1%ROWTYPE; v_user uuid;
BEGIN
 IF p_password_hash IS NULL OR p_password_hash !~ '^bcrypt:\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN
   RAISE EXCEPTION 'OPERATOR_PASSWORD_HASH_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023';
 END IF;
 SELECT organisation_id,role_id INTO v_org,v_role FROM gov_repo.governance_operator_invitations_v1 WHERE token_hash=p_token_hash;
 PERFORM 1 FROM gov_repo.organisations WHERE organisation_id=v_org AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM gov_repo.governance_roles WHERE role_id=v_role AND role_code='GOVERNANCE_ADMIN' AND is_system_role FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_inv FROM gov_repo.governance_operator_invitations_v1 WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR v_inv.state<>'ISSUED' OR v_inv.expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'OPERATOR_INVITATION_UNAVAILABLE' USING ERRCODE='22023';
 END IF;
 INSERT INTO gov_repo.governance_users(email,full_name,display_name,organisation_id,status,external_id,role_ids)
 VALUES(v_inv.email,v_inv.full_name,left(v_inv.full_name,100),v_inv.organisation_id,'active',p_password_hash,ARRAY[v_inv.role_id])
 RETURNING user_id INTO v_user;
 UPDATE gov_repo.governance_operator_invitations_v1 SET state='REDEEMED',redeemed_user_id=v_user WHERE invitation_id=v_inv.invitation_id;
 -- Existing ALWAYS trigger authors password_changed_at. No hash, token or
 -- session is returned. The operator must use the ordinary credential login.
 RETURN jsonb_build_object('email',v_inv.email,'organisationId',v_inv.organisation_id,'userId',v_user);
END;
$$;
REVOKE ALL ON FUNCTION gov_repo.redeem_governance_operator_invitation_v1(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION gov_repo.redeem_governance_operator_invitation_v1(text,text) TO service_role;
COMMENT ON TABLE gov_repo.governance_operator_invitations_v1 IS
 'Administrative onboarding receipts: immutable prebound identity/organisation/role, SHA256 bearer-token digest, bounded expiry and one terminal consumption/revocation. No human review authority is exercised here.';
NOTIFY pgrst, 'reload schema';
COMMIT;
