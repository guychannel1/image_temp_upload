export interface Collection {
    id: string;
    name: string;
    is_active: boolean;
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
}

// In-memory mock database
export let collections: Collection[] = [
    { id: "col-1", name: "ewe", is_active: true },
    { id: "col-2", name: "camp-science", is_active: true },
    { id: "col-3", name: "design-workshop", is_active: false }
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
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%236366f1'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>สมชาย ใจดี</text></svg>"
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
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%2310b981'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>วิภาดา รักเรียน</text></svg>"
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
        img_data: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%' height='100%' fill='%23f59e0b'/><text x='50%' y='50%' font-size='10' fill='white' dominant-baseline='middle' text-anchor='middle'>ปกรณ์ เรียนดี</text></svg>"
    }
];

export function addCollection(name: string, is_active: boolean) {
    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_ก-๙]/g, '-');
    if (collections.some(c => c.name === cleanName)) {
        throw new Error("ชื่อหัวข้อซ้ำ");
    }
    const newCol = { id: 'col-' + Date.now(), name: cleanName, is_active };
    collections.push(newCol);
    return newCol;
}

export function deleteCollection(id: string) {
    const count = submissions.filter(s => s.collection_id === id).length;
    submissions = submissions.filter(s => s.collection_id !== id);
    collections = collections.filter(c => c.id !== id);
}

export function toggleCollection(id: string) {
    const col = collections.find(c => c.id === id);
    if (col) {
        col.is_active = !col.is_active;
    }
}

export function addSubmission(sub: Omit<Submission, 'id'>) {
    const newSub = {
        ...sub,
        id: 'sub-' + Date.now()
    };
    submissions.push(newSub);
    return newSub;
}

export function deleteSubmissions(ids: string[]) {
    const set = new Set(ids);
    submissions = submissions.filter(s => !set.has(s.id));
}
