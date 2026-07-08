import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

export const supabaseUrl = env.SUPABASE_URL || '';
export const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseKey;

export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl, supabaseKey)
    : null;

if (isSupabaseConfigured) {
    console.log('🔌 Connected to Supabase Live Backend');
} else {
    console.log('⚠️ Supabase credentials not found in env. Running in local memory Mock DB mode.');
}
