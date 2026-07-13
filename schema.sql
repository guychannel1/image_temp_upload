-- SQL Migration Script for Supabase
-- Copy and run this script inside the Supabase SQL Editor

-- 1. Create collections table with submission_limit field
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    submission_limit INT NOT NULL DEFAULT 500,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure submission_limit column exists if table was previously created
ALTER TABLE collections ADD COLUMN IF NOT EXISTS submission_limit INT NOT NULL DEFAULT 500;

-- 2. Create submissions table with is_deleted field
CREATE TABLE IF NOT EXISTS submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    collection_name TEXT NOT NULL,
    name TEXT NOT NULL,
    group_name TEXT,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    original_size BIGINT NOT NULL,
    img_url TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure is_deleted column exists if table was previously created
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Create app_users table
CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Store hashed login session tokens. Raw tokens only live in httpOnly cookies.
CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES app_users(username) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_sessions_username_idx ON app_sessions(username);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);

-- Seed app_users with users (guyssar: guychannel1 -> admin, admin: 1234 -> staff)
-- Password 'guychannel1' hash: d2175b1572d0be3ee4e5e04cf339b6f9946c47d6e4b7615d5bf70618d6cace61
-- Password '1234' hash: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
INSERT INTO app_users (username, role, password_hash)
VALUES 
    ('guyssar', 'admin', 'd2175b1572d0be3ee4e5e04cf339b6f9946c47d6e4b7615d5bf70618d6cace61'),
    ('admin', 'staff', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4')
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 4. Create Storage Bucket named "images" (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Enable public upload (INSERT) access to the images bucket
DROP POLICY IF EXISTS "Public Upload Policy" ON storage.objects;
CREATE POLICY "Public Upload Policy"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'images');

-- 6. Enable public read (SELECT) access to the images bucket
DROP POLICY IF EXISTS "Public Read Policy" ON storage.objects;
CREATE POLICY "Public Read Policy"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'images');

-- 7. Enable delete access (DELETE) to the images bucket for cleanup
DROP POLICY IF EXISTS "Public Delete Policy" ON storage.objects;
CREATE POLICY "Public Delete Policy"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'images');

-- ============================================================
-- 8. Atomic submission function (prevents race conditions)
--    Combines quota guard + per-person limit + duplicate name resolution + insert
--    into ONE PostgreSQL transaction with row-level locking.
--    Run this in Supabase SQL Editor to enable concurrent-safe uploads.
-- ============================================================
CREATE OR REPLACE FUNCTION submit_with_quota_guard(
    p_collection_id   uuid,
    p_collection_name text,
    p_name            text,
    p_group_name      text,
    p_file_path       text,
    p_file_size       bigint,
    p_original_size   bigint,
    p_img_url         text,
    p_person_limit    int DEFAULT 3
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    v_limit        int;
    v_count        int;
    v_person_count int;
    v_new_id       uuid;
    v_final_name   text := p_name;
    v_counter      int  := 1;
BEGIN
    -- Lock the collection row to prevent concurrent quota overflows.
    -- Any concurrent call to this function with the same collection_id
    -- will wait here until the current transaction commits or rolls back.
    SELECT submission_limit INTO v_limit
    FROM collections
    WHERE id = p_collection_id
      AND is_active = true
    FOR UPDATE;

    -- Collection not found or not active
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'reason', 'collection_not_found');
    END IF;

    -- Count current active submissions (collection-level quota)
    SELECT COUNT(*) INTO v_count
    FROM submissions
    WHERE collection_id = p_collection_id
      AND is_deleted = false;

    IF v_count >= v_limit THEN
        RETURN json_build_object('success', false, 'reason', 'quota_exceeded', 'limit', v_limit);
    END IF;

    -- Count how many images this specific person has already submitted
    -- Matches exact name AND numbered variants e.g. "สมชาย ใจดี (1)", "สมชาย ใจดี (2)"
    SELECT COUNT(*) INTO v_person_count
    FROM submissions
    WHERE collection_id = p_collection_id
      AND group_name    = p_group_name
      AND (
          LOWER(name) = LOWER(p_name)
          OR LOWER(name) LIKE LOWER(p_name) || ' (%)'
      )
      AND is_deleted = false;

    IF v_person_count >= p_person_limit THEN
        RETURN json_build_object(
            'success',      false,
            'reason',       'person_limit_exceeded',
            'person_limit', p_person_limit
        );
    END IF;

    -- Resolve duplicate display name within the same group (atomic, inside this transaction)
    WHILE EXISTS (
        SELECT 1
        FROM submissions
        WHERE collection_id = p_collection_id
          AND group_name    = p_group_name
          AND LOWER(name)   = LOWER(v_final_name)
          AND is_deleted    = false
    ) LOOP
        v_final_name := p_name || ' (' || v_counter || ')';
        v_counter    := v_counter + 1;
    END LOOP;

    -- Insert the new submission
    INSERT INTO submissions (
        collection_id,
        collection_name,
        name,
        group_name,
        file_path,
        file_size,
        original_size,
        img_url,
        is_deleted
    ) VALUES (
        p_collection_id,
        p_collection_name,
        v_final_name,
        p_group_name,
        p_file_path,
        p_file_size,
        p_original_size,
        p_img_url,
        false
    ) RETURNING id INTO v_new_id;

    RETURN json_build_object(
        'success',    true,
        'id',         v_new_id,
        'final_name', v_final_name
    );
END;
$$;
