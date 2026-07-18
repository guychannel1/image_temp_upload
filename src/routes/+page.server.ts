import { supabase, isSupabaseConfigured } from '$lib/server/supabase';
import * as mockDb from '$lib/server/db';
import { uploadToR2, deleteFromR2, deleteObjectsFromR2 } from '$lib/server/r2';
import { createSession, destroySession, getCurrentUser } from '$lib/server/auth';
import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { findEvidenceForName, mergeParticipantLists, normalizePersonName, parseParticipantList, planParticipantUpdates } from '$lib/evidence';

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

function canViewSubmissions(role: string): role is 'admin' | 'staff' {
    return role === 'admin' || role === 'staff';
}

const PUBLIC_EVIDENCE_COLLECTIONS = [
    { id: 'eve', name: 'eve', is_active: true, submission_limit: 500 },
    { id: 'cer', name: 'cer', is_active: true, submission_limit: 500 }
];

type AttendancePeriod = 'morning' | 'afternoon';
type AttendancePayloadRow = {
    participant_name: string;
    attendance_date: string;
    period: AttendancePeriod;
    is_present: boolean;
    previous_is_present?: boolean;
};
type AttendanceDateRename = {
    from: string;
    to: string;
};
type AttendanceSessionRow = {
    id: string;
    session_date: string;
    period: AttendancePeriod;
    label: string;
};

const ATTENDANCE_DELETE_NAME_CHUNK_SIZE = 8;
const ATTENDANCE_DELETE_ID_CHUNK_SIZE = 80;
const ATTENDANCE_INSERT_CHUNK_SIZE = 300;

function evidenceAliases(type: string) {
    if (type === 'eve') return ['eve', 'ewe', 'evidence'];
    if (type === 'cer') return ['cer', 'cert', 'certificate'];
    return [type];
}

function normalizeEvidenceType(value: string | null | undefined) {
    const lower = (value ?? '').trim().toLowerCase();
    if (evidenceAliases('eve').includes(lower)) return 'eve';
    if (evidenceAliases('cer').includes(lower)) return 'cer';
    return '';
}

async function loadParticipantsFromListFile() {
    try {
        const text = await readFile('list.md', 'utf8');
        return parseParticipantList(text);
    } catch (err: any) {
        if (err?.code !== 'ENOENT') {
            console.error('Failed to load list.md:', err);
        }
        return [];
    }
}

function participantRecordsToParticipants(records: any[]) {
    return records
        .map((row, index) => ({
            order: Number(row.list_order ?? row.order ?? index + 1),
            fullName: String(row.full_name ?? row.fullName ?? row.name ?? '').trim().replace(/\s+/g, ' ')
        }))
        .filter((row) => row.fullName.length > 0)
        .sort((a, b) => a.order - b.order)
        .map((row, index) => ({ order: Number.isFinite(row.order) && row.order > 0 ? row.order : index + 1, fullName: row.fullName }));
}

function isMissingParticipantListOrderError(error: any) {
    const message = String(error?.message ?? error ?? '');
    return /list_order/i.test(message) && /schema cache|column|could not find/i.test(message);
}

function isMissingParticipantOrderError(error: any) {
    const message = String(error?.message ?? error ?? '');
    return /\border\b/i.test(message) && /schema cache|column|could not find/i.test(message);
}

async function getParticipantOrderColumn(): Promise<'list_order' | 'order'> {
    if (!supabase) return 'list_order';

    const { error } = await supabase
        .from('participants')
        .select('id, list_order, full_name, created_at')
        .limit(1);

    if (!error) return 'list_order';
    if (isMissingParticipantListOrderError(error)) return 'order';
    throw error;
}

async function hasLegacyParticipantOrderColumn() {
    if (!supabase) return false;

    const { error } = await supabase
        .from('participants')
        .select('id, order')
        .limit(1);

    if (!error) return true;
    if (isMissingParticipantOrderError(error)) return false;
    return false;
}

function participantSelectColumns(orderColumn: 'list_order' | 'order') {
    return `id, ${orderColumn}, full_name, created_at`;
}

function participantInsertRows(rows: Array<{ order: number; fullName: string }>, orderColumn: 'list_order' | 'order') {
    return rows.map((row) => ({
        [orderColumn]: row.order,
        full_name: row.fullName
    }));
}

function participantInsertRowsForSchema(
    rows: Array<{ order: number; fullName: string }>,
    orderColumn: 'list_order' | 'order',
    includeLegacyOrder: boolean
) {
    return rows.map((row) => ({
        [orderColumn]: row.order,
        ...(includeLegacyOrder ? { order: row.order } : {}),
        full_name: row.fullName
    }));
}

export async function _loadParticipants(loggedIn: boolean) {
    const fileParticipants = await loadParticipantsFromListFile();
    if (!loggedIn) {
        return {
            participants: fileParticipants,
            meta: { source: 'list.md', databaseCount: 0, loadedCount: fileParticipants.length, error: '' }
        };
    }

    if (isSupabaseConfigured && supabase) {
        try {
            const orderColumn = await getParticipantOrderColumn();
            const response = await supabase
                .from('participants')
                .select(participantSelectColumns(orderColumn))
                .order(orderColumn, { ascending: true })
                .range(0, 5000);

            const { data, error } = response;
            if (error) throw error;
            const participants = participantRecordsToParticipants(data ?? []);
            if (participants.length > 0) {
                return {
                    participants,
                    meta: {
                        source: 'database',
                        databaseCount: data?.length ?? participants.length,
                        loadedCount: participants.length,
                        error: ''
                    }
                };
            }

            return {
                participants: fileParticipants,
                meta: { source: 'list.md-empty-db', databaseCount: 0, loadedCount: fileParticipants.length, error: '' }
            };
        } catch (err: any) {
            console.error('Failed to load participants from Supabase:', err);
            return {
                participants: fileParticipants,
                meta: {
                    source: 'list.md-error',
                    databaseCount: 0,
                    loadedCount: fileParticipants.length,
                    error: err?.message ?? String(err)
                }
            };
        }
    }

    const participants = participantRecordsToParticipants(mockDb.participants);
    return {
        participants: participants.length > 0 ? participants : fileParticipants,
        meta: {
            source: participants.length > 0 ? 'mock-db' : 'list.md-empty-mock',
            databaseCount: participants.length,
            loadedCount: participants.length > 0 ? participants.length : fileParticipants.length,
            error: ''
        }
    };
}

function decodeXml(value: string) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function extractXmlText(xml: string) {
    return decodeXml(
        Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
            .map((match) => match[1])
            .join('')
            .replace(/<[^>]+>/g, '')
    ).trim();
}

async function parseParticipantsXlsx(file: File) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
    if (!sheetXml) {
        throw new Error('ไม่พบ sheet แรกในไฟล์ XLSX');
    }

    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const sharedStrings = sharedXml
        ? Array.from(sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) => extractXmlText(match[1]))
        : [];

    const parsedRows = Array.from(sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
        const cells: Record<string, string> = {};
        for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
            const attrs = cellMatch[1];
            const body = cellMatch[2];
            const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? '';
            const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
            const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
            let value = '';
            if (type === 's') {
                value = sharedStrings[Number(rawValue)] ?? '';
            } else if (type === 'inlineStr') {
                value = extractXmlText(body);
            } else {
                value = decodeXml(rawValue);
            }
            if (ref) cells[ref] = value.trim();
        }
        return cells;
    });

    const firstDataIndex = parsedRows.findIndex((row) => {
        const values = Object.values(row).join(' ').toLowerCase();
        return values.includes('ชื่อ') || values.includes('name');
    });
    const rows = (firstDataIndex >= 0 ? parsedRows.slice(firstDataIndex + 1) : parsedRows)
        .map((row, index) => {
            const order = Number.parseInt(row.A ?? '', 10);
            const name = (row.B || Object.entries(row).find(([col, value]) => col !== 'A' && !/^\d+$/.test(value))?.[1] || '').trim();
            return {
                order: Number.isFinite(order) && order > 0 ? order : index + 1,
                fullName: name.replace(/\s+/g, ' ')
            };
        })
        .filter((row) => row.fullName.length > 0);

    if (rows.length === 0) {
        throw new Error('ไม่พบรายชื่อในไฟล์ XLSX');
    }
    return rows;
}

