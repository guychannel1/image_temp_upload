<script lang="ts">
    import { enhance } from '$app/forms';
    import { 
        Folder, ArrowUp, Home, Search, Trash2, FolderPlus, Download, 
        Power, ChevronLeft, ChevronRight, ChevronDown, HardDrive, FolderGit2,
        RefreshCw, Sidebar, RotateCcw, CloudUpload, User, Lock, CheckSquare, Loader2
    } from '@lucide/svelte';
    import { gsap } from 'gsap';

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

    let expandedCollections = $state<Record<string, boolean>>({});
    function toggleCollectionExpand(colId: string) {
        if (expandedCollections[colId] === undefined) {
            const col = data.collections.find((c: any) => c.id === colId);
            const isCurrentlyActive = col ? currentExplorerPath[0] === col.name : false;
            expandedCollections[colId] = !isCurrentlyActive;
        } else {
            expandedCollections[colId] = !expandedCollections[colId];
        }
    }

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

    $effect(() => {
        if (isConfirmModalOpen) {
            setTimeout(() => {
                const modalBg = document.getElementById('confirm-modal-bg');
                const modalBox = document.getElementById('confirm-modal-box');
                if (modalBg && modalBox) {
                    gsap.fromTo(modalBg, { opacity: 0 }, { opacity: 1, duration: 0.3 });
                    gsap.fromTo(modalBox, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.7)' });
                }
            }, 10);
        }
    });

    function closeConfirmModal() {
        const modalBg = document.getElementById('confirm-modal-bg');
        const modalBox = document.getElementById('confirm-modal-box');
        if (modalBg && modalBox) {
            gsap.to(modalBox, { scale: 0.8, opacity: 0, duration: 0.2, ease: 'power2.in' });
            gsap.to(modalBg, { opacity: 0, duration: 0.25, onComplete: () => {
                isConfirmModalOpen = false;
            }});
        } else {
            isConfirmModalOpen = false;
        }
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
                const colSubmissions = data.submissions.filter((s: any) => s.collection_id === colObj.id);
                const groups = [...new Set<string>(colSubmissions.map((s: any) => s.group_name))];
                return groups.map(group => {
                    const imgCount = colSubmissions.filter((s: any) => s.group_name === group).length;
                    return {
                        type: 'folder',
                        id: `group-${group}`,
                        name: group,
                        subText: `${imgCount} รูปภาพ`,
                        colorClass: 'text-brand-500',
                        onClick: () => navigateToPath([colName, group])
                    };
                });
            } else {
                const colName = currentExplorerPath[0];
                const groupName = currentExplorerPath[1];
                const colObj = data.collections.find((c: any) => c.name === colName);
                if (!colObj) return [];
                return data.submissions
                    .filter((s: any) => s.collection_id === colObj.id && s.group_name === groupName)
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
        if (currentExplorerPath.length <= 1) {
            for (const col of targetCols) {
                const colSubmissions = data.submissions.filter((s: any) => s.collection_id === col.id);
                const groups = [...new Set<string>(colSubmissions.map((s: any) => s.group_name))];
                for (const gp of groups) {
                    if (gp.toLowerCase().includes(searchLower)) {
                        const imgCount = colSubmissions.filter((s: any) => s.group_name === gp).length;
                        items.push({
                            type: 'folder',
                            id: `group-${col.name}-${gp}`,
                            name: currentExplorerPath.length === 0 ? `/${col.name}/${gp}` : gp,
                            subText: `โฟลเดอร์ย่อย | ${imgCount} รูป`,
                            colorClass: 'text-brand-500',
                            onClick: () => { searchExplorerQuery = ''; navigateToPath([col.name, gp]); }
                        });
                    }
                }
            }
        }
        for (const col of targetCols) {
            let colSubmissions = data.submissions.filter((s: any) => s.collection_id === col.id);
            if (currentExplorerPath.length === 2) {
                colSubmissions = colSubmissions.filter((s: any) => s.group_name === currentExplorerPath[1]);
            }
            for (const sub of colSubmissions) {
                if (sub.name.toLowerCase().includes(searchLower)) {
                    items.push({
                        type: 'file',
                        id: sub.id,
                        name: sub.name,
                        subText: `${sub.collection_name}/${sub.group_name} | ${formatBytes(sub.file_size)}`,
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

    async function packZipSubmissions(zip: any, submissions: any[]) {
        let nextIndex = 0;
        let completedFiles = 0;
        let addedFiles = 0;

        async function worker() {
            while (nextIndex < submissions.length) {
                const sub = submissions[nextIndex++];
                try {
                    const image = await getZipImageBlob(sub);
                    const zipPath = `${sub.collection_name}/${sub.group_name}/${sub.name}.${image.extension}`;
                    zip.file(zipPath, image.blob);
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
                } else if (currentExplorerPath.length === 2) {
                    const colName = currentExplorerPath[0];
                    const groupName = currentExplorerPath[1];
                    targetSubmissions = data.submissions.filter((s: any) => s.collection_name === colName && s.group_name === groupName && !isDeletedDriveSubmission(s));
                    zipNamePrefix = `drive-${colName}-${groupName}`;
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
            const content = await zip.generateAsync({ type: 'blob' });
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
            const content = await zip.generateAsync({ type: 'blob' });
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
                <h1 class="text-2xl font-bold text-white tracking-tight">เข้าสู่ระบบหลังบ้าน</h1>
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
<!-- Admin Dashboard Section -->
<section class="space-y-6 w-full animate-fade-in">
    <!-- Admin title & buttons -->
    <div class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-800 pb-5 gap-4">
        <!-- <div>
            <h2 class="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
                <span>Dashboard</span>
            </h2>
            <p class="text-zinc-400 text-sm mt-1">บริหารจัดการหัวข้อเปิดรับรูปภาพ และดาวน์โหลดรูปภาพที่ส่งเข้ามาใน format ZIP สำหรับการประเมินผล</p>
        </div> -->
        <div class="flex flex-wrap justify-center w-full items-center gap-2">
            <button onclick={reloadData} disabled={isReloading} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 disabled:opacity-50 disabled:pointer-events-none">
                <RefreshCw class="w-4 h-4 text-emerald-400 {isReloading ? 'animate-spin' : ''}" />
                <span>{isReloading ? 'กำลังดึงข้อมูล...' : 'รีโหลดข้อมูล'}</span>
            </button>
            <button onclick={() => isCollectionsPanelOpen = !isCollectionsPanelOpen} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                <Sidebar class="w-4 h-4 text-brand-500" />
                <span>{isCollectionsPanelOpen ? 'ซ้อนแผงจัดการ' : 'แสดงแผงจัดการ'}</span>
            </button>
            <button onclick={() => isAddColModalOpen = true} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 animate-none">
                <FolderPlus class="w-4 h-4 text-brand-500" />
                <span>เพิ่มหัวข้อใหม่</span>
            </button>
            <button onclick={() => isDownloadZipModalOpen = true} class="bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-white flex items-center space-x-2 shadow-lg shadow-brand-600/10 animate-none">
                <Download class="w-4 h-4" />
                <span>ดาวน์โหลด ZIP</span>
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



    <!-- Explorer section -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left panel: Collections manager -->
        {#if isCollectionsPanelOpen}
            <div class="lg:col-span-1 space-y-4">
                <div class="glass p-5 rounded-2xl space-y-4">
                    <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
                        <h3 class="font-bold text-sm text-zinc-200">หัวข้อส่งรูป</h3>
                        <span class="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">{activeCollections.length}</span>
                    </div>

                    <!-- Active Collections -->
                    <div class="space-y-2 max-h-[300px] overflow-y-auto pr-1">
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
        <div class="{isCollectionsPanelOpen ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4 transition-all duration-300">
            <div class="glass rounded-2xl border border-zinc-800 overflow-hidden flex flex-col min-h-[480px]">
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
                            {@const colSubmissions = data.submissions.filter((s: any) => s.collection_id === col.id)}
                            {@const groups = [...new Set<string>(colSubmissions.map((s: any) => s.group_name))]}
                            {@const isExpanded = expandedCollections[col.id] !== undefined ? expandedCollections[col.id] : (currentExplorerPath[0] === col.name)}
                            <div class="space-y-1">
                                <div class="flex items-center w-full rounded hover:bg-zinc-800 hover:text-white transition-all group/item {currentExplorerPath.length === 1 && currentExplorerPath[0] === col.name ? 'bg-zinc-800 text-white font-medium' : ''}">
                                    <button onclick={() => toggleCollectionExpand(col.id)} class="p-1.5 text-zinc-500 hover:text-zinc-300 focus:outline-none shrink-0">
                                        {#if isExpanded}
                                            <ChevronDown class="w-3 h-3" />
                                        {:else}
                                            <ChevronRight class="w-3 h-3" />
                                        {/if}
                                    </button>
                                    <button onclick={() => navigateToPath([col.name])} class="flex items-center space-x-1.5 py-1 px-1 flex-1 text-left truncate">
                                        <Folder class="w-3.5 h-3.5 {col.id === 'deleted-drive' ? 'text-rose-500' : (col.name.endsWith('_deleted') ? 'text-zinc-600' : 'text-amber-500')} shrink-0" />
                                        <span class="truncate {col.name.endsWith('_deleted') ? 'line-through text-zinc-600' : ''}">/{col.id === 'deleted-drive' ? 'deleted' : col.name}</span>
                                    </button>
                                </div>
                                {#if isExpanded && groups.length > 0}
                                    <div class="pl-4.5 space-y-1 border-l border-zinc-800 ml-5 my-1">
                                        {#each groups as gp}
                                            <button onclick={() => navigateToPath([col.name, gp])} class="flex items-center space-x-2 py-0.5 px-1.5 w-full rounded hover:bg-zinc-800 hover:text-white transition-all text-[10px] {currentExplorerPath.length === 2 && currentExplorerPath[0] === col.name && currentExplorerPath[1] === gp ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-500'}">
                                                <Folder class="w-3 h-3 text-brand-500 shrink-0" />
                                                <span class="truncate">{gp}</span>
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
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
                                            <img src={it.img_data} class="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300" alt="Thumbnail">
                                            <button onclick={(e) => toggleSelectFile(it.id, e)} class="absolute top-2 left-2 z-10 p-1 rounded hover:bg-zinc-900/80" title="เลือก">
                                                <input type="checkbox" checked={selectedExplorerIds.has(it.id)} class="rounded border-zinc-700 bg-zinc-900 text-brand-600 focus:ring-brand-500 pointer-events-none w-4 h-4 shadow">
                                            </button>
                                            <span class="absolute bottom-1 right-1.5 text-[9px] bg-zinc-950/70 text-zinc-400 px-1 py-0.5 rounded font-mono">{it.subText}</span>
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
    </div>
</section>

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
                <img src={file.img_data} class="max-h-[70vh] max-w-full w-auto object-contain rounded-lg shadow-2xl border border-zinc-800 select-none" alt={file.name}>
                <div class="text-center space-y-1 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 w-full max-w-lg" style="background: rgba(9, 9, 11, 0.85) !important; border-color: rgba(63, 63, 70, 0.4) !important;">
                    <h4 class="text-sm font-semibold" style="color: #ffffff !important;">{file.name}</h4>
                    <p class="text-xs" style="color: #a1a1aa !important;">เส้นทาง: images/{file.file_path} | ขนาดเดิม: {formatBytes(file.original_size)}</p>
                </div>
            </div>
        </div>
    </div>
{/if}

{/if}

<!-- Custom Confirmation Modal (GSAP Animated) -->
{#if isConfirmModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="confirm-modal-bg" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 opacity-0" onclick={closeConfirmModal}>
        <div id="confirm-modal-box" class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 space-y-6 text-center opacity-0 scale-90" onclick={(e) => e.stopPropagation()}>
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
                                    <option value="admin">Admin (ผู้ดูแลระบบ)</option>
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
