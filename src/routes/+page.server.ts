import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import * as mockDb from '$lib/server/db';
import { uploadToR2, deleteFromR2, deleteObjectsFromR2 } from '$lib/server/r2';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createHash } from 'crypto';

/**
 * Computes SHA-256 hash of a string.
 */
function hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export const load: PageServerLoad = async ({ cookies }) => {
    const session = cookies.get('admin_session');
    const loggedIn = !!session;
    const username = session || '';
    const userRole = username === 'guyssar' ? 'admin' : (username === 'admin' ? 'staff' : '');

    let collectionsList: any[] = [];
    let submissionsList: any[] = [];

    if (isSupabaseConfigured && supabase) {
        try {
            // Load collections from Supabase
            const { data: cols, error: colsErr } = await supabase
                .from('collections')
                .select('*')
                .order('created_at', { ascending: true });
            
            if (!colsErr && cols) {
                collectionsList = cols.map(c => ({
                    id: c.id,
                    name: c.name,
                    is_active: c.is_active,
                    submission_limit: c.submission_limit ?? 500
                }));
            }

            // Load submissions from Supabase
            const { data: subs, error: subsErr } = await supabase
                .from('submissions')
                .select('*')
                .order('created_at', { ascending: true });

            if (!subsErr && subs) {
                // Map and filter based on deletion status and user role
                const allMapped = subs.map(s => ({
                    id: s.id,
                    collection_id: s.is_deleted ? 'deleted-drive' : s.collection_id,
                    collection_name: s.is_deleted ? 'deleted' : s.collection_name,
                    name: s.name,
                    group_name: s.is_deleted ? '' : s.group_name,
                    category: s.is_deleted ? 'deleted' : s.collection_name,
                    file_path: s.file_path,
                    file_size: s.file_size,
                    original_size: s.original_size,
                    img_data: s.img_url,
                    is_deleted: s.is_deleted
                }));

                if (userRole === 'admin') {
                    submissionsList = allMapped;
                } else {
                    submissionsList = allMapped.filter(s => !s.is_deleted);
                }
            }
        } catch (err) {
            console.error('Supabase query failed, falling back to Mock DB:', err);
            collectionsList = mockDb.collections;
            submissionsList = mockDb.submissions;
        }
    } else {
        // Fallback to local mock db
        collectionsList = mockDb.collections;
        const allMapped = mockDb.submissions.map(s => ({
            ...s,
            collection_id: s.is_deleted ? 'deleted-drive' : s.collection_id,
            collection_name: s.is_deleted ? 'deleted' : s.collection_name,
            group_name: s.is_deleted ? '' : s.group_name,
            category: s.is_deleted ? 'deleted' : s.collection_name
        }));

        if (userRole === 'admin') {
            submissionsList = allMapped;
        } else {
            submissionsList = allMapped.filter(s => !s.is_deleted);
        }
    }

    // If user is admin (guyssar), add virtual collection for deleted items
    if (userRole === 'admin') {
        collectionsList.push({
            id: 'deleted-drive',
            name: 'deleted',
            is_active: false,
            submission_limit: 999999
        });
    }

    return {
        collections: collectionsList,
        activeCollections: collectionsList.filter(c => c.is_active && c.id !== 'deleted-drive'),
        submissions: submissionsList,
        loggedIn,
        userRole,
        username,
        isSupabaseLive: isSupabaseConfigured
    };
};

