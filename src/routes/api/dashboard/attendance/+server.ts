import { json, error } from '@sveltejs/kit';
import { getCurrentUser } from '$lib/server/auth';
import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import * as mockDb from '$lib/server/db';
import { _loadParticipants, _loadAttendanceRecords, _loadAttendanceSessions } from '../../../+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
    const currentUser = await getCurrentUser(cookies);
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'staff') {
        error(403, 'Admin or staff access required');
    }

    const [participantLoad, attendanceRecords, attendanceSessions] = await Promise.all([
        _loadParticipants(true),
        _loadAttendanceRecords(true),
        _loadAttendanceSessions(true)
    ]);

    let submissions: any[] = [];
    if (isSupabaseConfigured && supabase) {
        const { data, error: submissionsError } = await supabase
            .from('submissions')
            .select('id, collection_id, collection_name, name, group_name, file_path, file_size, original_size, img_url, is_deleted')
            .order('created_at', { ascending: true })
            .range(0, 20000);
        if (submissionsError) error(500, 'Unable to load export evidence data');
        submissions = (data ?? []).map((submission: any) => ({
            id: submission.id,
            collection_id: submission.is_deleted ? 'deleted-drive' : submission.collection_id,
            collection_name: submission.is_deleted ? 'deleted' : submission.collection_name,
            name: submission.name,
            group_name: submission.is_deleted ? '' : submission.group_name,
            category: submission.is_deleted ? 'deleted' : submission.collection_name,
            file_path: submission.file_path,
            file_size: submission.file_size,
            original_size: submission.original_size,
            img_data: submission.img_url,
            is_deleted: submission.is_deleted
        }));
    } else {
        submissions = mockDb.submissions.map((submission: any) => ({
            ...submission,
            collection_id: submission.is_deleted ? 'deleted-drive' : submission.collection_id,
            collection_name: submission.is_deleted ? 'deleted' : submission.collection_name,
            group_name: submission.is_deleted ? '' : submission.group_name,
            category: submission.is_deleted ? 'deleted' : submission.collection_name
        }));
    }

    return json({
        participants: participantLoad.participants,
        attendanceRecords,
        attendanceSessions,
        submissions
    }, { headers: { 'cache-control': 'private, max-age=30' } });
};
