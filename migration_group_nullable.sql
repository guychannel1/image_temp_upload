-- Migration: make group_name nullable in submissions
-- Run this in Supabase SQL Editor if the table already exists

ALTER TABLE submissions ALTER COLUMN group_name DROP NOT NULL;
