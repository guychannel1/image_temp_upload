-- SQL Migration Script for Supabase
-- Copy and run this script inside the Supabase SQL Editor

-- 1. Create collections table
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create submissions table
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create Storage Bucket named "images" (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Enable public upload (INSERT) access to the images bucket
CREATE POLICY "Public Upload Policy"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'images');

-- 5. Enable public read (SELECT) access to the images bucket
CREATE POLICY "Public Read Policy"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'images');

-- 6. Enable delete access (DELETE) to the images bucket for cleanup
CREATE POLICY "Public Delete Policy"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'images');

