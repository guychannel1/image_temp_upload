import { normalizePersonName } from '$lib/evidence';

export interface Collection {
    id: string;
    name: string;
    is_active: boolean;
    submission_limit: number;
}

export interface Submission {
    id: string;
    collection_id: string;
    collection_name: string;
    name: string;
    group_name: string;
    category: string;
    file_path: string;
    file_size: number;
    original_size: number;
    img_data: string; // base64 representation
    is_deleted: boolean;
}

export interface AppUser {
    id: string;
    username: string;
    role: 'admin' | 'staff';
    password_hash: string;
}

export interface AppSession {
    token_hash: string;
    username: string;
    expires_at: string;
}

export interface ParticipantRecord {
    id: string;
    order: number;
    full_name: string;
    created_at: string;
}

export interface AttendanceRecord {
    id: string;
    participant_name: string;
    attendance_date: string;
    period: 'morning' | 'afternoon';
    is_present: boolean;
    is_deleted?: boolean;
    created_at: string;
    updated_at: string;
}

export interface AttendanceSession {
    id: string;
    session_date: string;
    period: 'morning' | 'afternoon';
    label?: string;
    is_deleted?: boolean;
}

// In-memory mock database users
export let appUsers: AppUser[] = [
    { id: "usr-1", username: "guyssar", role: "admin", password_hash: "d2175b1572d0be3ee4e5e04cf339b6f9946c47d6e4b7615d5bf70618d6cace61" }, // password 'guychannel1' hash
    { id: "usr-2", username: "admin", role: "staff", password_hash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4" }    // password '1234' hash
];

export let appSessions: AppSession[] = [];

export let participants: ParticipantRecord[] = [];

export let attendanceRecords: AttendanceRecord[] = [];

export let attendanceSessions: AttendanceSession[] = [];

export let collections: Collection[] = [
    { id: "col-1", name: "ewe", is_active: true, submission_limit: 500 },
    { id: "col-2", name: "camp-science", is_active: true, submission_limit: 500 },
    { id: "col-3", name: "design-workshop", is_active: false, submission_limit: 500 }
];

export let submissions: Submission[] = [
    { 
        id: "sub-1", 
        collection_id: "col-1", 
        collection_name: "ewe",
        name: "สมชาย ใจดี", 
        group_name: "กลุ่ม 1", 
        category: "ewe",
        file_path: "ewe/กลุ่ม 1/สมชาย ใจดี.avif",
        file_size: 78500,
        original_size: 1540000,
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%236366f1'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>สมชาย ใจดี</text></svg>",
        is_deleted: false
    },
    { 
        id: "sub-2", 
        collection_id: "col-1", 
        collection_name: "ewe",
        name: "วิภาดา รักเรียน", 
        group_name: "กลุ่ม 1", 
        category: "ewe",
        file_path: "ewe/กลุ่ม 1/วิภาดา รักเรียน.avif",
        file_size: 65200,
        original_size: 980000,
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%2310b981'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>วิภาดา รักเรียน</text></svg>",
        is_deleted: false
    },
    { 
        id: "sub-3", 
        collection_id: "col-2", 
        collection_name: "camp-science",
        name: "ปกรณ์ เรียนดี", 
        group_name: "กลุ่มวิทยาศาสตร์ 4", 
        category: "camp-science",
        file_path: "camp-science/กลุ่มวิทยาศาสตร์ 4/ปกรณ์ เรียนดี.avif",
        file_size: 92100,
        original_size: 2100000,
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%23f59e0b'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>ปกรณ์ เรียนดี</text></svg>",
        is_deleted: false
    }
];

export function addCollection(name: string, is_active: boolean, submission_limit: number = 500) {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_ก-๙]/g, '-');
    if (collections.some(c => c.name === cleanName)) {
        throw new Error("ชื่อหัวข้อซ้ำ");
    }
    const newCol = { id: 'col-' + Date.now(), name: cleanName, is_active, submission_limit };
    collections.push(newCol);
    return newCol;
}

export function updateCollectionLimit(id: string, limit: number) {
    const col = collections.find(c => c.id === id);
    if (col) {
        col.submission_limit = limit;
    }
}

export function deleteCollection(id: string) {
    const col = collections.find(c => c.id === id);
    if (col) {
        if (!col.name.endsWith('_deleted')) {
            col.name = `${col.name}_deleted`;
        }
        col.is_active = false;
    }
    // When deleting a collection, we soft-delete its submissions
    submissions = submissions.map(s => {
        if (s.collection_id === id) {
            return { ...s, is_deleted: true };
        }
        return s;
    });
}

