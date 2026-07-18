import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import { getCurrentUser } from '$lib/server/auth';
import { downloadFromR2, R2_PUBLIC_URL } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_PROXY_BYTES = 10 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
const allowedImageHosts = new Set([
	new URL(R2_PUBLIC_URL).hostname,
	...(env.IMAGE_PROXY_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
]);

async function tryDownloadFromR2(storagePath: string) {
	try {
		const object = await downloadFromR2(storagePath);
		if (!object) return null;
		const body = new Uint8Array(object.buffer);
		return new Response(body, {
			headers: {
				'content-type': object.contentType,
				'cache-control': 'private, max-age=300'
			}
		});
	} catch (err) {
		console.warn('[image-proxy] R2 download failed:', storagePath, err);
		return null;
	}
}

export const GET: RequestHandler = async ({ url, fetch, cookies }) => {
	const currentUser = await getCurrentUser(cookies);
	if (currentUser?.role !== 'admin' && currentUser?.role !== 'staff') {
		error(403, 'Admin or staff access required');
	}

	const storagePath = url.searchParams.get('path');
	const imageUrl = url.searchParams.get('url');

	if (storagePath) {
		const r2Response = await tryDownloadFromR2(storagePath);
		if (r2Response) return r2Response;
	}

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
	if (!allowedImageHosts.has(target.hostname.toLowerCase())) {
		error(403, 'Image host is not allowed');
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(target.toString(), {
			signal: controller.signal,
			headers: {
				accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8',
				referer: `${url.origin}/`,
				'user-agent': 'Temporarily image proxy'
			}
		});
	} catch {
		error(504, 'Image request timed out');
	} finally {
		clearTimeout(timeout);
	}
	if (!response.ok) {
		error(response.status, `Unable to fetch image: ${response.statusText}`);
	}

	const contentType = response.headers.get('content-type') || 'application/octet-stream';
	const contentLength = Number(response.headers.get('content-length') || 0);
	if (!contentType.toLowerCase().startsWith('image/')) {
		error(415, 'Remote resource is not an image');
	}
	if (contentLength > MAX_PROXY_BYTES) {
		error(413, 'Image is too large');
	}
	const body = await response.arrayBuffer();
	if (body.byteLength > MAX_PROXY_BYTES) {
		error(413, 'Image is too large');
	}

	return new Response(body, {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, max-age=300'
		}
	});
};
