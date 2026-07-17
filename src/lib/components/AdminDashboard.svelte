<script lang="ts">
    import { enhance } from '$app/forms';
    import { invalidateAll } from '$app/navigation';
    import { 
        Folder, ArrowUp, Home, Search, Trash2, FolderPlus, Download, 
        Power, ChevronLeft, ChevronRight, HardDrive, FolderGit2,
        RefreshCw, Sidebar, RotateCcw, CloudUpload, User, Lock, CheckSquare, Loader2, MoreVertical
    } from '@lucide/svelte';
    import {
        buildEvidenceReport,
        cleanPersonName,
        inferEvidenceType,
        normalizePersonName,
        parseParticipantList
    } from '$lib/evidence';

    let {
        data = $bindable(),
        MAX_SUBMISSIONS_PER_COLLECTION,
        overQuotaCollections,
        nearQuotaCollections,
        totalStorageMB
    } = $props<{
        data: any;
        MAX_SUBMISSIONS_PER_COLLECTION: number;
        overQuotaCollections: any[];
        nearQuotaCollections: any[];
        totalStorageMB: number;
    }>();

    let isReloading = $state(false);
    let isCollectionsPanelOpen = $state(true);
    let isAddColModalOpen = $state(false);
    let isDownloadZipModalOpen = $state(false);
    let isAdminLightboxOpen = $state(false);
    let isBackingUp = $state(false);
    let isProcessing = $state(false);
    let processingText = $state('');
    let progressPercent = $state(0);

    let progressInterval: any = null;
    function startProcessing(text: string) {
        isProcessing = true;
        processingText = text;
        progressPercent = 0;
        
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(() => {
            progressPercent += (95 - progressPercent) * 0.15;
        }, 100);
    }

    function stopProcessing() {
        if (progressInterval) clearInterval(progressInterval);
        progressPercent = 100;
        setTimeout(() => {
            isProcessing = false;
        }, 400);
    }

    let currentViewerIndex = $state(-1);
    let viewerFiles = $state<{ id: string; name: string; file_path: string; img_data: string; original_size: number }[]>([]);

    let isLoggingIn = $state(false);
    let loginError = $state('');

    let editingLimitId = $state<string | null>(null);
    let editingLimitValue = $state(500);

    function startEditLimit(col: any) {
        editingLimitId = col.id;
        editingLimitValue = col.submission_limit ?? 500;
    }

    let isConfirmModalOpen = $state(false);
    let confirmTitle = $state('');
    let confirmMessage = $state('');
    let confirmAction = $state<(() => void) | null>(null);
    let confirmTheme = $state<'danger' | 'success' | 'info'>('danger');

    // User management states
    let isUserManagementOpen = $state(false);
    let createUsername = $state('');
    let createPassword = $state('');
    let createRole = $state<'admin' | 'staff'>('staff');
    let changePasswordUsername = $state('');
    let changePasswordNewPassword = $state('');
    let adminWorkspaceTab = $state<'overview' | 'participants' | 'attendance' | 'mapping' | 'files'>('overview');
    const initialParticipantText = (data.participants ?? []).map((p: any) => `${p.order}\t${p.fullName}`).join('\n');
    let participantSourceText = $state(initialParticipantText);
    let participantListText = $state(initialParticipantText);
    let participantAddOrder = $state('');
    let participantAddName = $state('');
    let participantPage = $state(1);
    let evidenceSearch = $state('');
    let evidenceFilter = $state<'all' | 'missing' | 'missing-eve' | 'missing-cer' | 'complete'>('all');
    let attendanceSearch = $state('');
    let attendanceDateInput = $state(new Date().toISOString().slice(0, 10));
    let attendanceExtraDates = $state<string[]>([]);
    let attendanceRemovedDates = $state<string[]>([]);
    let attendanceDateRenames = $state<Array<{ from: string; to: string }>>([]);
    let selectedAttendanceDate = $state('all');
    let attendanceDraft = $state<Record<string, boolean>>({});
    let isAttendanceDirty = $state(false);
    let isEvidencePanelOpen = $state(true);
    let mappingDrafts = $state<Record<string, { name: string; evidence_type: 'eve' | 'cer' }>>({});
    let editingSubmission = $state<any | null>(null);
    let editingSubmissionName = $state('');
    let editingSubmissionType = $state<'eve' | 'cer'>('eve');
    const canManageAttendanceDates = $derived(data.username === 'guyssar');

    const workspaceTabs = [
        { id: 'overview', label: 'เช็คหลักฐาน', description: 'สถานะหลักฐาน eve / cer', countLabel: 'รายชื่อ' },
        { id: 'attendance', label: 'เช็คชื่อผู้เข้างาน', description: 'บันทึกเช้า / บ่าย', countLabel: 'วัน' },
        { id: 'participants', label: 'รายชื่อผู้เข้างาน', description: 'นำเข้าและแก้ไขรายชื่อ', countLabel: 'คน' },
        { id: 'mapping', label: 'ไฟล์ที่ต้องตรวจสอบ', description: 'แก้ชื่อหรือชนิดไฟล์', countLabel: 'ไฟล์' },
        { id: 'files', label: 'ไฟล์ทั้งหมด', description: 'เปิดดูและจัดการรูป', countLabel: 'ไฟล์' }
    ] as const;

    function switchWorkspaceTab(tab: typeof adminWorkspaceTab) {
        adminWorkspaceTab = tab;
        if (tab !== 'files') isEvidencePanelOpen = true;
    }

    function workspaceCount(tab: typeof adminWorkspaceTab) {
        if (tab === 'participants') return participantRows.length;
        if (tab === 'attendance') return attendanceDates.length;
        if (tab === 'mapping') return unmatchedEvidenceFiles.length;
        if (tab === 'files') return data.submissions.filter((s: any) => !isDeletedDriveSubmission(s) && !s.is_deleted).length;
        return evidenceStats.total;
    }

    function workspaceTitle(tab: typeof adminWorkspaceTab) {
        if (tab === 'participants') return 'จัดการรายชื่อ';
        if (tab === 'attendance') return 'เช็คชื่อเข้างาน';
        if (tab === 'mapping') return 'ไฟล์ที่ต้องตรวจ';
        if (tab === 'files') return 'ไฟล์ทั้งหมด';
        return 'สรุปการส่งหลักฐาน';
    }

    function workspaceDescription(tab: typeof adminWorkspaceTab) {
        if (tab === 'participants') return 'เพิ่ม แก้ไข นำเข้า XLSX และบันทึกรายชื่อหลักในฐานข้อมูล';
        if (tab === 'attendance') return 'เลือกวันที่ที่สร้างไว้หรือเพิ่มวันใหม่ แล้วบันทึกเฉพาะรายการที่เปลี่ยน';
        if (tab === 'mapping') return 'ตรวจไฟล์ที่ชื่อไม่ตรงฐานข้อมูลหรือโฟลเดอร์ไม่ชัดเจน';
        if (tab === 'files') return 'เปิดดูไฟล์ตามหัวข้อและจัดการรูปที่ส่งเข้ามา';
        return 'รวมทุกกลุ่มเป็น eve / cer และนับชื่อที่ลงท้าย (1)(2)(3) เป็นคนเดียวกัน';
    }

    function showConfirm(title: string, message: string, action: () => void, theme: 'danger' | 'success' | 'info' = 'danger') {
        confirmTitle = title;
        confirmMessage = message;
        confirmAction = () => {
            action();
            closeConfirmModal();
        };
        confirmTheme = theme;
        isConfirmModalOpen = true;
    }

    function closeConfirmModal() {
        isConfirmModalOpen = false;
    }

    // Toasts (passed via showToast from parent or local)
    let toasts = $state<{ id: number; title: string; desc: string; type: 'success' | 'error' }[]>([]);
    function showToast(title: string, desc: string, type: 'success' | 'error' = 'success') {
        const id = Date.now();
        toasts = [...toasts, { id, title, desc, type }];
        setTimeout(() => {
            toasts = toasts.filter(t => t.id !== id);
        }, 3000);
    }

    function formatBackupMessage(message: string) {
        return message
            .replace(/Cloudflare\s+R2/gi, 'ระบบสำรองข้อมูล')
            .replace(/\bR2\b/g, 'ระบบสำรองข้อมูล')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    async function reloadData() {
        if (isReloading) return;
        isReloading = true;
        try {
            const { invalidateAll } = await import('$app/navigation');
            await invalidateAll();
            showToast('รีโหลดสำเร็จ', 'อัพเดตข้อมูลล่าสุดเรียบร้อย', 'success');
        } catch (e) {
            showToast('ล้มเหลว', 'เกิดข้อผิดพลาดในการดึงข้อมูล', 'error');
        } finally {
            isReloading = false;
        }
    }

    // ─── Explorer ─────────────────────────────────────────────────────────────
    let currentExplorerPath = $state<string[]>([]);
    let searchExplorerQuery = $state('');
    let selectedExplorerIds = $state<Set<string>>(new Set());

    let explorerItems = $derived.by(() => {
        const searchLower = searchExplorerQuery.trim().toLowerCase();

        if (!searchLower) {
            if (currentExplorerPath.length === 0) {
                return data.collections.map((col: any) => {
                    const subCount = data.submissions.filter((s: any) => s.collection_id === col.id).length;
                    return {
                        type: 'folder',
                        id: col.id,
                        name: col.name,
                        subText: `${subCount} รูปภาพ`,
                        colorClass: col.id === 'deleted-drive' ? 'text-rose-500' : (col.name.endsWith('_deleted') ? 'text-zinc-600' : 'text-amber-500'),
                        onClick: () => navigateToPath([col.name])
                    };
                });
            } else if (currentExplorerPath.length === 1) {
                const colName = currentExplorerPath[0];
                const colObj = data.collections.find((c: any) => c.name === colName);
                if (!colObj) return [];
                if (colObj.id === 'deleted-drive') {
                    return data.submissions
                        .filter((s: any) => s.collection_id === 'deleted-drive')
                        .map((sub: any) => ({
                            type: 'file',
                            id: sub.id,
                            name: sub.name,
                            subText: formatBytes(sub.file_size),
                            original_size: sub.original_size,
                            file_path: sub.file_path,
                            img_data: sub.img_data
                        }));
                }
                return data.submissions
                    .filter((s: any) => s.collection_id === colObj.id)
                    .map((sub: any) => ({
                        type: 'file',
                        id: sub.id,
                        name: sub.name,
                        subText: formatBytes(sub.file_size),
                        original_size: sub.original_size,
                        file_path: sub.file_path,
                        img_data: sub.img_data
                    }));
            }
        }

        // Search mode
        const items: any[] = [];
        let targetCols = data.collections;
        if (currentExplorerPath.length >= 1) {
            targetCols = data.collections.filter((c: any) => c.name === currentExplorerPath[0]);
        }
        if (currentExplorerPath.length === 0) {
            for (const col of targetCols) {
                if (col.name.toLowerCase().includes(searchLower)) {
                    const subCount = data.submissions.filter((s: any) => s.collection_id === col.id).length;
                    items.push({
                        type: 'folder',
                        id: col.id,
                        name: col.name,
                        subText: `โฟลเดอร์หลัก | ${subCount} รูป`,
                        colorClass: 'text-amber-500',
                        onClick: () => { searchExplorerQuery = ''; navigateToPath([col.name]); }
                    });
                }
            }
        }
        for (const col of targetCols) {
            let colSubmissions = data.submissions.filter((s: any) => s.collection_id === col.id);
            for (const sub of colSubmissions) {
                if (sub.name.toLowerCase().includes(searchLower)) {
                    items.push({
                        type: 'file',
                        id: sub.id,
                        name: sub.name,
                        subText: `${sub.collection_name} | ${formatBytes(sub.file_size)}`,
                        original_size: sub.original_size,
                        file_path: sub.file_path,
                        img_data: sub.img_data
                    });
                }
            }
        }
        return items;
    });

    function navigateToPath(path: string[]) {
        currentExplorerPath = path;
        selectedExplorerIds.clear();
        searchExplorerQuery = '';
    }

    function navigateUp() {
        if (currentExplorerPath.length > 0) {
            navigateToPath(currentExplorerPath.slice(0, -1));
        }
    }

    function toggleSelectFile(id: string, event: Event) {
        event.stopPropagation();
        if (selectedExplorerIds.has(id)) {
            selectedExplorerIds.delete(id);
        } else {
            selectedExplorerIds.add(id);
        }
        selectedExplorerIds = new Set(selectedExplorerIds);
    }

    let hasVisibleFiles = $derived(explorerItems.some((item: any) => item.type === 'file'));
    let isAllSelected = $derived(
        hasVisibleFiles && explorerItems.filter((item: any) => item.type === 'file').every((item: any) => selectedExplorerIds.has(item.id))
    );

    function toggleSelectAll() {
        const visibleFiles = explorerItems.filter((item: any) => item.type === 'file');
        if (visibleFiles.length === 0) return;
        
        const allSelected = visibleFiles.every((item: any) => selectedExplorerIds.has(item.id));
        if (allSelected) {
            // Deselect all visible files
            visibleFiles.forEach((item: any) => selectedExplorerIds.delete(item.id));
        } else {
            // Select all visible files
            visibleFiles.forEach((item: any) => selectedExplorerIds.add(item.id));
        }
        selectedExplorerIds = new Set(selectedExplorerIds);
    }

    function openAdminLightbox(fileId: string) {
        viewerFiles = explorerItems
            .filter((item: any) => item.type === 'file')
            .map((item: any) => ({
                id: item.id,
                name: item.name,
                file_path: item.file_path,
                img_data: item.img_data,
                original_size: item.original_size
            }));
        currentViewerIndex = viewerFiles.findIndex(f => f.id === fileId);
        if (currentViewerIndex !== -1) isAdminLightboxOpen = true;
    }

    function prevImage() { if (currentViewerIndex > 0) currentViewerIndex--; }
    function nextImage() { if (currentViewerIndex < viewerFiles.length - 1) currentViewerIndex++; }

    function handleKeydown(e: KeyboardEvent) {
        if (!isAdminLightboxOpen) return;
        if (e.key === 'ArrowLeft') prevImage();
        if (e.key === 'ArrowRight') nextImage();
        if (e.key === 'Escape') isAdminLightboxOpen = false;
    }

    // ─── ZIP Download ──────────────────────────────────────────────────────────
    const ZIP_DOWNLOAD_CONCURRENCY = 5;

    function getDownloadableImageUrl(submission: any) {
        const imageUrl = submission.img_data || submission.img_url || '';
        const params = new URLSearchParams();
        if (submission.file_path) params.set('path', submission.file_path);
        if (imageUrl) params.set('url', imageUrl);

        if (params.size > 0 && (submission.file_path || imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
            return `/api/image-proxy?${params.toString()}`;
        }
        return imageUrl;
    }

    async function fetchImageBlob(submission: any): Promise<Blob> {
        const res = await fetch(getDownloadableImageUrl(submission));
        if (!res.ok) {
            throw new Error(`Image fetch failed: ${res.status}`);
        }
        return res.blob();
    }

    async function convertToJpegBlob(imageSource: string): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 600;
                canvas.height = img.naturalHeight || 600;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('Canvas 2D context error')); return; }
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob empty'));
                }, 'image/jpeg', 0.9);
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = imageSource;
        });
    }

    async function convertBlobToJpegBlob(blob: Blob): Promise<Blob> {
        const objectUrl = URL.createObjectURL(blob);
        try {
            return await convertToJpegBlob(objectUrl);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    function isHeicImage(submission: any, blob?: Blob) {
        const contentType = blob?.type?.toLowerCase() || '';
        if (contentType.includes('heic') || contentType.includes('heif')) return true;

        const source = submission.file_path || submission.img_data || submission.img_url || '';
        return /\.(heic|heif)(\?|$)/i.test(source);
    }

    async function convertHeicBlobToJpegBlob(blob: Blob): Promise<Blob> {
        const heic2any = (await import('heic2any')).default;
        const converted = await heic2any({
            blob,
            toType: 'image/jpeg',
            quality: 0.9
        });
        return Array.isArray(converted) ? converted[0] : converted;
    }

    function getOriginalImageExtension(submission: any, blob: Blob) {
        const contentType = blob.type.toLowerCase();
        if (contentType.includes('png')) return 'png';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('avif')) return 'avif';
        if (contentType.includes('heic') || contentType.includes('heif')) return 'heic';

        const source = submission.file_path || submission.img_data || submission.img_url || '';
        const match = source.split('?')[0].match(/\.([a-z0-9]+)$/i);
        return match?.[1]?.toLowerCase() || 'jpg';
    }

    async function getZipImageBlob(submission: any): Promise<{ blob: Blob; extension: string }> {
        const imageUrl = submission.img_data || submission.img_url || '';
        if (imageUrl.startsWith('data:')) {
            return { blob: await convertToJpegBlob(imageUrl), extension: 'jpg' };
        }

        const originalBlob = await fetchImageBlob(submission);
        if (isHeicImage(submission, originalBlob)) {
            return { blob: await convertHeicBlobToJpegBlob(originalBlob), extension: 'jpg' };
        }

        try {
            return { blob: await convertBlobToJpegBlob(originalBlob), extension: 'jpg' };
        } catch (e) {
            console.error('Blob conversion failed, adding original image bytes', e);
            return { blob: originalBlob, extension: getOriginalImageExtension(submission, originalBlob) };
        }
    }

    function isDeletedDriveSubmission(submission: any) {
        return submission.collection_id === 'deleted-drive' || submission.collection_name === 'deleted-drive';
    }

    function safeFileName(value: string) {
        return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
    }

    function numberedNameSuffix(value: string | null | undefined) {
        const match = (value ?? '').trim().match(/\((\d+)\)\s*$/);
        return match ? `_${match[1]}` : '';
    }

    function formatEvidenceZipName(folder: string, order: number | string, fullName: string, duplicateSuffix = '') {
        const orderText = typeof order === 'number' ? String(order).padStart(3, '0') : safeFileName(order).replace(/[^a-z0-9ก-๙_-]+/gi, '');
        return `${safeFileName(folder)}_${orderText}_${safeFileName(fullName)}${duplicateSuffix}.jpg`;
    }

    async function packZipSubmissions(zip: any, submissions: any[]) {
        let nextIndex = 0;
        let completedFiles = 0;
        let addedFiles = 0;
        const orderedSubmissions = submissions.map((sub, index) => ({ sub, order: index + 1 }));

        async function worker() {
            while (nextIndex < orderedSubmissions.length) {
                const { sub, order } = orderedSubmissions[nextIndex++];
                try {
                    const image = await getZipImageBlob(sub);
                    const folder = sub.collection_name || 'folder';
                    const zipPath = `${safeFileName(folder)}/${formatEvidenceZipName(folder, order, cleanPersonName(sub.name), numberedNameSuffix(sub.name))}`;
                    zip.file(zipPath, image.blob, { compression: 'STORE' });
                    addedFiles++;
                } catch (e) {
                    console.error('Image download failed for', sub.name, e);
                } finally {
                    completedFiles++;
                    progressPercent = Math.max(progressPercent, Math.round((completedFiles / submissions.length) * 90));
                    processingText = `กำลังแพคไฟล์ ${completedFiles}/${submissions.length}`;
                }
            }
        }

        const workers = Array.from(
            { length: Math.min(ZIP_DOWNLOAD_CONCURRENCY, submissions.length) },
            () => worker()
        );
        await Promise.all(workers);
        return addedFiles;
    }

    async function handleZipDownload(scope: 'all' | 'folder') {
        if (isProcessing) return;
        isDownloadZipModalOpen = false;
        startProcessing('กำลังแพคไฟล์ ZIP กรุณารอสักครู่...');
        showToast('กำลังจัดเตรียมไฟล์ ZIP', 'เริ่มการโหลดรูปภาพทั้งหมดเป็น JPEG กลายทาง...', 'success');

        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            let targetSubmissions = data.submissions.filter((s: any) => !isDeletedDriveSubmission(s));
            let zipNamePrefix = 'all';

            if (scope === 'folder') {
                if (currentExplorerPath.length === 1) {
                    const colName = currentExplorerPath[0];
                    targetSubmissions = data.submissions.filter((s: any) => s.collection_name === colName && !isDeletedDriveSubmission(s));
                    zipNamePrefix = `drive-${colName}`;
                } else if (selectedExplorerIds.size > 0) {
                    targetSubmissions = data.submissions.filter((s: any) => selectedExplorerIds.has(s.id) && !isDeletedDriveSubmission(s));
                    zipNamePrefix = 'selected-files';
                }
            }

            if (targetSubmissions.length === 0) {
                showToast('ไม่มีไฟล์', 'ไม่มีไฟล์ในขอบเขตที่เลือกการดาวน์โหลดที่เลือก', 'error');
                return;
            }

            const addedFiles = await packZipSubmissions(zip, targetSubmissions);

            if (addedFiles === 0) {
                showToast('ดาวน์โหลด ZIP ล้มเหลว', 'ไม่สามารถโหลดรูปภาพสำหรับแพค ZIP ได้', 'error');
                return;
            }

            processingText = 'กำลังสร้างไฟล์ ZIP...';
            const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            const zipName = `temp-export-${zipNamePrefix}-${Date.now()}.zip`;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast('ดาวน์โหลด ZIP สำเร็จ', `สร้างไฟล์ ${zipName} และโหลดเป็น JPEG แล้ว`, 'success');
        } catch (err) {
            console.error(err);
            showToast('เกิดข้อผิดพลาด', 'ไม่สามารถสีกอัด ZIP ได้', 'error');
        } finally {
            stopProcessing();
        }
    }

    async function downloadFolderZipDirect(colName: string, event: Event) {
        event.stopPropagation();
        if (isProcessing) return;
        if (colName === 'deleted-drive') {
            showToast('ไม่สามารถดาวน์โหลดได้', 'Deleted drive ถูกข้ามจากการดาวน์โหลด ZIP', 'error');
            return;
        }
        startProcessing(`กำลังแพคไฟล์ ZIP สำหรับ /${colName}...`);
        showToast('ดาวน์โหลดด่วน', `กำลังจัดเตรียมไฟล์โฟลเดอร์ /${colName} เป็น JPEG...`, 'success');
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            const targetSubmissions = data.submissions.filter((s: any) => s.collection_name === colName && !isDeletedDriveSubmission(s));
            if (targetSubmissions.length === 0) {
                showToast('ว่างเปล่า', `ไม่มีรูปภาพในโฟลเดอร์ /${colName}`, 'error');
                return;
            }
            const addedFiles = await packZipSubmissions(zip, targetSubmissions);
            if (addedFiles === 0) {
                showToast('ดาวน์โหลดล้มเหลว', 'ไม่สามารถโหลดรูปภาพสำหรับแพค ZIP ได้', 'error');
                return;
            }
            processingText = 'กำลังสร้างไฟล์ ZIP...';
            const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `temp-export-drive-${colName}-${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('ดาวน์โหลดด่วนสำเร็จ', `โฟลเดอร์ /${colName} ถูกดาวน์โหลดเสร็จสิ้น`, 'success');
        } catch (e) {
            showToast('ดาวน์โหลดล้มเหลว', 'เกิดข้อผิดพลาดในการโหลดไฟล์', 'error');
        } finally {
            stopProcessing();
        }
    }

    function downloadSingleImage(fileId: string, event: Event) {
        event.stopPropagation();
        const file = data.submissions.find((s: any) => s.id === fileId);
        if (!file) return;
        const link = document.createElement('a');
        link.href = file.img_data;
        link.download = `${file.name}.avif`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('ดาวน์โหลดไฟล์เดียว', `ดาวน์โหลดภาพ ${file.name} สำเร็จ`, 'success');
    }

    // ─── Derived ───────────────────────────────────────────────────────────────
    function fallbackParticipantsFromSubmissions() {
        const names = new Map<string, string>();
        for (const submission of data.submissions.filter((s: any) => !isDeletedDriveSubmission(s) && !s.is_deleted)) {
            const cleanName = cleanPersonName(submission.name);
            const key = normalizePersonName(cleanName);
            if (key && !names.has(key)) names.set(key, cleanName);
        }
        return [...names.values()].sort((a, b) => a.localeCompare(b, 'th')).map((fullName, index) => ({
            order: index + 1,
            fullName
        }));
    }

    const participantRows = $derived.by(() => {
        const databaseRows = (data.participants ?? [])
            .map((p: any, index: number) => ({
                order: Number(p.order ?? index + 1),
                fullName: cleanPersonName(p.fullName ?? p.full_name ?? p.name)
            }))
            .filter((p: any) => p.fullName.length > 0);
        if (databaseRows.length > 0) return databaseRows;

        const parsed = parseParticipantList(participantListText);
        return parsed.length > 0 ? parsed : fallbackParticipantsFromSubmissions();
    });

    const PARTICIPANT_PAGE_SIZE = 20;
    const participantPageCount = $derived.by(() => Math.max(1, Math.ceil(participantRows.length / PARTICIPANT_PAGE_SIZE)));
    const participantPageRows = $derived.by(() => {
        const start = (participantPage - 1) * PARTICIPANT_PAGE_SIZE;
        return participantRows.slice(start, start + PARTICIPANT_PAGE_SIZE);
    });
    const participantPageStart = $derived.by(() => participantRows.length === 0 ? 0 : (participantPage - 1) * PARTICIPANT_PAGE_SIZE + 1);
    const participantPageEnd = $derived.by(() => Math.min(participantPage * PARTICIPANT_PAGE_SIZE, participantRows.length));

    $effect(() => {
        if (participantPage > participantPageCount) participantPage = participantPageCount;
        if (participantPage < 1) participantPage = 1;
    });

    function buildFullEvidenceReportRows(): any[] {
        const rows: any[] = buildEvidenceReport(participantRows, data.submissions);
        const participantKeys = new Set(rows.map((row: any) => row.key));
        const unlistedRows = new Map<string, any>();

        for (const submission of data.submissions) {
            if (isDeletedDriveSubmission(submission) || submission.is_deleted) continue;
            const type = inferEvidenceType(submission);
            if (!type) continue;

            const fullName = cleanPersonName(submission.participant_name || submission.name);
            const key = normalizePersonName(fullName);
            if (!key || participantKeys.has(key)) continue;

            if (!unlistedRows.has(key)) {
                unlistedRows.set(key, {
                    order: 'N/A',
                    fullName,
                    key: `unlisted-${key}`,
                    eve: false,
                    cer: false,
                    eveCount: 0,
                    cerCount: 0,
                    eveFiles: [],
                    cerFiles: [],
                    isUnlisted: true
                });
            }

            const row = unlistedRows.get(key);
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

        return [...rows, ...unlistedRows.values()].map((row: any, index: number) => ({
            ...row,
            sortIndex: typeof row.order === 'number' ? row.order : participantRows.length + index + 1
        }));
    }

    const allEvidenceReportRows = $derived.by((): any[] => buildFullEvidenceReportRows());

    const evidenceReportRows = $derived.by(() => {
        const rows = allEvidenceReportRows;
        const query = evidenceSearch.trim().toLowerCase();
        return rows.filter((row: any) => {
            if (query && !row.fullName.toLowerCase().includes(query) && !String(row.order).includes(query)) return false;
            if (evidenceFilter === 'missing') return !row.eve || !row.cer;
            if (evidenceFilter === 'missing-eve') return !row.eve;
            if (evidenceFilter === 'missing-cer') return !row.cer;
            if (evidenceFilter === 'complete') return row.eve && row.cer;
            return true;
        });
    });

    const evidenceStats = $derived.by(() => {
        const rows = allEvidenceReportRows;
        return {
            total: rows.length,
            complete: rows.filter((row: any) => row.eve && row.cer).length,
            submittedEve: rows.filter((row: any) => row.eve).length,
            submittedCer: rows.filter((row: any) => row.cer).length,
            missingEve: rows.filter((row: any) => !row.eve).length,
            missingCer: rows.filter((row: any) => !row.cer).length
        };
    });

    function attendanceKey(name: string, date: string, period: 'morning' | 'afternoon') {
        return `${normalizePersonName(name)}|${date}|${period}`;
    }

    const savedAttendanceDraft = $derived.by(() => {
        const saved: Record<string, boolean> = {};
        for (const record of data.attendanceRecords ?? []) {
            const period = record.period === 'afternoon' ? 'afternoon' : 'morning';
            saved[attendanceKey(record.participant_name, String(record.attendance_date).slice(0, 10), period)] = !!record.is_present;
        }
        return saved;
    });

    function attendanceCheckboxClass(name: string, date: string, period: 'morning' | 'afternoon') {
        const key = attendanceKey(name, date, period);
        const isChecked = !!attendanceDraft[key];
        const isSavedChecked = !!savedAttendanceDraft[key];
        const checkedColor = isChecked && !isSavedChecked
            ? 'text-sky-600 accent-sky-500 focus:ring-sky-500'
            : 'text-emerald-600 accent-emerald-500 focus:ring-emerald-500';

        return `h-5 w-5 rounded border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 ${checkedColor}`;
    }

    const attendanceDates = $derived.by(() => {
        const dates = new Set<string>();
        const removedDates = new Set(attendanceRemovedDates);
        for (const session of data.attendanceSessions ?? []) {
            const date = String(session.session_date ?? '').slice(0, 10);
            if (date && !removedDates.has(date)) dates.add(date);
        }
        for (const record of data.attendanceRecords ?? []) {
            const date = String(record.attendance_date ?? '').slice(0, 10);
            if (date && !removedDates.has(date)) dates.add(date);
        }
        for (const date of attendanceExtraDates) {
            if (date && !removedDates.has(date)) dates.add(date);
        }
        return Array.from(dates).sort();
    });

    const visibleAttendanceDates = $derived.by(() => {
        if (selectedAttendanceDate === 'all') return attendanceDates;
        if (selectedAttendanceDate && attendanceDates.includes(selectedAttendanceDate)) return [selectedAttendanceDate];
        return attendanceDates;
    });

    $effect(() => {
        if (isAttendanceDirty) return;
        attendanceDraft = { ...savedAttendanceDraft };
    });

    $effect(() => {
        if (attendanceDates.length === 0) {
            selectedAttendanceDate = 'all';
            return;
        }
        if (selectedAttendanceDate !== 'all' && !attendanceDates.includes(selectedAttendanceDate)) {
            selectedAttendanceDate = 'all';
        }
    });

    const attendanceRows = $derived.by(() => {
        const query = attendanceSearch.trim().toLowerCase();
        return participantRows.filter((row: any) => {
            if (!query) return true;
            return row.fullName.toLowerCase().includes(query) || String(row.order).includes(query);
        });
    });

    function savedAttendanceValue(name: string, date: string, period: 'morning' | 'afternoon') {
        const renamedDate = attendanceDateRenames.find((rename) => rename.to === date)?.from ?? date;
        return !!savedAttendanceDraft[attendanceKey(name, renamedDate, period)];
    }

    function isSavedAttendanceDate(date: string) {
        return (data.attendanceSessions ?? []).some((session: any) => String(session.session_date ?? '').slice(0, 10) === date)
            || (data.attendanceRecords ?? []).some((record: any) => String(record.attendance_date ?? '').slice(0, 10) === date);
    }

    function isNewAttendanceDate(date: string) {
        return attendanceExtraDates.includes(date) && !isSavedAttendanceDate(date);
    }

    function attendanceConflictRows(rows: Array<{
        participant_name: string;
        attendance_date: string;
        period: 'morning' | 'afternoon';
        previous_is_present?: boolean;
    }>) {
        return rows.filter((row) => {
            if (typeof row.previous_is_present !== 'boolean') return false;
            if (isNewAttendanceDate(row.attendance_date)) return false;
            return savedAttendanceValue(row.participant_name, row.attendance_date, row.period) !== row.previous_is_present;
        });
    }

    const attendancePayload = $derived.by(() => JSON.stringify(
        participantRows.flatMap((participant: any) => attendanceDates.flatMap((date: string) => {
            const periods: Array<'morning' | 'afternoon'> = ['morning', 'afternoon'];
            return periods
                .map((period) => ({
                    participant_name: participant.fullName,
                    attendance_date: date,
                    period,
                    is_present: !!attendanceDraft[attendanceKey(participant.fullName, date, period)],
                    previous_is_present: savedAttendanceValue(participant.fullName, date, period)
                }))
                .filter((row) => isNewAttendanceDate(date) || row.is_present !== savedAttendanceValue(participant.fullName, date, row.period));
        }))
    ));

    const attendanceDateRenamesPayload = $derived.by(() => JSON.stringify(attendanceDateRenames));
    const attendanceDeletedDatesPayload = $derived.by(() => JSON.stringify(
        attendanceRemovedDates.filter((date) => isSavedAttendanceDate(date))
    ));

    const attendanceStats = $derived.by(() => {
        const totalSlots = participantRows.length * attendanceDates.length * 2;
        const presentSlots = participantRows.reduce((count: number, participant: any) => {
            return count + attendanceDates.reduce((dateCount: number, date: string) => {
                return dateCount
                    + (attendanceDraft[attendanceKey(participant.fullName, date, 'morning')] ? 1 : 0)
                    + (attendanceDraft[attendanceKey(participant.fullName, date, 'afternoon')] ? 1 : 0);
            }, 0);
        }, 0);
        return {
            totalSlots,
            presentSlots,
            missingSlots: totalSlots - presentSlots
        };
    });

    const selectedAttendanceSummary = $derived.by(() => {
        const date = selectedAttendanceDate !== 'all' && attendanceDates.includes(selectedAttendanceDate)
            ? selectedAttendanceDate
            : visibleAttendanceDates[0] ?? '';
        const morningPresent: any[] = [];
        const afternoonPresent: any[] = [];
        const fullDayPresent: any[] = [];
        const incomplete: any[] = [];

        if (!date) {
            return { date, morningPresent, afternoonPresent, fullDayPresent, incomplete };
        }

        for (const participant of participantRows) {
            const morning = !!attendanceDraft[attendanceKey(participant.fullName, date, 'morning')];
            const afternoon = !!attendanceDraft[attendanceKey(participant.fullName, date, 'afternoon')];
            if (morning) morningPresent.push(participant);
            if (afternoon) afternoonPresent.push(participant);
            if (morning && afternoon) fullDayPresent.push(participant);
            if (!morning || !afternoon) incomplete.push(participant);
        }

        return { date, morningPresent, afternoonPresent, fullDayPresent, incomplete };
    });

    function setAttendance(name: string, date: string, period: 'morning' | 'afternoon', value: boolean) {
        isAttendanceDirty = true;
        attendanceDraft = {
            ...attendanceDraft,
            [attendanceKey(name, date, period)]: value
        };
    }

    function addAttendanceDate() {
        if (!canManageAttendanceDates) {
            showToast('ไม่มีสิทธิ์เพิ่มวันที่', 'เฉพาะ guyssar เท่านั้นที่เพิ่มวันที่เช็คได้', 'error');
            return;
        }
        if (!attendanceDateInput || attendanceDates.includes(attendanceDateInput)) return;
        isAttendanceDirty = true;
        attendanceExtraDates = [...attendanceExtraDates, attendanceDateInput];
    }

    function removeAttendanceDate(date: string) {
        if (!canManageAttendanceDates) {
            showToast('ไม่มีสิทธิ์ลบวันที่', 'เฉพาะ guyssar เท่านั้นที่ลบวันที่เช็คได้', 'error');
            return;
        }
        isAttendanceDirty = true;
        attendanceExtraDates = attendanceExtraDates.filter((extraDate) => extraDate !== date);
        if (isSavedAttendanceDate(date)) {
            attendanceRemovedDates = Array.from(new Set([...attendanceRemovedDates, date]));
        }

        const nextDraft: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(attendanceDraft)) {
            const parts = key.split('|');
            if (parts.length === 3 && parts[1] === date) continue;
            nextDraft[key] = value;
        }
        attendanceDraft = nextDraft;
        attendanceDateRenames = attendanceDateRenames.filter((rename) => rename.from !== date && rename.to !== date);
    }

    function replaceAttendanceDraftDate(oldDate: string, newDate: string) {
        const nextDraft: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(attendanceDraft)) {
            const parts = key.split('|');
            if (parts.length !== 3 || parts[1] !== oldDate) {
                nextDraft[key] = value;
                continue;
            }

            const nextKey = `${parts[0]}|${newDate}|${parts[2]}`;
            nextDraft[nextKey] = nextDraft[nextKey] || value;
        }
        attendanceDraft = nextDraft;
    }

    function updateAttendanceDate(oldDate: string, newDate: string) {
        if (!canManageAttendanceDates) {
            showToast('ไม่มีสิทธิ์แก้วันที่', 'เฉพาะ guyssar เท่านั้นที่แก้วันที่เช็คได้', 'error');
            return;
        }
        if (!newDate || newDate === oldDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
        if (attendanceDates.includes(newDate)) {
            showToast('วันที่ซ้ำ', 'มีวันที่นี้อยู่แล้ว', 'error');
            return;
        }

        const existingRename = attendanceDateRenames.find((rename) => rename.to === oldDate || rename.from === oldDate);
        const sourceDate = existingRename?.from ?? oldDate;
        isAttendanceDirty = true;
        replaceAttendanceDraftDate(oldDate, newDate);
        attendanceRemovedDates = Array.from(new Set([...attendanceRemovedDates, sourceDate, oldDate])).filter((date) => date !== newDate);
        attendanceExtraDates = Array.from(new Set(attendanceExtraDates.map((date) => date === oldDate ? newDate : date).concat(newDate))).filter((date) => date !== oldDate);
        attendanceDateRenames = [
            ...attendanceDateRenames.filter((rename) => rename.from !== sourceDate && rename.to !== oldDate && rename.from !== oldDate),
            { from: sourceDate, to: newDate }
        ];
    }

    function openNativeDatePicker(event: Event) {
        const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
        input.showPicker?.();
    }

    const unmatchedEvidenceFiles = $derived.by(() => {
        const participantKeys = new Set(participantRows.map((p: any) => normalizePersonName(p.fullName)));
        return data.submissions
            .filter((submission: any) => !isDeletedDriveSubmission(submission) && !submission.is_deleted)
            .filter((submission: any) => {
                const hasType = !!inferEvidenceType(submission);
                const hasParticipant = participantKeys.has(normalizePersonName(submission.name));
                return !hasType || !hasParticipant;
            });
    });

    function getMappingDraft(file: any) {
        return mappingDrafts[file.id] ?? {
            name: cleanPersonName(file.name),
            evidence_type: (inferEvidenceType(file) ?? 'eve') as 'eve' | 'cer'
        };
    }

    function updateMappingDraft(file: any, patch: Partial<{ name: string; evidence_type: 'eve' | 'cer' }>) {
        mappingDrafts = {
            ...mappingDrafts,
            [file.id]: {
                ...getMappingDraft(file),
                ...patch
            }
        };
    }

    function openSubmissionMappingEditor(file: any, event?: Event) {
        event?.stopPropagation();
        editingSubmission = file;
        editingSubmissionName = cleanPersonName(file.name);
        editingSubmissionType = (inferEvidenceType(file) ?? 'eve') as 'eve' | 'cer';
    }

    function printUnmatchedEvidenceFiles() {
        const rows = unmatchedEvidenceFiles.map((file: any, index: number) => ({
            index: index + 1,
            name: cleanPersonName(file.name),
            folder: inferEvidenceType(file) ?? file.collection_name ?? '-',
            path: file.file_path ?? ''
        }));
        const html = `
            <html>
                <head>
                    <title>unmatched-evidence-files</title>
                    <style>
                        body { font-family: sans-serif; padding: 24px; color: #111827; }
                        h1 { font-size: 18px; margin: 0 0 12px; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
                        th { background: #f3f4f6; }
                    </style>
                </head>
                <body>
                    <h1>รายชื่อ/ไฟล์ที่หา mapping ไม่เจอ (${rows.length})</h1>
                    <table>
                        <thead><tr><th>#</th><th>ชื่อ</th><th>folder</th><th>path</th></tr></thead>
                        <tbody>
                            ${rows.map((row: { index: number; name: string; folder: string; path: string }) => `<tr><td>${row.index}</td><td>${row.name}</td><td>${row.folder}</td><td>${row.path}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </body>
            </html>
        `;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
    }

    const mappingDraftPayload = $derived.by(() => {
        return JSON.stringify(unmatchedEvidenceFiles.map((file: any) => ({
            id: file.id,
            ...getMappingDraft(file)
        })));
    });

    function statusMark(value: boolean) {
        return value ? '1' : '-';
    }

    function escapeHtml(value: unknown) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    $effect(() => {
        const latest = (data.participants ?? []).map((p: any) => `${p.order}\t${p.fullName}`).join('\n');
        if (latest !== participantSourceText) {
            participantSourceText = latest;
            participantListText = latest;
        }
    });

    function participantActionEnhance(successTitle: string, processingTitle: string) {
        startProcessing(processingTitle);
        return async ({ result, update }: any) => {
            stopProcessing();
            if (result.type === 'success') {
                showToast(successTitle, (result.data as any)?.message ?? 'อัปเดตรายชื่อเรียบร้อยแล้ว', 'success');
                participantAddOrder = '';
                participantAddName = '';
            } else {
                showToast('อัปเดตรายชื่อไม่สำเร็จ', (result.data as any)?.message ?? 'เกิดข้อผิดพลาด', 'error');
            }
            await update();
        };
    }

    function escapeXml(value: unknown) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function xlsxTextCell(ref: string, value: unknown, style = 0) {
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    }

    function xlsxNumberCell(ref: string, value: number, style = 0) {
        return `<c r="${ref}" s="${style}" t="n"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
    }

    function xlsxColumnName(index: number) {
        let name = '';
        let current = index;
        while (current > 0) {
            const mod = (current - 1) % 26;
            name = String.fromCharCode(65 + mod) + name;
            current = Math.floor((current - mod) / 26);
        }
        return name;
    }

    function buildEvidenceWorksheetXml(rows: any[]) {
        const bodyRows = rows.map((row, index) => {
            const excelRow = index + 2;
            return `<row r="${excelRow}">
                ${typeof row.order === 'number' ? xlsxNumberCell(`A${excelRow}`, row.order, 2) : xlsxTextCell(`A${excelRow}`, row.order, 2)}
                ${xlsxTextCell(`B${excelRow}`, row.fullName, 3)}
                ${xlsxTextCell(`C${excelRow}`, statusMark(row.eve), row.eve ? 4 : 5)}
                ${xlsxTextCell(`D${excelRow}`, statusMark(row.cer), row.cer ? 4 : 5)}
            </row>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>
        <col min="1" max="1" width="8" customWidth="1"/>
        <col min="2" max="2" width="32" customWidth="1"/>
        <col min="3" max="4" width="10" customWidth="1"/>
    </cols>
    <sheetData>
        <row r="1" ht="19.5" customHeight="1">
            ${xlsxTextCell('A1', 'ลำดับ', 1)}
            ${xlsxTextCell('B1', 'ชื่อ-นามสกุล', 1)}
            ${xlsxTextCell('C1', 'ewe', 1)}
            ${xlsxTextCell('D1', 'cer', 1)}
        </row>
        ${bodyRows}
    </sheetData>
    <autoFilter ref="A1:D${rows.length + 1}"/>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildSummaryWorksheetXml(rows: any[]) {
        const total = rows.length;
        const submittedEwe = rows.filter((row) => row.eve).length;
        const submittedCer = rows.filter((row) => row.cer).length;
        const submittedAny = rows.filter((row) => row.eve || row.cer).length;
        const submittedAll = rows.filter((row) => row.eve && row.cer).length;
        const submittedNone = rows.filter((row) => !row.eve && !row.cer).length;
        const summaryRows = [
            ['จำนวนรายชื่อทั้งหมด', total],
            ['ส่ง ewe แล้ว', submittedEwe],
            ['ส่ง cer แล้ว', submittedCer],
            ['ส่งอย่างน้อย 1 รายการ', submittedAny],
            ['ส่งครบ ewe และ cer', submittedAll],
            ['ยังไม่ส่งทั้ง ewe และ cer', submittedNone],
            ['ขาด ewe', total - submittedEwe],
            ['ขาด cer', total - submittedCer]
        ];

        const bodyRows = summaryRows.map(([label, value], index) => {
            const row = index + 2;
            return `<row r="${row}">${xlsxTextCell(`A${row}`, label, 7)}${xlsxNumberCell(`B${row}`, value as number, 8)}</row>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>
        <col min="1" max="1" width="42" customWidth="1"/>
        <col min="2" max="2" width="15" customWidth="1"/>
    </cols>
    <sheetData>
        <row r="1">${xlsxTextCell('A1', 'หัวข้อ', 6)}${xlsxTextCell('B1', 'จำนวน', 6)}</row>
        ${bodyRows}
    </sheetData>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildAttendanceWorksheetXml(rows: any[], dates: string[]) {
        const headerCells = [
            xlsxTextCell('A1', 'ลำดับ', 1),
            xlsxTextCell('B1', 'ชื่อ-สกุล', 1),
            ...dates.flatMap((date, dateIndex) => {
                const morningCol = xlsxColumnName(3 + dateIndex * 2);
                const afternoonCol = xlsxColumnName(4 + dateIndex * 2);
                return [
                    xlsxTextCell(`${morningCol}1`, `${date} เช้า`, 1),
                    xlsxTextCell(`${afternoonCol}1`, `${date} บ่าย`, 1)
                ];
            })
        ].join('');

        const bodyRows = rows.map((row, rowIndex) => {
            const excelRow = rowIndex + 2;
            const attendanceCells = dates.flatMap((date, dateIndex) => {
                const morning = !!attendanceDraft[attendanceKey(row.fullName, date, 'morning')];
                const afternoon = !!attendanceDraft[attendanceKey(row.fullName, date, 'afternoon')];
                const morningCol = xlsxColumnName(3 + dateIndex * 2);
                const afternoonCol = xlsxColumnName(4 + dateIndex * 2);
                return [
                    xlsxTextCell(`${morningCol}${excelRow}`, statusMark(morning), morning ? 4 : 5),
                    xlsxTextCell(`${afternoonCol}${excelRow}`, statusMark(afternoon), afternoon ? 4 : 5)
                ];
            }).join('');

            return `<row r="${excelRow}">
                ${typeof row.order === 'number' ? xlsxNumberCell(`A${excelRow}`, row.order, 2) : xlsxTextCell(`A${excelRow}`, row.order, 2)}
                ${xlsxTextCell(`B${excelRow}`, row.fullName, 3)}
                ${attendanceCells}
            </row>`;
        }).join('');

        const lastColumn = xlsxColumnName(Math.max(2, 2 + dates.length * 2));
        const dateColumns = dates.map((_, index) => {
            const first = 3 + index * 2;
            return `<col min="${first}" max="${first + 1}" width="12" customWidth="1"/>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>
        <col min="1" max="1" width="8" customWidth="1"/>
        <col min="2" max="2" width="32" customWidth="1"/>
        ${dateColumns}
    </cols>
    <sheetData>
        <row r="1" ht="19.5" customHeight="1">${headerCells}</row>
        ${bodyRows}
    </sheetData>
    <autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildCombinedEvidenceAttendanceWorksheetXml(rows: any[], dates: string[]) {
        const headerCells = [
            xlsxTextCell('A1', 'ลำดับ', 1),
            xlsxTextCell('B1', 'ชื่อสกุล', 1),
            xlsxTextCell('C1', 'ewe', 1),
            xlsxTextCell('D1', 'cer', 1),
            ...dates.flatMap((date, dateIndex) => {
                const morningCol = xlsxColumnName(5 + dateIndex * 2);
                const afternoonCol = xlsxColumnName(6 + dateIndex * 2);
                return [
                    xlsxTextCell(`${morningCol}1`, `${date} เช้า`, 1),
                    xlsxTextCell(`${afternoonCol}1`, `${date} บ่าย`, 1)
                ];
            })
        ].join('');

        const bodyRows = rows.map((row, rowIndex) => {
            const excelRow = rowIndex + 2;
            const attendanceCells = dates.flatMap((date, dateIndex) => {
                const morning = !!attendanceDraft[attendanceKey(row.fullName, date, 'morning')];
                const afternoon = !!attendanceDraft[attendanceKey(row.fullName, date, 'afternoon')];
                const morningCol = xlsxColumnName(5 + dateIndex * 2);
                const afternoonCol = xlsxColumnName(6 + dateIndex * 2);
                return [
                    xlsxTextCell(`${morningCol}${excelRow}`, statusMark(morning), morning ? 4 : 5),
                    xlsxTextCell(`${afternoonCol}${excelRow}`, statusMark(afternoon), afternoon ? 4 : 5)
                ];
            }).join('');

            return `<row r="${excelRow}">
                ${typeof row.order === 'number' ? xlsxNumberCell(`A${excelRow}`, row.order, 2) : xlsxTextCell(`A${excelRow}`, row.order, 2)}
                ${xlsxTextCell(`B${excelRow}`, row.fullName, 3)}
                ${xlsxTextCell(`C${excelRow}`, statusMark(row.eve), row.eve ? 4 : 5)}
                ${xlsxTextCell(`D${excelRow}`, statusMark(row.cer), row.cer ? 4 : 5)}
                ${attendanceCells}
            </row>`;
        }).join('');

        const lastColumn = xlsxColumnName(Math.max(4, 4 + dates.length * 2));
        const dateColumns = dates.map((_, index) => {
            const first = 5 + index * 2;
            return `<col min="${first}" max="${first + 1}" width="12" customWidth="1"/>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>
        <col min="1" max="1" width="8" customWidth="1"/>
        <col min="2" max="2" width="32" customWidth="1"/>
        <col min="3" max="4" width="10" customWidth="1"/>
        ${dateColumns}
    </cols>
    <sheetData>
        <row r="1" ht="19.5" customHeight="1">${headerCells}</row>
        ${bodyRows}
    </sheetData>
    <autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildAttendanceSummaryWorksheetXml(rows: any[], dates: string[]) {
        const totalSlots = rows.length * dates.length * 2;
        const presentSlots = rows.reduce((count, row) => count + dates.reduce((dateCount, date) => {
            return dateCount
                + (attendanceDraft[attendanceKey(row.fullName, date, 'morning')] ? 1 : 0)
                + (attendanceDraft[attendanceKey(row.fullName, date, 'afternoon')] ? 1 : 0);
        }, 0), 0);
        const summaryRows = [
            ['จำนวนรายชื่อทั้งหมด', rows.length],
            ['จำนวนวัน', dates.length],
            ['ช่องเช็คทั้งหมด', totalSlots],
            ['มาแล้ว', presentSlots],
            ['ขาด', totalSlots - presentSlots]
        ];

        const bodyRows = summaryRows.map(([label, value], index) => {
            const row = index + 2;
            return `<row r="${row}">${xlsxTextCell(`A${row}`, label, 7)}${xlsxNumberCell(`B${row}`, value as number, 8)}</row>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>
        <col min="1" max="1" width="30" customWidth="1"/>
        <col min="2" max="2" width="15" customWidth="1"/>
    </cols>
    <sheetData>
        <row r="1">${xlsxTextCell('A1', 'หัวข้อ', 6)}${xlsxTextCell('B1', 'จำนวน', 6)}</row>
        ${bodyRows}
    </sheetData>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildTableWorksheetXml(headers: string[], rows: unknown[][]) {
        const headerRow = headers.map((header, index) => {
            const col = xlsxColumnName(index + 1);
            return xlsxTextCell(`${col}1`, header, 1);
        }).join('');
        const bodyRows = rows.map((rowData, rowIndex) => {
            const excelRow = rowIndex + 2;
            const cells = rowData.map((value, index) => {
                const col = xlsxColumnName(index + 1);
                return typeof value === 'number'
                    ? xlsxNumberCell(`${col}${excelRow}`, value, 2)
                    : xlsxTextCell(`${col}${excelRow}`, value, 3);
            }).join('');
            return `<row r="${excelRow}">${cells}</row>`;
        }).join('');
        const cols = headers.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 12 : 24}" customWidth="1"/>`).join('');
        const lastColumn = xlsxColumnName(Math.max(1, headers.length));

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
    <sheetFormatPr defaultColWidth="8.6796875" defaultRowHeight="15"/>
    <cols>${cols}</cols>
    <sheetData>
        <row r="1" ht="19.5" customHeight="1">${headerRow}</row>
        ${bodyRows}
    </sheetData>
    <autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
    <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
</worksheet>`;
    }

    function buildWorkbookStylesXml() {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="5">
        <font><sz val="10"/><name val="Arial"/></font>
        <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
        <font><sz val="10"/><color rgb="FF006100"/><name val="Arial"/></font>
        <font><sz val="10"/><color rgb="FF9C0006"/><name val="Arial"/></font>
        <font><b/><sz val="10"/><name val="Arial"/></font>
    </fonts>
    <fills count="5">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FF305496"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
    </fills>
    <borders count="2">
        <border><left/><right/><top/><bottom/><diagonal/></border>
        <border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom><diagonal/></border>
    </borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="9">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
        <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
        <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
        <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    </cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    }

    async function downloadEvidenceXlsx() {
        const rows = allEvidenceReportRows;
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
        zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <bookViews><workbookView activeTab="0"/></bookViews>
    <sheets>
        <sheet name="สรุปการส่งงาน" sheetId="1" r:id="rId1"/>
        <sheet name="สรุปภาพรวม" sheetId="2" r:id="rId2"/>
    </sheets>
</workbook>`);
        zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
        zip.file('xl/worksheets/sheet1.xml', buildEvidenceWorksheetXml(rows));
        zip.file('xl/worksheets/sheet2.xml', buildSummaryWorksheetXml(rows));
        zip.file('xl/styles.xml', buildWorkbookStylesXml());
        zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>สรุปการส่งงาน</dc:title>
    <dc:creator>image_temp_upload</dc:creator>
    <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`);
        zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>image_temp_upload</Application>
</Properties>`);
        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `สรุปการส่งงาน-${Date.now()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function downloadAttendanceXlsx() {
        const rows = participantRows;
        const dates = attendanceDates;
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
        zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <bookViews><workbookView activeTab="0"/></bookViews>
    <sheets>
        <sheet name="attendance" sheetId="1" r:id="rId1"/>
        <sheet name="summary" sheetId="2" r:id="rId2"/>
    </sheets>
</workbook>`);
        zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
        zip.file('xl/worksheets/sheet1.xml', buildAttendanceWorksheetXml(rows, dates));
        zip.file('xl/worksheets/sheet2.xml', buildAttendanceSummaryWorksheetXml(rows, dates));
        zip.file('xl/styles.xml', buildWorkbookStylesXml());
        zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>attendance</dc:title>
    <dc:creator>image_temp_upload</dc:creator>
    <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`);
        zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>image_temp_upload</Application>
</Properties>`);
        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `attendance-${Date.now()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function downloadAllXlsx() {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const sheets = [
            { name: 'evidence_attendance', xml: buildCombinedEvidenceAttendanceWorksheetXml(allEvidenceReportRows, attendanceDates) }
        ];

        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n    ')}
    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
        zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <bookViews><workbookView activeTab="0"/></bookViews>
    <sheets>
        ${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('\n        ')}
    </sheets>
</workbook>`);
        zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n    ')}
    <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
        sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml));
        zip.file('xl/styles.xml', buildWorkbookStylesXml());
        zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>dashboard-all</dc:title>
    <dc:creator>image_temp_upload</dc:creator>
    <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`);
        zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Application>image_temp_upload</Application>
</Properties>`);
        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `evidence-attendance-combined-${Date.now()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function printAttendanceReport() {
        const rows = attendanceRows;
        const dates = visibleAttendanceDates;
        const selectedLabel = selectedAttendanceDate === 'all' ? 'ทุกวันที่เช็ค' : selectedAttendanceDate;
        const html = `
            <html>
                <head>
                    <title>attendance-report</title>
                    <style>
                        body { font-family: sans-serif; padding: 24px; color: #111827; }
                        h1 { font-size: 18px; margin: 0 0 4px; }
                        p { margin: 0 0 12px; font-size: 12px; color: #4b5563; }
                        table { width: 100%; border-collapse: collapse; font-size: 11px; }
                        th, td { border: 1px solid #d1d5db; padding: 6px 8px; }
                        th { background: #f3f4f6; text-align: left; }
                        th.status, td.status { text-align: center; width: 64px; }
                        td.order { width: 48px; color: #4b5563; }
                        .ok { color: #047857; font-weight: 800; }
                        .missing { color: #b91c1c; font-weight: 800; }
                        @media print {
                            body { padding: 0; }
                            th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        }
                    </style>
                </head>
                <body>
                    <h1>Attendance report</h1>
                    <p>${escapeHtml(selectedLabel)} · ${rows.length} รายชื่อ</p>
                    <table>
                        <thead>
                            <tr>
                                <th>ลำดับ</th>
                                <th>ชื่อ-สกุล</th>
                                ${dates.map((date) => `
                                    <th class="status">${escapeHtml(date)}<br>เช้า</th>
                                    <th class="status">${escapeHtml(date)}<br>บ่าย</th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row: any) => `
                                <tr>
                                    <td class="order">${row.order}</td>
                                    <td>${escapeHtml(row.fullName)}</td>
                                    ${dates.map((date) => {
                                        const morning = !!attendanceDraft[attendanceKey(row.fullName, date, 'morning')];
                                        const afternoon = !!attendanceDraft[attendanceKey(row.fullName, date, 'afternoon')];
                                        return `
                                            <td class="status ${morning ? 'ok' : 'missing'}">${morning ? 'มา' : '-'}</td>
                                            <td class="status ${afternoon ? 'ok' : 'missing'}">${afternoon ? 'มา' : '-'}</td>
                                        `;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </body>
            </html>
        `;
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }

    function printEvidenceReport() {
        const rows = allEvidenceReportRows;
        const html = `
            <html>
                <head>
                    <title>evidence-report</title>
                    <style>
                        body { font-family: sans-serif; padding: 24px; color: #111827; }
                        h1 { font-size: 18px; margin: 0 0 12px; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #d1d5db; padding: 6px 8px; }
                        th { background: #f3f4f6; text-align: left; }
                        td.order { width: 56px; color: #4b5563; }
                        td.status, th.status { width: 72px; text-align: center; }
                        .mark { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 24px; border-radius: 6px; font-weight: 800; }
                        .ok { color: #047857; background: #d1fae5; border: 1px solid #6ee7b7; }
                        .missing { color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; }
                        @media print {
                            body { padding: 0; }
                            .ok, .missing { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        }
                    </style>
                </head>
                <body>
                    <h1>Evidence report (${rows.length})</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>ลำดับ</th>
                                <th>ชื่อสกุล</th>
                                <th class="status">ewe</th>
                                <th class="status">cer</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map((row) => `
                                <tr>
                                    <td class="order">${row.order}</td>
                                    <td>${escapeHtml(row.fullName)}</td>
                                    <td class="status"><span class="mark ${row.eve ? 'ok' : 'missing'}">${statusMark(row.eve)}</span></td>
                                    <td class="status"><span class="mark ${row.cer ? 'ok' : 'missing'}">${statusMark(row.cer)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </body>
            </html>
        `;
        const win = window.open('', '_blank');
        if (!win) return;
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
    }

    async function downloadEvidenceZip() {
        if (isProcessing) return;
        startProcessing('กำลังสร้าง ZIP รายชื่อหลักฐาน 0/0');
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            const rows = allEvidenceReportRows;
            const fileEntries = rows.flatMap((row: any) => [
                ...row.eveFiles.map((file: any) => ({ row, file, type: 'eve' })),
                ...row.cerFiles.map((file: any) => ({ row, file, type: 'cer' }))
            ]);
            const totalFiles = fileEntries.length;
            let completed = 0;
            let added = 0;

            if (totalFiles === 0) {
                showToast('ไม่มีไฟล์สำหรับ ZIP', 'ยังไม่มีไฟล์ที่ map กับรายชื่อหลัก', 'error');
                return;
            }

            processingText = `กำลังแพคไฟล์ 0/${totalFiles}`;
            let nextIndex = 0;
            async function worker() {
                while (nextIndex < fileEntries.length) {
                    const entry = fileEntries[nextIndex++];
                    try {
                        const image = await getZipImageBlob(entry.file);
                        zip.file(
                            `${entry.type}/${formatEvidenceZipName(entry.type, entry.row.order, entry.row.fullName, numberedNameSuffix(entry.file?.name))}`,
                            image.blob,
                            { compression: 'STORE' }
                        );
                        added++;
                    } catch (err) {
                        console.error('Evidence ZIP file failed:', entry.file?.id, err);
                    } finally {
                        completed++;
                        progressPercent = Math.max(progressPercent, Math.round((completed / totalFiles) * 90));
                        processingText = `กำลังแพคไฟล์ ${completed}/${totalFiles}`;
                    }
                }
            }
            await Promise.all(Array.from(
                { length: Math.min(ZIP_DOWNLOAD_CONCURRENCY, fileEntries.length) },
                () => worker()
            ));

            if (added === 0) {
                showToast('ไม่มีไฟล์สำหรับ ZIP', 'ไม่สามารถโหลดไฟล์ที่ map กับรายชื่อหลักได้', 'error');
                return;
            }

            processingText = `กำลังสร้างไฟล์ ZIP ${added}/${totalFiles}`;
            const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (metadata) => {
                progressPercent = Math.max(progressPercent, Math.round(90 + (metadata.percent / 100) * 10));
            });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `evidence-renamed-${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('สร้าง ZIP สำเร็จ', `rename และแพคไฟล์ ${added}/${totalFiles} รายการแล้ว`, 'success');
        } finally {
            stopProcessing();
        }
    }

    // Collections excluding deleted-drive
    const realCollections = $derived(data.collections.filter((c: any) => c.id !== 'deleted-drive'));
    const activeCollections = $derived(realCollections.filter((c: any) => !c.name.endsWith('_deleted')));
    const deletedCollections = $derived(realCollections.filter((c: any) => c.name.endsWith('_deleted')));
    function displayName(name: string) { return name.replace(/_deleted$/, ''); }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if !data.loggedIn}
    <!-- Show Login Form -->
    <section class="flex items-center justify-center p-4 min-h-[50vh] w-full">
        <div class="glass max-w-sm w-full rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden border border-zinc-800/80 space-y-6">
            <div class="absolute top-0 left-0 w-full h-[3px] bg-brand-500"></div>
            
            <div class="text-center space-y-2">
                <h1 class="text-2xl font-bold text-white tracking-tight">เข้าสู่ Dashboard</h1>
                <p class="text-zinc-500 text-xs">ระบุบัญชีผู้ดูแลเพื่อจัดการไฟล์ภาพผลงาน</p>
            </div>

            {#if loginError}
                <div class="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-semibold text-center">
                    {loginError}
                </div>
            {/if}

            <form method="POST" action="?/login" use:enhance={() => {
                isLoggingIn = true;
                return async ({ result, update }) => {
                    isLoggingIn = false;
                    if (result.type === 'success') {
                        startProcessing('กำลังโหลด Dashboard...');
                        loginError = '';
                        data.loggedIn = true;
                        data.userRole = (result.data as any)?.role || '';
                        data.username = (result.data as any)?.username || '';
                        const { appState: state } = await import('$lib/appState.svelte');
                        state.activeTab = 'admin';
                        showToast('เข้าสู่ระบบสำเร็จ', 'ยินดีต้อนรับกลับเข้าสู่หน้าแอดมิน', 'success');
                    } else {
                        // @ts-ignore
                        loginError = result.data?.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
                        showToast('เข้าสู่ระบบล้มเหลว', loginError, 'error');
                    }
                    await update();
                    if (isProcessing) stopProcessing();
                };
            }} class="space-y-4">
                <div class="space-y-2">
                    <label for="username" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Username</label>
                    <div class="relative">
                        <input type="text" id="username" name="username" required placeholder="username" autocomplete="username" disabled={isLoggingIn}
                            class="w-full bg-zinc-900/60 border border-zinc-700/80 rounded-xl pl-10 pr-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm disabled:opacity-50">
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                            <User class="w-4 h-4" />
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <label for="password" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Password</label>
                    <div class="relative">
                        <input type="password" id="password" name="password" required placeholder="••••" autocomplete="current-password" disabled={isLoggingIn}
                            class="w-full bg-zinc-900/60 border border-zinc-700/80 rounded-xl pl-10 pr-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm disabled:opacity-50">
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                            <Lock class="w-4 h-4" />
                        </div>
                    </div>
                </div>

                <button type="submit" disabled={isLoggingIn} class="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium py-3 rounded-xl shadow-lg shadow-brand-500/10 hover:shadow-brand-600/20 transition-all duration-300 flex items-center justify-center space-x-2 text-sm mt-6">
                    {#if isLoggingIn}
                        <Loader2 class="w-4.5 h-4.5 animate-spin" />
                        <span>กำลังเข้าสู่ระบบ...</span>
                    {:else}
                        <span>เข้าสู่ระบบ</span>
                    {/if}
                </button>
            </form>
        </div>
    </section>
{:else}
<!-- Dashboard Section -->
<section class="space-y-4 w-full animate-fade-in">
    <div class="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-950/70">
        <!-- <div>
            <h2 class="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
                <span>Dashboard</span>
            </h2>
            <p class="text-zinc-400 text-sm mt-1">บริหารจัดการหัวข้อเปิดรับรูปภาพ และดาวน์โหลดรูปภาพที่ส่งเข้ามาใน format ZIP สำหรับการประเมินผล</p>
        </div> -->
        <div class="border-b border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/80">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <div class="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">Operations console</div>
                    <h2 class="mt-1 text-xl font-black tracking-tight text-zinc-950 dark:text-white">Dashboard</h2>
                    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">จัดการงานหลักจากหน้าจอเดียว: เช็คชื่อ รายชื่อ หลักฐาน และไฟล์</p>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span class="rounded-full border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900">{data.username}</span>
                    <span class="rounded-full border border-zinc-200 bg-white px-2.5 py-1 uppercase dark:border-zinc-800 dark:bg-zinc-900">{data.userRole}</span>
                </div>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div class="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div class="text-[10px] font-semibold uppercase text-zinc-400">หลักฐาน</div>
                    <div class="mt-1 text-lg font-black text-zinc-950 dark:text-white">{evidenceStats.total}</div>
                </div>
                <div class="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div class="text-[10px] font-semibold uppercase text-zinc-400">วันที่เช็ค</div>
                    <div class="mt-1 text-lg font-black text-zinc-950 dark:text-white">{attendanceDates.length}</div>
                </div>
                <div class="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div class="text-[10px] font-semibold uppercase text-zinc-400">รายชื่อ</div>
                    <div class="mt-1 text-lg font-black text-zinc-950 dark:text-white">{participantRows.length}</div>
                </div>
                <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                    <div class="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">ต้องตรวจ</div>
                    <div class="mt-1 text-lg font-black text-amber-700 dark:text-amber-300">{unmatchedEvidenceFiles.length}</div>
                </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
                <button onclick={reloadData} disabled={isReloading} class="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50 disabled:pointer-events-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600">
                    <RefreshCw class="w-4 h-4 text-emerald-400 {isReloading ? 'animate-spin' : ''}" />
                    <span>{isReloading ? 'กำลังดึงข้อมูล...' : 'รีโหลดข้อมูล'}</span>
                </button>
                <button onclick={downloadEvidenceZip} disabled={isProcessing} class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none">
                    <Download class="w-4 h-4" />
                    <span>ดาวน์โหลด ZIP</span>
                </button>
                <button onclick={downloadAllXlsx} disabled={isProcessing} class="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 disabled:pointer-events-none dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15">
                    <Download class="w-4 h-4" />
                    <span>Download all XLSX</span>
                </button>
            </div>
        </div>

        <details class="group m-3 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/60">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <span>เครื่องมือระบบ</span>
                <span class="text-zinc-400 group-open:hidden">แสดง</span>
                <span class="hidden text-zinc-400 group-open:inline">ซ่อน</span>
            </summary>
            <div class="flex flex-wrap w-full items-center gap-2 border-t border-zinc-200 dark:border-zinc-800 p-3">
            <button onclick={() => isCollectionsPanelOpen = !isCollectionsPanelOpen} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                <Sidebar class="w-4 h-4 text-brand-500" />
                <span>{isCollectionsPanelOpen ? 'ซ้อนแผงจัดการ' : 'แสดงแผงจัดการ'}</span>
            </button>
            <button onclick={() => isAddColModalOpen = true} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 animate-none">
                <FolderPlus class="w-4 h-4 text-brand-500" />
                <span>เพิ่มหัวข้อใหม่</span>
            </button>
            {#if data.userRole === 'admin'}
                <button onclick={() => isUserManagementOpen = true} class="bg-violet-300 hover:bg-violet-500 dark:bg-violet-400 hover:dark:bg-violet-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 shadow-lg shadow-violet-600/10 animate-none">
                    <User class="w-4 h-4" />
                    <span>จัดการผู้ใช้</span>
                </button>
            {/if}

             <!-- Backup -->
            {#if data.userRole === 'admin' || data.userRole === 'staff'}
                <div class="flex items-center gap-2">
                    <form method="POST" action="?/backupToCloudflare" use:enhance={() => {
                        isBackingUp = true;
                        startProcessing('กำลัง Backup ข้อมูล...');
                        return async ({ result, update }) => {
                            isBackingUp = false;
                            stopProcessing();
                            if (result.type === 'success') {
                                showToast('Backup สำเร็จ', formatBackupMessage((result.data as any)?.message ?? 'สำรองข้อมูลเรียบร้อย'), 'success');
                            } else if (result.type === 'failure') {
                                showToast('Backup ล้มเหลว', formatBackupMessage((result.data as any)?.message ?? 'เกิดข้อผิดพลาด'), 'error');
                            }
                            await update();
                        };
                    }}>
                        <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('สำรองข้อมูล', 'คุณต้องการสำรองข้อมูลรูปภาพและชีตทังหมดใช่หรือไม่?', () => form?.requestSubmit(), 'info'); }} disabled={isBackingUp || isProcessing} class="bg-zinc-900 border border-zinc-700 hover:border-amber-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 disabled:opacity-50">
                            <CloudUpload class="w-4 h-4 text-amber-400 {isBackingUp ? 'animate-pulse' : ''}" />
                            <span>{isBackingUp ? 'กำลัง Backup...' : 'Backup'}</span>
                        </button>
                    </form>

                    <form method="POST" action="?/importBackupJson" enctype="multipart/form-data" use:enhance={() => {
                        startProcessing('กำลังนำเข้าข้อมูลสำรองจากไฟล์ JSON...');
                        return async ({ result, update }) => {
                            stopProcessing();
                            if (result.type === 'success') {
                                showToast('นำเข้าสำเร็จ', (result.data as any)?.message ?? 'นำเข้าข้อมูลสำรองเรียบร้อยแล้ว', 'success');
                            } else {
                                // @ts-ignore
                                showToast('นำเข้าล้มเหลว', result.data?.message || 'การกู้คืนข้อมูลล้มเหลว', 'error');
                            }
                            await update();
                        };
                    }}>
                        <input type="file" id="import-backup-file" name="backup_file" accept=".json" class="hidden" onchange={(e) => {
                            const file = (e.currentTarget as HTMLInputElement).files?.[0];
                            if (file) {
                                const form = e.currentTarget.closest('form');
                                showConfirm('นำเข้าข้อมูลสำรอง', `คุณต้องการนำเข้าข้อมูลสำรองจากไฟล์ "${file.name}" ใช่หรือไม่? ข้อมูลเดิมจะถูกเขียนทับด้วยข้อมูลในไฟล์นี้`, () => form?.requestSubmit(), 'success');
                            }
                        }}>
                        <button type="button" onclick={() => document.getElementById('import-backup-file')?.click()} class="bg-zinc-900 border border-zinc-700 hover:border-violet-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                            <FolderGit2 class="w-4 h-4 text-violet-400" />
                            <span>นำเข้าสำรองข้อมูล</span>
                        </button>
                    </form>
                </div>
            {/if}

            <form method="POST" action="?/logout" use:enhance={() => {
                return async ({ result, update }) => {
                    if (result.type === 'success') {
                        data.loggedIn = false;
                        data.userRole = '';
                        data.username = '';
                        const { appState: state } = await import('$lib/appState.svelte');
                        state.activeTab = 'login';
                        showToast('ออกจากระบบแล้ว', 'เซสชั่นแอดมินถูกยกเลิกเรียบร้อย', 'success');
                    }
                    await update();
                };
            }}>
                <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ออกจากระบบ', 'คุณต้องการออกจากระบบใช่หรือไม่?', () => form?.requestSubmit(), 'danger'); }} class="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                    <Power class="w-4 h-4" />
                    <span>ออกจากระบบ</span>
                </button>
            </form>
        </div>
        </details>
    </div>

    <div class="rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-950/70">
        <div class="px-2 pb-2 pt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
                <h3 class="text-sm font-bold text-zinc-950 dark:text-white">งานใน Dashboard</h3>
                <p class="text-[11px] text-zinc-500 dark:text-zinc-400">เลือกงานก่อน แล้วค่อยใช้เครื่องมือเฉพาะของหน้านั้น</p>
            </div>
            <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                ตอนนี้: <span class="font-semibold text-zinc-800 dark:text-zinc-200">{workspaceTitle(adminWorkspaceTab)}</span>
            </div>
        </div>
        <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-5">
            {#each workspaceTabs as tab (tab.id)}
                {@const count = workspaceCount(tab.id)}
                <button
                    type="button"
                    onclick={() => switchWorkspaceTab(tab.id)}
                    class="min-h-16 rounded-xl border px-3 py-2.5 text-left transition-all {adminWorkspaceTab === tab.id ? 'border-zinc-900 bg-zinc-100 text-zinc-950 shadow-sm ring-1 ring-zinc-900/5 dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-950' : 'border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70'}"
                >
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-bold">{tab.label}</div>
                            <div class="mt-0.5 text-[11px] leading-snug {adminWorkspaceTab === tab.id ? 'text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}">{tab.description}</div>
                        </div>
                        <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold {adminWorkspaceTab === tab.id ? 'bg-zinc-950 text-white dark:bg-zinc-950 dark:text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'}">{count}</span>
                    </div>
                </button>
            {/each}
        </div>
    </div>

    <!-- Quota Alert Banner -->
    {#if overQuotaCollections.length > 0 || nearQuotaCollections.length > 0}
        <div class="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex flex-col gap-2 shadow-inner">
            {#each overQuotaCollections as col}
                <div class="flex items-center gap-2 text-xs text-rose-400 font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>
                    <span>หัวข้อ "/{col.name}" ส่งรูปภาพเต็มขีดจำกัดแล้ว ({data.submissions.filter((s: any) => s.collection_id === col.id && !s.is_deleted).length} รูป) ผู้ใช้งานจะไม่สามารถส่งรูปเพิ่มได้</span>
                </div>
            {/each}
            {#each nearQuotaCollections as col}
                <div class="flex items-center gap-2 text-xs text-amber-400 font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>
                    <span>หัวข้อ "/{col.name}" ใกล้เต็มขีดจำกัดแล้ว ({data.submissions.filter((s: any) => s.collection_id === col.id && !s.is_deleted).length} รูป)</span>
                </div>
            {/each}
        </div>
    {/if}



    <!-- Evidence report section -->
    {#if adminWorkspaceTab !== 'files'}
    <div class="evidence-report-section rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/5 overflow-hidden print:block dark:border-zinc-800 dark:bg-zinc-950/70">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 border-b border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/80">
            <div>
                <h3 class="text-sm font-bold text-zinc-950 dark:text-white">{workspaceTitle(adminWorkspaceTab)}</h3>
                <p class="text-[11px] text-zinc-500">{workspaceDescription(adminWorkspaceTab)}</p>
            </div>
            <div class="flex flex-wrap gap-2">
                {#if adminWorkspaceTab === 'overview'}
                    <button type="button" onclick={downloadEvidenceXlsx} class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-200">XLSX</button>
                    <button type="button" onclick={printEvidenceReport} class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-200">Print/PDF</button>
                {/if}
                {#if adminWorkspaceTab === 'attendance'}
                    <form method="POST" action="?/saveAttendance" use:enhance={() => {
                        startProcessing('กำลังบันทึกการเข้างาน...');
                        return async ({ result, update }) => {
                            stopProcessing();
                            if (result.type === 'success') {
                                const savedDates = ((result.data as any)?.savedDates ?? []) as string[];
                                attendanceExtraDates = Array.from(new Set([...attendanceExtraDates, ...savedDates]));
                                await update();
                                attendanceRemovedDates = [];
                                attendanceDateRenames = [];
                                showToast('บันทึกแล้ว', (result.data as any)?.message ?? 'บันทึกการเข้างานเรียบร้อยแล้ว', 'success');
                                isAttendanceDirty = false;
                            } else {
                                showToast('บันทึกไม่สำเร็จ', (result as any).data?.message ?? 'กรุณาลองใหม่', 'error');
                                await update();
                            }
                        };
                    }}>
                        <input type="hidden" name="attendance_payload" value={attendancePayload}>
                        <input type="hidden" name="attendance_date_renames" value={attendanceDateRenamesPayload}>
                        <input type="hidden" name="attendance_deleted_dates" value={attendanceDeletedDatesPayload}>
                        <button type="submit" disabled={isProcessing || participantRows.length === 0 || attendanceDates.length === 0} class="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-xs text-white font-semibold">บันทึก</button>
                    </form>
                    <button type="button" onclick={downloadAttendanceXlsx} class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-200">XLSX</button>
                    <button type="button" onclick={printAttendanceReport} class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-200">Print/PDF</button>
                {/if}
            </div>
        </div>

        {#if isEvidencePanelOpen}
            <div class="{adminWorkspaceTab === 'overview' ? 'grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-0' : 'grid grid-cols-1 gap-0'}">
                <div class="p-4 border-b xl:border-b-0 xl:border-r border-zinc-200 dark:border-zinc-800 space-y-3">
                    {#if adminWorkspaceTab === 'participants'}
                    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
                        <div class="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                            <div class="flex items-start justify-between gap-2">
                                <div>
                                    <div class="text-xs font-bold text-zinc-950 dark:text-white">เครื่องมือรายชื่อ</div>
                                    <div class="text-[11px] text-zinc-500">เพิ่มรายชื่อเดี่ยว หรือนำเข้า XLSX</div>
                                </div>
                                <span class="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">{participantRows.length}</span>
                            </div>
                        <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            source: {data.participantsMeta?.source ?? '-'} · db rows: {data.participantsMeta?.databaseCount ?? 0} · loaded: {data.participantsMeta?.loadedCount ?? participantRows.length}
                            {#if data.participantsMeta?.error}
                                <div class="mt-1 text-rose-500 break-words">{data.participantsMeta.error}</div>
                            {/if}
                        </div>
                        <form method="POST" action="?/importParticipantsXlsx" enctype="multipart/form-data" class="rounded-xl border border-zinc-200 bg-white p-3 space-y-2 dark:border-zinc-800 dark:bg-zinc-950/50" use:enhance={() => participantActionEnhance('นำเข้า XLSX สำเร็จ', 'กำลังนำเข้ารายชื่อจาก XLSX...')}>
                            <div class="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">นำเข้าจาก XLSX</div>
                            <input id="participant-xlsx-input" name="participant_file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="block w-full text-xs text-zinc-600 dark:text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-700" required>
                            <button type="submit" disabled={isProcessing} class="w-full px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-xs text-white font-semibold">อัปเดตรายชื่อจาก XLSX</button>
                        </form>
                        <form method="POST" action="?/addParticipant" class="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/50" use:enhance={() => participantActionEnhance('เพิ่มรายชื่อสำเร็จ', 'กำลังเพิ่มรายชื่อ...')}>
                            <div class="mb-2 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">เพิ่มรายชื่อเดี่ยว</div>
                            <div class="grid grid-cols-[76px_1fr_auto] gap-2">
                            <input name="order" bind:value={participantAddOrder} inputmode="numeric" placeholder="แทรกที่" title="เว้นว่างเพื่อต่อท้าย หรือกรอกเลขเพื่อแทรกที่ลำดับนั้น" class="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500">
                            <input name="full_name" bind:value={participantAddName} placeholder="ชื่อ-สกุล" class="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand-500" required>
                            <button type="submit" disabled={isProcessing} class="px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 disabled:opacity-50">เพิ่ม</button>
                            </div>
                        </form>
                        </div>
                        <div class="space-y-3">
                        <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/50 overflow-hidden">
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
                                <div>
                                    <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-200">รายชื่อ</div>
                                    <div class="text-[11px] text-zinc-500">แสดง {participantPageStart}-{participantPageEnd} จาก {participantRows.length}</div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onclick={() => participantPage = Math.max(1, participantPage - 1)}
                                        disabled={participantPage <= 1}
                                        class="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
                                        aria-label="หน้าก่อนหน้า"
                                    >
                                        <ChevronLeft class="h-4 w-4" />
                                    </button>
                                    <div class="min-w-16 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                        {participantPage}/{participantPageCount}
                                    </div>
                                    <button
                                        type="button"
                                        onclick={() => participantPage = Math.min(participantPageCount, participantPage + 1)}
                                        disabled={participantPage >= participantPageCount}
                                        class="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
                                        aria-label="หน้าถัดไป"
                                    >
                                        <ChevronRight class="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <div class="max-h-[520px] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-900">
                                {#each participantPageRows as participant (`participant-list-${participant.order}-${participant.fullName}`)}
                                    <div class="grid grid-cols-[56px_1fr] items-center gap-3 px-3 py-2.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                                        <div class="rounded-lg bg-zinc-100 dark:bg-zinc-900 px-2 py-1 text-center font-semibold text-zinc-500 dark:text-zinc-400">
                                            {participant.order}
                                        </div>
                                        <div class="min-w-0 font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                            {participant.fullName}
                                        </div>
                                    </div>
                                {:else}
                                    <div class="px-3 py-6 text-center text-xs text-zinc-500">ยังไม่มีรายชื่อ</div>
                                {/each}
                            </div>
                        </div>
                        </div>
                        <form method="POST" action="?/saveParticipants" class="xl:col-span-2 rounded-xl border border-zinc-200 bg-white p-3 space-y-2 dark:border-zinc-800 dark:bg-zinc-950/50" use:enhance={() => participantActionEnhance('บันทึกรายชื่อสำเร็จ', 'กำลังบันทึกรายชื่อ...')}>
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <label for="participant-list-text" class="block text-xs font-bold text-zinc-950 dark:text-white">แก้รายชื่อแบบรายการยาว</label>
                                    <div class="text-[11px] text-zinc-500">ใช้เมื่อจำเป็นต้องแก้หลายคนพร้อมกัน แล้วกดบันทึกทั้งหมด</div>
                                </div>
                                <span class="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">{participantRows.length} รายชื่อ</span>
                            </div>
                            <textarea id="participant-list-text" name="participant_list" bind:value={participantListText} rows="10" placeholder="วางรายชื่อ 1 บรรทัดต่อ 1 คน เช่น&#10;1 นาย ก&#10;2 นางสาว ข" class="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl p-3 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-600 focus:outline-none focus:border-brand-500"></textarea>
                            <button type="submit" disabled={isProcessing} class="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-xs text-white font-semibold">บันทึกรายชื่อทั้งหมด</button>
                        </form>
                    </div>
                    {/if}
                    {#if adminWorkspaceTab === 'attendance'}
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                            <div class="space-y-3">
                                <div class="grid grid-cols-3 gap-2 text-xs">
                                    <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3">
                                        <div class="text-zinc-500">รายชื่อ</div>
                                        <div class="text-lg font-black text-zinc-950 dark:text-white">{participantRows.length}</div>
                                    </div>
                                    <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3">
                                        <div class="text-zinc-500">วัน</div>
                                        <div class="text-lg font-black text-zinc-950 dark:text-white">{attendanceDates.length}</div>
                                    </div>
                                    <div class="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-white dark:bg-emerald-500/10 p-3">
                                        <div class="text-emerald-700 dark:text-emerald-300">มา</div>
                                        <div class="text-lg font-black text-emerald-700 dark:text-emerald-300">{attendanceStats.presentSlots}</div>
                                    </div>
                                </div>
                                <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3 space-y-3">
                                    <div class="flex items-center justify-between gap-2">
                                        <div>
                                            <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-300">วันที่เช็ค</div>
                                            <div class="text-[11px] text-zinc-500">กดวันที่เพื่อเลือกจากปฏิทิน</div>
                                        </div>
                                        <span class="text-[10px] rounded-lg border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-zinc-500">{attendanceDates.length}</span>
                                    </div>
                                    <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                                        <button
                                            type="button"
                                            onclick={() => selectedAttendanceDate = 'all'}
                                            class="w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition {selectedAttendanceDate === 'all' ? 'border-brand-500 bg-brand-500/10 text-zinc-950 dark:text-white' : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-300'}"
                                        >
                                            ทั้งหมด
                                        </button>
                                        {#each attendanceDates as date (date)}
                                            <label class="block rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/70 p-2">
                                                <span class="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase text-zinc-500">
                                                    <button type="button" onclick={() => selectedAttendanceDate = date} class="text-left {selectedAttendanceDate === date ? 'text-brand-600 dark:text-brand-300' : ''}">วันเช็ค</button>
                                                    {#if canManageAttendanceDates}
                                                        <button
                                                            type="button"
                                                            onclick={(e) => { e.preventDefault(); removeAttendanceDate(date); }}
                                                            class="grid h-6 w-6 place-items-center rounded-md border border-rose-200 bg-white text-rose-500 hover:bg-rose-50 dark:border-rose-500/20 dark:bg-zinc-900 dark:hover:bg-rose-500/10"
                                                            aria-label={`ลบวันที่ ${date}`}
                                                            title={isSavedAttendanceDate(date) ? 'ลบแบบ soft delete เมื่อกดบันทึก' : 'ลบวันที่ใหม่'}
                                                        >
                                                            <Trash2 class="h-3.5 w-3.5" />
                                                        </button>
                                                    {/if}
                                                </span>
                                                {#if canManageAttendanceDates}
                                                    <input
                                                        type="date"
                                                        value={date}
                                                        onfocus={openNativeDatePicker}
                                                        onclick={openNativeDatePicker}
                                                        onchange={(e) => updateAttendanceDate(date, e.currentTarget.value)}
                                                        class="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg px-2.5 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-brand-500"
                                                    >
                                                {:else}
                                                    <button
                                                        type="button"
                                                        onclick={() => selectedAttendanceDate = date}
                                                        class="w-full rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition {selectedAttendanceDate === date ? 'border-brand-500 bg-brand-500/10 text-zinc-950 dark:text-white' : 'border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'}"
                                                    >
                                                        {date}
                                                    </button>
                                                {/if}
                                            </label>
                                        {/each}
                                    </div>
                                </div>
                                {#if canManageAttendanceDates}
                                <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3 space-y-2">
                                    <label for="attendance-date" class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">เพิ่มวันที่เช็ค</label>
                                    <div class="flex gap-2">
                                        <input id="attendance-date" type="date" bind:value={attendanceDateInput} onfocus={openNativeDatePicker} onclick={openNativeDatePicker} class="min-w-0 flex-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-brand-500">
                                        <button type="button" onclick={addAttendanceDate} class="px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200">เพิ่ม</button>
                                    </div>
                                    <div class="text-[11px] text-zinc-500">เช็คเป็น 2 ช่องต่อวัน: เช้าและบ่าย</div>
                                </div>
                                {/if}
                            </div>
                            <div class="space-y-3 min-w-0">
                                <div class="flex flex-col sm:flex-row gap-2">
                                    <input bind:value={attendanceSearch} placeholder="ค้นหาลำดับหรือชื่อ" class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-600 focus:outline-none focus:border-brand-500">
                                    <select bind:value={selectedAttendanceDate} class="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200">
                                        <option value="all">ทุกวันที่เช็ค</option>
                                        {#each attendanceDates as date (date)}
                                            <option value={date}>{date}</option>
                                        {/each}
                                    </select>
                                    <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                                        ขาด {attendanceStats.missingSlots}/{attendanceStats.totalSlots}
                                    </div>
                                </div>
                                <div class="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                                    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <div class="text-xs font-bold text-zinc-950 dark:text-white">รายชื่อผู้เข้างาน</div>
                                            <div class="text-[11px] text-zinc-500">
                                                {selectedAttendanceDate === 'all' ? 'เลือกวันที่เดียวเพื่อดูรายชื่อแยกเช้า/บ่าย' : selectedAttendanceSummary.date}
                                            </div>
                                        </div>
                                        {#if selectedAttendanceDate !== 'all'}
                                            <div class="flex flex-wrap gap-2 text-[11px]">
                                                <span class="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">ครบวัน {selectedAttendanceSummary.fullDayPresent.length}</span>
                                                <span class="rounded-full bg-sky-50 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">เช้า {selectedAttendanceSummary.morningPresent.length}</span>
                                                <span class="rounded-full bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">บ่าย {selectedAttendanceSummary.afternoonPresent.length}</span>
                                                <span class="rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">ยังไม่ครบ {selectedAttendanceSummary.incomplete.length}</span>
                                            </div>
                                        {/if}
                                    </div>
                                    {#if selectedAttendanceDate !== 'all'}
                                        <div class="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
                                            <div class="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                                <div class="mb-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">มาครบเช้า-บ่าย</div>
                                                <div class="max-h-32 space-y-1 overflow-y-auto pr-1">
                                                    {#each selectedAttendanceSummary.fullDayPresent.slice(0, 40) as person (`full-${person.order}-${person.fullName}`)}
                                                        <div class="truncate rounded-md bg-white px-2 py-1 text-[11px] text-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">{person.order}. {person.fullName}</div>
                                                    {:else}
                                                        <div class="text-[11px] text-zinc-500">ยังไม่มีรายชื่อ</div>
                                                    {/each}
                                                </div>
                                            </div>
                                            <div class="rounded-lg border border-sky-100 bg-sky-50/60 p-2 dark:border-sky-500/20 dark:bg-sky-500/10">
                                                <div class="mb-2 text-[11px] font-bold text-sky-700 dark:text-sky-300">มาเช้า</div>
                                                <div class="max-h-32 space-y-1 overflow-y-auto pr-1">
                                                    {#each selectedAttendanceSummary.morningPresent.slice(0, 40) as person (`morning-${person.order}-${person.fullName}`)}
                                                        <div class="truncate rounded-md bg-white px-2 py-1 text-[11px] text-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">{person.order}. {person.fullName}</div>
                                                    {:else}
                                                        <div class="text-[11px] text-zinc-500">ยังไม่มีรายชื่อ</div>
                                                    {/each}
                                                </div>
                                            </div>
                                            <div class="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                                                <div class="mb-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">มาบ่าย</div>
                                                <div class="max-h-32 space-y-1 overflow-y-auto pr-1">
                                                    {#each selectedAttendanceSummary.afternoonPresent.slice(0, 40) as person (`afternoon-${person.order}-${person.fullName}`)}
                                                        <div class="truncate rounded-md bg-white px-2 py-1 text-[11px] text-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">{person.order}. {person.fullName}</div>
                                                    {:else}
                                                        <div class="text-[11px] text-zinc-500">ยังไม่มีรายชื่อ</div>
                                                    {/each}
                                                </div>
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                                <div class="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-[620px]">
                                    <table class="w-full min-w-max text-xs">
                                        <thead class="sticky top-0 bg-zinc-100 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400">
                                            <tr>
                                                <th class="text-left p-2 w-16">ลำดับ</th>
                                                <th class="text-left p-2 min-w-56">ชื่อ-สกุล</th>
                                                {#each visibleAttendanceDates as date (date)}
                                                    <th class="text-center p-2 min-w-24">{date}<div class="text-[10px] font-normal">เช้า</div></th>
                                                    <th class="text-center p-2 min-w-24">{date}<div class="text-[10px] font-normal">บ่าย</div></th>
                                                {/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each attendanceRows as row (`attendance-${row.order}-${row.fullName}`)}
                                                <tr class="border-t border-zinc-200 dark:border-zinc-900">
                                                    <td class="p-2 text-zinc-500 dark:text-zinc-400">{row.order}</td>
                                                    <td class="p-2 text-zinc-950 dark:text-zinc-100">{row.fullName}</td>
                                                    {#each visibleAttendanceDates as date (date)}
                                                        <td class="p-2 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!attendanceDraft[attendanceKey(row.fullName, date, 'morning')]}
                                                                onchange={(e) => setAttendance(row.fullName, date, 'morning', e.currentTarget.checked)}
                                                                class={attendanceCheckboxClass(row.fullName, date, 'morning')}
                                                                aria-label={`${row.fullName} ${date} เช้า`}
                                                            >
                                                        </td>
                                                        <td class="p-2 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!attendanceDraft[attendanceKey(row.fullName, date, 'afternoon')]}
                                                                onchange={(e) => setAttendance(row.fullName, date, 'afternoon', e.currentTarget.checked)}
                                                                class={attendanceCheckboxClass(row.fullName, date, 'afternoon')}
                                                                aria-label={`${row.fullName} ${date} บ่าย`}
                                                            >
                                                        </td>
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/if}
                    {#if adminWorkspaceTab === 'overview'}
                    <div class="grid grid-cols-1 gap-2 text-xs">
                        <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-3">
                            <div class="text-zinc-500">ทั้งหมด</div>
                            <div class="text-lg font-black text-zinc-950 dark:text-white">{evidenceStats.total} รายชื่อ</div>
                        </div>
                        <div class="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-white dark:bg-emerald-500/10 p-3 shadow-sm dark:shadow-none">
                            <div class="text-emerald-700 dark:text-emerald-300">ครบ</div>
                            <div class="text-lg font-black text-emerald-700 dark:text-emerald-300">{evidenceStats.complete}</div>
                        </div>
                        <div class="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-white dark:bg-amber-500/10 p-3 shadow-sm dark:shadow-none">
                            <div class="text-amber-700 dark:text-amber-300 font-semibold">eve</div>
                            <div class="text-base font-black text-zinc-950 dark:text-zinc-100">ส่งแล้ว {evidenceStats.submittedEve}/{evidenceStats.total}</div>
                            <div class="text-[11px] text-amber-700 dark:text-amber-300">ขาด {evidenceStats.missingEve}</div>
                        </div>
                        <div class="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-white dark:bg-amber-500/10 p-3 shadow-sm dark:shadow-none">
                            <div class="text-amber-700 dark:text-amber-300 font-semibold">cer</div>
                            <div class="text-base font-black text-zinc-950 dark:text-zinc-100">ส่งแล้ว {evidenceStats.submittedCer}/{evidenceStats.total}</div>
                            <div class="text-[11px] text-amber-700 dark:text-amber-300">ขาด {evidenceStats.missingCer}</div>
                        </div>
                    </div>
                    {/if}

                    {#if adminWorkspaceTab === 'mapping'}
                        <div class="space-y-2 pt-2">
                            <div class="text-xs font-semibold text-amber-300">ไฟล์ที่ต้องตรวจ mapping ({unmatchedEvidenceFiles.length})</div>
                            {#if unmatchedEvidenceFiles.length === 0}
                                <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-300">ไม่มีไฟล์ที่ต้องตรวจ mapping ตอนนี้</div>
                            {:else}
                            <form method="POST" action="?/updateSubmissionMappings" use:enhance={() => {
                                startProcessing('กำลังบันทึก mapping ทั้งหมด...');
                                return async ({ result, update }) => {
                                    stopProcessing();
                                    if (result.type === 'success') {
                                        mappingDrafts = {};
                                        showToast('บันทึกทั้งหมดแล้ว', (result.data as any)?.message || 'อัปเดต mapping ทุกไฟล์เรียบร้อย', 'success');
                                    } else {
                                        // @ts-ignore
                                        showToast('บันทึกทั้งหมดไม่สำเร็จ', result.data?.message || 'กรุณาลองใหม่', 'error');
                                    }
                                    await update();
                                };
                            }}>
                                <input type="hidden" name="mappings" value={mappingDraftPayload}>
                                <div class="grid grid-cols-2 gap-2">
                                    <button type="submit" class="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold">บันทึกทั้งหมด</button>
                                    <button type="button" onclick={printUnmatchedEvidenceFiles} class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold">PDF รายชื่อไม่เจอ</button>
                                </div>
                            </form>
                            <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {#each unmatchedEvidenceFiles as file (file.id)}
                                    {@const draft = getMappingDraft(file)}
                                    <form method="POST" action="?/updateSubmissionMapping" use:enhance={() => {
                                        startProcessing('กำลังอัปเดต mapping...');
                                        return async ({ result, update }) => {
                                            stopProcessing();
                                            if (result.type === 'success') {
                                                showToast('อัปเดตแล้ว', 'แก้ชื่อหรือประเภทไฟล์เรียบร้อย', 'success');
                                            } else {
                                                // @ts-ignore
                                                showToast('อัปเดตไม่สำเร็จ', result.data?.message || 'กรุณาลองใหม่', 'error');
                                            }
                                            await update();
                                        };
                                    }} class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-2 space-y-2">
                                        <input type="hidden" name="id" value={file.id}>
                                        <input name="name" value={draft.name} oninput={(e) => updateMappingDraft(file, { name: e.currentTarget.value })} class="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-200">
                                        <div class="flex gap-2">
                                            <select name="evidence_type" value={draft.evidence_type} onchange={(e) => updateMappingDraft(file, { evidence_type: e.currentTarget.value as 'eve' | 'cer' })} class="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-200">
                                                <option value="eve">eve</option>
                                                <option value="cer">cer</option>
                                            </select>
                                            <button type="submit" class="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold">บันทึก</button>
                                        </div>
                                    </form>
                                {/each}
                            </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                {#if adminWorkspaceTab === 'overview'}
                <div class="p-4 space-y-3">
                    <div class="flex flex-col sm:flex-row gap-2">
                        <input bind:value={evidenceSearch} placeholder="ค้นหาลำดับหรือชื่อ" class="flex-1 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-600 focus:outline-none focus:border-brand-500">
                        <select bind:value={evidenceFilter} class="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-900 dark:text-zinc-200">
                            <option value="all">ทั้งหมด</option>
                            <option value="missing">ยังไม่ครบ</option>
                            <option value="missing-eve">ขาด eve</option>
                            <option value="missing-cer">ขาด cer</option>
                            <option value="complete">ครบแล้ว</option>
                        </select>
                    </div>
                    <div class="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-[520px] print:max-h-none">
                        <table class="w-full text-xs print:text-[11px]">
                            <thead class="sticky top-0 bg-zinc-100 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 print:static">
                                <tr>
                                    <th class="text-left p-2 w-16">ลำดับ</th>
                                    <th class="text-left p-2">ชื่อ-สกุล</th>
                                    <th class="text-center p-2 w-20">eve</th>
                                    <th class="text-center p-2 w-20">cer</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each evidenceReportRows as row (`${row.order}-${row.key}`)}
                                    <tr class="border-t border-zinc-200 dark:border-zinc-900">
                                        <td class="p-2 text-zinc-500 dark:text-zinc-400">{row.order}</td>
                                        <td class="p-2 text-zinc-950 dark:text-zinc-100">{row.fullName}</td>
                                        <td class="p-2 text-center">
                                            <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg font-black {row.eve ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-zinc-900 text-zinc-600 border border-zinc-800'}">{statusMark(row.eve)}</span>
                                        </td>
                                        <td class="p-2 text-center">
                                            <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg font-black {row.cer ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-zinc-900 text-zinc-600 border border-zinc-800'}">{statusMark(row.cer)}</span>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </div>
                {/if}
            </div>
        {/if}
    </div>
    {/if}

    <!-- Explorer section -->
    {#if adminWorkspaceTab === 'files'}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 min- ">
        <!-- Left panel: Collections manager -->
        {#if isCollectionsPanelOpen}
            <div class="lg:col-span-1 space-y-4 min-h-full">
                <div class="glass p-5 rounded-2xl space-y-4">
                    <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
                        <h3 class="font-bold text-sm text-zinc-200">หัวข้อส่งรูป</h3>
                        <span class="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">{activeCollections.length}</span>
                    </div>

                    <!-- Active Collections -->
                    <div class="space-y-2 overflow-y-auto pr-1">
                        {#each activeCollections as col (col.id)}
                            {@const count = data.submissions.filter((s: any) => s.collection_id === col.id && !s.is_deleted).length}
                            <div class="flex flex-col p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-800/20 transition-all gap-2">
                                {#if editingLimitId === col.id}
                                    <form method="POST" action="?/updateCollectionLimit" class="space-y-2 w-full" use:enhance={() => {
                                        return async ({ result, update }) => {
                                            editingLimitId = null;
                                            if (result.type === 'success') {
                                                showToast('แก้ไขสำเร็จ', 'ปรับขีดจำกัดการรับรูปเรียบร้อย', 'success');
                                            } else {
                                                // @ts-ignore
                                                showToast('ล้มเหลว', result.data?.message || 'ปรับปรุงจำกัดล้มเหลว', 'error');
                                            }
                                            await update();
                                        };
                                    }}>
                                        <input type="hidden" name="id" value={col.id} />
                                        <div class="flex items-center justify-between">
                                            <span class="text-[10px] font-semibold text-zinc-400">แก้ไขจำนวนจำกัด (/{col.name})</span>
                                            <button type="button" onclick={() => editingLimitId = null} class="text-[10px] text-zinc-500 hover:text-zinc-300">ยกเลิก</button>
                                        </div>
                                        <div class="flex items-center gap-1.5">
                                            <input
                                                type="number"
                                                name="limit"
                                                bind:value={editingLimitValue}
                                                min="1"
                                                class="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                            />
                                            <button type="submit" class="px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-[10px] font-semibold transition-colors">บันทึก</button>
                                        </div>
                                    </form>
                                {:else}
                                    <div class="flex items-center justify-between w-full">
                                        <div class="space-y-1 truncate">
                                            <div class="flex items-center space-x-2">
                                                <span class="font-semibold text-xs text-white truncate">/{col.name}</span>
                                            </div>
                                            <p class="text-[9px] text-zinc-500">Bucket: <code class="text-zinc-400">images/{col.name}/</code></p>
                                        </div>
                                        <div class="flex items-center space-x-2 shrink-0">
                                            <span class="text-[9.5px] font-medium text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">{count}/{col.submission_limit} รูป</span>
                                        </div>
                                    </div>
                                    
                                    <!-- Visual quota progress bar -->
                                    <div class="w-full bg-zinc-900/15 dark:bg-zinc-800 rounded-full h-1">
                                        <div class="h-1 rounded-full {count >= col.submission_limit ? 'bg-rose-500' : (count >= col.submission_limit * 0.9 ? 'bg-amber-500' : 'bg-brand-500')}"
                                            style="width: {Math.min(100, (count / col.submission_limit) * 100)}%"></div>
                                    </div>

                                    <div class="flex items-center justify-between w-full pt-1 border-t border-zinc-800/40">
                                        <div class="flex gap-1.5">
                                            {#if count >= col.submission_limit}
                                                <span class="text-[9px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">เต็มแล้ว</span>
                                            {:else}
                                                {#if count >= col.submission_limit * 0.9}
                                                    <span class="text-[9px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">ใกล้เต็ม</span>
                                                {/if}
                                            {/if}
                                        </div>
                                        <div class="flex items-center space-x-2">
                                        <!-- Toggle active -->
                                        <form method="POST" action="?/toggleCollection" use:enhance>
                                            <input type="hidden" name="id" value={col.id}>
                                            <button type="submit" title="สลับสถานะการเปิดรับรูปภาพ" aria-label="สลับสถานะการเปิดรับรูปภาพ"
                                                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {col.is_active ? 'bg-brand-600' : 'bg-zinc-800'}">
                                                <span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out {col.is_active ? 'translate-x-4' : 'translate-x-0'}"></span>
                                            </button>
                                        </form>

                                        <!-- Edit Limit -->
                                        {#if data.userRole === 'admin' || data.userRole === 'staff'}
                                            <button onclick={() => startEditLimit(col)}
                                                class="text-zinc-500 hover:text-brand-500 p-1 rounded transition-colors" title="แก้ไขจำนวนรูปสูงสุด">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                            </button>
                                        {/if}

                                        <!-- Soft Delete -->
                                        {#if data.userRole === 'admin'}
                                            <form method="POST" action="?/deleteCollection" use:enhance>
                                                <input type="hidden" name="id" value={col.id}>
                                                <button type="button"
                                                    onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ลบหัวข้อ', `คุณต้องการย้ายหัวข้อ "/${col.name}" และรูปภาพทั้งหมดไปยังถังขยะใช่หรือไม่? (สามารถกู้คืนได้)`, () => form?.requestSubmit(), 'danger'); }}
                                                    class="text-zinc-500 hover:text-rose-500 p-1 rounded transition-colors" title="ลบ (ย้ายไปถังขยะ)">
                                                    <Trash2 class="w-3.5 h-3.5" />
                                                </button>
                                            </form>
                                        {/if}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <!-- Recycle Bin for deleted collections -->
                    {#if deletedCollections.length > 0 && data.userRole === 'admin'}
                        <div class="border-t border-zinc-800 pt-3 space-y-2">
                            <p class="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
                                <Trash2 class="w-3 h-3 text-rose-500" />
                                ถังขยะหัวข้อ ({deletedCollections.length})
                            </p>
                            {#each deletedCollections as col (col.id)}
                                <div class="flex items-center justify-between p-2.5 rounded-xl border border-rose-900/30 bg-rose-950/20">
                                    <span class="text-xs text-zinc-500 line-through truncate mr-2">/{displayName(col.name)}</span>
                                    <div class="flex items-center gap-1 shrink-0">
                                        <!-- Restore -->
                                        <form method="POST" action="?/restoreCollection" use:enhance={() => {
                                            return async ({ result, update }) => {
                                                if (result.type === 'success') {
                                                    showToast('กู้คืนสำเร็จ', `หัวข้อ "${displayName(col.name)}" ถูกกู้คืนแล้ว`, 'success');
                                                }
                                                update();
                                            };
                                        }}>
                                            <input type="hidden" name="id" value={col.id}>
                                            <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('กู้คืนหัวข้อ', `คุณต้องการกู้คืนหัวข้อ "${displayName(col.name)}" กลับมาใช้งานใช่หรือไม่?`, () => form?.requestSubmit(), 'success'); }} title="กู้คืนหัวข้อ"
                                                class="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-500/10 transition-colors">
                                                <RotateCcw class="w-3.5 h-3.5" />
                                            </button>
                                        </form>
                                        <!-- Permanent delete -->
                                        <form method="POST" action="?/deleteCollectionPermanently" use:enhance={() => {
                                            return async ({ result, update }) => {
                                                if (result.type === 'success') {
                                                    showToast('ลบถาวรสำเร็จ', `หัวข้อถูกลบออกจากระบบแล้ว`, 'success');
                                                }
                                                update();
                                            };
                                        }}>
                                            <input type="hidden" name="id" value={col.id}>
                                            <button type="button"
                                                onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ลบหัวข้อถาวร', `ลบถาวรหัวข้อ "/${displayName(col.name)}" และรูปภาพทั้งหมดถาวรใช่หรือไม่?\n⚠️ การกระทำนี้ไม่สามารถกู้คืนได้!`, () => form?.requestSubmit(), 'danger'); }}
                                                title="ลบถาวร"
                                                class="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors">
                                                <Trash2 class="w-3.5 h-3.5" />
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- Right panel: Explorer -->
        {#if adminWorkspaceTab === 'files'}
        <div class="{isCollectionsPanelOpen ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4 transition-all duration-300">
            <div class="glass rounded-2xl border border-zinc-800 overflow-hidden flex flex-col h-140">
                <!-- Header bar -->
                <div class="bg-zinc-900/95 border-b border-zinc-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                    <div class="flex items-center space-x-2.5">
                        <button onclick={navigateUp} disabled={currentExplorerPath.length === 0} class="p-2 bg-zinc-950 border border-zinc-800 rounded hover:bg-zinc-800/80 transition-all text-zinc-400 disabled:opacity-30 disabled:pointer-events-none" title="ขึ้นไปโฟลเดอร์เดิม">
                            <ArrowUp class="w-4 h-4" />
                        </button>
                        <button onclick={() => navigateToPath([])} class="p-2 bg-zinc-950 border border-zinc-800 rounded hover:bg-zinc-800/80 transition-all text-zinc-400" title="หน้าแรก">
                            <Home class="w-4 h-4" />
                        </button>
                        <span class="font-bold text-zinc-300 font-sans tracking-wide truncate" id="explorer-window-title">
                            Root{currentExplorerPath.length > 0 ? ' / ' + currentExplorerPath.join(' / ') : ''}
                        </span>
                    </div>

                    <div class="flex items-center space-x-2">
                        <div class="relative flex-1 sm:w-44">
                            <input type="text" bind:value={searchExplorerQuery} placeholder="ค้นหาในโฟลเดอร์นี้..." class="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 pl-8 py-2 text-zinc-300 placeholder-zinc-650 focus:outline-none focus:border-brand-500 font-sans">
                            <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-650">
                                <Search class="w-3.5 h-3.5" />
                            </div>
                        </div>

                        {#if data.username?.toLowerCase() === 'guyssar' && hasVisibleFiles}
                            <button type="button" onclick={toggleSelectAll} class="p-2 bg-zinc-950 border border-zinc-800 rounded hover:bg-zinc-800/80 transition-all text-zinc-400 flex items-center space-x-1.5 text-xs font-sans" title={isAllSelected ? "ยกเลิกการเลือกทั้งหมด" : "เลือกทั้งหมด"}>
                                <CheckSquare class="w-4 h-4 {isAllSelected ? 'text-emerald-400' : ''}" />
                                <span class="hidden md:inline">{isAllSelected ? "ยกเลิกเลือก" : "เลือกทั้งหมด"}</span>
                            </button>
                        {/if}

                        {#if selectedExplorerIds.size > 0}
                            <!-- Restore selected (if in deleted drive) -->
                            {#if currentExplorerPath[0] === 'deleted'}
                                <div class="flex items-center space-x-1.5">
                                    <form method="POST" action="?/restoreSubmissions" use:enhance={() => {
                                        startProcessing('กำลังกู้คืนรูปภาพที่เลือก...');
                                        return async ({ result, update }) => {
                                            stopProcessing();
                                            if (result.type === 'success') {
                                                showToast('กู้คืนสำเร็จ', 'กู้คืนรูปภาพที่เลือกเรียบร้อยแล้ว', 'success');
                                                selectedExplorerIds.clear();
                                            }
                                            update();
                                        };
                                    }}>
                                        <input type="hidden" name="ids" value={JSON.stringify([...selectedExplorerIds])}>
                                        <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('กู้คืนภาพที่เลือก', 'คุณต้องการกู้คืนรูปภาพที่เลือกทั้งหมดใช่หรือไม่?', () => form?.requestSubmit(), 'success'); }} class="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/20 transition-all" title="กู้คืนที่เลือก">
                                            <RotateCcw class="w-4 h-4" />
                                        </button>
                                    </form>

                                    {#if data.username?.toLowerCase() === 'guyssar'}
                                        <form method="POST" action="?/deleteSubmissionsPermanently" use:enhance={() => {
                                            startProcessing('กำลังลบรูปภาพที่เลือกออกจาก R2 และระบบอย่างถาวร...');
                                            return async ({ result, update }) => {
                                                stopProcessing();
                                                if (result.type === 'success') {
                                                    showToast('ลบสำเร็จ', 'ลบภาพที่เลือกแบบถาวรเรียบร้อยแล้ว', 'success');
                                                    selectedExplorerIds.clear();
                                                }
                                                update();
                                            };
                                        }}>
                                            <input type="hidden" name="ids" value={JSON.stringify([...selectedExplorerIds])}>
                                            <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ลบภาพถาวร', 'คุณต้องการลบภาพที่เลือกแบบถาวรออกจากระบบและ R2 ใช่หรือไม่? (ไม่สามารถย้อนกลับได้)', () => form?.requestSubmit(), 'danger'); }} class="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded hover:bg-rose-500/20 transition-all" title="ลบถาวรที่เลือก">
                                                <Trash2 class="w-4 h-4" />
                                            </button>
                                        </form>
                                    {/if}
                                </div>
                            {:else}
                                <form method="POST" action="?/deleteSubmissions" use:enhance={() => {
                                    startProcessing('กำลังย้ายรูปภาพที่เลือกไปยังถังขยะ...');
                                    return async ({ result, update }) => {
                                        stopProcessing();
                                        if (result.type === 'success') {
                                            showToast('ลบเสร็จสิ้น', 'ลบภาพที่เลือกไปยังถังขยะเรียบร้อย', 'success');
                                            selectedExplorerIds.clear();
                                        }
                                        update();
                                    };
                                }}>
                                    <input type="hidden" name="ids" value={JSON.stringify([...selectedExplorerIds])}>
                                    <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ลบภาพที่เลือก', 'คุณต้องการลบภาพที่เลือกทั้งหมดไปยังถังขยะใช่หรือไม่?', () => form?.requestSubmit(), 'danger'); }} class="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded hover:bg-rose-500/20 transition-all" title="ลบที่เลือก">
                                        <Trash2 class="w-4 h-4" />
                                    </button>
                                </form>
                            {/if}
                        {/if}
                    </div>
                </div>

                <!-- Grid content -->
                <div class="flex-1 flex overflow-hidden">
                    <!-- Sidebar tree -->
                    <div class="w-48 border-r border-zinc-800 bg-zinc-900/10 p-3.5 overflow-y-auto hidden sm:block select-none text-xs text-zinc-400 space-y-2">
                        <div class="font-semibold text-[10px] text-zinc-500 uppercase tracking-wider mb-2">โครงสร้างไดเรกทอรี</div>
                        <button onclick={() => navigateToPath([])} class="flex items-center space-x-2 py-1 px-1.5 w-full rounded hover:bg-zinc-800 hover:text-white transition-all {currentExplorerPath.length === 0 ? 'bg-zinc-800 text-white font-medium' : ''}">
                            <HardDrive class="w-3.5 h-3.5 text-zinc-500" />
                            <span class="truncate">Root /</span>
                        </button>
                        {#each data.collections as col (col.id)}
                            <div class="space-y-1">
                                <div class="flex items-center w-full rounded hover:bg-zinc-800 hover:text-white transition-all group/item {currentExplorerPath.length === 1 && currentExplorerPath[0] === col.name ? 'bg-zinc-800 text-white font-medium' : ''}">
                                    <button onclick={() => navigateToPath([col.name])} class="flex items-center space-x-1.5 py-1 px-1 flex-1 text-left truncate">
                                        <Folder class="w-3.5 h-3.5 {col.id === 'deleted-drive' ? 'text-rose-500' : (col.name.endsWith('_deleted') ? 'text-zinc-600' : 'text-amber-500')} shrink-0" />
                                        <span class="truncate {col.name.endsWith('_deleted') ? 'line-through text-zinc-600' : ''}">/{col.id === 'deleted-drive' ? 'deleted' : col.name}</span>
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Files area -->
                    <div class="flex flex-wrap gap-4 flex-1 p-4 overflow-y-auto bg-zinc-950/30 min-h-[250px] content-start">
                        {#if explorerItems.length === 0}
                            <div class="w-full flex flex-col items-center justify-center text-zinc-500 py-16 text-center space-y-2">
                                <Folder class="w-10 h-10 text-zinc-700" />
                                <p class="text-xs">โฟลเดอร์นี้ไม่มีรายการข้อมูล</p>
                            </div>
                        {:else}
                            {#each explorerItems as it (it.id)}
                                {#if it.type === 'folder'}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div onclick={it.onClick} class="flex flex-col items-center p-4 rounded-xl border border-zinc-900 bg-zinc-900/30 hover:bg-zinc-800/20 hover:border-zinc-800 cursor-pointer select-none text-center transition-all group relative w-[130px] shrink-0">
                                        <button onclick={(e) => downloadFolderZipDirect(it.name, e)} class="absolute top-2 right-2 p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800/80 rounded bg-zinc-950/40 opacity-0 group-hover:opacity-100 transition-all z-20" title="ดาวน์โหลดโดยตรงนี้ (.zip)">
                                            <Download class="w-3.5 h-3.5" />
                                        </button>
                                        <div class="p-2 relative">
                                            <Folder class="w-12 h-12 {it.colorClass} fill-current/10 transition-transform group-hover:scale-105" />
                                        </div>
                                        <span class="text-xs font-semibold text-zinc-200 mt-2 truncate w-full group-hover:text-white" title={it.name}>{it.name}</span>
                                        <span class="text-[10px] text-zinc-500 mt-0.5">{it.subText}</span>
                                    </div>
                                {:else}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div onclick={() => openAdminLightbox(it.id)} class="flex flex-col rounded-xl overflow-hidden border cursor-pointer select-none transition-all group relative w-[130px] shrink-0 {selectedExplorerIds.has(it.id) ? 'border-brand-500 bg-brand-500/10' : 'border-zinc-900 bg-zinc-900/30 hover:bg-zinc-800/20 hover:border-zinc-800'}">
                                        <div class="h-24 bg-zinc-950/80 flex items-center justify-center overflow-hidden border-b border-zinc-900/80 relative">
                                            <img src={it.img_data} loading="lazy" decoding="async" class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" alt="Thumbnail">
                                            <button onclick={(e) => toggleSelectFile(it.id, e)} class="absolute top-2 left-2 z-10 p-1 rounded hover:bg-zinc-900/80" title="เลือก">
                                                <input type="checkbox" checked={selectedExplorerIds.has(it.id)} class="rounded border-zinc-700 bg-zinc-900 text-brand-600 focus:ring-brand-500 pointer-events-none w-4 h-4 shadow">
                                            </button>
                                            <button onclick={(e) => openSubmissionMappingEditor(it, e)} class="absolute top-2 right-2 z-10 p-1.5 rounded bg-zinc-950/70 text-zinc-300 hover:text-white hover:bg-zinc-800/90 opacity-0 group-hover:opacity-100 transition-all" title="แก้ชื่อหรือ folder">
                                                <MoreVertical class="w-3.5 h-3.5" />
                                            </button>
                                            <!-- <span class="absolute bottom-1 right-1.5 text-[9px] bg-zinc-950/70 text-zinc-400 px-1 py-0.5 rounded font-mono">{it.subText}</span> -->
                                        </div>
                                        <div class="p-2 text-left space-y-0.5">
                                            <p class="text-[10px] font-semibold text-zinc-200 truncate group-hover:text-white" title={it.name}>{it.name}</p>
                                            <div class="flex items-center justify-between text-[9px] text-zinc-500">
                                                <span class="truncate text-zinc-700 dark:text-zinc-400 font-mono font-medium">ดิบ: {formatBytes(it.original_size)}</span>
                                                <button onclick={(e) => downloadSingleImage(it.id, e)} class="text-zinc-500 hover:text-white" title="ดาวน์โหลด">
                                                    <Download class="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                {/if}
                            {/each}
                        {/if}
                    </div>
                </div>
            </div>
        </div>
        {/if}
    </div>
    {/if}
</section>

<!-- Modal: Add New Collection -->
{#if editingSubmission}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
        <div class="glass max-w-sm w-full rounded-2xl p-6 shadow-2xl relative border border-zinc-800 space-y-4">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 class="text-sm font-bold text-white">แก้ชื่อ / folder</h3>
                <button onclick={() => editingSubmission = null} class="text-zinc-500 hover:text-white">
                    <Trash2 class="w-4 h-4 rotate-45" />
                </button>
            </div>

            <form method="POST" action="?/updateSubmissionMapping" use:enhance={() => {
                startProcessing('กำลังอัปเดตไฟล์...');
                return async ({ result, update }) => {
                    stopProcessing();
                    if (result.type === 'success') {
                        showToast('อัปเดตแล้ว', 'แก้ชื่อหรือ folder เรียบร้อย', 'success');
                        editingSubmission = null;
                    } else {
                        // @ts-ignore
                        showToast('อัปเดตไม่สำเร็จ', result.data?.message || 'กรุณาลองใหม่', 'error');
                    }
                    await update();
                };
            }} class="space-y-3">
                <input type="hidden" name="id" value={editingSubmission.id}>
                <label class="block text-xs font-semibold text-zinc-400 space-y-1">
                    <span>ชื่อ-สกุล</span>
                    <input name="name" bind:value={editingSubmissionName} class="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200">
                </label>
                <label class="block text-xs font-semibold text-zinc-400 space-y-1">
                    <span>folder</span>
                    <select name="evidence_type" bind:value={editingSubmissionType} class="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-200">
                        <option value="eve">eve</option>
                        <option value="cer">cer</option>
                    </select>
                </label>
                <div class="flex justify-end gap-2 pt-2">
                    <button type="button" onclick={() => editingSubmission = null} class="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs">ยกเลิก</button>
                    <button type="submit" class="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold">บันทึก</button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Modal: Add New Collection -->
{#if isAddColModalOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="glass max-w-sm w-full rounded-2xl p-6 shadow-2xl relative border border-zinc-800">
            <h3 class="text-base font-bold text-white mb-2">เพิ่มหัวข้อจัดเก็บรูปใหม่</h3>
            <p class="text-xs text-zinc-400 mb-4">ชื่อหัวข้อจะถูกแปลงเป็นอักษรภาษาอังกฤษตัวเล็กในการจำลองโครงสร้างไดเรกทอรี</p>

            <form method="POST" action="?/addCollection" use:enhance={() => {
                return async ({ result, update }) => {
                    if (result.type === 'success') {
                        showToast('สร้างสำเร็จ', 'สร้างหัวข้อการจัดเก็บข้อมูลเรียบร้อยแล้ว', 'success');
                        isAddColModalOpen = false;
                    } else {
                        // @ts-ignore
                        showToast('เกิดข้อผิดพลาด', result.data?.message || 'เพิ่มล้มเหลว', 'error');
                    }
                    update();
                };
            }} class="space-y-4">
                <input type="text" name="name" required placeholder="เช่น ewe, camp-science"
                    class="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500">
                <div class="flex justify-end space-x-2 pt-2">
                    <button type="button" onclick={() => isAddColModalOpen = false} class="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-800 text-xs font-semibold">ยกเลิก</button>
                    <button type="submit" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold">สร้างโฟลเดอร์</button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Modal: Choose Download Scope -->
{#if isDownloadZipModalOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="glass max-w-md w-full rounded-2xl p-6 shadow-2xl relative border border-zinc-800 space-y-4">
            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
                <h3 class="text-sm font-bold text-white">ดาวน์โหลดไฟล์ทีกอัด (.ZIP)</h3>
                <button onclick={() => isDownloadZipModalOpen = false} class="text-zinc-500 hover:text-white">
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore component_name_lowercase -->
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>

            <div class="space-y-3">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div onclick={() => handleZipDownload('folder')} class="flex items-start p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 cursor-pointer transition-all">
                    <div class="p-2 bg-brand-500/10 rounded-lg text-brand-500 border border-brand-500/20 mr-3 mt-0.5">
                        <Folder class="w-4 h-4" />
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                            {#if currentExplorerPath.length === 0}
                                ดาวน์โหลดเฉพาะที่นำทาง (เลือกไฟล์ก่อน)
                            {:else if currentExplorerPath.length === 1}
                                ดาวน์โหลดเฉพาะไดรฟ์ /{currentExplorerPath[0]}
                            {:else}
                                ดาวน์โหลดเฉพาะกลุ่ม {currentExplorerPath[1]}
                            {/if}
                        </h4>
                        <p class="text-[10px] text-zinc-500 mt-1">รูปภาพทั้งหมดจะถูกโหลดเป็นสกุล JPEG (.jpg) บรรจุใน ZIP</p>
                    </div>
                </div>

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div onclick={() => handleZipDownload('all')} class="flex items-start p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 cursor-pointer transition-all">
                    <div class="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20 mr-3 mt-0.5">
                        <HardDrive class="w-4 h-4" />
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-zinc-700 dark:text-zinc-200">ดาวน์โหลดรูปภาพทั้งหมดในระบบ</h4>
                        <p class="text-[10px] text-zinc-500 mt-1">บีบอัดรูปภาพทุกหัวข้อเปิดรับมา แบ่งเป็นโฟลเดอร์ตามโครงสร้างจริงเป็น JPEG</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Lightbox Modal: Admin Viewer -->
{#if isAdminLightboxOpen && currentViewerIndex !== -1}
    {@const file = viewerFiles[currentViewerIndex]}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm" onclick={() => isAdminLightboxOpen = false}>
        <button onclick={() => isAdminLightboxOpen = false} class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2.5 z-50 transition-colors" title="ปิด">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>

        <div class="max-w-4xl max-h-[85vh] w-full px-4 flex items-center justify-center relative" onclick={(e) => e.stopPropagation()}>
            <button onclick={prevImage} disabled={currentViewerIndex === 0}
                class="absolute left-4 p-3 bg-zinc-900/60 border border-zinc-800 text-white rounded-full hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all z-10">
                <ChevronLeft class="w-6 h-6" />
            </button>

            <button onclick={nextImage} disabled={currentViewerIndex === viewerFiles.length - 1}
                class="absolute right-4 p-3 bg-zinc-900/60 border border-zinc-800 text-white rounded-full hover:bg-zinc-800 disabled:opacity-20 disabled:pointer-events-none transition-all z-10">
                <ChevronRight class="w-6 h-6" />
            </button>

            <div class="flex flex-col items-center space-y-4 max-w-full">
                <img src={file.img_data} loading="lazy" decoding="async" class="max-h-[70vh] max-w-full w-auto object-contain rounded-lg shadow-2xl border border-zinc-800 select-none" alt={file.name}>
                <div class="text-center space-y-1 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 w-full max-w-lg" style="background: rgba(9, 9, 11, 0.85) !important; border-color: rgba(63, 63, 70, 0.4) !important;">
                    <h4 class="text-sm font-semibold" style="color: #ffffff !important;">{file.name}</h4>
                    <p class="text-xs" style="color: #a1a1aa !important;">เส้นทาง: images/{file.file_path} | ขนาดเดิม: {formatBytes(file.original_size)}</p>
                </div>
            </div>
        </div>
    </div>
{/if}

{/if}

<!-- Custom Confirmation Modal -->
{#if isConfirmModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="confirm-modal-bg" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4" onclick={closeConfirmModal}>
        <div id="confirm-modal-box" class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 space-y-6 text-center" onclick={(e) => e.stopPropagation()}>
            <div class="mx-auto w-16 h-16 rounded-full flex items-center justify-center {confirmTheme === 'danger' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' : (confirmTheme === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border border-amber-500/20 text-amber-400')}">
                {#if confirmTheme === 'danger'}
                    <Trash2 class="w-8 h-8" />
                {:else if confirmTheme === 'success'}
                    <RotateCcw class="w-8 h-8" />
                {:else}
                    <CloudUpload class="w-8 h-8" />
                {/if}
            </div>
            
            <div class="space-y-2">
                <h3 class="text-xl font-bold" style="color: var(--text-primary) !important;">{confirmTitle}</h3>
                <p class="text-xs sm:text-sm" style="color: var(--text-secondary) !important;">{confirmMessage}</p>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <button onclick={closeConfirmModal} 
                    style="background: var(--admin-btn-bg) !important; border-color: var(--admin-btn-border) !important; color: var(--admin-btn-text) !important;"
                    class="w-full font-medium py-2.5 rounded-xl transition-all text-sm border focus:outline-none">
                    ยกเลิก
                </button>
                <button onclick={() => { if (confirmAction) confirmAction(); }} 
                    class="w-full text-white font-medium py-2.5 rounded-xl transition-all text-sm shadow-lg focus:outline-none {confirmTheme === 'danger' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/10' : (confirmTheme === 'success' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/10' : 'bg-brand-600 hover:bg-brand-700 shadow-brand-600/10')}">
                    ยืนยัน
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Processing Overlay Modal -->
{#if isProcessing}
    <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
        <div class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl border border-zinc-800 space-y-6 text-center">
            <div class="mx-auto w-16 h-16 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                <Loader2 class="w-8 h-8 animate-spin" />
            </div>
            
            <div class="space-y-4">
                <div class="space-y-1">
                    <h3 class="text-lg font-bold" style="color: var(--text-primary) !important;">กำลังประมวลผล</h3>
                    <p class="text-xs sm:text-sm" style="color: var(--text-secondary) !important;">{processingText}</p>
                </div>

                <div class="space-y-1.5">
                    <div class="h-2 w-full bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden p-[1px]">
                        <div class="h-full bg-gradient-to-r from-brand-500 to-emerald-400 rounded-full transition-all duration-300 ease-out" style="width: {progressPercent}%;"></div>
                    </div>
                    <div class="flex justify-between text-[10px] text-zinc-500 font-mono">
                        <span>ความคืบหน้า</span>
                        <span>{Math.round(progressPercent)}%</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Modal: User Management -->
{#if isUserManagementOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
        <div class="glass max-w-2xl w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 flex flex-col max-h-[85vh]">
            <button onclick={() => isUserManagementOpen = false} class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2 z-10 transition-colors" title="ปิด">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>

            <div class="flex items-center space-x-2 border-b border-zinc-800 pb-3 mb-4">
                <User class="w-5 h-5 text-violet-400" />
                <h3 class="text-base font-bold text-white">จัดการบัญชีผู้ใช้งานระบบ</h3>
            </div>

            <div class="flex-1 overflow-y-auto space-y-6 pr-1">
                <!-- Section: Create User -->
                <div class="bg-zinc-950/40 border border-zinc-900 rounded-2xl p-4 space-y-3">
                    <h4 class="text-xs font-bold text-zinc-200">สร้างบัญชีผู้ใช้งานใหม่</h4>
                    <form method="POST" action="?/createUser" use:enhance={() => {
                        startProcessing('กำลังสร้างบัญชีผู้ใช้งานใหม่...');
                        return async ({ result, update }) => {
                            stopProcessing();
                            if (result.type === 'success') {
                                showToast('สำเร็จ', 'สร้างบัญชีผู้ใช้เรียบร้อยแล้ว', 'success');
                                createUsername = '';
                                createPassword = '';
                            } else {
                                // @ts-ignore
                                showToast('ล้มเหลว', result.data?.message || 'สร้างบัญชีล้มเหลว', 'error');
                            }
                            await update();
                        };
                    }} class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                        <div class="sm:col-span-1 space-y-1">
                            <label class="text-[10px] font-semibold text-zinc-400 block">
                                ชื่อผู้ใช้
                                <input type="text" name="username" bind:value={createUsername} required placeholder="username" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1 font-normal">
                            </label>
                        </div>
                        <div class="sm:col-span-1 space-y-1">
                            <label class="text-[10px] font-semibold text-zinc-400 block">
                                รหัสผ่าน
                                <input type="password" name="password" bind:value={createPassword} required placeholder="••••••••" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1 font-normal">
                            </label>
                        </div>
                        <div class="sm:col-span-1 space-y-1">
                            <label class="text-[10px] font-semibold text-zinc-400 block">
                                บทบาท (Role)
                                <select name="role" bind:value={createRole} class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-brand-500 mt-1 font-normal">
                                    <option value="staff">Staff (ผู้ใช้งานทั่วไป)</option>
                                    <option value="admin">ผู้ดูแลระบบ</option>
                                </select>
                            </label>
                        </div>
                        <div class="sm:col-span-1">
                            <button type="submit" class="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-1.5 rounded-lg text-xs transition-colors shadow">สร้างผู้ใช้</button>
                        </div>
                    </form>
                </div>

                <!-- Section: Users List -->
                <div class="space-y-2">
                    <h4 class="text-xs font-bold text-zinc-200">รายชื่อบัญชีในระบบ</h4>
                    <div class="border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-900">
                        {#if (data.usersList ?? data.users) && (data.usersList ?? data.users).length > 0}
                            {#each (data.usersList ?? data.users) as user (user.username)}
                                <div class="p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                                    <div class="flex items-center space-x-2.5">
                                        <div class="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                                            <User class="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div class="flex items-center space-x-1.5">
                                                <span class="font-bold text-zinc-200">{user.username}</span>
                                                <span class="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase {user.role === 'admin' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-brand-500/10 text-brand-400 border border-brand-500/20'}">{user.role}</span>
                                            </div>
                                            <p class="text-[9px] text-zinc-500">สร้างเมื่อ: {new Date(user.created_at).toLocaleDateString('th-TH')} {new Date(user.created_at).toLocaleTimeString('th-TH')}</p>
                                        </div>
                                    </div>

                                    <div class="flex items-center space-x-2">
                                        {#if changePasswordUsername === user.username}
                                            <form method="POST" action="?/changeUserPassword" use:enhance={() => {
                                                startProcessing('กำลังเปลี่ยนรหัสผ่าน...');
                                                return async ({ result, update }) => {
                                                    stopProcessing();
                                                    if (result.type === 'success') {
                                                        showToast('สำเร็จ', 'เปลี่ยนรหัสผ่านสำเร็จ', 'success');
                                                        changePasswordUsername = '';
                                                        changePasswordNewPassword = '';
                                                    } else {
                                                        // @ts-ignore
                                                        showToast('ล้มเหลว', result.data?.message || 'เปลี่ยนรหัสผ่านล้มเหลว', 'error');
                                                    }
                                                    await update();
                                                };
                                            }} class="flex items-center gap-1">
                                                <input type="hidden" name="username" value={user.username}>
                                                <input type="password" name="password" bind:value={changePasswordNewPassword} required placeholder="รหัสผ่านใหม่" class="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-brand-500 w-28">
                                                <button type="submit" class="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1 text-[10px] font-semibold">บันทึก</button>
                                                <button type="button" onclick={() => changePasswordUsername = ''} class="text-[10px] text-zinc-500 hover:text-zinc-300 px-1">ยกเลิก</button>
                                            </form>
                                        {:else}
                                            <button type="button" onclick={() => { changePasswordUsername = user.username; changePasswordNewPassword = ''; }} class="bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white px-2 py-1 rounded text-[10px] font-medium flex items-center space-x-1">
                                                <Lock class="w-3 h-3 text-zinc-500" />
                                                <span>[Change Password]</span>
                                            </button>
                                            
                                            {#if user.username?.toLowerCase() !== 'guyssar'}
                                                <form method="POST" action="?/deleteUser" use:enhance={() => {
                                                    startProcessing('กำลังลบผู้ใช้...');
                                                    return async ({ result, update }) => {
                                                        stopProcessing();
                                                        if (result.type === 'success') {
                                                            showToast('สำเร็จ', 'ลบบัญชีผู้ใช้งานสำเร็จ', 'success');
                                                        } else {
                                                            // @ts-ignore
                                                            showToast('ล้มเหลว', result.data?.message || 'ลบล้มเหลว', 'error');
                                                        }
                                                        await update();
                                                    };
                                                }}>
                                                    <input type="hidden" name="username" value={user.username}>
                                                    <button type="button" onclick={(e) => { const form = e.currentTarget.closest('form'); showConfirm('ลบผู้ใช้', `คุณต้องการลบผู้ใช้ "${user.username}" หรือไม่?`, () => form?.requestSubmit(), 'danger'); }} class="bg-rose-600/15 border border-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white px-2 py-1 rounded text-[10px] font-medium">
                                                        ลบผู้ใช้
                                                    </button>
                                                </form>
                                            {/if}
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        {:else}
                            <div class="p-8 text-center text-zinc-500 text-xs">
                                ไม่มีผู้ใช้งานอื่นในระบบนอกเหนือจากตัวท่าน
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="border-t border-zinc-800 pt-3 mt-4 flex justify-end">
                <button onclick={() => isUserManagementOpen = false} class="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-800 text-xs font-semibold">ปิดหน้าต่าง</button>
            </div>
        </div>
    </div>
{/if}

<!-- Toast Notifications -->
<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
    {#each toasts as toast (toast.id)}
        <div class="glass px-4 py-3 rounded-xl shadow-xl flex flex-col border border-zinc-800 text-left min-w-[250px]">
            <span class="text-xs font-bold {toast.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}">{toast.title}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5">{toast.desc}</span>
        </div>
    {/each}
</div>