async function replaceParticipants(rows: Array<{ order: number; fullName: string }>, options: { preserveMissing?: boolean } = {}) {
    let normalizedRows = rows
        .map((row, index) => ({
            order: Number.isFinite(row.order) && row.order > 0 ? row.order : index + 1,
            fullName: row.fullName.trim().replace(/\s+/g, ' ')
        }))
        .filter((row) => row.fullName.length > 0)
        .sort((a, b) => a.order - b.order)
        .map((row, index) => ({ order: index + 1, fullName: row.fullName }));

    if (normalizedRows.length === 0) {
        throw new Error('ไม่มีรายชื่อสำหรับบันทึก');
    }

    if (isSupabaseConfigured && supabase) {
        const orderColumn = await getParticipantOrderColumn();
        const includeLegacyOrder = await hasLegacyParticipantOrderColumn();
        const { data: existingData, error: existingError } = await supabase
            .from('participants')
            .select(`id, ${orderColumn}, full_name`);
        if (existingError) throw existingError;

        const existingRows = (existingData ?? []).map((row: any, index: number) => ({
            id: row.id,
            order: Number(row[orderColumn] ?? index + 1),
            fullName: String(row.full_name ?? '').trim().replace(/\s+/g, ' ')
        }));
        if (options.preserveMissing) {
            normalizedRows = mergeParticipantLists(normalizedRows, existingRows);
        }
        const updatePlan = planParticipantUpdates(normalizedRows, existingRows, {
            matchRenamesByOrder: !options.preserveMissing
        });
        const removedIds = updatePlan.removedRows.map((row) => row.id);

        if (removedIds.length > 0) {
            const hasParticipantId = await hasAttendanceParticipantIdColumn();
            if (hasParticipantId) {
                for (const idChunk of chunkArray(removedIds, ATTENDANCE_DELETE_ID_CHUNK_SIZE)) {
                    const { error } = await supabase
                        .from('attendance_records')
                        .update({ participant_id: null, updated_at: new Date().toISOString() })
                        .in('participant_id', idChunk);
                    if (error && !isAttendanceSchemaError(error)) throw error;
                }
            }

            const { error: deleteError } = await supabase
                .from('participants')
                .delete()
                .in('id', removedIds);
            if (deleteError) throw deleteError;
        }

        const minimumExistingOrder = existingRows.reduce((minimum, row) => Math.min(minimum, row.order), 0);
        for (const [index, row] of updatePlan.changedRows.entries()) {
            const tempOrder = minimumExistingOrder - index - 1;
            const { error } = await supabase
                .from('participants')
                .update({
                    [orderColumn]: tempOrder,
                    ...(includeLegacyOrder ? { order: tempOrder } : {}),
                    updated_at: new Date().toISOString()
                })
                .eq('id', row.existing!.id);
            if (error) throw error;
        }

        for (const row of [...updatePlan.changedRows, ...updatePlan.newRows]) {
            const now = new Date().toISOString();
            if (!row.existing) {
                const { error } = await supabase
                    .from('participants')
                    .insert({
                        [orderColumn]: row.order,
                        ...(includeLegacyOrder ? { order: row.order } : {}),
                        full_name: row.fullName,
                        created_at: now,
                        updated_at: now
                    });
                if (error) throw error;
                continue;
            }

            if (row.existing.fullName !== row.fullName) {
                const { error: attendanceByIdError } = await supabase
                    .from('attendance_records')
                    .update({ participant_name: row.fullName, updated_at: now })
                    .eq('participant_id', row.existing.id);
                if (attendanceByIdError && !isAttendanceSchemaError(attendanceByIdError)) throw attendanceByIdError;

                const { error: attendanceByNameError } = await supabase
                    .from('attendance_records')
                    .update({ participant_name: row.fullName, updated_at: now })
                    .eq('participant_name', row.existing.fullName);
                if (attendanceByNameError && !isAttendanceSchemaError(attendanceByNameError)) throw attendanceByNameError;

                const { error: submissionsByNameError } = await supabase
                    .from('submissions')
                    .update({ name: row.fullName })
                    .eq('name', row.existing.fullName);
                if (submissionsByNameError) throw submissionsByNameError;
            }

            const { error } = await supabase
                .from('participants')
                .update({
                    [orderColumn]: row.order,
                    ...(includeLegacyOrder ? { order: row.order } : {}),
                    full_name: row.fullName,
                    updated_at: now
                })
                .eq('id', row.existing.id);
            if (error) throw error;
        }
    } else {
        if (options.preserveMissing) {
            normalizedRows = mergeParticipantLists(normalizedRows, participantRecordsToParticipants(mockDb.participants));
        }
        mockDb.replaceParticipants(normalizedRows);
    }

    return normalizedRows;
}

async function loadParticipantRowsForImportReview() {
    if (isSupabaseConfigured && supabase) {
        const orderColumn = await getParticipantOrderColumn();
        const { data, error } = await supabase
            .from('participants')
            .select(`id, ${orderColumn}, full_name`)
            .order(orderColumn, { ascending: true })
            .range(0, 20000);
        if (error) throw error;
        return (data ?? []).map((row: any, index: number) => ({
            id: String(row.id),
            order: Number(row[orderColumn] ?? index + 1),
            fullName: String(row.full_name ?? '').trim().replace(/\s+/g, ' ')
        })).filter((row) => row.fullName.length > 0);
    }

    return mockDb.participants.map((row: any, index: number) => ({
        id: String(row.id ?? `mock-${index + 1}`),
        order: Number(row.order ?? index + 1),
        fullName: String(row.full_name ?? '').trim().replace(/\s+/g, ' ')
    })).filter((row) => row.fullName.length > 0);
}

async function addParticipant(fullName: string, order?: number) {
    const cleanName = fullName.trim().replace(/\s+/g, ' ');
    if (!cleanName) throw new Error('กรุณากรอกชื่อ-สกุล');

    if (isSupabaseConfigured && supabase) {
        const orderColumn = await getParticipantOrderColumn();
        const { data, error } = await supabase
            .from('participants')
            .select(participantSelectColumns(orderColumn))
            .order(orderColumn, { ascending: true });
        if (error) throw error;

        const rows = participantRecordsToParticipants(data ?? []);
        const insertIndex = order && order > 0
            ? Math.min(Math.max(order - 1, 0), rows.length)
            : rows.length;
        rows.splice(insertIndex, 0, { order: insertIndex + 1, fullName: cleanName });
        await replaceParticipants(rows);
    } else {
        mockDb.addParticipant(cleanName, order);
    }
}

function attendanceRecordsToRows(records: any[]) {
    return records
        .map((row) => ({
            id: String(row.id ?? ''),
            participant_name: String(row.participant_name ?? '').trim().replace(/\s+/g, ' '),
            attendance_date: String(row.attendance_date ?? '').slice(0, 10),
            period: row.period === 'afternoon' ? 'afternoon' : 'morning',
            is_present: !!row.is_present
        }))
        .filter((row) => row.participant_name && row.attendance_date);
}

function attendanceSessionsToRows(records: any[]): AttendanceSessionRow[] {
    return records
        .map((row) => ({
            id: String(row.id ?? ''),
            session_date: String(row.session_date ?? '').slice(0, 10),
            period: (row.period === 'afternoon' ? 'afternoon' : 'morning') as AttendancePeriod,
            label: String(row.label ?? '')
        }))
        .filter((row) => row.session_date);
}

function isAttendanceSchemaError(error: any) {
    const message = String(error?.message ?? error ?? '');
    const code = String(error?.code ?? '');
    return code === '42703'
        || code === '42P10'
        || (/attendance_records/i.test(message) && /column|schema cache|constraint|on conflict/i.test(message));
}

function attendanceMigrationMessage(error?: any) {
    const detail = error?.message ? ` (${error.message})` : '';
    return `โครงสร้างตาราง attendance_records ยังไม่ตรงกับระบบ กรุณารัน migration_attendance_records.sql ใน Supabase SQL Editor${detail}`;
}

function formatServerError(error: any) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    return [
        error.message,
        error.code ? `code=${error.code}` : '',
        error.details ? `details=${error.details}` : '',
        error.hint ? `hint=${error.hint}` : ''
    ].filter(Boolean).join(' | ') || JSON.stringify(error);
}

async function hasAttendanceParticipantIdColumn() {
    if (!supabase) return false;

    const { error } = await supabase
        .from('attendance_records')
        .select('id, participant_id')
        .limit(1);

    if (!error) return true;
    const message = String(error?.message ?? '');
    if (/participant_id/i.test(message) && /schema cache|column|could not find/i.test(message)) return false;
    return false;
}

async function hasAttendanceSessionIdColumn() {
    if (!supabase) return false;

    const { error } = await supabase
        .from('attendance_records')
        .select('id, session_id')
        .limit(1);

    if (!error) return true;
    const message = String(error?.message ?? '');
    if (/session_id/i.test(message) && /schema cache|column|could not find/i.test(message)) return false;
    return false;
}

async function hasAttendanceSessionIsDeletedColumn() {
    if (!supabase) return false;

    const { error } = await supabase
        .from('attendance_sessions')
        .select('id, is_deleted')
        .limit(1);

    if (!error) return true;
    const message = String(error?.message ?? '');
    if (/is_deleted/i.test(message) && /schema cache|column|could not find/i.test(message)) return false;
    return false;
}

