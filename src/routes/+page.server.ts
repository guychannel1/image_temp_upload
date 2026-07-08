import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import * as mockDb from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
    const session = cookies.get('admin_session');
    const loggedIn = !!session;

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
                collectionsList = cols;
            }

            // Load submissions from Supabase
            const { data: subs, error: subsErr } = await supabase
                .from('submissions')
                .select('*')
                .order('created_at', { ascending: true });

            if (!subsErr && subs) {
                // Map img_url from Supabase to img_data for component consistency
                submissionsList = subs.map(s => ({
                    id: s.id,
                    collection_id: s.collection_id,
                    collection_name: s.collection_name,
                    name: s.name,
                    group_name: s.group_name,
                    category: s.collection_name,
                    file_path: s.file_path,
                    file_size: s.file_size,
                    original_size: s.original_size,
                    img_data: s.img_url // Public URL mapped to preview field
                }));
            }
        } catch (err) {
            console.error('Supabase query failed, falling back to Mock DB:', err);
            collectionsList = mockDb.collections;
            submissionsList = mockDb.submissions;
        }
    } else {
        // Fallback to local mock db
        collectionsList = mockDb.collections;
        submissionsList = mockDb.submissions;
    }

    return {
        collections: collectionsList,
        activeCollections: collectionsList.filter(c => c.is_active),
        submissions: submissionsList,
        loggedIn,
        isSupabaseLive: isSupabaseConfigured
    };
};

export const actions: Actions = {
    // Admin authentication actions
    login: async ({ request, cookies }) => {
        const data = await request.formData();
        const username = data.get('username');
        const password = data.get('password');

        if (username === 'admin' && password === '1234') {
            cookies.set('admin_session', 'authenticated', {
                path: '/',
                httpOnly: true,
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 // 1 day
            });
            return { success: true, loggedIn: true };
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
                    .insert({ name: cleanName, is_active: true });

                if (error) throw error;
                return { success: true, message: 'เพิ่มหัวข้อสำเร็จ' };
            } catch (err: any) {
                return fail(400, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ Supabase' });
            }
        } else {
            // Mock DB
            try {
                mockDb.addCollection(cleanName, true);
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
                // Delete files in Storage first
                const { data: files } = await supabase
                    .from('submissions')
                    .select('file_path')
                    .eq('collection_id', id);

                if (files && files.length > 0) {
                    const paths = files.map(f => f.file_path);
                    await supabase.storage.from('images').remove(paths);
                }

                // Delete collection row (will cascade delete submissions in DB)
                const { error } = await supabase
                    .from('collections')
                    .delete()
                    .eq('id', id);

                if (error) throw error;
                return { success: true, message: 'ลบหัวข้อและไฟล์ทั้งหมดสำเร็จ' };
            } catch (err) {
                return fail(500, { success: false, message: 'ลบล้มเหลว' });
            }
        } else {
            mockDb.deleteCollection(id);
            return { success: true, message: 'ลบหัวข้อจำลองสำเร็จ' };
        }
    },

    // Submissions Management
    deleteSubmissions: async ({ request }) => {
        const formData = await request.formData();
        const idsString = formData.get('ids') as string;

        if (!idsString) return fail(400, { success: false });

        try {
            const ids: string[] = JSON.parse(idsString);

            if (isSupabaseConfigured && supabase) {
                // Delete storage files
                const { data: files } = await supabase
                    .from('submissions')
                    .select('file_path')
                    .in('id', ids);

                if (files && files.length > 0) {
                    const paths = files.map(f => f.file_path);
                    await supabase.storage.from('images').remove(paths);
                }

                // Delete table records
                await supabase
                    .from('submissions')
                    .delete()
                    .in('id', ids);
            } else {
                mockDb.deleteSubmissions(ids);
            }

            return { success: true, message: 'ลบรายการภาพที่เลือกสำเร็จ' };
        } catch (e) {
            return fail(400, { success: false, message: 'ข้อมูลรูปภาพไม่ถูกต้อง' });
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

        if (!name || !group_name || !isFile || fileSize === 0) {
            return fail(400, { success: false, message: 'กรุณากรอกข้อมูลและเลือกไฟล์รูปภาพให้ครบถ้วน' });
        }

        const subName = name.trim();
        const subGroup = group_name.trim();
        let finalName = subName;

        let targetCollectionId = collection_id;
        let colName = '';

        if (isSupabaseConfigured && supabase) {
            try {
                // If collection_id is empty, resolve to a default active collection
                if (!targetCollectionId || targetCollectionId.trim() === '') {
                    const { data: cols } = await supabase
                        .from('collections')
                        .select('*')
                        .eq('is_active', true)
                        .order('created_at', { ascending: true });
                    
                    const defaultCol = cols?.find((c: any) => c.name === 'ทั่วไป' || c.name === 'general') || cols?.[0];
                    if (!defaultCol) {
                        return fail(400, { success: false, message: 'ไม่มีหัวข้อเปิดรับส่งงานในระบบในขณะนี้' });
                    }
                    targetCollectionId = defaultCol.id;
                    colName = defaultCol.name;
                } else {
                    const { data: col } = await supabase
                        .from('collections')
                        .select('name')
                        .eq('id', targetCollectionId)
                        .single();

                    if (!col) return fail(400, { success: false, message: 'ไม่พบหัวข้อการส่งรูปภาพ' });
                    colName = col.name;
                }

                // Check duplicate name inside the same group
                const { data: existing } = await supabase
                    .from('submissions')
                    .select('name')
                    .eq('collection_id', targetCollectionId)
                    .eq('group_name', subGroup);

                if (existing) {
                    let counter = 1;
                    while (existing.some(s => s.name.toLowerCase() === finalName.toLowerCase())) {
                        finalName = `${subName} (${counter})`;
                        counter++;
                    }
                }

                const uploadFile = file as any;
                const originalName = uploadFile.name || 'image.jpg';
                const fileExtension = originalName.split('.').pop()?.toLowerCase() || 'jpg';
                const uniqueId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
                const filePath = `${colName}/${subGroup}/${uniqueId}.${fileExtension}`;
                const fileBuffer = Buffer.from(await uploadFile.arrayBuffer());
                const mimeType = uploadFile.type || 'image/jpeg';

                // Upload to Supabase Storage Bucket 'images'
                const { error: uploadError } = await supabase.storage
                    .from('images')
                    .upload(filePath, fileBuffer, {
                        contentType: mimeType,
                        upsert: true
                    });

                if (uploadError) throw uploadError;

                // Get public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('images')
                    .getPublicUrl(filePath);

                const original_size_str = formData.get('original_size');
                const original_size = original_size_str ? parseInt(original_size_str as string, 10) : fileSize;

                // Write metadata to table
                const { error: dbError } = await supabase
                    .from('submissions')
                    .insert({
                        collection_id: targetCollectionId,
                        collection_name: colName,
                        name: finalName,
                        group_name: subGroup,
                        file_path: filePath,
                        file_size: fileSize,
                        original_size,
                        img_url: publicUrl
                    });

                if (dbError) throw dbError;

                return { success: true, message: 'ส่งรูปภาพเข้าระบบเสร็จสิ้นเรียบร้อย!' };
            } catch (err: any) {
                console.error(err);
                return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการอัปโหลดไป Supabase' });
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
            const filePath = `${colName}/${subGroup}/${uniqueId}.${fileExtension}`;

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
    }
};
