import { error } from '@sveltejs/kit';
import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import { getCurrentUser } from '$lib/server/auth';
import type { RequestHandler } from './$types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	const currentUser = await getCurrentUser(cookies);
	if (currentUser?.role !== 'admin') {
		error(403, 'Admin access required');
	}

	const storagePath = url.searchParams.get('path');
	const imageUrl = url.searchParams.get('url');

	if (storagePath && isSupabaseConfigured && supabase) {
		const { data, error: downloadError } = await supabase.storage.from('images').download(storagePath);
		if (!downloadError && data) {
			return new Response(await data.arrayBuffer(), {
				headers: {
					'content-type': data.type || 'application/octet-stream',
					'cache-control': 'private, max-age=300'
				}
			});
		}
	}

	if (!imageUrl) {
		error(400, 'Missing url parameter');
	}

	let target: URL;
	try {
		target = new URL(imageUrl);
	} catch {
		error(400, 'Invalid url parameter');
	}

	if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
		error(400, 'Unsupported image URL protocol');
	}

	const response = await fetch(target.toString(), {
		headers: {
			accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
			referer: `${url.origin}/`,
			'user-agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
		}
	});
	if (!response.ok) {
		error(response.status, `Unable to fetch image: ${response.statusText}`);
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const body = await response.arrayBuffer();

	return new Response(body, {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, max-age=300'
		}
	});
};
