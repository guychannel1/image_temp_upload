import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { runBackup } from '$lib/server/backup';
import type { RequestHandler } from './$types';

function checkToken(url: URL, headers: Headers): boolean {
    const configuredToken = env.BACKUP_CRON_TOKEN;
    if (!configuredToken) {
        return false;
    }

    const queryToken = url.searchParams.get('token');
    const authHeader = headers.get('Authorization');
    const headerToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

    return queryToken === configuredToken || headerToken === configuredToken;
}

export const GET: RequestHandler = async ({ url, request, platform }) => {
    const configuredToken = env.BACKUP_CRON_TOKEN;
    if (!configuredToken) {
        return json({ 
            success: false, 
            message: 'Backup token is not configured on the server. Please set BACKUP_CRON_TOKEN in .env.' 
        }, { status: 500 });
    }

    if (!checkToken(url, request.headers)) {
        return json({ success: false, message: 'Unauthorized. Invalid or missing backup token.' }, { status: 401 });
    }

    const r2Bucket = (platform as any)?.env?.R2_BUCKET || (platform as any)?.env?.R2 || (platform as any)?.env?.images;
    const result = await runBackup(r2Bucket);
    if (result.success) {
        return json(result);
    } else {
        return json(result, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ url, request, platform }) => {
    const configuredToken = env.BACKUP_CRON_TOKEN;
    if (!configuredToken) {
        return json({ 
            success: false, 
            message: 'Backup token is not configured on the server. Please set BACKUP_CRON_TOKEN in .env.' 
        }, { status: 500 });
    }

    if (!checkToken(url, request.headers)) {
        return json({ success: false, message: 'Unauthorized. Invalid or missing backup token.' }, { status: 401 });
    }

    const r2Bucket = (platform as any)?.env?.R2_BUCKET || (platform as any)?.env?.R2 || (platform as any)?.env?.images;
    const result = await runBackup(r2Bucket);
    if (result.success) {
        return json(result);
    } else {
        return json(result, { status: 500 });
    }
};
