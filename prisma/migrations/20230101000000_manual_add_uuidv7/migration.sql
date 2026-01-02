-- 1. Kích hoạt Extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Tạo hàm UUID v7
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
  timestamp_ms bigint;
  internal_uuid bytea;
BEGIN
  timestamp_ms := (extract(epoch from now()) * 1000)::bigint;
  internal_uuid := decode(lpad(to_hex(timestamp_ms), 12, '0'), 'hex');
  internal_uuid := internal_uuid || gen_random_bytes(10);
  internal_uuid := set_byte(internal_uuid, 6, (get_byte(internal_uuid, 6) & 15) | 112);
  internal_uuid := set_byte(internal_uuid, 8, (get_byte(internal_uuid, 8) & 63) | 128);
  RETURN encode(internal_uuid, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;