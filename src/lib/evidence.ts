export type EvidenceType = 'eve' | 'cer';

export type Participant = {
    order: number;
    fullName: string;
};

export type EvidenceStatusRow = Participant & {
    key: string;
    eve: boolean;
    cer: boolean;
    eveCount: number;
    cerCount: number;
    eveFiles: any[];
    cerFiles: any[];
};

const NUMBERED_SUFFIX_RE = /\s*\(\d+\)\s*$/;

function normalizeThaiNameCharacters(value: string) {
    return value
        // Unicode normalization reorders Thai combining marks such as ้ + ุ
        // into their canonical order (ุ + ้).
        .normalize('NFC')
        // Two SARA E characters are commonly typed to imitate SARA AE.
        .replace(/\u0E40\u0E40/g, '\u0E41');
}

export function normalizePersonName(value: string | null | undefined) {
    return normalizeThaiNameCharacters(value ?? '')
        .trim()
        .replace(NUMBERED_SUFFIX_RE, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function cleanPersonName(value: string | null | undefined) {
    return normalizeThaiNameCharacters(value ?? '').trim().replace(NUMBERED_SUFFIX_RE, '').replace(/\s+/g, ' ');
}

export function mergeParticipantLists(incoming: Participant[], existing: Participant[]) {
    const merged: Participant[] = [];
    const seen = new Set<string>();

    for (const participant of [...incoming, ...existing]) {
        const fullName = cleanPersonName(participant.fullName);
        const key = normalizePersonName(fullName);
        if (!key || seen.has(key)) continue;

        seen.add(key);
        merged.push({ order: merged.length + 1, fullName });
    }

    return merged;
}

export function parseParticipantList(input: string): Participant[] {
    return input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const withoutLeadingOrder = line.replace(/^\s*\d+[\s.)_-]+/, '').trim();
            return {
                order: index + 1,
                fullName: cleanPersonName(withoutLeadingOrder)
            };
        })
        .filter((p) => p.fullName.length > 0);
}

export function inferEvidenceType(submission: any): EvidenceType | null {
    const source = [
        submission.evidence_type,
        submission.collection_name,
        submission.category,
        submission.file_path
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/\bcer\b|certificate|cert/.test(source)) return 'cer';
    if (/\beve\b|\bewe\b|evidence/.test(source)) return 'eve';
    return null;
}

export function buildEvidenceReport(participants: Participant[], submissions: any[]): EvidenceStatusRow[] {
    const rows = participants.map((participant) => ({
        ...participant,
        key: normalizePersonName(participant.fullName),
        eve: false,
        cer: false,
        eveCount: 0,
        cerCount: 0,
        eveFiles: [] as any[],
        cerFiles: [] as any[]
    }));
    const byName = new Map(rows.map((row) => [row.key, row]));

    for (const submission of submissions) {
        if (submission.is_deleted) continue;
        const type = inferEvidenceType(submission);
        if (!type) continue;

        const key = normalizePersonName(submission.participant_name || submission.name);
        const row = byName.get(key);
        if (!row) continue;

        if (type === 'eve') {
            row.eve = true;
            row.eveCount++;
            row.eveFiles.push(submission);
        } else {
            row.cer = true;
            row.cerCount++;
            row.cerFiles.push(submission);
        }
    }

    return rows;
}

export function findEvidenceForName(name: string, submissions: any[]) {
    const key = normalizePersonName(name);
    const matches = submissions.filter((submission) => {
        if (submission.is_deleted) return false;
        return normalizePersonName(submission.participant_name || submission.name) === key;
    });

    return {
        eve: matches.some((submission) => inferEvidenceType(submission) === 'eve'),
        cer: matches.some((submission) => inferEvidenceType(submission) === 'cer'),
        matches
    };
}
