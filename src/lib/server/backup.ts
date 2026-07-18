import { supabase, isSupabaseConfigured } from './supabase';
import * as mockDb from './db';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { downloadFromR2, getR2Client, R2_PUBLIC_URL } from './r2';
import { createHash } from 'crypto';

export interface BackupResult {
    success: boolean;
    message: string;
    folderPath?: string;
    filesCount?: number;
    sizeBytes?: number;
    error?: string;
}

export type RestoreImagesResult = {
    filesCount: number;
    sizeBytes: number;
    urlsBySubmissionId: Record<string, string>;
};

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>) {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            await task(items[index], index);
        }
    });
    await Promise.all(workers);
}


/**
 * Downloads image file from Cloudflare R2, HTTP URL, Supabase Storage, or Data URL.
 */
async function getFileBuffer(submission: any, r2BucketBinding?: any): Promise<{ buffer: Buffer; contentType: string }> {
    // 1. Primary source: Cloudflare R2 object key.
    if (submission.file_path) {
        try {
            const object = await downloadFromR2(submission.file_path, r2BucketBinding);
            if (object) return object;
        } catch (e: any) {
            console.warn(`R2 download failed for ${submission.file_path}, trying fallback URL...`, e?.message || e);
        }
    }

    // 2. Fallback: HTTP Fetch URL (R2 public URL is stored in img_url for new uploads)
    const url = submission.img_url || submission.img_data || (submission.file_path ? `${R2_PUBLIC_URL}/${submission.file_path}` : '');
    if (url && url.startsWith('http')) {
        const response = await fetch(url);
        if (response.ok) {
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const arrayBuffer = await response.arrayBuffer();
            return {
                buffer: Buffer.from(arrayBuffer),
                contentType
            };
        }
        console.warn(`HTTP image fetch failed for ${url}: ${response.status} ${response.statusText}`);
    }

    // 3. Legacy fallback: Supabase Storage (old deployments only)
    if (isSupabaseConfigured && supabase && submission.file_path) {
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
    }

    // 4. Fallback: Parse Data URL if present (typically in Mock DB mode)
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

    throw new Error(`Unable to retrieve file content for submission: ${submission.name}`);
}

