-- Migration: attendance records for morning/afternoon checks
-- Run this in Supabase SQL Editor if the project already exists.

CREATE TABLE IF NOT EXISTS attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_date DATE NOT NULL,
    period TEXT NOT NULL CHECK (period IN ('morning', 'afternoon')),
    label TEXT
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_name TEXT,
    attendance_date DATE,
    period TEXT CHECK (period IN ('morning', 'afternoon')),
    is_present BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS participant_name TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS attendance_date DATE;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_present BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'attendance_records'
          AND column_name = 'participant_id'
    ) THEN
        ALTER TABLE attendance_records ALTER COLUMN participant_id DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'attendance_records'
          AND column_name = 'session_id'
    ) THEN
        ALTER TABLE attendance_records ALTER COLUMN session_id DROP NOT NULL;
    END IF;

    IF to_regclass('public.participants') IS NOT NULL
       AND to_regclass('public.attendance_sessions') IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'attendance_records'
             AND column_name = 'participant_id'
       )
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'attendance_records'
             AND column_name = 'session_id'
       )
       AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'attendance_records'
             AND column_name = 'checked'
       )
    THEN
        UPDATE attendance_records AS ar
        SET
            participant_name = COALESCE(ar.participant_name, p.full_name),
            attendance_date = COALESCE(ar.attendance_date, s.session_date),
            period = COALESCE(ar.period, s.period),
            is_present = COALESCE(ar.checked, ar.is_present, FALSE),
            updated_at = NOW()
        FROM participants AS p, attendance_sessions AS s
        WHERE ar.participant_id = p.id
          AND ar.session_id = s.id
          AND (
              ar.participant_name IS NULL
              OR ar.attendance_date IS NULL
              OR ar.period IS NULL
          );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_records_period_check'
          AND conrelid = 'attendance_records'::regclass
    ) THEN
        ALTER TABLE attendance_records
            ADD CONSTRAINT attendance_records_period_check
            CHECK (period IN ('morning', 'afternoon'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_records_participant_date_period_key'
          AND conrelid = 'attendance_records'::regclass
    ) THEN
        ALTER TABLE attendance_records
            ADD CONSTRAINT attendance_records_participant_date_period_key
            UNIQUE (participant_name, attendance_date, period);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_sessions_date_period_key'
          AND conrelid = 'attendance_sessions'::regclass
    ) THEN
        ALTER TABLE attendance_sessions
            ADD CONSTRAINT attendance_sessions_date_period_key
            UNIQUE (session_date, period);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS attendance_records_name_idx ON attendance_records(participant_name);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx ON attendance_records(attendance_date);
