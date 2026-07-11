import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export const GET: RequestHandler = async ({ url, fetch }) => {
	const imageUrl = url.searchParams.get('url');
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

	const response = await fetch(target.toString());
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