async function uploadBackupObject(target: {
    r2BucketBinding?: any;
    client?: any;
    bucketName: string;
    key: string;
    body: string | Buffer;
    contentType: string;
}) {
    if (target.r2BucketBinding) {
        await target.r2BucketBinding.put(target.key, target.body, {
            httpMetadata: { contentType: target.contentType }
        });
        return;
    }

    await target.client.send(new PutObjectCommand({
        Bucket: target.bucketName,
        Key: target.key,
        Body: target.body,
        ContentType: target.contentType
    }));
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
        let attendanceSessions: any[] = [];
        let attendanceRecords: any[] = [];
        let appUsers: any[] = [];

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

            const [participantsResponse, attendanceResponse, sessionsResponse, usersResponse] = await Promise.all([
                supabase.from('participants').select('*'),
                supabase.from('attendance_records').select('*'),
                supabase.from('attendance_sessions').select('*'),
                supabase.from('app_users').select('id, username, role, password_hash, created_at')
            ]);
            if (participantsResponse.error) throw participantsResponse.error;
            if (attendanceResponse.error) throw attendanceResponse.error;
            if (sessionsResponse.error) throw sessionsResponse.error;
            if (usersResponse.error) throw usersResponse.error;
            participants = participantsResponse.data || [];
            attendanceRecords = attendanceResponse.data || [];
            attendanceSessions = sessionsResponse.data || [];
            appUsers = usersResponse.data || [];
        } else {
            // Fallback mock DB
            collections = mockDb.collections;
            submissions = mockDb.submissions;
            participants = mockDb.participants;
            attendanceSessions = mockDb.attendanceSessions;
            attendanceRecords = mockDb.attendanceRecords;
            appUsers = mockDb.appUsers;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFolder = `backups/backup-${timestamp}`;

        console.log(`📂 Destination bucket path: s3://${bucketName}/${backupFolder}/`);

        // 2. Build a manifest. It is uploaded only after every image succeeds.
        const manifest: any = {
            backup_version: '2.0',
            backup_status: 'building',
            backup_folder: backupFolder,
            exported_at: new Date().toISOString(),
            total_collections: collections.length,
            total_submissions: submissions.length,
            total_participants: participants.length,
            total_attendance_sessions: attendanceSessions.length,
            total_attendance_records: attendanceRecords.length,
            total_users: appUsers.length,
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
            })),
            attendance_sessions: attendanceSessions.map((session) => ({
                id: session.id,
                session_date: session.session_date,
                period: session.period,
                label: session.label ?? null,
                is_deleted: session.is_deleted ?? false
            })),
            attendance_records: attendanceRecords.map((record) => ({
                id: record.id,
                participant_id: record.participant_id ?? null,
                session_id: record.session_id ?? null,
                participant_name: record.participant_name,
                attendance_date: record.attendance_date,
                period: record.period,
                is_present: record.is_present ?? record.checked ?? false,
                is_deleted: record.is_deleted ?? false,
                created_at: record.created_at,
                updated_at: record.updated_at
            })),
            app_users: appUsers.map((user) => ({
                id: user.id,
                username: user.username,
                role: user.role,
                password_hash: user.password_hash,
                created_at: user.created_at
            }))
        };

        // 3. Upload and checksum every image.
        let successCount = 0;
        let totalSize = 0;
        const failedSubmissions: string[] = [];

        await runWithConcurrency(submissions, 5, async (sub) => {
            try {
                // Get image buffer and content type
                const { buffer, contentType } = await getFileBuffer(sub, r2BucketBinding);
                
                // R2 Key path
                if (!sub.file_path) throw new Error(`Missing file_path for submission ${sub.id}`);
                const imageKey = `${backupFolder}/images/${sub.file_path}`;
                const checksum = createHash('sha256').update(buffer).digest('hex');
                await uploadBackupObject({
                    r2BucketBinding,
                    client,
                    bucketName,
                    key: imageKey,
                    body: buffer,
                    contentType
                });

                successCount++;
                totalSize += buffer.length;
                const manifestSubmission = manifest.submissions.find((item: any) => item.id === sub.id);
                Object.assign(manifestSubmission, {
                    backup_image_path: imageKey,
                    backup_content_type: contentType,
                    backup_size: buffer.length,
                    backup_sha256: checksum
                });
                if (successCount % 25 === 0 || successCount === submissions.length) {
                    console.log(`📦 Backup image progress: ${successCount}/${submissions.length}`);
                }
            } catch (err: any) {
                console.error(`❌ Failed to backup file for submission ${sub.name}:`, err);
                failedSubmissions.push(`${sub.name} (ID: ${sub.id}) - ${err.message}`);
            }
        });

        if (failedSubmissions.length > 0 || successCount !== submissions.length) {
            throw new Error(`Backup incomplete: ${failedSubmissions.length} of ${submissions.length} image files failed. ${failedSubmissions.slice(0, 5).join('; ')}`);
        }

        manifest.backup_status = 'complete';
        manifest.total_image_bytes = totalSize;
        validateFullBackupManifest(manifest);
        const manifestKey = `${backupFolder}/metadata.json`;
        await uploadBackupObject({
            r2BucketBinding,
            client,
            bucketName,
            key: manifestKey,
            body: JSON.stringify(manifest, null, 2),
            contentType: 'application/json'
        });

        console.log(`✅ Uploaded verified metadata.json manifest to R2.`);

        const statsMsg = `Backup completed and verified. Backed up ${successCount}/${submissions.length} files. Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB.`;
        console.log(`🎉 ${statsMsg}`);

        return {
            success: true,
            message: statsMsg,
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

export function validateFullBackupManifest(manifest: any) {
    if (!manifest || typeof manifest !== 'object') throw new Error('ไฟล์ Backup ไม่ใช่ JSON object');
    if (manifest.backup_version !== '2.0' || manifest.backup_status !== 'complete') {
        throw new Error('รองรับการกู้คืนเต็มรูปแบบเฉพาะ Backup version 2.0 ที่มีสถานะ complete');
    }
    if (!manifest.backup_folder || !manifest.exported_at) throw new Error('Backup ไม่มีตำแหน่งโฟลเดอร์หรือเวลาที่สร้าง');

    const arrayFields = ['collections', 'submissions', 'participants', 'attendance_sessions', 'attendance_records', 'app_users'];
    for (const field of arrayFields) {
        if (!Array.isArray(manifest[field])) throw new Error(`Backup ไม่มีข้อมูล ${field}`);
    }

    const countFields: Array<[string, string]> = [
        ['total_collections', 'collections'],
        ['total_submissions', 'submissions'],
        ['total_participants', 'participants'],
        ['total_attendance_sessions', 'attendance_sessions'],
        ['total_attendance_records', 'attendance_records'],
        ['total_users', 'app_users']
    ];
    for (const [countField, arrayField] of countFields) {
        if (manifest[countField] !== manifest[arrayField].length) {
            throw new Error(`จำนวน ${arrayField} ใน Backup ไม่ตรงกับ manifest`);
        }
    }

    for (const field of arrayFields) {
        const ids = manifest[field].map((row: any) => row.id).filter(Boolean);
        if (ids.length !== manifest[field].length || new Set(ids).size !== ids.length) {
            throw new Error(`ข้อมูล ${field} มี ID ว่างหรือซ้ำกัน`);
        }
    }

    let imageSizeTotal = 0;
    for (const submission of manifest.submissions) {
        if (!submission.id || !submission.file_path || !submission.backup_image_path || !submission.backup_sha256) {
            throw new Error(`ข้อมูลไฟล์รูปใน Backup ไม่ครบ: ${submission.id || submission.name || 'unknown'}`);
        }
        if (!Number.isFinite(submission.backup_size) || submission.backup_size < 0 || !/^[a-f0-9]{64}$/.test(submission.backup_sha256)) {
            throw new Error(`ขนาดหรือ checksum ไม่ถูกต้อง: ${submission.id}`);
        }
        imageSizeTotal += submission.backup_size;
    }
    if (imageSizeTotal !== manifest.total_image_bytes) throw new Error('ขนาดรวมของรูปไม่ตรงกับ manifest');

    const collectionIds = new Set(manifest.collections.map((row: any) => row.id));
    const participantIds = new Set(manifest.participants.map((row: any) => row.id));
    const sessionIds = new Set(manifest.attendance_sessions.map((row: any) => row.id));
    for (const submission of manifest.submissions) {
        if (!collectionIds.has(submission.collection_id)) throw new Error(`รูปอ้างถึงหัวข้อที่ไม่มีใน Backup: ${submission.id}`);
    }
    for (const record of manifest.attendance_records) {
        if (record.participant_id && !participantIds.has(record.participant_id)) {
            throw new Error(`เช็คชื่ออ้างถึงรายชื่อที่ไม่มีใน Backup: ${record.id}`);
        }
        if (record.session_id && !sessionIds.has(record.session_id)) {
            throw new Error(`เช็คชื่ออ้างถึง session ที่ไม่มีใน Backup: ${record.id}`);
        }
    }

    if (manifest.app_users.length === 0 || !manifest.app_users.some((user: any) => user.role === 'admin')) {
        throw new Error('Backup ไม่มีบัญชีผู้ดูแลระบบ');
    }
    for (const user of manifest.app_users) {
        if (!user.id || !user.username || !user.password_hash || !['admin', 'staff'].includes(user.role)) {
            throw new Error(`ข้อมูลบัญชีผู้ใช้ใน Backup ไม่ครบ: ${user.username || user.id || 'unknown'}`);
        }
    }
    if (new Set(manifest.app_users.map((user: any) => user.username.toLowerCase())).size !== manifest.app_users.length) {
        throw new Error('Backup มี username ซ้ำกัน');
    }
}

export async function restoreBackupImages(manifest: any, r2BucketBinding?: any): Promise<RestoreImagesResult> {
    validateFullBackupManifest(manifest);

    let client: any = null;
    let bucketName = '';
    if (r2BucketBinding) {
        bucketName = 'R2_BINDING';
    } else {
        const r2 = getR2Client();
        client = r2.client;
        bucketName = r2.bucketName;
    }

    let sizeBytes = 0;
    const urlsBySubmissionId: Record<string, string> = {};
    let completed = 0;
    await runWithConcurrency<any>(manifest.submissions as any[], 4, async (submission) => {
        const object = await downloadFromR2(submission.backup_image_path, r2BucketBinding);
        if (!object) throw new Error(`ไม่พบไฟล์ Backup: ${submission.backup_image_path}`);
        const checksum = createHash('sha256').update(object.buffer).digest('hex');
        if (checksum !== submission.backup_sha256 || object.buffer.length !== submission.backup_size) {
            throw new Error(`Checksum หรือขนาดไฟล์ไม่ตรง: ${submission.backup_image_path}`);
        }

        await uploadBackupObject({
            r2BucketBinding,
            client,
            bucketName,
            key: submission.file_path,
            body: object.buffer,
            contentType: submission.backup_content_type || object.contentType
        });
        sizeBytes += object.buffer.length;
        urlsBySubmissionId[submission.id] = `${R2_PUBLIC_URL}/${submission.file_path}`;
        completed++;
        if (completed % 25 === 0 || completed === manifest.submissions.length) {
            console.log(`♻️ Restore image progress: ${completed}/${manifest.submissions.length}`);
        }
    });

    return { filesCount: manifest.submissions.length, sizeBytes, urlsBySubmissionId };
}
