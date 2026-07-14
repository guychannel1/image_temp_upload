import { env } from '$env/dynamic/private';
import { supabase, isSupabaseConfigured } from './supabase';
import * as mockDb from './db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client } from './r2';

export interface BackupResult {
    success: boolean;
    message: string;
    folderPath?: string;
    filesCount?: number;
    sizeBytes?: number;
    error?: string;
}


/**
 * Downloads image file from Supabase Storage or via HTTP fetch or from Data URL
 */
async function getFileBuffer(submission: any): Promise<{ buffer: Buffer; contentType: string }> {
    // 1. If live Supabase, try to download from Storage first
    if (isSupabaseConfigured && supabase && submission.file_path) {
        try {
            const { data, error } = await supabase.storage
                .from('images')
                .download(submission.file_path);
            
            if (!error && data) {
                const arrayBuffer = await data.arrayBuffer();
                return {
                    buffer: Buffer.from(arrayBuffer),
                    contentType: data.type || 'image/jpeg'
                };
            }
            console.warn(`Supabase Storage download failed for ${submission.file_path}, trying fallback URL...`, error);
        } catch (e) {
            console.warn(`Error downloading from Supabase Storage:`, e);
        }
    }

    // 2. Fallback: Parse Data URL if present (typically in Mock DB mode)
    const imgData = submission.img_data || submission.img_url || '';
    if (imgData.startsWith('data:')) {
        const matches = imgData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const contentType = matches[1];
            const base64Data = matches[2];
            return {
                buffer: Buffer.from(base64Data, 'base64'),
                contentType
            };
        }
    }

    // 3. Fallback: HTTP Fetch URL
    const url = submission.img_url || submission.img_data;
    if (url && url.startsWith('http')) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP fetch failed for URL: ${url}`);
        }
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await response.arrayBuffer();
        return {
            buffer: Buffer.from(arrayBuffer),
            contentType
        };
    }

    throw new Error(`Unable to retrieve file content for submission: ${submission.name}`);
}

/**
 * Runs the Cloudflare R2 backup process.
 * Supports both Cloudflare Workers R2 Bucket binding (native) and AWS S3 SDK (fallback).
 * Saves a JSON manifest and all image files to a subfolder in R2.
 */
export async function runBackup(r2BucketBinding?: any): Promise<BackupResult> {
    try {
        console.log('🔄 Starting Cloudflare R2 Backup...');
        
        let client: any = null;
        let bucketName = '';

        if (r2BucketBinding) {
            console.log('☁️ Using Cloudflare native R2 Bucket binding for backup.');
            bucketName = 'R2_BINDING';
        } else {
            console.log('🔌 Using AWS S3 SDK with credentials from env for backup.');
            const r2 = getR2Client();
            client = r2.client;
            bucketName = r2.bucketName;
        }

        // 1. Gather Collections & Submissions
        let collections: any[] = [];
        let submissions: any[] = [];
        let participants: any[] = [];

        if (isSupabaseConfigured && supabase) {
            const { data: cols, error: colsErr } = await supabase
                .from('collections')
                .select('*');
            if (colsErr) throw colsErr;
            collections = cols || [];

            const { data: subs, error: subsErr } = await supabase
                .from('submissions')
                .select('*');
            if (subsErr) throw subsErr;
            submissions = subs || [];

            const { data: participantRows, error: participantsErr } = await supabase
                .from('participants')
                .select('*');
            if (participantsErr) {
                console.warn('Participants backup skipped:', participantsErr.message);
            } else {
                participants = participantRows || [];
            }
        } else {
            // Fallback mock DB
            collections = mockDb.collections;
            submissions = mockDb.submissions;
            participants = mockDb.participants;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFolder = `backups/backup-${timestamp}`;

        console.log(`📂 Destination bucket path: s3://${bucketName}/${backupFolder}/`);

        // 2. Upload Metadata JSON manifest
        const manifest = {
            backup_version: '1.0',
            exported_at: new Date().toISOString(),
            total_collections: collections.length,
            total_submissions: submissions.length,
            total_participants: participants.length,
            collections: collections.map(c => ({
                id: c.id,
                name: c.name,
                is_active: c.is_active,
                submission_limit: c.submission_limit ?? 500,
                created_at: c.created_at
            })),
            submissions: submissions.map(s => ({
                id: s.id,
                collection_id: s.collection_id,
                collection_name: s.collection_name,
                name: s.name,
                group_name: s.group_name,
                file_path: s.file_path,
                file_size: s.file_size,
                original_size: s.original_size,
                img_url: s.img_url || s.img_data,
                is_deleted: s.is_deleted,
                created_at: s.created_at
            })),
            participants: participants.map((p, index) => ({
                id: p.id,
                list_order: p.list_order ?? p.order ?? index + 1,
                full_name: p.full_name ?? p.fullName ?? p.name,
                created_at: p.created_at,
                updated_at: p.updated_at
            }))
        };

        const manifestKey = `${backupFolder}/metadata.json`;
        if (r2BucketBinding) {
            await r2BucketBinding.put(manifestKey, JSON.stringify(manifest, null, 2), {
                httpMetadata: { contentType: 'application/json' }
            });
        } else {
            await client.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: manifestKey,
                Body: JSON.stringify(manifest, null, 2),
                ContentType: 'application/json'
            }));
        }

        console.log(`✅ Uploaded metadata.json manifest to R2.`);

        // 3. Upload images
        let successCount = 0;
        let totalSize = 0;
        const failedSubmissions: string[] = [];

        for (const sub of submissions) {
            try {
                // Get image buffer and content type
                const { buffer, contentType } = await getFileBuffer(sub);
                
                // R2 Key path
                const imageKey = `${backupFolder}/images/${sub.file_path}`;
                
                if (r2BucketBinding) {
                    await r2BucketBinding.put(imageKey, buffer, {
                        httpMetadata: { contentType }
                    });
                } else {
                    await client.send(new PutObjectCommand({
                        Bucket: bucketName,
                        Key: imageKey,
                        Body: buffer,
                        ContentType: contentType
                    }));
                }

                successCount++;
                totalSize += buffer.length;
            } catch (err: any) {
                console.error(`❌ Failed to backup file for submission ${sub.name}:`, err);
                failedSubmissions.push(`${sub.name} (ID: ${sub.id}) - ${err.message}`);
            }
        }

        const statsMsg = `Backup completed successfully. Backed up ${successCount}/${submissions.length} files. Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB.`;
        console.log(`🎉 ${statsMsg}`);

        if (failedSubmissions.length > 0) {
            console.warn(`⚠️ Warning: ${failedSubmissions.length} files failed to backup:\n`, failedSubmissions.join('\n'));
        }

        return {
            success: true,
            message: statsMsg + (failedSubmissions.length > 0 ? ` (Failed to backup ${failedSubmissions.length} files)` : ''),
            folderPath: `${bucketName}/${backupFolder}`,
            filesCount: successCount,
            sizeBytes: totalSize
        };

    } catch (err: any) {
        console.error('❌ Cloudflare R2 backup process failed:', err);
        return {
            success: false,
            message: err.message || 'An error occurred during Cloudflare R2 backup',
            error: err.toString()
        };
    }
}