async function loadParticipantIdByName(participantNames: string[]) {
    const result = new Map<string, string>();
    if (!supabase || participantNames.length === 0) return result;

    const requestedNames = new Set(participantNames.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean));
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('participants')
            .select('id, full_name')
            .range(from, from + pageSize - 1);
        if (error) throw error;

        for (const row of data ?? []) {
            const name = String(row.full_name).trim().replace(/\s+/g, ' ');
            if (requestedNames.has(name)) {
                result.set(name, row.id);
            }
        }

        if (!data || data.length < pageSize || result.size >= requestedNames.size) break;
        from += pageSize;
    }

    return result;
}

async function ensureParticipantIdsByName(participantNames: string[]) {
    const existing = await loadParticipantIdByName(participantNames);
    if (!supabase) return existing;

    const requestedNames = Array.from(new Set(participantNames.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean)));
    const missingNames = requestedNames.filter((name) => !existing.has(name));
    if (missingNames.length === 0) return existing;

    const orderColumn = await getParticipantOrderColumn();
    const includeLegacyOrder = await hasLegacyParticipantOrderColumn();
    const { data: currentRows, error: currentRowsError } = await supabase
        .from('participants')
        .select(participantSelectColumns(orderColumn))
        .range(0, 10000);
    if (currentRowsError) throw currentRowsError;

    const currentOrders = participantRecordsToParticipants(currentRows ?? []).map((row) => row.order);
    const maxOrder = currentOrders.length > 0 ? Math.max(...currentOrders) : 0;
    const now = new Date().toISOString();
    const rowsToInsert = missingNames.map((name, index) => {
        const rowOrder = maxOrder + index + 1;
        return {
            [orderColumn]: rowOrder,
            ...(includeLegacyOrder ? { order: rowOrder } : {}),
            full_name: name,
            created_at: now,
            updated_at: now
        };
    });

    for (const chunk of chunkArray(rowsToInsert, 500)) {
        const { error } = await supabase
            .from('participants')
            .insert(chunk);
        if (error) throw error;
    }

    return loadParticipantIdByName(requestedNames);
}

export async function _loadAttendanceRecords(loggedIn: boolean) {
    if (!loggedIn) return [];

    if (isSupabaseConfigured && supabase) {
        try {
            const { data, error } = await supabase
                .from('attendance_records')
                .select('id, participant_name, attendance_date, period, is_present')
                .or('is_deleted.is.null,is_deleted.eq.false')
                .order('attendance_date', { ascending: true })
                .range(0, 20000);
            if (error) throw error;
            return attendanceRecordsToRows(data ?? []);
        } catch (err: any) {
            console.error('Failed to load attendance records:', isAttendanceSchemaError(err) ? attendanceMigrationMessage(err) : err);
            return [];
        }
    }

    return attendanceRecordsToRows(mockDb.attendanceRecords.filter((record) => !record.is_deleted));
}

export async function _loadAttendanceSessions(loggedIn: boolean) {
    if (!loggedIn) return [];

    if (isSupabaseConfigured && supabase) {
        try {
            const hasIsDeleted = await hasAttendanceSessionIsDeletedColumn();
            let query = supabase
                .from('attendance_sessions')
                .select(hasIsDeleted ? 'id, session_date, period, label, is_deleted' : 'id, session_date, period, label')
                .order('session_date', { ascending: true })
                .order('period', { ascending: true })
                .range(0, 20000);

            if (hasIsDeleted) {
                query = query.or('is_deleted.is.null,is_deleted.eq.false');
            }

            const { data, error } = await query;
            if (error) throw error;
            return attendanceSessionsToRows(data ?? []);
        } catch (err: any) {
            console.error('Failed to load attendance sessions:', err);
            return [];
        }
    }

    return attendanceSessionsToRows(mockDb.attendanceSessions.filter((session) => !session.is_deleted));
}

function normalizeAttendancePayload(value: string): AttendancePayloadRow[] {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) {
        throw new Error('Attendance payload must be an array');
    }

    return parsed
        .map((row) => ({
            participant_name: String(row.participant_name ?? '').trim().replace(/\s+/g, ' '),
            attendance_date: String(row.attendance_date ?? '').slice(0, 10),
            period: (row.period === 'afternoon' ? 'afternoon' : 'morning') as AttendancePeriod,
            is_present: !!row.is_present,
            previous_is_present: typeof row.previous_is_present === 'boolean' ? row.previous_is_present : undefined
        }))
        .filter((row) => row.participant_name && /^\d{4}-\d{2}-\d{2}$/.test(row.attendance_date));
}

function normalizeAttendanceDateRenames(value: string): AttendanceDateRename[] {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) {
        throw new Error('Attendance date renames must be an array');
    }

    return parsed
        .map((row) => ({
            from: String(row.from ?? '').slice(0, 10),
            to: String(row.to ?? '').slice(0, 10)
        }))
        .filter((row) =>
            /^\d{4}-\d{2}-\d{2}$/.test(row.from)
            && /^\d{4}-\d{2}-\d{2}$/.test(row.to)
            && row.from !== row.to
        );
}