export function restoreCollection(id: string) {
    const col = collections.find(c => c.id === id);
    if (col) {
        if (col.name.endsWith('_deleted')) {
            col.name = col.name.replace(/_deleted$/, '');
        }
        col.is_active = true;
    }
    // Restore submissions
    submissions = submissions.map(s => {
        if (s.collection_id === id) {
            return { ...s, is_deleted: false };
        }
        return s;
    });
}

export function deleteCollectionPermanently(id: string) {
    collections = collections.filter(c => c.id !== id);
    submissions = submissions.filter(s => s.collection_id !== id);
}

export function toggleCollection(id: string) {
    const col = collections.find(c => c.id === id);
    if (col) {
        col.is_active = !col.is_active;
    }
}

export function addSubmission(sub: Omit<Submission, 'id' | 'is_deleted'>) {
    const newSub: Submission = {
        ...sub,
        id: 'sub-' + Date.now(),
        is_deleted: false
    };
    submissions.push(newSub);
    return newSub;
}

export function deleteSubmissions(ids: string[]) {
    const set = new Set(ids);
    submissions = submissions.map(s => {
        if (set.has(s.id)) {
            return { ...s, is_deleted: true };
        }
        return s;
    });
}

export function deleteSubmissionsPermanently(ids: string[]) {
    const set = new Set(ids);
    submissions = submissions.filter(s => !set.has(s.id));
}

export function restoreSubmissions(ids: string[]) {
    const set = new Set(ids);
    submissions = submissions.map(s => {
        if (set.has(s.id)) {
            return { ...s, is_deleted: false };
        }
        return s;
    });
}

export function replaceParticipants(rows: Array<{ order: number; fullName: string }>) {
    const now = new Date().toISOString();
    const existingByName = new Map(participants.map((row) => [normalizePersonName(row.full_name), row]));
    const usedIds = new Set<string>();
    const nextParticipants = rows.map((row) => {
        const cleanName = row.fullName.trim().replace(/\s+/g, ' ');
        const byName = existingByName.get(normalizePersonName(cleanName));
        const existing = byName && !usedIds.has(byName.id) ? byName : null;

        if (!existing) {
            return {
                id: 'participant-' + Date.now() + '-' + row.order,
                order: row.order,
                full_name: cleanName,
                created_at: now
            };
        }

        usedIds.add(existing.id);
        if (existing.full_name !== cleanName) {
            for (const record of attendanceRecords) {
                if (record.participant_name === existing.full_name) {
                    record.participant_name = cleanName;
                    record.updated_at = now;
                }
            }
            for (const submission of submissions) {
                if (submission.name === existing.full_name) submission.name = cleanName;
            }
        }

        return {
            ...existing,
            order: row.order,
            full_name: cleanName
        };
    });

    participants.length = 0;
    participants.push(...nextParticipants);
}

export function addParticipant(fullName: string, order?: number) {
    const cleanName = fullName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
        throw new Error('กรุณากรอกชื่อ-สกุล');
    }
    const sorted = [...participants].sort((a, b) => a.order - b.order);
    const insertIndex = order && order > 0
        ? Math.min(Math.max(order - 1, 0), sorted.length)
        : sorted.length;
    const record = {
        id: 'participant-' + Date.now(),
        order: insertIndex + 1,
        full_name: cleanName,
        created_at: new Date().toISOString()
    };
    sorted.splice(insertIndex, 0, record);
    participants.length = 0;
    participants.push(...sorted.map((row, index) => ({ ...row, order: index + 1 })));
    return record;
}

export function upsertAttendanceRecords(rows: Array<{
    participant_name: string;
    attendance_date: string;
    period: 'morning' | 'afternoon';
    is_present: boolean;
}>) {
    const now = new Date().toISOString();
    for (const row of rows) {
        const cleanName = row.participant_name.trim().replace(/\s+/g, ' ');
        if (!cleanName || !row.attendance_date || !row.period) continue;

        const existing = attendanceRecords.find((record) =>
            record.participant_name === cleanName
            && record.attendance_date === row.attendance_date
            && record.period === row.period
        );

        if (existing) {
            existing.is_present = row.is_present;
            existing.updated_at = now;
        } else {
            attendanceRecords.push({
                id: 'attendance-' + Math.random().toString(36).substring(2, 9),
                participant_name: cleanName,
                attendance_date: row.attendance_date,
                period: row.period,
                is_present: row.is_present,
                is_deleted: false,
                created_at: now,
                updated_at: now
            });
        }
    }

    return rows.length;
}

export function ensureAttendanceSessions(dates: string[]) {
    const cleanDates = Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
    const periods: Array<'morning' | 'afternoon'> = ['morning', 'afternoon'];
    let changedCount = 0;

    for (const date of cleanDates) {
        for (const period of periods) {
            const existing = attendanceSessions.find((session) =>
                session.session_date === date && session.period === period
            );

            if (existing) {
                if (existing.is_deleted) {
                    existing.is_deleted = false;
                    changedCount++;
                }
            } else {
                attendanceSessions.push({
                    id: 'attendance-session-' + Math.random().toString(36).substring(2, 9),
                    session_date: date,
                    period,
                    label: '',
                    is_deleted: false
                });
                changedCount++;
            }
        }
    }

    return changedCount;
}

