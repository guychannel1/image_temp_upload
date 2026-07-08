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
