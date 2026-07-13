import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { createHash, randomBytes } from 'crypto';
import { isSupabaseConfigured, supabase } from './supabase';
import * as mockDb from './db';

export const SESSION_COOKIE = 'admin_session';
export const SESSION_MAX_AGE = 60 * 60 * 24;

export type CurrentUser = {
	username: string;
	role: 'admin' | 'staff';
};

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function getExpiresAt(): string {
	return new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
}

function setSessionCookie(cookies: Cookies, token: string) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'strict',
		maxAge: SESSION_MAX_AGE
	});
}

export async function createSession(username: string, cookies: Cookies) {
	const token = randomBytes(32).toString('base64url');
	const tokenHash = hashToken(token);
	const expiresAt = getExpiresAt();

	if (isSupabaseConfigured && supabase) {
		const { error } = await supabase
			.from('app_sessions')
			.insert({ token_hash: tokenHash, username, expires_at: expiresAt });
		if (error) throw error;
	} else {
		mockDb.appSessions.push({ token_hash: tokenHash, username, expires_at: expiresAt });
	}

	setSessionCookie(cookies, token);
}

export async function getCurrentUser(cookies: Cookies): Promise<CurrentUser | null> {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;

	const tokenHash = hashToken(token);
	const now = new Date();

	if (isSupabaseConfigured && supabase) {
		const { data: session } = await supabase
			.from('app_sessions')
			.select('username, expires_at')
			.eq('token_hash', tokenHash)
			.maybeSingle();

		if (!session || new Date(session.expires_at) <= now) {
			await destroySession(cookies);
			return null;
		}

		const { data: user } = await supabase
			.from('app_users')
			.select('username, role')
			.eq('username', session.username)
			.maybeSingle();

		if (!user) {
			await destroySession(cookies);
			return null;
		}

		return { username: user.username, role: user.role };
	}

	const session = mockDb.appSessions.find((s) => s.token_hash === tokenHash);
	if (!session || new Date(session.expires_at) <= now) {
		await destroySession(cookies);
		return null;
	}

	const user = mockDb.appUsers.find((u) => u.username === session.username);
	return user ? { username: user.username, role: user.role } : null;
}

export async function destroySession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		const tokenHash = hashToken(token);
		if (isSupabaseConfigured && supabase) {
			await supabase.from('app_sessions').delete().eq('token_hash', tokenHash);
		} else {
			const index = mockDb.appSessions.findIndex((s) => s.token_hash === tokenHash);
			if (index !== -1) mockDb.appSessions.splice(index, 1);
		}
	}

	cookies.delete(SESSION_COOKIE, { path: '/' });
}