export function deleteAttendanceRecordsForDates(participantNames: string[], dates: string[]) {
    const nameSet = new Set(participantNames.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean));
    const dateSet = new Set(dates.filter(Boolean));
    const before = attendanceRecords.length;
    attendanceRecords = attendanceRecords.filter((record) => {
        return !(nameSet.has(record.participant_name) && dateSet.has(record.attendance_date));
    });
    return before - attendanceRecords.length;
}

export function renameAttendanceDates(dateRenames: Array<{ from: string; to: string }>) {
    let changedCount = 0;
    const now = new Date().toISOString();
    for (const rename of dateRenames) {
        for (const session of attendanceSessions) {
            if (session.session_date !== rename.from) continue;
            session.session_date = rename.to;
            session.is_deleted = false;
            changedCount++;
        }

        for (const record of attendanceRecords) {
            if (record.attendance_date !== rename.from) continue;
            record.attendance_date = rename.to;
            record.updated_at = now;
            changedCount++;
        }
    }
    return changedCount;
}

export function softDeleteAttendanceDates(dates: string[]) {
    const dateSet = new Set(dates);
    const now = new Date().toISOString();
    let changedCount = 0;
    for (const session of attendanceSessions) {
        if (!dateSet.has(session.session_date) || session.is_deleted) continue;
        session.is_deleted = true;
        changedCount++;
    }

    for (const record of attendanceRecords) {
        if (!dateSet.has(record.attendance_date) || record.is_deleted) continue;
        record.is_deleted = true;
        record.updated_at = now;
        changedCount++;
    }
    return changedCount;
}

export function importBackupData(
    newCols: any[],
    newSubs: any[],
    newParticipants: any[] = [],
    newAttendanceSessions: any[] = [],
    newAttendanceRecords: any[] = []
) {
    collections.length = 0;
    collections.push(...newCols.map(c => ({
        id: c.id || ('col-' + Math.random().toString(36).substring(2, 9)),
        name: c.name,
        is_active: c.is_active ?? true,
        submission_limit: c.submission_limit ?? 500
    })));
    
    submissions.length = 0;
    submissions.push(...newSubs.map(s => ({
        id: s.id || ('sub-' + Math.random().toString(36).substring(2, 9)),
        collection_id: s.collection_id,
        collection_name: s.collection_name,
        name: s.name,
        group_name: s.group_name || '',
        category: s.collection_name,
        file_path: s.file_path,
        file_size: s.file_size,
        original_size: s.original_size || s.file_size,
        img_data: s.img_url || s.img_data || '',
        is_deleted: s.is_deleted ?? false
    })));

    participants.length = 0;
    participants.push(...newParticipants.map((p, index) => ({
        id: p.id || ('participant-' + Math.random().toString(36).substring(2, 9)),
        order: p.list_order ?? p.order ?? index + 1,
        full_name: p.full_name ?? p.fullName ?? p.name,
        created_at: p.created_at || new Date().toISOString()
    })).filter(p => p.full_name));
    participants.sort((a, b) => a.order - b.order);

    attendanceSessions.length = 0;
    attendanceSessions.push(...newAttendanceSessions.map((session) => ({
        id: session.id || ('attendance-session-' + Math.random().toString(36).substring(2, 9)),
        session_date: String(session.session_date ?? '').slice(0, 10),
        period: (session.period === 'afternoon' ? 'afternoon' : 'morning') as 'morning' | 'afternoon',
        label: session.label ?? '',
        is_deleted: session.is_deleted ?? false
    })).filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.session_date)));

    attendanceRecords.length = 0;
    attendanceRecords.push(...newAttendanceRecords.map((record) => ({
        id: record.id || ('attendance-' + Math.random().toString(36).substring(2, 9)),
        participant_name: String(record.participant_name ?? '').trim().replace(/\s+/g, ' '),
        attendance_date: String(record.attendance_date ?? '').slice(0, 10),
        period: (record.period === 'afternoon' ? 'afternoon' : 'morning') as 'morning' | 'afternoon',
        is_present: record.is_present ?? record.checked ?? false,
        is_deleted: record.is_deleted ?? false,
        created_at: record.created_at || new Date().toISOString(),
        updated_at: record.updated_at || new Date().toISOString()
    })).filter((record) => record.participant_name && /^\d{4}-\d{2}-\d{2}$/.test(record.attendance_date)));
}
