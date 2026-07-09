import { env } from '$env/dynamic/private';
import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

/**
 * Public base URL for the R2 bucket (r2.dev subdomain or custom domain).
 * Set CLOUDFLARE_R2_PUBLIC_URL in .env to override the default.
 */
export const R2_PUBLIC_URL =
    (env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-3e02c893d8a841159f8fefab2b1a2a05.r2.dev').replace(/\/$/, '');

/**
 * Creates and returns an S3-compatible client for Cloudflare R2
 * along with the configured bucket name.
 */
export function getR2Client() {
    const accessKeyId     = env.CLOUDFLARE_R2_ACCESS_KEY_ID     || '';
    const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
    const accountId       = env.CLOUDFLARE_R2_ACCOUNT_ID        || '';
    const bucketName      = env.CLOUDFLARE_R2_BUCKET_NAME        || '';

    if (!accessKeyId || !secretAccessKey || !accountId || !bucketName) {
        throw new Error(
            'Cloudflare R2 credentials are missing. ' +
            'Please set CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, ' +
            'CLOUDFLARE_R2_ACCOUNT_ID, and CLOUDFLARE_R2_BUCKET_NAME in your .env file.'
        );
    }

    const client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey }
    });

    return { client, bucketName };
}

/**
 * Uploads a file buffer to Cloudflare R2.
 * Retries up to maxRetries times with exponential backoff on transient failures.
 *
 * @param filePath    - R2 object key (e.g. "ewe/group-1/uuid.jpg")
 * @param buffer      - File content as Buffer
 * @param contentType - MIME type (e.g. "image/jpeg")
 * @param maxRetries  - Number of retry attempts (default: 3)
 * @returns The public URL of the uploaded file
 */
export async function uploadToR2(
    filePath: string,
    buffer: Buffer,
    contentType: string,
    maxRetries = 3
): Promise<string> {
    const { client, bucketName } = getR2Client();
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await client.send(new PutObjectCommand({
                Bucket:      bucketName,
                Key:         filePath,
                Body:        buffer,
                ContentType: contentType
            }));
            return `${R2_PUBLIC_URL}/${filePath}`;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                // Exponential backoff: 1s, 2s
                await new Promise(r => setTimeout(r, attempt * 1000));
            }
        }
    }

    throw lastError;
}

/**
 * Deletes a file from Cloudflare R2 (used for rollback on DB failure).
 * Silently swallows errors so a failed rollback never breaks the response.
 *
 * @param filePath - R2 object key to delete
 */
export async function deleteFromR2(filePath: string): Promise<void> {
    try {
        const { client, bucketName } = getR2Client();
        await client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key:    filePath
        }));
    } catch (err) {
        console.warn('[deleteFromR2] Rollback delete failed (non-fatal):', err);
    }
}

/**
 * Deletes multiple files from Cloudflare R2 in batch.
 * Max 1000 files per single request.
 *
 * @param filePaths - Array of R2 object keys to delete
 */
export async function deleteObjectsFromR2(filePaths: string[]): Promise<void> {
    if (!filePaths || filePaths.length === 0) return;
    try {
        const { client, bucketName } = getR2Client();
        const chunkSize = 1000;
        
        for (let i = 0; i < filePaths.length; i += chunkSize) {
            const chunk = filePaths.slice(i, i + chunkSize);
            await client.send(new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: {
                    Objects: chunk.map(path => ({ Key: path })),
                    Quiet: true
                }
            }));
        }
    } catch (err) {
        console.warn('[deleteObjectsFromR2] Bulk delete failed (non-fatal):', err);
    }
}