export const actions: Actions = {
    // Admin authentication actions
    login: async ({ request, cookies }) => {
        const data = await request.formData();
        const username = (data.get('username') as string || '').trim();
        const password = data.get('password') as string || '';

        const passwordHash = hashPassword(password);

        if (isSupabaseConfigured && supabase) {
            try {
                const { data: user } = await supabase
                    .from('app_users')
                    .select('*')
                    .eq('username', username)
                    .maybeSingle();

                if (user && user.password_hash === passwordHash) {
                    cookies.set('admin_session', username, {
                        path: '/',
                        httpOnly: true,
                        sameSite: 'strict',
                        maxAge: 60 * 60 * 24 // 1 day
                    });
                    return { success: true, loggedIn: true, role: user.role };
                }
            } catch (err) {
                console.error('Supabase user auth failed, falling back to mock auth:', err);
            }
        }

        // Fallback to local memory mock db
        const user = mockDb.appUsers.find(u => u.username === username);
        if (user && user.password_hash === passwordHash) {
            cookies.set('admin_session', username, {
                path: '/',
                httpOnly: true,
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 // 1 day
            });
            return { success: true, loggedIn: true, role: user.role };
        }

        return fail(400, { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    },

    logout: async ({ cookies }) => {
        cookies.delete('admin_session', { path: '/' });
        return { success: true, loggedIn: false };
    },

    // Collections Management
    addCollection: async ({ request }) => {
        const formData = await request.formData();
        const name = formData.get('name') as string;

        if (!name || name.trim() === '') {
            return fail(400, { success: false, message: 'กรุณากรอกชื่อหัวข้อ' });
        }

        const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_ก-๙]/g, '-');

        if (isSupabaseConfigured && supabase) {
            try {
                // Check duplicate in Supabase
                const { data: exists } = await supabase
                    .from('collections')
                    .select('id')
                    .eq('name', cleanName)
                    .maybeSingle();

                if (exists) {
                    return fail(400, { success: false, message: 'ชื่อหัวข้อซ้ำในระบบ' });
                }

                const { error } = await supabase
                    .from('collections')
                    .insert({ name: cleanName, is_active: true, submission_limit: 500 });

                if (error) throw error;
                return { success: true, message: 'เพิ่มหัวข้อสำเร็จ' };
            } catch (err: any) {
                return fail(400, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ Supabase' });
            }
        } else {
            // Mock DB
            try {
                mockDb.addCollection(cleanName, true, 500);
                return { success: true, message: 'เพิ่มหัวข้อจำลองสำเร็จ' };
            } catch (e: any) {
                return fail(400, { success: false, message: e.message || 'เกิดข้อผิดพลาด' });
            }
        }
    },

    toggleCollection: async ({ request }) => {
        const formData = await request.formData();
        const id = formData.get('id') as string;
        
        if (!id) return fail(400, { success: false });

        if (isSupabaseConfigured && supabase) {
            try {
                const { data: current } = await supabase
                    .from('collections')
                    .select('is_active')
                    .eq('id', id)
                    .single();

                if (current) {
                    await supabase
                        .from('collections')
                        .update({ is_active: !current.is_active })
                        .eq('id', id);
                }
                return { success: true };
            } catch (err) {
                return fail(400, { success: false });
            }
        } else {
            mockDb.toggleCollection(id);
            return { success: true };
        }
    },

    deleteCollection: async ({ request }) => {
        const formData = await request.formData();
        const id = formData.get('id') as string;

        if (!id) return fail(400, { success: false });

        if (isSupabaseConfigured && supabase) {
            try {
                // Get the current name
                const { data: col } = await supabase
                    .from('collections')
                    .select('name')
                    .eq('id', id)
                    .single();

                if (!col) return fail(404, { success: false, message: 'ไม่พบหัวข้อนี้' });

                // Append _deleted suffix if not already present
                let deletedName = col.name;
                if (!deletedName.endsWith('_deleted')) {
                    deletedName = `${deletedName}_deleted`;
                }

                // Update collection name and set is_active = false
                const { error: colErr } = await supabase
                    .from('collections')
                    .update({ name: deletedName, is_active: false })
                    .eq('id', id);

                if (colErr) throw colErr;

                // Soft-delete submissions belonging to this collection
                const { error: subError } = await supabase
                    .from('submissions')
                    .update({ is_deleted: true })
                    .eq('collection_id', id);

                if (subError) throw subError;

                return { success: true, message: 'ลบหัวข้อ (ย้ายรูปภาพไปยังถังขยะ) เรียบร้อย' };
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'ลบล้มเหลว' });
            }
        } else {
            mockDb.deleteCollection(id);
            return { success: true, message: 'ลบหัวข้อจำลองสำเร็จ' };
        }
    },

    restoreCollection: async ({ request }) => {
        const formData = await request.formData();
        const id = formData.get('id') as string;

        if (!id) return fail(400, { success: false });

        if (isSupabaseConfigured && supabase) {
            try {
                // Get the current name
                const { data: col } = await supabase
                    .from('collections')
                    .select('name')
                    .eq('id', id)
                    .single();

                if (!col) return fail(404, { success: false, message: 'ไม่พบหัวข้อนี้' });

                // Remove _deleted suffix
                let restoredName = col.name;
                if (restoredName.endsWith('_deleted')) {
                    restoredName = restoredName.replace(/_deleted$/, '');
                }

                // Update collection name and set is_active = true
                const { error: colErr } = await supabase
                    .from('collections')
                    .update({ name: restoredName, is_active: true })
                    .eq('id', id);

                if (colErr) throw colErr;

                // Restore submissions belonging to this collection
                const { error: subError } = await supabase
                    .from('submissions')
                    .update({ is_deleted: false })
                    .eq('collection_id', id);

                if (subError) throw subError;

                return { success: true, message: 'กู้คืนหัวข้อและรูปภาพทั้งหมดสำเร็จ!' };
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'กู้คืนล้มเหลว' });
            }
        } else {
            mockDb.restoreCollection(id);
            return { success: true, message: 'กู้คืนหัวข้อจำลองสำเร็จ!' };
        }
    },

    deleteCollectionPermanently: async ({ request }) => {
        const formData = await request.formData();
        const id = formData.get('id') as string;

        if (!id) return fail(400, { success: false });

        if (isSupabaseConfigured && supabase) {
            try {
                const { error } = await supabase
                    .from('collections')
                    .delete()
                    .eq('id', id);

                if (error) throw error;
                return { success: true, message: 'ลบหัวข้อแบบถาวรเรียบร้อยแล้ว' };
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'ลบถาวรล้มเหลว' });
            }
        } else {
            mockDb.deleteCollectionPermanently(id);
            return { success: true, message: 'ลบหัวข้อจำลองถาวรสำเร็จ' };
        }
    },

    // Submissions Management (Soft Delete)
    deleteSubmissions: async ({ request }) => {
        const formData = await request.formData();
        const idsString = formData.get('ids') as string;

        if (!idsString) return fail(400, { success: false });

        try {
            const ids: string[] = JSON.parse(idsString);

            if (isSupabaseConfigured && supabase) {
                // Soft delete: set is_deleted = TRUE in DB (Do not remove storage file!)
                const chunks = chunkArray(ids, 100);
                for (const chunk of chunks) {
                    const { error } = await supabase
                        .from('submissions')
                        .update({ is_deleted: true })
                        .in('id', chunk);
                    if (error) throw error;
                }
            } else {
                mockDb.deleteSubmissions(ids);
            }

            return { success: true, message: 'ลบรูปภาพที่เลือกไปยังถังขยะเรียบร้อย' };
        } catch (e) {
            return fail(400, { success: false, message: 'เกิดข้อผิดพลาดในการลบรูปภาพ' });
        }
    },

    // Permanent Delete Submissions (only allowed for guyssar)
    deleteSubmissionsPermanently: async ({ request, cookies }) => {
        const session = cookies.get('admin_session');
        if (session !== 'guyssar') {
            return fail(403, { success: false, message: 'ไม่มีสิทธิ์ในการลบรูปภาพถาวร' });
        }

        const formData = await request.formData();
        const idsString = formData.get('ids') as string;

        if (!idsString) return fail(400, { success: false });

        try {
            const ids: string[] = JSON.parse(idsString);

            if (isSupabaseConfigured && supabase) {
                const chunks = chunkArray(ids, 100);
                const subs: any[] = [];

                // 1. Fetch file paths first so we can delete from R2 (in chunks)
                for (const chunk of chunks) {
                    const { data: chunkSubs, error: fetchErr } = await supabase
                        .from('submissions')
                        .select('file_path')
                        .in('id', chunk);
                    if (fetchErr) throw fetchErr;
                    if (chunkSubs) subs.push(...chunkSubs);
                }

                // 2. Delete rows from DB (in chunks)
                for (const chunk of chunks) {
                    const { error: deleteErr } = await supabase
                        .from('submissions')
                        .delete()
                        .in('id', chunk);
                    if (deleteErr) throw deleteErr;
                }

                // 3. Delete files from Cloudflare R2 (bulk request)
                if (subs && subs.length > 0) {
                    const paths = subs.map(s => s.file_path).filter(Boolean);
                    await deleteObjectsFromR2(paths);
                }
            } else {
                // Mock DB: permanently delete
                mockDb.deleteSubmissionsPermanently(ids);
            }

            return { success: true, message: 'ลบรูปภาพที่เลือกแบบถาวรเรียบร้อยแล้ว' };
        } catch (e) {
            console.error('[deleteSubmissionsPermanently] Failed:', e);
            return fail(400, { success: false, message: 'เกิดข้อผิดพลาดในการลบรูปภาพถาวร' });
        }
    },

    // Restore Soft-Deleted Submissions
    restoreSubmissions: async ({ request }) => {
        const formData = await request.formData();
        const idsString = formData.get('ids') as string;

        if (!idsString) return fail(400, { success: false });

        try {
            const ids: string[] = JSON.parse(idsString);

            if (isSupabaseConfigured && supabase) {
                const chunks = chunkArray(ids, 100);
                for (const chunk of chunks) {
                    const { error } = await supabase
                        .from('submissions')
                        .update({ is_deleted: false })
                        .in('id', chunk);
                    if (error) throw error;
                }
            } else {
                mockDb.restoreSubmissions(ids);
            }

            return { success: true, message: 'กู้คืนรูปภาพที่เลือกสำเร็จ' };
        } catch (e) {
            return fail(400, { success: false, message: 'เกิดข้อผิดพลาดในการกู้คืนรูปภาพ' });
        }
    },

    // Update Collection Submission Limit
    updateCollectionLimit: async ({ request }) => {
        const formData = await request.formData();
        const id = formData.get('id') as string;
        const limitStr = formData.get('limit') as string;

        if (!id || !limitStr) return fail(400, { success: false, message: 'ข้อมูลไม่ครบถ้วน' });

        try {
            const limit = parseInt(limitStr, 10);
            if (isNaN(limit) || limit < 1) {
                return fail(400, { success: false, message: 'กรุณากรอกขีดจำกัดที่ถูกต้อง (มากกว่า 0)' });
            }

            if (isSupabaseConfigured && supabase) {
                const { error } = await supabase
                    .from('collections')
                    .update({ submission_limit: limit })
                    .eq('id', id);
                if (error) throw error;
            } else {
                mockDb.updateCollectionLimit(id, limit);
            }

            return { success: true, message: 'ปรับปรุงขีดจำกัดหัวข้อเรียบร้อยสำเร็จ!' };
        } catch (e) {
            return fail(400, { success: false, message: 'เกิดข้อผิดพลาดในการบันทึกขีดจำกัด' });
        }
    },

    // Public Student Submission
    submitForm: async ({ request }) => {
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const group_name = formData.get('group_name') as string;
        const collection_id = formData.get('collection_id') as string;
        const file = formData.get('file');

        const isFile = file && typeof file === 'object' && 'size' in file && 'name' in file;
        const fileSize = isFile ? (file as any).size : 0;

        console.log('📤 [submitForm] Submission received:', { name, group_name, collection_id, isFile, fileSize });

        if (!name || !isFile || fileSize === 0) {
            return fail(400, { success: false, message: 'กรุณากรอกข้อมูลและเลือกไฟล์รูปภาพให้ครบถ้วน' });
        }

        const subName = name.trim();
        const subGroup = (group_name ?? '').trim();
        let finalName = subName;

        let targetCollectionId = collection_id;
        let colName = '';
        let submissionLimit = 500;

        if (isSupabaseConfigured && supabase) {
            // =============================================
            // STEP 1: Resolve collection_id if empty
            // =============================================
            if (!targetCollectionId || targetCollectionId.trim() === '') {
                const { data: cols } = await supabase
                    .from('collections')
                    .select('id, name')
                    .eq('is_active', true)
                    .order('created_at', { ascending: true });

                const defaultCol = cols?.find((c: any) => c.name === 'ทั่วไป' || c.name === 'general') || cols?.[0];
                if (!defaultCol) {
                    return fail(400, { success: false, message: 'ไม่มีหัวข้อเปิดรับส่งงานในระบบในขณะนี้' });
                }
                targetCollectionId = defaultCol.id;
                colName = defaultCol.name;
            }

            // =============================================
            // STEP 2: Upload file to Cloudflare R2
            // (so we have a URL to pass to the atomic DB function)
            // =============================================
            let filePath = '';
            let publicUrl = '';
            try {
                const uploadFile = file as any;
                const originalName = uploadFile.name || 'image.jpg';
                const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
                const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : Math.random().toString(36).substring(2, 15);

                // We need colName for the path — do a lightweight fetch if still empty
                if (!colName) {
                    const { data: col } = await supabase
                        .from('collections')
                        .select('name')
                        .eq('id', targetCollectionId)
                        .single();
                    if (!col) return fail(400, { success: false, message: 'ไม่พบหัวข้อการส่งรูปภาพ' });
                    colName = col.name;
                }

                filePath = subGroup
                    ? `${colName}/${subGroup}/${uniqueId}.${fileExtension}`
                    : `${colName}/${uniqueId}.${fileExtension}`;

                const fileBuffer = Buffer.from(await uploadFile.arrayBuffer());
                const mimeType = uploadFile.type || 'image/jpeg';

                // Upload to Cloudflare R2 (retry built-in)
                publicUrl = await uploadToR2(filePath, fileBuffer, mimeType);
            } catch (storageErr: any) {
                console.error('[submitForm] R2 upload failed:', storageErr);
                return fail(500, { success: false, message: 'อัปโหลดไฟล์ล้มเหลว กรุณาลองใหม่อีกครั้ง' });
            }

            // =============================================
            // STEP 3: Atomic DB insert via RPC
            // (quota check + dup name + insert in ONE transaction with row lock)
            // =============================================
            try {
                const original_size_str = formData.get('original_size');
                const original_size = original_size_str ? parseInt(original_size_str as string, 10) : fileSize;

                const { data: rpcResult, error: rpcError } = await supabase.rpc(
                    'submit_with_quota_guard',
                    {
                        p_collection_id:   targetCollectionId,
                        p_collection_name: colName,
                        p_name:            subName,
                        p_group_name:      subGroup,
                        p_file_path:       filePath,
                        p_file_size:       fileSize,
                        p_original_size:   original_size,
                        p_img_url:         publicUrl,
                        p_person_limit:    3   // max images per person per collection
                    }
                );

                if (rpcError) throw rpcError;

                // RPC returns { success, reason?, limit?, id?, final_name? }
                if (!rpcResult?.success) {
                    // Rollback: delete the uploaded file from R2 since DB rejected it
                    await deleteFromR2(filePath);

                    if (rpcResult?.reason === 'quota_exceeded') {
                        return fail(429, {
                            success: false,
                            message: `หัวข้อนี้ถึงขีดจำกัดการรับส่งภาพแล้ว (${rpcResult.limit ?? submissionLimit} รูป) กรุณาติดต่อผู้ดูแลระบบ`
                        });
                    }
                    if (rpcResult?.reason === 'person_limit_exceeded') {
                        return fail(429, {
                            success: false,
                            message: `คุณส่งรูปครบแล้ว (${rpcResult.person_limit ?? 3} รูปต่อคน) ไม่สามารถส่งเพิ่มได้`
                        });
                    }
                    if (rpcResult?.reason === 'collection_not_found') {
                        return fail(400, { success: false, message: 'ไม่พบหัวข้อการส่งรูปภาพ หรือหัวข้อปิดรับแล้ว' });
                    }
                    return fail(400, { success: false, message: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่' });
                }

                return { success: true, message: 'ส่งรูปภาพเข้าระบบเสร็จสิ้นเรียบร้อย!' };
            } catch (dbErr: any) {
                console.error('[submitForm] RPC failed:', dbErr);
                // Rollback: remove the file we just uploaded to R2
                if (filePath) await deleteFromR2(filePath);
                return fail(500, { success: false, message: dbErr.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่' });
            }
        } else {
            // Fallback to local memory mock db
            let col = mockDb.collections.find(c => c.id === targetCollectionId);
            if (!col) {
                // Find default collection
                col = mockDb.collections.find(c => c.is_active && (c.name === 'ทั่วไป' || c.name === 'general')) || mockDb.collections.filter(c => c.is_active)[0];
                if (!col) {
                    return fail(400, { success: false, message: 'ไม่มีหัวข้อเปิดรับส่งงานในระบบในขณะนี้' });
                }
                targetCollectionId = col.id;
            }
            colName = col.name;
            submissionLimit = col.submission_limit ?? 500;

            // =============================================
            // QUOTA GUARD: Max dynamic submissions per collection
            // =============================================
            const submissionCount = mockDb.submissions.filter(s => s.collection_id === targetCollectionId && !s.is_deleted).length;
            if (submissionCount >= submissionLimit) {
                return fail(429, { 
                    success: false, 
                    message: `หัวข้อ "${colName}" ถึงขีดจำกัดการรับส่งภาพแล้ว (${submissionLimit} รูป) กรุณาติดต่อผู้ดูแลระบบ` 
                });
            }

            let counter = 1;
            while (mockDb.submissions.some(s => s.collection_id === targetCollectionId && s.group_name === subGroup && s.name.toLowerCase() === finalName.toLowerCase())) {
                finalName = `${subName} (${counter})`;
                counter++;
            }

            const uploadFile = file as any;
            const arrayBuffer = await uploadFile.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            const mimeType = uploadFile.type || 'image/jpeg';
            const dataUri = `data:${mimeType};base64,${base64}`;

            const originalName = uploadFile.name || 'image.jpg';
            const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
            const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
            const filePath = subGroup
                ? `${colName}/${subGroup}/${uniqueId}.${fileExtension}`
                : `${colName}/${uniqueId}.${fileExtension}`;

            const original_size_str = formData.get('original_size');
            const original_size = original_size_str ? parseInt(original_size_str as string, 10) : fileSize;

            mockDb.addSubmission({
                collection_id: targetCollectionId,
                collection_name: colName,
                name: finalName,
                group_name: subGroup,
                category: colName,
                file_path: filePath,
                file_size: fileSize,
                original_size,
                img_data: dataUri
            });

            return { success: true, message: 'ส่งรูปภาพจำลองสำเร็จ!' };
        }
    },

    backupToCloudflare: async ({ cookies, platform }) => {
        const session = cookies.get('admin_session');
        if (!session) {
            return fail(401, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
        }

        try {
            const { runBackup } = await import('$lib/server/backup');
            const r2Bucket = (platform as any)?.env?.R2_BUCKET || (platform as any)?.env?.R2 || (platform as any)?.env?.images;
            const result = await runBackup(r2Bucket);
            if (result.success) {
                return { success: true, message: result.message, folderPath: result.folderPath };
            } else {
                return fail(500, { success: false, message: result.message || 'เกิดข้อผิดพลาดในการสำรองข้อมูล' });
            }
        } catch (err: any) {
            return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดที่คาดไม่ถึงในการตั้งค่าคีย์หรือการเชื่อมต่อ' });
        }
    }
};
