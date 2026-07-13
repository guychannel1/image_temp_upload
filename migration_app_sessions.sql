-- Add hashed admin/staff session storage for token-based auth.
-- Run this once in Supabase SQL Editor before deploying the session-token code.

CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES app_users(username) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_sessions_username_idx ON app_sessions(username);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx ON app_sessions(expires_at);