function normalizeAttendanceDeletedDates(value: string): string[] {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) {
        throw new Error('Attendance deleted dates must be an array');
    }

    return Array.from(new Set(parsed
        .map((date) => String(date ?? '').slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
}

async function deleteAttendanceDates(participantNames: string[], dates: string[]) {
    const cleanNames = Array.from(new Set(participantNames.map((name) => name.trim().replace(/\s+/g, ' ')).filter(Boolean)));
    const cleanDates = Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
    if (cleanNames.length === 0 || cleanDates.length === 0) return 0;

    if (isSupabaseConfigured && supabase) {
        const hasParticipantId = await hasAttendanceParticipantIdColumn();
        const participantIdByName = hasParticipantId ? await loadParticipantIdByName(cleanNames) : new Map<string, string>();
        for (const date of cleanDates) {
            if (hasParticipantId) {
                const ids = cleanNames.map((name) => participantIdByName.get(name)).filter(Boolean);
                for (const idChunk of chunkArray(ids, ATTENDANCE_DELETE_ID_CHUNK_SIZE)) {
                    if (idChunk.length === 0) continue;
                    const { error } = await supabase
                        .from('attendance_records')
                        .delete()
                        .eq('attendance_date', date)
                        .in('participant_id', idChunk);
                    if (error) {
                        if (isAttendanceSchemaError(error)) throw new Error(attendanceMigrationMessage(error));
                        throw error;
                    }
                }
            } else {
                for (const nameChunk of chunkArray(cleanNames, ATTENDANCE_DELETE_NAME_CHUNK_SIZE)) {
                    const { error } = await supabase
                        .from('attendance_records')
                        .delete()
                        .eq('attendance_date', date)
                        .in('participant_name', nameChunk);
                    if (error) {
                        if (isAttendanceSchemaError(error)) throw new Error(attendanceMigrationMessage(error));
                        throw error;
                    }
                }
            }
        }
        return cleanNames.length * cleanDates.length;
    }

    return mockDb.deleteAttendanceRecordsForDates(cleanNames, cleanDates);
}

async function renameAttendanceDates(dateRenames: AttendanceDateRename[]) {
    const cleanRenames = dateRenames.filter((rename) =>
        /^\d{4}-\d{2}-\d{2}$/.test(rename.from)
        && /^\d{4}-\d{2}-\d{2}$/.test(rename.to)
        && rename.from !== rename.to
    );
    if (cleanRenames.length === 0) return 0;

    let changedCount = 0;
    if (isSupabaseConfigured && supabase) {
        for (const rename of cleanRenames) {
            const hasSessionIsDeleted = await hasAttendanceSessionIsDeletedColumn();
            const sessionUpdate: Record<string, any> = { session_date: rename.to };
            if (hasSessionIsDeleted) sessionUpdate.is_deleted = false;
            const { data: sessionData, error: sessionError } = await supabase
                .from('attendance_sessions')
                .update(sessionUpdate)
                .eq('session_date', rename.from)
                .select('id');
            if (sessionError) throw sessionError;
            changedCount += sessionData?.length ?? 0;

            const { data, error } = await supabase
                .from('attendance_records')
                .update({
                    attendance_date: rename.to,
                    updated_at: new Date().toISOString()
                })
                .eq('attendance_date', rename.from)
                .select('id');
            if (error) {
                if (isAttendanceSchemaError(error)) throw new Error(attendanceMigrationMessage(error));
                throw error;
            }
            changedCount += data?.length ?? 0;
        }
        return changedCount;
    }

    return mockDb.renameAttendanceDates(cleanRenames);
}

async function softDeleteAttendanceDates(dates: string[]) {
    const cleanDates = Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
    if (cleanDates.length === 0) return 0;

    if (isSupabaseConfigured && supabase) {
        let changedCount = 0;
        for (const date of cleanDates) {
            const hasSessionIsDeleted = await hasAttendanceSessionIsDeletedColumn();
            if (hasSessionIsDeleted) {
                const { data: sessionData, error: sessionError } = await supabase
                    .from('attendance_sessions')
                    .update({ is_deleted: true })
                    .eq('session_date', date)
                    .select('id');
                if (sessionError) throw sessionError;
                changedCount += sessionData?.length ?? 0;
            }

            const { data, error } = await supabase
                .from('attendance_records')
                .update({
                    is_deleted: true,
                    updated_at: new Date().toISOString()
                })
                .eq('attendance_date', date)
                .select('id');
            if (error) {
                if (isAttendanceSchemaError(error)) throw new Error(attendanceMigrationMessage(error));
                throw error;
            }
            changedCount += data?.length ?? 0;
        }
        return changedCount;
    }

    return mockDb.softDeleteAttendanceDates(cleanDates);
}

async function ensureAttendanceSessionsForDates(dates: string[]) {
    const cleanDates = Array.from(new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
    if (cleanDates.length === 0) return 0;

    if (isSupabaseConfigured && supabase) {
        const periods: AttendancePeriod[] = ['morning', 'afternoon'];
        const hasSessionIsDeleted = await hasAttendanceSessionIsDeletedColumn();
        let changedCount = 0;

        const { data: existingRows, error: existingError } = await supabase
            .from('attendance_sessions')
            .select(hasSessionIsDeleted ? 'id, session_date, period, is_deleted' : 'id, session_date, period')
            .in('session_date', cleanDates);
        if (existingError) throw existingError;

        const existingByKey = new Map<string, any>();
        for (const row of (existingRows ?? []) as any[]) {
            existingByKey.set(`${String(row.session_date).slice(0, 10)}|${row.period}`, row);
        }

        for (const date of cleanDates) {
            for (const period of periods) {
                const key = `${date}|${period}`;
                const existing = existingByKey.get(key);
                if (existing) {
                    if (hasSessionIsDeleted && existing.is_deleted) {
                        const { error } = await supabase
                            .from('attendance_sessions')
                            .update({ is_deleted: false })
                            .eq('id', existing.id);
                        if (error) throw error;
                        changedCount++;
                    }
                    continue;
                }

                const { error } = await supabase
                    .from('attendance_sessions')
                    .insert({
                        session_date: date,
                        period,
                        label: null,
                        ...(hasSessionIsDeleted ? { is_deleted: false } : {})
                    });
                if (error) throw error;
                changedCount++;
            }
        }

        return changedCount;
    }

    return mockDb.ensureAttendanceSessions(cleanDates);
}

function uniqueAttendanceDatesFromRows(rows: AttendancePayloadRow[]) {
    return Array.from(new Set(rows
        .map((row) => row.attendance_date)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
}

async function loadKnownAttendanceDateSet() {
    const sessions = await _loadAttendanceSessions(true);
    const records = await _loadAttendanceRecords(true);
    return new Set([
        ...sessions.map((session) => session.session_date),
        ...records.map((record) => record.attendance_date)
    ]);
}

async function findAttendanceConflicts(rows: AttendancePayloadRow[]) {
    const rowsWithPrevious = rows.filter((row) => typeof row.previous_is_present === 'boolean');
    if (rowsWithPrevious.length === 0) return [];

    const latestRecords = await _loadAttendanceRecords(true);
    const latestByKey = new Map<string, boolean>();
    for (const record of latestRecords) {
        latestByKey.set(`${record.participant_name}|${record.attendance_date}|${record.period}`, !!record.is_present);
    }

    return rowsWithPrevious.filter((row) => {
        const key = `${row.participant_name}|${row.attendance_date}|${row.period}`;
        const latestValue = latestByKey.get(key) ?? false;
        return latestValue !== row.previous_is_present;
    });
}

async function saveAttendanceRecords(rows: AttendancePayloadRow[]) {
    if (rows.length === 0) return 0;

    if (isSupabaseConfigured && supabase) {
        const now = new Date().toISOString();
        const participantNames = Array.from(new Set(rows.map((row) => row.participant_name)));
        const hasParticipantId = await hasAttendanceParticipantIdColumn();
        const participantIdByName = hasParticipantId ? await ensureParticipantIdsByName(participantNames) : new Map<string, string>();
        if (hasParticipantId) {
            const missingNames = participantNames.filter((name) => !participantIdByName.has(name));
            if (missingNames.length > 0) {
                throw new Error(`ไม่พบ participant_id สำหรับรายชื่อ: ${missingNames.slice(0, 5).join(', ')}${missingNames.length > 5 ? '...' : ''}`);
            }
        }

        for (const rowChunk of chunkArray(rows, ATTENDANCE_INSERT_CHUNK_SIZE)) {
            const { error: upsertError } = await supabase
                .from('attendance_records')
                .upsert(rowChunk.map((row) => ({
                    participant_name: row.participant_name,
                    attendance_date: row.attendance_date,
                    period: row.period,
                    is_present: row.is_present,
                    ...(hasParticipantId ? { participant_id: participantIdByName.get(row.participant_name) ?? null } : {}),
                    is_deleted: false,
                    updated_at: now
                })), { onConflict: 'participant_name,attendance_date,period' });
            if (upsertError) {
                if (isAttendanceSchemaError(upsertError)) throw new Error(attendanceMigrationMessage(upsertError));
                throw upsertError;
            }
        }
        return rows.length;
    }

    return mockDb.upsertAttendanceRecords(rows);
}

async function resolveCollectionByEvidenceType(type: string) {
    const normalizedType = normalizeEvidenceType(type);
    if (!normalizedType) return null;
    const aliases = evidenceAliases(normalizedType);

    if (isSupabaseConfigured && supabase) {
        const { data: cols, error } = await supabase
            .from('collections')
            .select('id, name, submission_limit')
            .eq('is_active', true)
            .in('name', aliases)
            .limit(1);
        if (error) throw error;
        const col = cols?.[0];
        return col ? { id: col.id, name: col.name, submission_limit: col.submission_limit ?? 500 } : null;
    }

    const col = mockDb.collections.find(c => c.is_active && aliases.includes(c.name.toLowerCase()));
    return col ? { id: col.id, name: col.name, submission_limit: col.submission_limit ?? 500 } : null;
}

function isMissingSubmitRpcError(error: any) {
    const message = String(error?.message ?? error ?? '');
    const code = String(error?.code ?? '');
    return code === '42883'
        || code === 'PGRST202'
        || /submit_with_quota_guard/i.test(message)
        || /function .* does not exist/i.test(message);
}

function stripDuplicateSuffix(value: string) {
    return value.trim().replace(/\s+\(\d+\)$/, '').toLowerCase();
}

async function insertSubmissionWithQuotaGuard(input: {
    collectionId: string;
    collectionName: string;
    name: string;
    groupName: string;
    filePath: string;
    fileSize: number;
    originalSize: number;
    imgUrl: string;
    collectionLimit: number;
    personLimit: number;
}) {
    if (!supabase) throw new Error('Supabase is not configured');

    const { data: existingSubmissions, error: existingError } = await supabase
        .from('submissions')
        .select('name, is_deleted')
        .eq('collection_id', input.collectionId);
    if (existingError) throw existingError;

    const activeSubmissions = (existingSubmissions ?? []).filter((submission: any) => !submission.is_deleted);
    if (activeSubmissions.length >= input.collectionLimit) {
        return { success: false, reason: 'quota_exceeded', limit: input.collectionLimit };
    }

    const baseName = stripDuplicateSuffix(input.name);
    const personCount = activeSubmissions.filter((submission: any) => stripDuplicateSuffix(String(submission.name ?? '')) === baseName).length;
    if (personCount >= input.personLimit) {
        return { success: false, reason: 'person_limit_exceeded', person_limit: input.personLimit };
    }

    let finalName = input.name;
    let counter = 1;
    const existingNames = new Set(activeSubmissions.map((submission: any) => String(submission.name ?? '').toLowerCase()));
    while (existingNames.has(finalName.toLowerCase())) {
        finalName = `${input.name} (${counter})`;
        counter++;
    }

    const { error: insertError } = await supabase
        .from('submissions')
        .insert({
            collection_id: input.collectionId,
            collection_name: input.collectionName,
            name: finalName,
            group_name: input.groupName || null,
            file_path: input.filePath,
            file_size: input.fileSize,
            original_size: input.originalSize,
            img_url: input.imgUrl,
            is_deleted: false
        });
    if (insertError) throw insertError;

    return { success: true, final_name: finalName };
}

export const load: PageServerLoad = async ({ cookies, url }) => {
    const currentUser = await getCurrentUser(cookies);
    const loggedIn = !!currentUser;
    const username = currentUser?.username || '';
    const userRole = currentUser?.role || '';
    const requestedView = url.searchParams.get('view');
    const workspaceView = ['overview', 'participants', 'attendance', 'mapping', 'files'].includes(requestedView ?? '')
        ? requestedView
        : 'overview';
    const loadMode = workspaceView === 'attendance' ? 'attendance' : 'workspace';
    const attendanceOnly = loadMode === 'attendance';
    // The global XLSX export is available from every dashboard workspace and combines
    // participants, attendance, and evidence in one sheet. Keep all three datasets
    // available after login so its contents never depend on the currently selected tab.
    const needsParticipants = loggedIn && ['overview', 'participants', 'attendance', 'mapping'].includes(workspaceView ?? '');
    const needsAttendance = loggedIn && workspaceView === 'attendance';
    const needsSubmissionData = loggedIn && workspaceView !== 'attendance';
    const emptyParticipantLoad = {
        participants: [],
        meta: { source: 'not-loaded', databaseCount: 0, loadedCount: 0, error: '' }
    };
    const [participantLoad, attendanceRecords, attendanceSessions] = await Promise.all([
        needsParticipants ? _loadParticipants(loggedIn) : Promise.resolve(emptyParticipantLoad),
        needsAttendance ? _loadAttendanceRecords(loggedIn) : Promise.resolve([]),
        needsAttendance ? _loadAttendanceSessions(loggedIn) : Promise.resolve([])
    ]);
    const participants = participantLoad.participants;

    let collectionsList: any[] = [];
    let submissionsList: any[] = [];
    let collectionStats: Record<string, { count: number; totalFileSize: number }> = {};
    let usersList: any[] = [];

    if (!loggedIn) {
        return {
            collections: PUBLIC_EVIDENCE_COLLECTIONS,
            activeCollections: PUBLIC_EVIDENCE_COLLECTIONS,
            submissions: [],
            collectionStats: {},
            loggedIn,
            userRole,
            username,
            users: [],
            usersList: [],
            isSupabaseLive: isSupabaseConfigured,
            publicMode: true,
            participants,
            participantsMeta: participantLoad.meta,
            attendanceRecords: [],
            attendanceSessions: []
        };
    }

    if (loggedIn && userRole === 'admin' && !attendanceOnly) {
        if (isSupabaseConfigured && supabase) {
            try {
                const { data: dbUsers } = await supabase
                    .from('app_users')
                    .select('id, username, role, created_at')
                    .order('created_at', { ascending: true });
                if (dbUsers) {
                    usersList = dbUsers;
                }
            } catch (err) {
                console.error('Failed to load users from Supabase:', err);
                usersList = mockDb.appUsers.map(u => ({ id: u.id, username: u.username, role: u.role, created_at: new Date().toISOString() }));
            }
        } else {
            usersList = mockDb.appUsers.map(u => ({ id: u.id, username: u.username, role: u.role, created_at: new Date().toISOString() }));
        }
    }

    if (needsSubmissionData && isSupabaseConfigured && supabase) {
        try {
            const collectionsPromise = supabase
                .from('collections')
                .select('id, name, is_active, submission_limit')
                .order('created_at', { ascending: true });
            // Dashboard tabs use shallow URL updates, so file metadata must be present
            // even when the initial tab is not the file explorer.
            const submissionsPromise = supabase
                .from('submissions')
                .select('id, collection_id, collection_name, name, group_name, file_path, file_size, original_size, img_url, is_deleted')
                .order('created_at', { ascending: true });
            const [collectionsResponse, submissionsResponse] = await Promise.all([
                collectionsPromise,
                submissionsPromise
            ]);
            const { data: cols, error: colsErr } = collectionsResponse;

            if (!colsErr && cols) {
                collectionsList = cols.map(c => ({
                    id: c.id,
                    name: c.name,
                    is_active: c.is_active,
                    submission_limit: c.submission_limit ?? 500
                }));
            }

            const subs = (submissionsResponse.data ?? []) as any[];
            const subsErr = submissionsResponse.error;

            if (!subsErr) {
                collectionStats = subs.reduce((stats, s) => {
                    if (!s.is_deleted && s.collection_id) {
                        const current = stats[s.collection_id] ?? { count: 0, totalFileSize: 0 };
                        stats[s.collection_id] = {
                            count: current.count + 1,
                            totalFileSize: current.totalFileSize + (s.file_size || 0)
                        };
                    }
                    return stats;
                }, {} as Record<string, { count: number; totalFileSize: number }>);

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

                if (canViewSubmissions(userRole)) {
                    submissionsList = userRole === 'admin'
                        ? allMapped
                        : allMapped.filter(s => !s.is_deleted);
                }
            }
        } catch (err) {
            console.error('Supabase query failed, falling back to Mock DB:', err);
            collectionsList = mockDb.collections;
            collectionStats = mockDb.submissions.reduce((stats, s) => {
                if (!s.is_deleted && s.collection_id) {
                    const current = stats[s.collection_id] ?? { count: 0, totalFileSize: 0 };
                    stats[s.collection_id] = {
                        count: current.count + 1,
                        totalFileSize: current.totalFileSize + (s.file_size || 0)
                    };
                }
                return stats;
            }, {} as Record<string, { count: number; totalFileSize: number }>);
            submissionsList = canViewSubmissions(userRole)
                ? (userRole === 'admin' ? mockDb.submissions : mockDb.submissions.filter(s => !s.is_deleted))
                : [];
        }
    } else if (needsSubmissionData) {
        // Fallback to local mock db
        collectionsList = mockDb.collections;
        const allMapped = mockDb.submissions.map(s => ({
            ...s,
            collection_id: s.is_deleted ? 'deleted-drive' : s.collection_id,
            collection_name: s.is_deleted ? 'deleted' : s.collection_name,
            group_name: s.is_deleted ? '' : s.group_name,
            category: s.is_deleted ? 'deleted' : s.collection_name
        }));
        collectionStats = mockDb.submissions.reduce((stats, s) => {
            if (!s.is_deleted && s.collection_id) {
                const current = stats[s.collection_id] ?? { count: 0, totalFileSize: 0 };
                stats[s.collection_id] = {
                    count: current.count + 1,
                    totalFileSize: current.totalFileSize + (s.file_size || 0)
                };
            }
            return stats;
        }, {} as Record<string, { count: number; totalFileSize: number }>);

        if (canViewSubmissions(userRole)) {
            submissionsList = userRole === 'admin'
                ? allMapped
                : allMapped.filter(s => !s.is_deleted);
        }
    }

    // Keep the admin recycle-bin folder available when Files is opened through
    // shallow navigation from another workspace tab.
    if (userRole === 'admin' && needsSubmissionData && submissionsList.some((submission: any) => submission.is_deleted)) {
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
        collectionStats,
        loggedIn,
        userRole,
        username,
        users: usersList,
        usersList,
        isSupabaseLive: isSupabaseConfigured,
        loadMode,
        workspaceView,
        participants,
        participantsMeta: participantLoad.meta,
        attendanceRecords,
        attendanceSessions
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
                    await createSession(user.username, cookies);
                    return { success: true, loggedIn: true, role: user.role, username };
                }
            } catch (err) {
                console.error('Supabase user auth failed, falling back to mock auth:', err);
            }
        }

        // Fallback to local memory mock db
        const user = mockDb.appUsers.find(u => u.username === username);
        if (user && user.password_hash === passwordHash) {
            await createSession(user.username, cookies);
            return { success: true, loggedIn: true, role: user.role, username };
        }

        return fail(400, { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    },

    logout: async ({ cookies }) => {
        await destroySession(cookies);
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
        const currentUser = await getCurrentUser(cookies);
        if (currentUser?.role !== 'admin') {
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

    previewParticipantsXlsx: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนอัปเดตรายชื่อ' });
        }

        const formData = await request.formData();
        const file = formData.get('participant_file') as File;
        if (!file || file.size === 0) {
            return fail(400, { success: false, message: 'กรุณาเลือกไฟล์ XLSX' });
        }

        try {
            const rows = await parseParticipantsXlsx(file);
            const existingRows = await loadParticipantRowsForImportReview();
            return {
                success: true,
                message: `อ่านไฟล์สำเร็จ ${rows.length} รายการ กรุณาตรวจสอบก่อนบันทึก`,
                preview: { incomingRows: rows, existingRows }
            };
        } catch (err: any) {
            console.error('[importParticipantsXlsx] error:', err);
            return fail(500, { success: false, message: err.message || 'นำเข้าไฟล์ XLSX ไม่สำเร็จ' });
        }
    },

    applyParticipantImportPreview: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนอัปเดตรายชื่อ' });
        }

        try {
            const formData = await request.formData();
            const rawRows = String(formData.get('participant_rows') ?? '');
            const rows = JSON.parse(rawRows);
            if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20000) {
                return fail(400, { success: false, message: 'ข้อมูล Preview ไม่ถูกต้องหรือมีจำนวนมากเกินไป' });
            }
            const cleanRows = rows.map((row: any, index: number) => ({
                order: Number(row.order) || index + 1,
                fullName: String(row.fullName ?? '').trim().replace(/\s+/g, ' ')
            })).filter((row: any) => row.fullName.length > 0);
            const savedRows = await replaceParticipants(cleanRows, { preserveMissing: true });
            return { success: true, message: `ยืนยันการอัปเดตรายชื่อแล้ว ปัจจุบันมีทั้งหมด ${savedRows.length} รายการ` };
        } catch (err: any) {
            console.error('[applyParticipantImportPreview] error:', err);
            return fail(500, { success: false, message: err.message || 'อัปเดตรายชื่อไม่สำเร็จ' });
        }
    },

    saveParticipants: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนอัปเดตรายชื่อ' });
        }

        const formData = await request.formData();
        const participantText = (formData.get('participant_list') as string || '').trim();
        const rows = parseParticipantList(participantText);
        if (rows.length === 0) {
            return fail(400, { success: false, message: 'กรุณากรอกรายชื่อก่อนบันทึก' });
        }

        try {
            const savedRows = await replaceParticipants(rows);
            return { success: true, message: `บันทึกรายชื่อ ${savedRows.length} รายการเรียบร้อยแล้ว` };
        } catch (err: any) {
            console.error('[saveParticipants] error:', err);
            return fail(500, { success: false, message: err.message || 'บันทึกรายชื่อไม่สำเร็จ' });
        }
    },

    addParticipant: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนเพิ่มรายชื่อ' });
        }

        const formData = await request.formData();
        const fullName = (formData.get('full_name') as string || '').trim();
        const order = Number.parseInt(formData.get('order') as string || '', 10);

        try {
            await addParticipant(fullName, Number.isFinite(order) ? order : undefined);
            return { success: true, message: `เพิ่มรายชื่อ "${fullName}" เรียบร้อยแล้ว` };
        } catch (err: any) {
            console.error('[addParticipant] error:', err);
            return fail(500, { success: false, message: err.message || 'เพิ่มรายชื่อไม่สำเร็จ' });
        }
    },

    saveAttendance: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนบันทึกการเข้างาน' });
        }

        const formData = await request.formData();
        const payload = (formData.get('attendance_payload') as string || '').trim();
        const dateRenamesPayload = (formData.get('attendance_date_renames') as string || '').trim();
        const deletedDatesPayload = (formData.get('attendance_deleted_dates') as string || '').trim();

        try {
            const rows = normalizeAttendancePayload(payload);
            const dateRenames = normalizeAttendanceDateRenames(dateRenamesPayload);
            const deletedDates = normalizeAttendanceDeletedDates(deletedDatesPayload);
            const savedDates = uniqueAttendanceDatesFromRows(rows);
            const conflicts = await findAttendanceConflicts(rows);
            if (conflicts.length > 0) {
                return fail(409, { success: false, message: `ข้อมูลเช็คชื่อเปลี่ยนไปแล้ว ${conflicts.length} ช่อง กรุณารีโหลดและตรวจอีกครั้ง` });
            }
            const canManageAttendanceDates = currentUser?.role === 'admin';
            if (!canManageAttendanceDates) {
                const knownDates = await loadKnownAttendanceDateSet();
                const newDates = [
                    ...savedDates.filter((date) => !knownDates.has(date)),
                    ...dateRenames.map((rename) => rename.to).filter((date) => !knownDates.has(date))
                ];
                if (newDates.length > 0 || dateRenames.length > 0 || deletedDates.length > 0) {
                    return fail(403, { success: false, message: 'เฉพาะ guyssar เท่านั้นที่เพิ่ม แก้ไข หรือลบวันที่เช็คได้' });
                }
            }
            const sessionCount = await ensureAttendanceSessionsForDates(savedDates);
            const deletedCount = await softDeleteAttendanceDates(deletedDates);
            const renamedCount = await renameAttendanceDates(dateRenames);
            const savedCount = sessionCount + deletedCount + renamedCount + await saveAttendanceRecords(rows);
            return { success: true, message: `บันทึกการเข้างาน ${savedCount} รายการเรียบร้อยแล้ว`, savedDates };
        } catch (err: any) {
            console.error('[saveAttendance] error:', formatServerError(err), err);
            return fail(500, { success: false, message: err.message || 'บันทึกการเข้างานไม่สำเร็จ' });
        }
    },

    checkEvidenceStatus: async ({ request }) => {
        const formData = await request.formData();
        const name = (formData.get('name') as string || '').trim();
        if (!name) {
            return fail(400, { success: false, message: 'กรุณากรอกชื่อ-สกุล' });
        }

        try {
            let submissions: any[] = [];
            if (isSupabaseConfigured && supabase) {
                const { data: subs, error } = await supabase
                    .from('submissions')
                    .select('*')
                    .eq('is_deleted', false);
                if (error) throw error;
                submissions = (subs ?? []).map(s => ({
                    ...s,
                    img_data: s.img_url
                }));
            } else {
                submissions = mockDb.submissions.filter(s => !s.is_deleted);
            }

            const status = findEvidenceForName(name, submissions);
            return {
                success: true,
                name,
                eve: status.eve,
                cer: status.cer,
                count: status.matches.length
            };
        } catch (err: any) {
            return fail(500, { success: false, message: err.message || 'ไม่สามารถตรวจสถานะได้' });
        }
    },

    updateSubmissionMapping: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนแก้ไขข้อมูล' });
        }

        const formData = await request.formData();
        const id = (formData.get('id') as string || '').trim();
        const name = (formData.get('name') as string || '').trim();
        const evidenceType = normalizeEvidenceType(formData.get('evidence_type') as string);

        if (!id || !name || !evidenceType) {
            return fail(400, { success: false, message: 'ข้อมูล mapping ไม่ครบ' });
        }

        try {
            const evidenceCollection = await resolveCollectionByEvidenceType(evidenceType);
            if (!evidenceCollection) {
                return fail(400, { success: false, message: `ยังไม่พบหัวข้อ ${evidenceType} ที่เปิดรับอยู่ในระบบ` });
            }

            if (isSupabaseConfigured && supabase) {
                const { error } = await supabase
                    .from('submissions')
                    .update({
                        name,
                        collection_id: evidenceCollection.id,
                        collection_name: evidenceCollection.name
                    })
                    .eq('id', id);
                if (error) throw error;
            } else {
                const submission = mockDb.submissions.find(s => s.id === id);
                if (!submission) {
                    return fail(404, { success: false, message: 'ไม่พบไฟล์ที่ต้องการแก้ไข' });
                }
                submission.name = name;
                submission.collection_id = evidenceCollection.id;
                submission.collection_name = evidenceCollection.name;
                submission.category = evidenceCollection.name;
            }

            return { success: true, message: 'อัปเดต mapping เรียบร้อยแล้ว' };
        } catch (err: any) {
            return fail(500, { success: false, message: err.message || 'อัปเดต mapping ไม่สำเร็จ' });
        }
    },

    updateSubmissionMappings: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!canViewSubmissions(currentUser?.role || '')) {
            return fail(403, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนแก้ไขข้อมูล' });
        }

        const formData = await request.formData();
        const mappingsString = (formData.get('mappings') as string || '').trim();
        if (!mappingsString) {
            return fail(400, { success: false, message: 'ไม่มีรายการ mapping สำหรับบันทึก' });
        }

        try {
            const mappings = JSON.parse(mappingsString) as Array<{ id: string; name: string; evidence_type: string }>;
            if (!Array.isArray(mappings) || mappings.length === 0) {
                return fail(400, { success: false, message: 'ไม่มีรายการ mapping สำหรับบันทึก' });
            }

            const evidenceCollections = new Map<string, Awaited<ReturnType<typeof resolveCollectionByEvidenceType>>>();
            for (const type of ['eve', 'cer']) {
                evidenceCollections.set(type, await resolveCollectionByEvidenceType(type));
            }

            for (const mapping of mappings) {
                const id = (mapping.id || '').trim();
                const name = (mapping.name || '').trim();
                const evidenceType = normalizeEvidenceType(mapping.evidence_type);
                const evidenceCollection = evidenceCollections.get(evidenceType);

                if (!id || !name || !evidenceType || !evidenceCollection) {
                    return fail(400, { success: false, message: 'มีรายการ mapping ที่ข้อมูลไม่ครบหรือหัวข้อไม่ถูกต้อง' });
                }

                if (isSupabaseConfigured && supabase) {
                    const { error } = await supabase
                        .from('submissions')
                        .update({
                            name,
                            collection_id: evidenceCollection.id,
                            collection_name: evidenceCollection.name
                        })
                        .eq('id', id);
                    if (error) throw error;
                } else {
                    const submission = mockDb.submissions.find(s => s.id === id);
                    if (!submission) {
                        return fail(404, { success: false, message: `ไม่พบไฟล์ ${id}` });
                    }
                    submission.name = name;
                    submission.collection_id = evidenceCollection.id;
                    submission.collection_name = evidenceCollection.name;
                    submission.category = evidenceCollection.name;
                }
            }

            return { success: true, message: `อัปเดต mapping ${mappings.length} รายการเรียบร้อยแล้ว` };
        } catch (err: any) {
            return fail(500, { success: false, message: err.message || 'อัปเดต mapping ทั้งหมดไม่สำเร็จ' });
        }
    },

    // Public Student Submission
    submitForm: async ({ request }) => {
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const collection_id = formData.get('collection_id') as string;
        const evidence_type = formData.get('evidence_type') as string;
        const file = formData.get('file');

        const isFile = file && typeof file === 'object' && 'size' in file && 'name' in file;
        const fileSize = isFile ? (file as any).size : 0;

        console.log('📤 [submitForm] Submission received:', { name, collection_id, evidence_type, isFile, fileSize });

        if (!name || !isFile || fileSize === 0) {
            return fail(400, { success: false, message: 'กรุณากรอกข้อมูลและเลือกไฟล์รูปภาพให้ครบถ้วน' });
        }

        const subName = name.trim();
        const subGroup = '';
        let finalName = subName;

        let targetCollectionId = collection_id;
        let colName = '';
        let submissionLimit = 500;
        const requestedEvidenceType = normalizeEvidenceType(evidence_type || collection_id);

        if (requestedEvidenceType) {
            const evidenceCollection = await resolveCollectionByEvidenceType(requestedEvidenceType);
            if (!evidenceCollection) {
                return fail(400, { success: false, message: `ยังไม่พบหัวข้อ ${requestedEvidenceType} ที่เปิดรับอยู่ในระบบ` });
            }
            targetCollectionId = evidenceCollection.id;
            colName = evidenceCollection.name;
            submissionLimit = evidenceCollection.submission_limit;
        }

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
                const storageMessage = String(storageErr?.message ?? '');
                if (/Cloudflare R2 credentials are missing/i.test(storageMessage)) {
                    return fail(503, { success: false, message: 'ระบบอัปโหลดยังไม่ได้ตั้งค่า Cloudflare R2 บน Vercel กรุณาตั้งค่า ENV ของ R2 ให้ครบก่อนใช้งาน' });
                }
                return fail(500, { success: false, message: `อัปโหลดไฟล์ล้มเหลว: ${storageMessage || 'กรุณาลองใหม่อีกครั้ง'}` });
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

                if (rpcError) {
                    if (isMissingSubmitRpcError(rpcError)) {
                        console.warn('[submitForm] submit_with_quota_guard missing, using direct insert fallback:', rpcError.message);
                        const fallbackResult = await insertSubmissionWithQuotaGuard({
                            collectionId: targetCollectionId,
                            collectionName: colName,
                            name: subName,
                            groupName: subGroup,
                            filePath,
                            fileSize,
                            originalSize: original_size,
                            imgUrl: publicUrl,
                            collectionLimit: submissionLimit,
                            personLimit: 3
                        });

                        if (!fallbackResult.success) {
                            await deleteFromR2(filePath);
                            if (fallbackResult.reason === 'quota_exceeded') {
                                return fail(429, {
                                    success: false,
                                    message: `หัวข้อนี้ถึงขีดจำกัดการรับส่งภาพแล้ว (${fallbackResult.limit ?? submissionLimit} รูป) กรุณาติดต่อผู้ดูแลระบบ`
                                });
                            }
                            if (fallbackResult.reason === 'person_limit_exceeded') {
                                return fail(429, {
                                    success: false,
                                    message: `คุณส่งรูปครบแล้ว (${fallbackResult.person_limit ?? 3} รูปต่อคน) ไม่สามารถส่งเพิ่มได้`
                                });
                            }
                            return fail(400, { success: false, message: 'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่' });
                        }

                        return { success: true, message: 'ส่งรูปภาพเข้าระบบเสร็จสิ้นเรียบร้อย!' };
                    }
                    throw rpcError;
                }

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
        const currentUser = await getCurrentUser(cookies);
        if (!currentUser) {
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
    },

    importBackupJson: async ({ request, cookies, platform }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!currentUser) {
            return fail(401, { success: false, message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
        }

        const formData = await request.formData();
        const file = formData.get('backup_file') as File;
        if (!file || file.size === 0) {
            return fail(400, { success: false, message: 'ไม่พบไฟล์สำรองข้อมูล หรือไฟล์ไม่มีข้อมูล' });
        }

        try {
            const text = await file.text();
            const backupData = JSON.parse(text);

            if (!backupData || typeof backupData !== 'object') {
                return fail(400, { success: false, message: 'โครงสร้างไฟล์ JSON ไม่ถูกต้อง' });
            }

            const { restoreBackupImages, validateFullBackupManifest } = await import('$lib/server/backup');
            validateFullBackupManifest(backupData);

            const collections = backupData.collections || [];
            const submissions = backupData.submissions || [];
            const participants = backupData.participants || [];
            const attendanceSessions = backupData.attendance_sessions || backupData.attendanceSessions || [];
            const attendanceRecords = backupData.attendance_records || backupData.attendanceRecords || [];
            const appUsers = backupData.app_users || [];

            if (!Array.isArray(collections) || !Array.isArray(submissions) || !Array.isArray(participants) || !Array.isArray(attendanceSessions) || !Array.isArray(attendanceRecords) || !Array.isArray(appUsers)) {
                return fail(400, { success: false, message: 'โครงสร้าง collections, submissions หรือ participants ในไฟล์ JSON ไม่ถูกต้อง' });
            }

            // Verify checksums and restore every binary image before destructive DB work.
            const r2Bucket = (platform as any)?.env?.R2_BUCKET || (platform as any)?.env?.R2 || (platform as any)?.env?.images;
            const restoredImages = await restoreBackupImages(backupData, r2Bucket);

            if (isSupabaseConfigured && supabase) {
                // Full restore: clear dependent tables in FK-safe order only after all
                // backup files have been verified and restored successfully.
                for (const table of ['attendance_records', 'submissions', 'attendance_sessions', 'participants', 'collections']) {
                    const { error } = await supabase.from(table).delete().not('id', 'is', null);
                    if (error) throw new Error(`ไม่สามารถล้างตาราง ${table}: ${error.message}`);
                }

                // 1. นำเข้า Participants
                if (participants.length > 0) {
                    const orderColumn = await getParticipantOrderColumn();
                    const includeLegacyOrder = await hasLegacyParticipantOrderColumn();
                    const { error: participantErr } = await supabase
                        .from('participants')
                        .insert(
                            participants.map((p, index) => {
                                const rowOrder = p.list_order ?? p.order ?? index + 1;
                                return {
                                    id: p.id,
                                    [orderColumn]: rowOrder,
                                    ...(includeLegacyOrder ? { order: rowOrder } : {}),
                                    full_name: p.full_name ?? p.fullName ?? p.name,
                                    created_at: p.created_at || new Date().toISOString(),
                                    updated_at: p.updated_at || new Date().toISOString()
                                };
                            }).filter(p => p.full_name)
                        );

                    if (participantErr) {
                        console.error('[importBackupJson] Participants insert error:', participantErr);
                        throw new Error(`ไม่สามารถกู้คืนรายชื่อหลักได้: ${participantErr.message}`);
                    }
                }

                // 2. นำเข้า Collections
                if (collections.length > 0) {
                    const { error: colErr } = await supabase
                        .from('collections')
                        .upsert(
                            collections.map(c => ({
                                id: c.id,
                                name: c.name,
                                is_active: c.is_active ?? true,
                                submission_limit: c.submission_limit ?? 500,
                                created_at: c.created_at || new Date().toISOString()
                            }))
                        );

                    if (colErr) {
                        console.error('[importBackupJson] Collections upsert error:', colErr);
                        throw new Error(`ไม่สามารถกู้คืนหัวข้อส่งงานได้: ${colErr.message}`);
                    }
                }

                // 3. นำเข้า Submissions
                if (submissions.length > 0) {
                    const { error: subErr } = await supabase
                        .from('submissions')
                        .upsert(
                            submissions.map(s => ({
                                id: s.id,
                                collection_id: s.collection_id,
                                collection_name: s.collection_name,
                                name: s.name,
                                group_name: s.group_name || null,
                                file_path: s.file_path,
                                file_size: s.file_size,
                                original_size: s.original_size || s.file_size,
                                img_url: restoredImages.urlsBySubmissionId[s.id] || s.img_url,
                                is_deleted: s.is_deleted ?? false,
                                created_at: s.created_at || new Date().toISOString()
                            }))
                        );

                    if (subErr) {
                        console.error('[importBackupJson] Submissions upsert error:', subErr);
                        throw new Error(`ไม่สามารถกู้คืนรูปภาพส่งงานได้: ${subErr.message}`);
                    }
                }

                // 4. นำเข้า Attendance Sessions
                if (attendanceSessions.length > 0) {
                    const hasSessionIsDeleted = await hasAttendanceSessionIsDeletedColumn();
                    const { error: attendanceSessionsErr } = await supabase
                        .from('attendance_sessions')
                        .insert(attendanceSessions.map((session) => ({
                            id: session.id,
                            session_date: String(session.session_date ?? '').slice(0, 10),
                            period: session.period === 'afternoon' ? 'afternoon' : 'morning',
                            label: session.label ?? null,
                            ...(hasSessionIsDeleted ? { is_deleted: session.is_deleted ?? false } : {})
                        })).filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.session_date)));
                    if (attendanceSessionsErr) {
                        console.error('[importBackupJson] Attendance sessions insert error:', attendanceSessionsErr);
                        throw new Error(`ไม่สามารถกู้คืนวันที่เช็คได้: ${attendanceSessionsErr.message}`);
                    }
                }

                // 5. นำเข้า Attendance Records
                if (attendanceRecords.length > 0) {
                    const hasParticipantId = await hasAttendanceParticipantIdColumn();
                    const hasSessionId = await hasAttendanceSessionIdColumn();
                    const { error: attendanceRecordsErr } = await supabase
                        .from('attendance_records')
                        .insert(attendanceRecords.map((record) => ({
                            id: record.id,
                            ...(hasParticipantId ? { participant_id: record.participant_id ?? null } : {}),
                            ...(hasSessionId ? { session_id: record.session_id ?? null } : {}),
                            participant_name: String(record.participant_name ?? '').trim().replace(/\s+/g, ' '),
                            attendance_date: String(record.attendance_date ?? '').slice(0, 10),
                            period: record.period === 'afternoon' ? 'afternoon' : 'morning',
                            is_present: record.is_present ?? record.checked ?? false,
                            is_deleted: record.is_deleted ?? false,
                            created_at: record.created_at || new Date().toISOString(),
                            updated_at: record.updated_at || new Date().toISOString()
                        })).filter((record) => record.participant_name && /^\d{4}-\d{2}-\d{2}$/.test(record.attendance_date)));
                    if (attendanceRecordsErr) {
                        console.error('[importBackupJson] Attendance records insert error:', attendanceRecordsErr);
                        throw new Error(`ไม่สามารถกู้คืนข้อมูลเช็คชื่อได้: ${attendanceRecordsErr.message}`);
                    }
                }

                // Sessions are intentionally not restored. Expire them before replacing
                // accounts so stale authentication tokens cannot survive a restore.
                const { error: sessionsDeleteError } = await supabase
                    .from('app_sessions')
                    .delete()
                    .not('token_hash', 'is', null);
                if (sessionsDeleteError) throw new Error(`ไม่สามารถล้าง session เดิมได้: ${sessionsDeleteError.message}`);

                const { error: usersInsertError } = await supabase
                    .from('app_users')
                    .upsert(appUsers.map((user: any) => ({
                        username: user.username,
                        role: user.role,
                        password_hash: user.password_hash,
                        created_at: user.created_at || new Date().toISOString()
                    })), { onConflict: 'username' });
                if (usersInsertError) throw new Error(`ไม่สามารถกู้คืนบัญชีผู้ใช้ได้: ${usersInsertError.message}`);

                const backupUsernames = new Set(appUsers.map((user: any) => user.username));
                const { data: currentUsers, error: currentUsersError } = await supabase
                    .from('app_users')
                    .select('id, username');
                if (currentUsersError) throw new Error(`ไม่สามารถตรวจบัญชีผู้ใช้หลังการกู้คืนได้: ${currentUsersError.message}`);
                const extraUserIds = (currentUsers ?? [])
                    .filter((user: any) => !backupUsernames.has(user.username))
                    .map((user: any) => user.id);
                if (extraUserIds.length > 0) {
                    const { error: extraUsersDeleteError } = await supabase
                        .from('app_users')
                        .delete()
                        .in('id', extraUserIds);
                    if (extraUsersDeleteError) throw new Error(`ไม่สามารถลบบัญชีที่ไม่อยู่ใน Backup ได้: ${extraUsersDeleteError.message}`);
                }
            } else {
                // Fallback to mock DB
                mockDb.importBackupData(collections, submissions, participants, attendanceSessions, attendanceRecords);
            }

            return { 
                success: true, 
                message: `กู้คืน Full Backup สำเร็จ! (บัญชี: ${appUsers.length}, รายชื่อ: ${participants.length}, หัวข้อ: ${collections.length}, รูปที่ตรวจ checksum แล้ว: ${restoredImages.filesCount}, วันที่เช็ค: ${attendanceSessions.length}, เช็คชื่อ: ${attendanceRecords.length}) กรุณาเข้าสู่ระบบใหม่`
            };
        } catch (err: any) {
            console.error('[importBackupJson] Restore error:', err);
            return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการประมวลผลไฟล์ JSON' });
        }
    },

    createUser: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (currentUser?.role !== 'admin') {
            return fail(403, { success: false, message: 'ไม่มีสิทธิ์ในการสร้างผู้ใช้ (เฉพาะ guyssar เท่านั้น)' });
        }

        const data = await request.formData();
        const newUsername = (data.get('username') as string || '').trim().toLowerCase();
        const role = (data.get('role') as string || 'staff') as 'admin' | 'staff';
        const password = data.get('password') as string || '';

        if (!newUsername || !password) {
            return fail(400, { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
        }

        const passwordHash = hashPassword(password);

        if (isSupabaseConfigured && supabase) {
            try {
                // Check if user already exists
                const { data: existingUser } = await supabase
                    .from('app_users')
                    .select('id')
                    .eq('username', newUsername)
                    .maybeSingle();

                if (existingUser) {
                    return fail(400, { success: false, message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
                }

                const { error } = await supabase
                    .from('app_users')
                    .insert([{ username: newUsername, role, password_hash: passwordHash }]);

                if (error) {
                    return fail(500, { success: false, message: `ล้มเหลว: ${error.message}` });
                }
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล' });
            }
        } else {
            // Mock DB
            if (mockDb.appUsers.some(u => u.username === newUsername)) {
                return fail(400, { success: false, message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
            }
            mockDb.appUsers.push({
                id: 'usr-' + Date.now(),
                username: newUsername,
                role,
                password_hash: passwordHash
            });
        }

        return { success: true, message: `สร้างผู้ใช้งาน "${newUsername}" (${role}) เรียบร้อยแล้ว` };
    },

    changeUserPassword: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (!currentUser) {
            return fail(401, { success: false, message: 'กรุณาเข้าสู่ระบบ' });
        }

        const data = await request.formData();
        const targetUsername = (data.get('username') as string || '').trim().toLowerCase();
        const newPassword = data.get('password') as string || '';

        if (!targetUsername || !newPassword) {
            return fail(400, { success: false, message: 'ข้อมูลไม่ครบถ้วน' });
        }

        // Only guyssar can change anyone's password, other users can only change their own password
        if (currentUser.role !== 'admin' && currentUser.username?.toLowerCase() !== targetUsername?.toLowerCase()) {
            return fail(403, { success: false, message: 'ไม่มีสิทธิ์ในการเปลี่ยนรหัสผ่านของผู้อื่น' });
        }

        const passwordHash = hashPassword(newPassword);

        if (isSupabaseConfigured && supabase) {
            try {
                const { error } = await supabase
                    .from('app_users')
                    .update({ password_hash: passwordHash })
                    .eq('username', targetUsername);

                if (error) {
                    return fail(500, { success: false, message: `ล้มเหลว: ${error.message}` });
                }
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล' });
            }
        } else {
            // Mock DB
            const user = mockDb.appUsers.find(u => u.username === targetUsername);
            if (!user) {
                return fail(404, { success: false, message: 'ไม่พบผู้ใช้ที่ระบุ' });
            }
            user.password_hash = passwordHash;
        }

        return { success: true, message: `เปลี่ยนรหัสผ่านของ "${targetUsername}" เรียบร้อยแล้ว` };
    },

    deleteUser: async ({ request, cookies }) => {
        const currentUser = await getCurrentUser(cookies);
        if (currentUser?.role !== 'admin') {
            return fail(403, { success: false, message: 'ไม่มีสิทธิ์ในการลบผู้ใช้ (เฉพาะ guyssar เท่านั้น)' });
        }

        const data = await request.formData();
        const targetUsername = (data.get('username') as string || '').trim().toLowerCase();

        if (targetUsername?.toLowerCase() === 'guyssar') {
            return fail(400, { success: false, message: 'ไม่สามารถลบบัญชีหลัก guyssar ได้' });
        }

        if (isSupabaseConfigured && supabase) {
            try {
                const { error } = await supabase
                    .from('app_users')
                    .delete()
                    .eq('username', targetUsername);

                if (error) {
                    return fail(500, { success: false, message: `ล้มเหลว: ${error.message}` });
                }
            } catch (err: any) {
                return fail(500, { success: false, message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล' });
            }
        } else {
            // Mock DB
            const index = mockDb.appUsers.findIndex(u => u.username === targetUsername);
            if (index !== -1) {
                mockDb.appUsers.splice(index, 1);
            }
        }

        return { success: true, message: `ลบผู้ใช้งาน "${targetUsername}" เรียบร้อยแล้ว` };
    }
};
