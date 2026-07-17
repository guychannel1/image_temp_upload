-- Migration: master participant list for evidence reports
-- Run this in Supabase SQL Editor if the project already exists.

CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_order INT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS list_order INT;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'participants'
          AND column_name = 'order'
    ) THEN
        EXECUTE 'UPDATE participants SET list_order = "order" WHERE list_order IS NULL AND "order" IS NOT NULL';
        EXECUTE 'ALTER TABLE participants ALTER COLUMN "order" DROP NOT NULL';
    END IF;
END $$;
UPDATE participants SET list_order = id_order.row_number
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id)::INT AS row_number
    FROM participants
    WHERE list_order IS NULL
) AS id_order
WHERE participants.id = id_order.id;
ALTER TABLE participants ALTER COLUMN list_order SET NOT NULL;

CREATE INDEX IF NOT EXISTS participants_full_name_idx ON participants(full_name);
CREATE UNIQUE INDEX IF NOT EXISTS participants_list_order_key ON participants(list_order);
