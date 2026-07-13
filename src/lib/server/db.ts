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

// In-memory mock database users
export let appUsers: AppUser[] = [
    { id: "usr-1", username: "guyssar", role: "admin", password_hash: "d2175b1572d0be3ee4e5e04cf339b6f9946c47d6e4b7615d5bf70618d6cace61" }, // password 'guychannel1' hash
    { id: "usr-2", username: "admin", role: "staff", password_hash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4" }    // password '1234' hash
];

export let appSessions: AppSession[] = [];

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

export function importBackupData(newCols: any[], newSubs: any[]) {
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
}
