-- Atomic admission handling for QR tokens and backup codes.
-- p_scanned_value_hash should be digest(upper(trim(scanned_value)), 'sha256') from the API.

BEGIN;

CREATE OR REPLACE FUNCTION check_in_guest(
  p_event_public_id text,
  p_scanned_value_hash bytea,
  p_requested_admit_count integer DEFAULT 1,
  p_scanner_id uuid DEFAULT NULL,
  p_admitted_by_user_id uuid DEFAULT NULL,
  p_is_backup_code boolean DEFAULT false
)
RETURNS TABLE (
  result checkin_result,
  event_id uuid,
  token_id uuid,
  display_code text,
  capacity integer,
  admitted_count integer,
  remaining_count integer,
  admitted_now integer,
  message text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_token admission_tokens%ROWTYPE;
  v_requested integer;
  v_remaining integer;
  v_admit_now integer;
  v_result checkin_result;
  v_message text;
  v_scanner_event_id uuid;
BEGIN
  v_requested := greatest(coalesce(p_requested_admit_count, 1), 1);

  SELECT *
  INTO v_event
  FROM events e
  WHERE e.public_id = p_event_public_id;

  IF NOT FOUND THEN
    INSERT INTO checkins (
      scanner_id,
      admitted_by_user_id,
      scanned_value_hash,
      requested_admit_count,
      admitted_count,
      result,
      message
    )
    VALUES (
      p_scanner_id,
      p_admitted_by_user_id,
      p_scanned_value_hash,
      v_requested,
      0,
      'invalid',
      'Event was not found.'
    );

    RETURN QUERY SELECT
      'invalid'::checkin_result,
      NULL::uuid,
      NULL::uuid,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      'Event was not found.'::text;
    RETURN;
  END IF;

  IF p_scanner_id IS NOT NULL THEN
    SELECT s.event_id
    INTO v_scanner_event_id
    FROM scanners s
    WHERE s.id = p_scanner_id
      AND s.status = 'active';

    IF v_scanner_event_id IS NOT NULL AND v_scanner_event_id <> v_event.id THEN
      INSERT INTO checkins (
        event_id,
        scanner_id,
        admitted_by_user_id,
        scanned_value_hash,
        requested_admit_count,
        admitted_count,
        result,
        message
      )
      VALUES (
        v_event.id,
        p_scanner_id,
        p_admitted_by_user_id,
        p_scanned_value_hash,
        v_requested,
        0,
        'wrong_event',
        'QR belongs to a different event than this scanner.'
      );

      RETURN QUERY SELECT
        'wrong_event'::checkin_result,
        v_event.id,
        NULL::uuid,
        NULL::text,
        NULL::integer,
        NULL::integer,
        NULL::integer,
        0,
        'QR belongs to a different event than this scanner.'::text;
      RETURN;
    END IF;
  END IF;

  IF v_event.status NOT IN ('planned', 'active') OR now() < v_event.valid_from OR now() > v_event.valid_until THEN
    INSERT INTO checkins (
      event_id,
      scanner_id,
      admitted_by_user_id,
      scanned_value_hash,
      requested_admit_count,
      admitted_count,
      result,
      message
    )
    VALUES (
      v_event.id,
      p_scanner_id,
      p_admitted_by_user_id,
      p_scanned_value_hash,
      v_requested,
      0,
      'event_not_active',
      'Event is not currently open for admission.'
    );

    RETURN QUERY SELECT
      'event_not_active'::checkin_result,
      v_event.id,
      NULL::uuid,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      'Event is not currently open for admission.'::text;
    RETURN;
  END IF;

  IF p_is_backup_code THEN
    SELECT *
    INTO v_token
    FROM admission_tokens t
    WHERE t.event_id = v_event.id
      AND t.backup_code_hash = p_scanned_value_hash
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_token
    FROM admission_tokens t
    WHERE t.event_id = v_event.id
      AND t.token_hash = p_scanned_value_hash
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO checkins (
      event_id,
      scanner_id,
      admitted_by_user_id,
      scanned_value_hash,
      requested_admit_count,
      admitted_count,
      result,
      message
    )
    VALUES (
      v_event.id,
      p_scanner_id,
      p_admitted_by_user_id,
      p_scanned_value_hash,
      v_requested,
      0,
      'invalid',
      'Token or backup code is not valid for this event.'
    );

    RETURN QUERY SELECT
      'invalid'::checkin_result,
      v_event.id,
      NULL::uuid,
      NULL::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      0,
      'Token or backup code is not valid for this event.'::text;
    RETURN;
  END IF;

  IF v_token.status <> 'active' THEN
    INSERT INTO checkins (
      event_id,
      token_id,
      scanner_id,
      admitted_by_user_id,
      scanned_value_hash,
      requested_admit_count,
      admitted_count,
      remaining_after,
      result,
      message
    )
    VALUES (
      v_event.id,
      v_token.id,
      p_scanner_id,
      p_admitted_by_user_id,
      p_scanned_value_hash,
      v_requested,
      0,
      greatest(v_token.capacity - v_token.admitted_count, 0),
      'revoked',
      'Token has been revoked or voided.'
    );

    RETURN QUERY SELECT
      'revoked'::checkin_result,
      v_event.id,
      v_token.id,
      v_token.display_code,
      v_token.capacity,
      v_token.admitted_count,
      greatest(v_token.capacity - v_token.admitted_count, 0),
      0,
      'Token has been revoked or voided.'::text;
    RETURN;
  END IF;

  v_remaining := greatest(v_token.capacity - v_token.admitted_count, 0);

  IF v_remaining = 0 THEN
    INSERT INTO checkins (
      event_id,
      token_id,
      scanner_id,
      admitted_by_user_id,
      scanned_value_hash,
      requested_admit_count,
      admitted_count,
      remaining_after,
      result,
      message
    )
    VALUES (
      v_event.id,
      v_token.id,
      p_scanner_id,
      p_admitted_by_user_id,
      p_scanned_value_hash,
      v_requested,
      0,
      0,
      'fully_used',
      'Token capacity has already been fully admitted.'
    );

    RETURN QUERY SELECT
      'fully_used'::checkin_result,
      v_event.id,
      v_token.id,
      v_token.display_code,
      v_token.capacity,
      v_token.admitted_count,
      0,
      0,
      'Token capacity has already been fully admitted.'::text;
    RETURN;
  END IF;

  v_admit_now := least(v_requested, v_remaining);
  v_result := CASE
    WHEN v_admit_now = v_requested AND v_admit_now = v_remaining THEN 'admitted'::checkin_result
    WHEN v_admit_now = v_requested THEN 'admitted'::checkin_result
    ELSE 'partially_admitted'::checkin_result
  END;
  v_message := CASE
    WHEN v_result = 'partially_admitted' THEN 'Only remaining capacity was admitted.'
    ELSE 'Admission accepted.'
  END;

  UPDATE admission_tokens
  SET admitted_count = admission_tokens.admitted_count + v_admit_now
  WHERE id = v_token.id
  RETURNING * INTO v_token;

  INSERT INTO checkins (
    event_id,
    token_id,
    scanner_id,
    admitted_by_user_id,
    scanned_value_hash,
    requested_admit_count,
    admitted_count,
    remaining_after,
    result,
    message
  )
  VALUES (
    v_event.id,
    v_token.id,
    p_scanner_id,
    p_admitted_by_user_id,
    p_scanned_value_hash,
    v_requested,
    v_admit_now,
    greatest(v_token.capacity - v_token.admitted_count, 0),
    v_result,
    v_message
  );

  RETURN QUERY SELECT
    v_result,
    v_event.id,
    v_token.id,
    v_token.display_code,
    v_token.capacity,
    v_token.admitted_count,
    greatest(v_token.capacity - v_token.admitted_count, 0),
    v_admit_now,
    v_message;
END;
$$;

COMMIT;
