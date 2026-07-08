<script lang="ts">
    import { enhance } from '$app/forms';
    import { browser } from '$app/environment';
    import { 
        Send, LayoutDashboard, Upload, X, CircleCheck, Loader, Eye,
        Folder, ArrowUp, Home, Search, Trash2, FolderPlus, Download, 
        Power, ChevronLeft, ChevronRight, ChevronDown, HardDrive, FolderGit2, User, Lock, Menu,
        RefreshCw, Sidebar
    } from '@lucide/svelte';

    // Data loaded from +page.server.ts
    let { data } = $props();

    // Navigation state: 'portal' or 'admin'
    let activeTab = $state('portal');
    let isMobileMenuOpen = $state(false);
    let isUploadSuccessModalOpen = $state(false);

    let isCollectionsPanelOpen = $state(true);

    let isReloading = $state(false);
    async function reloadData() {
        if (isReloading) return;
        isReloading = true;
        try {
            const { invalidateAll } = await import('$app/navigation');
            await invalidateAll();
            showToast('รีโหลดสำเร็จ', 'อัปเดตข้อมูลไฟล์ล่าสุดเรียบร้อย', 'success');
        } catch (e) {
            showToast('ล้มเหลว', 'เกิดข้อผิดพลาดในการดึงข้อมูล', 'error');
        } finally {
            isReloading = false;
        }
    }

    let expandedCollections = $state<Record<string, boolean>>({});
    function toggleCollectionExpand(colId: string) {
        if (expandedCollections[colId] === undefined) {
            const col = data.collections.find(c => c.id === colId);
            const isCurrentlyActive = col ? currentExplorerPath[0] === col.name : false;
            expandedCollections[colId] = !isCurrentlyActive;
        } else {
            expandedCollections[colId] = !expandedCollections[colId];
        }
    }

    // Toasts state
    let toasts = $state<{ id: number; title: string; desc: string; type: 'success' | 'error' }[]>([]);
    function showToast(title: string, desc: string, type: 'success' | 'error' = 'success') {
        const id = Date.now();
        toasts = [...toasts, { id, title, desc, type }];
        setTimeout(() => {
            toasts = toasts.filter(t => t.id !== id);
        }, 3000);
    }

    // Format bytes helper
    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // ==========================================
    // 1. PUBLIC PORTAL (STUDENT UPLOAD FORM) STATES
    // ==========================================
    let studentName = $state('');
    let studentGroup = $state('');
    let selectedCollectionId = $state('');

    function selectCollection(id: string) {
        if (selectedCollectionId === id) {
            selectedCollectionId = '';
        } else {
            selectedCollectionId = id;
        }
    }
    
    let isDragging = $state(false);
    let previewUrl = $state<string | null>(null);
    let compressionStatus = $state<'idle' | 'compressing' | 'done' | 'error'>('idle');
    let compressionProgress = $state(0);
    
    let currentUploadedFile = $state<File | null>(null);
    let compressedFileBlob = $state<Blob | null>(null);
    let originalSize = $state(0);

    let isStudentLightboxOpen = $state(false);

    async function handleFileSelect(e: Event) {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
            await processFile(target.files[0]);
        }
    }

    async function processFile(file: File) {
        if (!file.type.startsWith('image/')) {
            showToast('ไฟล์ไม่รองรับ', 'กรุณาอัปโหลดเฉพาะไฟล์รูปภาพเท่านั้น', 'error');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            showToast('ไฟล์ใหญ่เกินไป', 'ขนาดไฟล์สูงสุดไม่เกิน 15MB', 'error');
            return;
        }

        currentUploadedFile = file;
        originalSize = file.size;
        previewUrl = URL.createObjectURL(file);
        
        // If file is already under 2.5MB, upload it as-is (original size)
        if (file.size <= 2.5 * 1024 * 1024) {
            compressionStatus = 'done';
            compressionProgress = 100;
            compressedFileBlob = file;
            return;
        }

        // If file exceeds 2.5MB, compress it down to 2.5MB at 4K resolution to prevent Vercel 4.5MB crash
        compressionStatus = 'compressing';
        compressionProgress = 30;

        try {
            if (browser) {
                const imageCompression = (await import('browser-image-compression')).default;
                const options = {
                    maxSizeMB: 2.5, // Safely under Vercel's 4.5MB limit
                    maxWidthOrHeight: 3840, // 4K Resolution (Ultra High Quality)
                    useWebWorker: true
                };

                await new Promise(resolve => setTimeout(resolve, 300));
                compressionProgress = 70;

                const compressedFile = await imageCompression(file, options);
                compressedFileBlob = compressedFile;
                compressionProgress = 100;
                compressionStatus = 'done';
            }
        } catch (err) {
            console.error('Compression failed:', err);
            compressedFileBlob = file;
            compressionProgress = 100;
            compressionStatus = 'error';
        }
    }

    function resetFile() {
        currentUploadedFile = null;
        compressedFileBlob = null;
        previewUrl = null;
        compressionStatus = 'idle';
        compressionProgress = 0;
    }

    function resetStudentForm() {
        studentName = '';
        studentGroup = '';
        resetFile();
    }

    // ==========================================
    // 2. ADMIN LOGIN STATES
    // ==========================================
    let loginError = $state('');

    // ==========================================
    // 3. ADMIN DASHBOARD (EXPLORER) STATES
    // ==========================================
    let currentExplorerPath = $state<string[]>([]);
    let searchExplorerQuery = $state('');
    let selectedExplorerIds = $state<Set<string>>(new Set());

    let isAddColModalOpen = $state(false);
    let isDownloadZipModalOpen = $state(false);
    let isAdminLightboxOpen = $state(false);

    let currentViewerIndex = $state(-1);
    let viewerFiles = $state<{ id: string; name: string; file_path: string; img_data: string; original_size: number }[]>([]);

    // Compute folder contents dynamically with recursive scoped search
    let explorerItems = $derived.by(() => {
        const searchLower = searchExplorerQuery.trim().toLowerCase();
        
        if (!searchLower) {
            // Standard non-search navigation
            if (currentExplorerPath.length === 0) {
                return data.collections.map(col => {
                    const subCount = data.submissions.filter(s => s.collection_id === col.id).length;
                    return {
                        type: 'folder',
                        id: col.id,
                        name: col.name,
                        subText: `${subCount} รูปภาพ`,
                        icon: Folder,
                        colorClass: 'text-amber-500',
                        onClick: () => navigateToPath([col.name])
                    };
                });
            } else if (currentExplorerPath.length === 1) {
                const colName = currentExplorerPath[0];
                const colObj = data.collections.find(c => c.name === colName);
                if (!colObj) return [];
                const colSubmissions = data.submissions.filter(s => s.collection_id === colObj.id);
                const groups = [...new Set(colSubmissions.map(s => s.group_name))];
                return groups.map(group => {
                    const imgCount = colSubmissions.filter(s => s.group_name === group).length;
                    return {
                        type: 'folder',
                        id: `group-${group}`,
                        name: group,
                        subText: `${imgCount} รูปภาพ`,
                        icon: Folder,
                        colorClass: 'text-brand-500',
                        onClick: () => navigateToPath([colName, group])
                    };
                });
            } else {
                const colName = currentExplorerPath[0];
                const groupName = currentExplorerPath[1];
                const colObj = data.collections.find(c => c.name === colName);
                if (!colObj) return [];
                const groupSubmissions = data.submissions.filter(s => s.collection_id === colObj.id && s.group_name === groupName);
                return groupSubmissions.map(sub => ({
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

        // Search is active! We do recursive scoped search!
        const items: any[] = [];
        
        // 1. Scoped collections
        let targetCols = data.collections;
        if (currentExplorerPath.length >= 1) {
            targetCols = data.collections.filter(c => c.name === currentExplorerPath[0]);
        }
        
        // If we are at Root, search collection folder names
        if (currentExplorerPath.length === 0) {
            for (const col of targetCols) {
                if (col.name.toLowerCase().includes(searchLower)) {
                    const subCount = data.submissions.filter(s => s.collection_id === col.id).length;
                    items.push({
                        type: 'folder',
                        id: col.id,
                        name: col.name,
                        subText: `ไดรฟ์หลัก | ${subCount} รูป`,
                        icon: Folder,
                        colorClass: 'text-amber-500',
                        onClick: () => {
                            searchExplorerQuery = ''; // Clear search on navigation
                            navigateToPath([col.name]);
                        }
                    });
                }
            }
        }
        
        // 2. Scoped group subfolders
        // Only if we are at Root or at a specific Collection level (length <= 1)
        if (currentExplorerPath.length <= 1) {
            for (const col of targetCols) {
                const colSubmissions = data.submissions.filter(s => s.collection_id === col.id);
                const groups = [...new Set(colSubmissions.map(s => s.group_name))];
                for (const gp of groups) {
                    if (gp.toLowerCase().includes(searchLower)) {
                        const imgCount = colSubmissions.filter(s => s.group_name === gp).length;
                        items.push({
                            type: 'folder',
                            id: `group-${col.name}-${gp}`,
                            name: currentExplorerPath.length === 0 ? `/${col.name}/${gp}` : gp,
                            subText: `โฟลเดอร์ย่อย | ${imgCount} รูป`,
                            icon: Folder,
                            colorClass: 'text-brand-500',
                            onClick: () => {
                                searchExplorerQuery = ''; // Clear search on navigation
                                navigateToPath([col.name, gp]);
                            }
                        });
                    }
                }
            }
        }
        
        // 3. Scoped files (student submissions)
        // Search student names directly!
        for (const col of targetCols) {
            let colSubmissions = data.submissions.filter(s => s.collection_id === col.id);
            if (currentExplorerPath.length === 2) {
                colSubmissions = colSubmissions.filter(s => s.group_name === currentExplorerPath[1]);
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

    function openAdminLightbox(fileId: string) {
        viewerFiles = explorerItems
            .filter(item => item.type === 'file')
            // @ts-ignore
            .map(item => ({
                id: item.id,
                name: item.name,
                file_path: item.file_path,
                img_data: item.img_data,
                original_size: item.original_size
            }));

        currentViewerIndex = viewerFiles.findIndex(f => f.id === fileId);
        if (currentViewerIndex !== -1) {
            isAdminLightboxOpen = true;
        }
    }

    function prevImage() {
        if (currentViewerIndex > 0) currentViewerIndex--;
    }

    function nextImage() {
        if (currentViewerIndex < viewerFiles.length - 1) currentViewerIndex++;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!isAdminLightboxOpen) return;
        if (e.key === 'ArrowLeft') prevImage();
        if (e.key === 'ArrowRight') nextImage();
        if (e.key === 'Escape') isAdminLightboxOpen = false;
    }

    // --- CANVAS CONVERSION AND ZIP PACKAGING ---
    async function convertToJpegBlob(base64Data: string): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || 600;
                canvas.height = img.naturalHeight || 600;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas 2D context error'));
                    return;
                }
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob empty'));
                }, 'image/jpeg', 0.9);
            };
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = base64Data;
        });
    }

    async function handleZipDownload(scope: 'all' | 'folder') {
        isDownloadZipModalOpen = false;
        showToast('กำลังจัดเตรียมไฟล์ ZIP', 'เริ่มการแปลงรูปภาพทั้งหมดเป็น JPEG ปลายทาง...', 'success');

        if (!browser) return;

        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            let targetSubmissions = data.submissions;
            let zipNamePrefix = 'all';

            if (scope === 'folder') {
                if (currentExplorerPath.length === 1) {
                    const colName = currentExplorerPath[0];
                    targetSubmissions = data.submissions.filter(s => s.collection_name === colName);
                    zipNamePrefix = `drive-${colName}`;
                } else if (currentExplorerPath.length === 2) {
                    const colName = currentExplorerPath[0];
                    const groupName = currentExplorerPath[1];
                    targetSubmissions = data.submissions.filter(s => s.collection_name === colName && s.group_name === groupName);
                    zipNamePrefix = `drive-${colName}-${groupName}`;
                } else if (selectedExplorerIds.size > 0) {
                    targetSubmissions = data.submissions.filter(s => selectedExplorerIds.has(s.id));
                    zipNamePrefix = 'selected-files';
                }
            }

            if (targetSubmissions.length === 0) {
                showToast('ไม่พบไฟล์', 'ไม่มีไฟล์ในขอบเขตการดาวน์โหลดที่เลือก', 'error');
                return;
            }

            for (const sub of targetSubmissions) {
                const zipPath = `${sub.collection_name}/${sub.group_name}/${sub.name}.jpg`;

                try {
                    const jpegBlob = await convertToJpegBlob(sub.img_data);
                    zip.file(zipPath, jpegBlob);
                } catch (e) {
                    console.error('Canvas conversion failed for', sub.name, e);
                    const res = await fetch(sub.img_data);
                    const blob = await res.blob();
                    zip.file(zipPath, blob);
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const zipName = `temp-export-${zipNamePrefix}-${Date.now()}.zip`;

            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast('ดาวน์โหลด ZIP สำเร็จ', `สร้างไฟล์ ${zipName} และแปลงเป็น JPEG แล้ว`, 'success');
        } catch (err) {
            console.error(err);
            showToast('เกิดข้อผิดพลาด', 'ไม่สามารถบีบอัดไฟล์ ZIP ได้', 'error');
        }
    }

    async function downloadFolderZipDirect(colName: string, event: Event) {
        event.stopPropagation();
        showToast('ดาวน์โหลดด่วน', `กำลังจัดเตรียมไฟล์ไดรฟ์ /${colName} เป็น JPEG...`, 'success');
        
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            const targetSubmissions = data.submissions.filter(s => s.collection_name === colName);
            if (targetSubmissions.length === 0) {
                showToast('ว่างเปล่า', `ไม่มีรูปภาพในไดรฟ์ /${colName}`, 'error');
                return;
            }

            for (const sub of targetSubmissions) {
                const zipPath = `${sub.collection_name}/${sub.group_name}/${sub.name}.jpg`;
                try {
                    const jpegBlob = await convertToJpegBlob(sub.img_data);
                    zip.file(zipPath, jpegBlob);
                } catch {
                    const res = await fetch(sub.img_data);
                    zip.file(zipPath, await res.blob());
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `temp-export-drive-${colName}-${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast('ดาวน์โหลดด่วนสำเร็จ', `ไดรฟ์ /${colName} ถูกดาวน์โหลดเสร็จสิ้น`, 'success');
        } catch (e) {
            showToast('ดาวน์โหลดล้มเหลว', 'เกิดข้อผิดพลาดในการโหลดไฟล์', 'error');
        }
    }

    function downloadSingleImage(fileId: string, event: Event) {
        event.stopPropagation();
        const file = data.submissions.find(s => s.id === fileId);
        if (!file) return;

        const link = document.createElement('a');
        link.href = file.img_data;
        link.download = `${file.name}.avif`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('ดาวน์โหลดไฟล์เดี่ยว', `ดาวน์โหลดภาพ ${file.name} สำเร็จ`, 'success');
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Unified Navigation Header -->
<header class="sticky top-0 z-40 glass border-b border-zinc-800/80 px-4 py-3 sm:px-6 lg:px-8 w-full max-w-7xl mx-auto rounded-b-2xl mb-6">
    <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center space-x-3">
            <div>
                <h1 class="text-xl font-bold tracking-tight text-white">Temp</h1>
            </div>
            {#if data.isSupabaseLive}
                <!-- <span class="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider">Live Supabase</span> -->
            {:else}
                <span class="text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider">Mock DB</span>
            {/if}
        </div>
        
        <!-- Tab Mode Switcher (Desktop) -->
        <div class="hidden sm:flex bg-zinc-900/90 p-1.5 rounded-xl border border-zinc-800 shadow-inner">
            <button onclick={() => activeTab = 'portal'} 
               class="flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 {activeTab === 'portal' ? 'bg-brand-600 text-white shadow-md shadow-brand-600/10' : 'text-zinc-400 hover:text-zinc-200'}">
                <Send class="w-4 h-4" />
                <span>ส่งรูปภาพ</span>
            </button>
            <button onclick={() => activeTab = data.loggedIn ? 'admin' : 'login'} 
               class="flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 {activeTab === 'admin' || activeTab === 'login' ? 'bg-brand-600 text-white shadow-md shadow-brand-600/10' : 'text-zinc-400 hover:text-zinc-200'}">
                <LayoutDashboard class="w-4 h-4" />
                <span>ระบบจัดการหลังบ้าน</span>
            </button>
        </div>

        <!-- Hamburger Button (Mobile) -->
        <div class="sm:hidden">
            <button onclick={() => isMobileMenuOpen = !isMobileMenuOpen} 
               class="p-2 text-zinc-400 hover:text-white bg-zinc-900/50 border border-zinc-800 rounded-xl focus:outline-none transition-all"
               aria-label="เมนู">
                {#if isMobileMenuOpen}
                    <X class="w-5 h-5" />
                {:else}
                    <Menu class="w-5 h-5" />
                {/if}
            </button>
        </div>
    </div>

    <!-- Mobile Dropdown Navigation -->
    {#if isMobileMenuOpen}
        <div class="sm:hidden mt-3 p-2 bg-zinc-950/85 border border-zinc-850 rounded-2xl flex flex-col gap-1.5 animate-slide-down">
            <button onclick={() => { activeTab = 'portal'; isMobileMenuOpen = false; }} 
               class="flex items-center space-x-3 w-full px-4 py-3 rounded-xl text-sm font-medium transition-all {activeTab === 'portal' ? 'bg-brand-600 text-white shadow-md shadow-brand-600/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'}">
                <Send class="w-4 h-4" />
                <span>ส่งรูปภาพ</span>
            </button>
            <button onclick={() => { activeTab = data.loggedIn ? 'admin' : 'login'; isMobileMenuOpen = false; }} 
               class="flex items-center space-x-3 w-full px-4 py-3 rounded-xl text-sm font-medium transition-all {activeTab === 'admin' || activeTab === 'login' ? 'bg-brand-600 text-white shadow-md shadow-brand-600/10' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'}">
                <LayoutDashboard class="w-4 h-4" />
                <span>ระบบจัดการหลังบ้าน</span>
            </button>
        </div>
    {/if}
</header>

<main class="flex-1 w-full max-w-7xl mx-auto px-4 pb-12 sm:px-6 lg:px-8 z-10 flex flex-col relative min-h-[70vh]">
    <!-- ==============================================
         TAB 1: PORTAL (STUDENT UPLOAD FORM)
         ============================================== -->
    {#if activeTab === 'portal'}
        <section class="space-y-6 max-w-2xl mx-auto py-4 w-full">
            <div class="text-center space-y-2">
                <!-- <span class="px-3 py-1 text-xs font-semibold text-brand-500 bg-brand-500/10 rounded-full border border-brand-500/20">Portal ส่งรูปภาพ</span> -->
                <!-- <h2 class="text-3xl font-extrabold tracking-tight sm:text-4xl bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">เก็บภาพชั่วคราว</h2> -->
            </div>

            <div class="glass rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden border border-zinc-800/80">
                <div class="absolute top-0 left-0 w-full h-[3px] bg-brand-500"></div>

                {#if data.activeCollections.length === 0}
                    <div class="text-center py-12 space-y-4">
                        <div class="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl max-w-sm mx-auto">
                            <p class="text-sm text-zinc-400">ขณะนี้ไม่มีหัวข้อเปิดรับส่งรูปภาพในระบบ</p>
                            <p class="text-xs text-zinc-500 mt-1">กรุณาติดต่อผู้ดูแลระบบเพื่อสร้างหัวข้อเปิดรับ</p>
                        </div>
                    </div>
                {:else}
                    <form method="POST" action="?/submitForm" enctype="multipart/form-data" use:enhance={({ formData }) => {
                        if (compressedFileBlob && currentUploadedFile) {
                            formData.set('file', compressedFileBlob, currentUploadedFile.name);
                            formData.set('original_size', originalSize.toString());
                        }
                        return async ({ update, result }) => {
                            if (result.type === 'success') {
                                isUploadSuccessModalOpen = true;
                                resetStudentForm();
                            } else {
                                // @ts-ignore
                                showToast('เกิดข้อผิดพลาด', result.data?.message || 'ส่งรูบล้มเหลว', 'error');
                            }
                            update();
                        };
                    }} class="space-y-5">
                        
                        <!-- Personal Info Row -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <label for="name" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">ชื่อ-นามสกุล <span class="text-rose-500">*</span></label>
                                <input type="text" id="name" name="name" bind:value={studentName} required placeholder="เช่น สมชาย ใจดี"
                                    class="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm">
                            </div>
                            <div class="space-y-2">
                                <label for="group_name" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">กลุ่ม <span class="text-zinc-600 font-normal normal-case tracking-normal">(ไม่บังคับ)</span></label>
                                <input type="text" id="group_name" name="group_name" bind:value={studentGroup} placeholder="เช่น กลุ่ม 1, ทีม A (ถ้ามี)"
                                    class="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm">
                            </div>
                        </div>

                        <!-- Collection select -->
                        <div class="space-y-2">
                            <div class="block text-sm font-medium text-zinc-300">
                                <span>หัวข้อการส่งรูปภาพ / หมวดหมู่ <span class="text-rose-500">*</span></span>
                            </div>
                            <!-- Hidden input to submit the collection ID -->
                            <input type="hidden" name="collection_id" value={selectedCollectionId}>

                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {#each data.activeCollections as col}
                                    <button 
                                        type="button"
                                        onclick={() => selectCollection(col.id)}
                                        class="relative flex items-center justify-center p-3 rounded-xl border cursor-pointer text-xs sm:text-sm font-medium transition-all select-none focus:outline-none
                                            {selectedCollectionId === col.id 
                                                ? 'border-brand-500 bg-brand-500/10 text-brand-500 font-semibold' 
                                                : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'}"
                                    >
                                        <span>{col.name}</span>
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <!-- Uploader Drag & Drop -->
                        <div class="space-y-2">
                            <div class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">อัปโหลดไฟล์รูปภาพ <span class="text-rose-500">*</span></div>
                            
                            {#if !previewUrl}
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div 
                                    ondragover={e => { e.preventDefault(); isDragging = true; }}
                                    ondragleave={() => isDragging = false}
                                    ondrop={async e => { e.preventDefault(); isDragging = false; if (e.dataTransfer?.files?.length) await processFile(e.dataTransfer.files[0]); }}
                                    class="border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 relative group cursor-pointer
                                        {isDragging ? 'border-brand-500 bg-brand-500/5' : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700/80 hover:bg-zinc-900/30'}"
                                >
                                    <input type="file" accept="image/*" onchange={handleFileSelect} class="absolute inset-0 opacity-0 cursor-pointer z-10">
                                    <div class="space-y-3">
                                        <div class="mx-auto w-12 h-12 rounded-xl bg-zinc-950/60 flex items-center justify-center border border-zinc-800 text-zinc-500 group-hover:text-zinc-300 group-hover:border-zinc-700 transition-colors">
                                            <Upload class="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p class="text-sm font-semibold text-zinc-200">ลากและวางรูปภาพที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
                                            <p class="text-xs text-zinc-500 mt-1">รองรับ JPG, PNG, AVIF, WebP (จำกัดสูงสุด 15MBต่อไฟล์)</p>
                                        </div>
                                    </div>
                                </div>
                            {:else}
                                <!-- Preview Thumbnail -->
                                <div class="w-full space-y-4 text-center">
                                    <div class="relative inline-block max-w-[200px] rounded-xl overflow-hidden shadow-lg border border-zinc-700 group">
                                        <button type="button" onclick={() => isStudentLightboxOpen = true} class="focus:outline-none w-full h-full block" title="คลิกเพื่อดูรูปขนาดเต็ม">
                                            <img src={previewUrl} alt="Preview" class="h-32 w-auto object-cover mx-auto cursor-pointer">
                                        </button>
                                        <button type="button" onclick={resetFile} class="absolute top-1.5 right-1.5 bg-zinc-950/80 hover:bg-rose-600 text-white rounded-full p-1.5 transition-colors z-20">
                                            <X class="w-4 h-4" />
                                        </button>
                                        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none z-10">
                                            <Eye class="w-6 h-6 text-white" />
                                        </div>
                                    </div>

                                    <!-- Processing Details -->
                                    <div class="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3 max-w-md mx-auto text-left space-y-2 text-xs">
                                        <div class="flex justify-between items-center text-zinc-400">
                                            <span>สถานะไฟล์:</span>
                                            {#if compressionStatus === 'compressing'}
                                                <span class="text-brand-400 font-medium flex items-center">
                                                    <Loader class="w-3.5 h-3.5 mr-1 animate-spin text-brand-500" /> กำลังตรวจสอบคุณภาพไฟล์...
                                                </span>
                                            {:else if compressionStatus === 'done'}
                                                {#if originalSize <= 2.5 * 1024 * 1024}
                                                    <span class="text-emerald-500 font-medium flex items-center">
                                                        <CircleCheck class="w-3.5 h-3.5 mr-1" /> ตรวจสอบแล้ว (ขนาดต้นฉบับ)
                                                    </span>
                                                {:else}
                                                    <span class="text-emerald-500 font-medium flex items-center">
                                                        <CircleCheck class="w-3.5 h-3.5 mr-1" /> บีบอัดแล้ว
                                                    </span>
                                                {/if}
                                            {:else}
                                                <span class="text-rose-500 font-medium flex items-center">
                                                    <X class="w-3.5 h-3.5 mr-1" /> ตรวจสอบล้มเหลว (ใช้ไฟล์จริง)
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                            <div class="h-full bg-emerald-500 transition-all duration-500" style="width: {compressionProgress}%;"></div>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Submit Button -->
                        <button type="submit" disabled={compressionStatus === 'compressing' || !studentName || !previewUrl}
                            class="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-medium py-3 rounded-xl shadow-lg shadow-brand-500/10 hover:shadow-brand-600/20 transition-all duration-300 flex items-center justify-center space-x-2 text-sm mt-4">
                            <span>บันทึกและส่งรูปภาพ</span>
                        </button>
                    </form>
                {/if}
            </div>
        </section>

        <!-- Lightbox Modal for student preview -->
        {#if isStudentLightboxOpen && previewUrl}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm" onclick={() => isStudentLightboxOpen = false}>
                <button onclick={() => isStudentLightboxOpen = false} class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2.5 z-50 transition-colors" title="ปิด">
                    <X class="w-6 h-6" />
                </button>
                
                <div class="max-w-4xl max-h-[85vh] w-full px-4 flex flex-col items-center justify-center space-y-4" onclick={(e) => e.stopPropagation()}>
                    <div class="relative group max-h-[70vh] flex items-center justify-center">
                        <img src={previewUrl} class="max-h-[70vh] max-w-full w-auto object-contain rounded-lg shadow-2xl border border-zinc-800 select-none" alt="Viewer Full">
                    </div>
                    
                    <div class="text-center space-y-1 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 w-full max-w-lg">
                        <h4 class="text-sm font-semibold text-white">{currentUploadedFile?.name || 'ภาพตัวอย่างส่งงาน'}</h4>
                        <p class="text-xs text-zinc-400 font-sans">ขนาดไฟล์จริง: {formatBytes(originalSize)}</p>
                    </div>
                </div>
            </div>
        {/if}
    {/if}

    <!-- ==============================================
         TAB 2: ADMIN LOGIN (SHOWN IF NOT LOGGED IN)
         ============================================== -->
    {#if activeTab === 'login'}
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
                    return async ({ result, update }) => {
                        if (result.type === 'success') {
                            loginError = '';
                            data.loggedIn = true;
                            activeTab = 'admin'; // Redirect to dashboard view
                            showToast('เข้าสู่ระบบสำเร็จ', 'ยินดีต้อนรับกลับเข้าสู่หน้าแอดมิน', 'success');
                        } else {
                            // @ts-ignore
                            loginError = result.data?.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
                            showToast('เข้าสู่ระบบล้มเหลว', loginError, 'error');
                        }
                        update();
                    };
                }} class="space-y-4">
                    <div class="space-y-2">
                        <label for="username" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Username</label>
                        <div class="relative">
                            <input type="text" id="username" name="username" required placeholder="username" autocomplete="username"
                                class="w-full bg-zinc-900/60 border border-zinc-700/80 rounded-xl pl-10 pr-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm">
                            <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                                <User class="w-4 h-4" />
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label for="password" class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Password</label>
                        <div class="relative">
                            <input type="password" id="password" name="password" required placeholder="••••" autocomplete="current-password"
                                class="w-full bg-zinc-900/60 border border-zinc-700/80 rounded-xl pl-10 pr-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm">
                            <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                                <Lock class="w-4 h-4" />
                            </div>
                        </div>
                    </div>

                    <button type="submit" class="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 rounded-xl shadow-lg shadow-brand-500/10 hover:shadow-brand-600/20 transition-all duration-300 flex items-center justify-center space-x-2 text-sm mt-6">
                        <span>เข้าสู่ระบบ</span>
                    </button>
                </form>
            </div>
        </section>
    {/if}

    <!-- ==============================================
         TAB 3: ADMIN DASHBOARD (FILE MANAGER)
         ============================================== -->
    {#if activeTab === 'admin' && data.loggedIn}
        <section class="space-y-6 w-full animate-fade-in">
            <!-- Admin title & buttons -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-800 pb-5 gap-4">
                <div>
                    <h2 class="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
                        <span>Dashboard</span>
                    </h2>
                    <p class="text-zinc-400 text-sm mt-1">บริหารจัดการหัวข้อเปิดรับรูปภาพ และดาวน์โหลดรูปภาพที่ส่งเข้ามาในฟอร์แมต ZIP สำหรับการประเมินผล</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button onclick={reloadData} disabled={isReloading} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 disabled:opacity-50 disabled:pointer-events-none">
                        <RefreshCw class="w-4 h-4 text-emerald-400 {isReloading ? 'animate-spin' : ''}" />
                        <span>{isReloading ? 'กำลังดึงข้อมูล...' : 'รีโหลดข้อมูล'}</span>
                    </button>
                    <button onclick={() => isCollectionsPanelOpen = !isCollectionsPanelOpen} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                        <Sidebar class="w-4 h-4 text-brand-500" />
                        <span>{isCollectionsPanelOpen ? 'ซ่อนพาเนลจัดการ' : 'แสดงพาเนลจัดการ'}</span>
                    </button>
                    <button onclick={() => isAddColModalOpen = true} class="bg-zinc-900 border border-zinc-700 hover:border-brand-500 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2 animate-none">
                        <FolderPlus class="w-4 h-4 text-brand-500" />
                        <span>เพิ่มหัวข้อใหม่</span>
                    </button>
                    <button onclick={() => isDownloadZipModalOpen = true} class="bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-white flex items-center space-x-2 shadow-lg shadow-brand-600/10 animate-none">
                        <Download class="w-4 h-4" />
                        <span>ดาวน์โหลด ZIP</span>
                    </button>
                    <form method="POST" action="?/logout" use:enhance={() => {
                        return async ({ result, update }) => {
                            if (result.type === 'success') {
                                data.loggedIn = false;
                                activeTab = 'portal'; // Back to public portal
                                showToast('ออกจากระบบแล้ว', 'เซสชันแอดมินปิดการทำงานเรียบร้อย', 'success');
                            }
                            update();
                        };
                    }}>
                        <button type="submit" class="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center space-x-2">
                            <Power class="w-4 h-4" />
                            <span>ออกจากระบบ</span>
                        </button>
                    </form>
                </div>
            </div>

            <!-- Stats cards -->
            <div class="grid grid-cols-2 gap-3 sm:gap-4">
                <div class="glass p-4 sm:p-5 rounded-2xl relative overflow-hidden">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-[10px] sm:text-xs text-zinc-500 font-semibold uppercase tracking-wider">ภาพที่ส่งเข้ามาทั้งหมด</p>
                            <h3 class="text-2xl sm:text-3xl font-bold mt-2">{data.submissions.length}</h3>
                        </div>
                        <div class="p-2 sm:p-3 bg-brand-500/10 rounded-xl text-brand-500 border border-brand-500/20 shrink-0">
                            <HardDrive class="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                    </div>
                </div>
                <div class="glass p-4 sm:p-5 rounded-2xl">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-[10px] sm:text-xs text-zinc-500 font-semibold uppercase tracking-wider">หัวข้อเปิดรับรูปภาพ</p>
                            <h3 class="text-2xl sm:text-3xl font-bold mt-2 text-brand-400">
                                {data.collections.filter(c => c.is_active).length} / {data.collections.length}
                            </h3>
                        </div>
                        <div class="p-2 sm:p-3 bg-brand-500/10 rounded-xl text-brand-400 border border-brand-500/20 shrink-0">
                            <FolderGit2 class="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Explorer section -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left panel: Collections manager -->
                {#if isCollectionsPanelOpen}
                    <div class="lg:col-span-1 space-y-4">
                        <div class="glass p-5 rounded-2xl space-y-4">
                            <div class="flex items-center justify-between border-b border-zinc-800 pb-3">
                                <h3 class="font-bold text-sm text-zinc-200">หัวข้อส่งรูป (Collections)</h3>
                                <span class="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">{data.collections.length}</span>
                            </div>
                            
                            <div class="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                                {#each data.collections as col}
                                    {@const count = data.submissions.filter(s => s.collection_id === col.id).length}
                                    <div class="flex items-center justify-between p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-850/20 transition-all">
                                        <div class="space-y-1">
                                            <div class="flex items-center space-x-2">
                                                <span class="font-semibold text-xs text-white">/{col.name}</span>
                                                <span class="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{count} ภาพ</span>
                                            </div>
                                            <p class="text-[10px] text-zinc-500">Bucket: <code class="text-zinc-400">images/{col.name}/</code></p>
                                        </div>
                                        <div class="flex items-center space-x-2">
                                        <form method="POST" action="?/toggleCollection" use:enhance>
                                            <input type="hidden" name="id" value={col.id}>
                                            <button type="submit" title="สลับสถานะการเปิดรับรูปภาพ" aria-label="สลับสถานะการเปิดรับรูปภาพ" class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none 
                                                {col.is_active ? 'bg-brand-600' : 'bg-zinc-800'}">
                                                <span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
                                                    {col.is_active ? 'translate-x-4' : 'translate-x-0'}"></span>
                                            </button>
                                        </form>

                                        <!-- Delete collection action -->
                                        <form method="POST" action="?/deleteCollection" use:enhance={() => {
                                            return async ({ result, update }) => {
                                                if (result.type === 'success') {
                                                    showToast('ลบหัวข้อสำเร็จ', 'ลบโฟลเดอร์หัวข้อและภาพทั้งหมดแล้ว', 'success');
                                                    navigateToPath([]); 
                                                }
                                                update();
                                            };
                                        }}>
                                            <input type="hidden" name="id" value={col.id}>
                                            <button type="submit" onclick={(e) => { if (!confirm('คุณแน่ใจว่าต้องการลบไดรฟ์นี้? รูปภาพทั้งหมดจะถูกลบ')) e.preventDefault(); }} class="text-zinc-500 hover:text-rose-500 p-1 rounded transition-colors">
                                                <Trash2 class="w-3.5 h-3.5" />
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
                {/if}

                <!-- Right panel: Explorer mockup -->
                <div class="{isCollectionsPanelOpen ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4 transition-all duration-300">
                    <div class="glass rounded-2xl border border-zinc-800 overflow-hidden flex flex-col min-h-[480px]">
                        
                        <!-- Header bar -->
                        <div class="bg-zinc-900/95 border-b border-zinc-850 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                            <div class="flex items-center space-x-2.5">
                                <button onclick={navigateUp} disabled={currentExplorerPath.length === 0} class="p-2 bg-zinc-950 border border-zinc-855 rounded hover:bg-zinc-800/80 transition-all text-zinc-400 disabled:opacity-30 disabled:pointer-events-none" title="ขึ้นโฟลเดอร์บน">
                                    <ArrowUp class="w-4 h-4" />
                                </button>
                                <button onclick={() => navigateToPath([])} class="p-2 bg-zinc-950 border border-zinc-855 rounded hover:bg-zinc-800/80 transition-all text-zinc-400" title="หน้าแรก">
                                    <Home class="w-4 h-4" />
                                </button>
                                <span class="font-bold text-zinc-300 font-sans tracking-wide truncate" id="explorer-window-title">
                                    Root{currentExplorerPath.length > 0 ? ' / ' + currentExplorerPath.join(' / ') : ''}
                                </span>
                            </div>
                            
                            <div class="flex items-center space-x-2">
                                <div class="relative flex-1 sm:w-44">
                                    <input type="text" bind:value={searchExplorerQuery} placeholder="ค้นหาในโฟลเดอร์นี้..." class="w-full bg-zinc-950 border border-zinc-855 rounded px-2.5 pl-8 py-2 text-zinc-300 placeholder-zinc-650 focus:outline-none focus:border-brand-500 font-sans">
                                    <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-650">
                                        <Search class="w-3.5 h-3.5" />
                                    </div>
                                </div>

                                {#if selectedExplorerIds.size > 0}
                                    <form method="POST" action="?/deleteSubmissions" use:enhance={() => {
                                        return async ({ result, update }) => {
                                            if (result.type === 'success') {
                                                showToast('ลบเสร็จสิ้น', 'ลบภาพที่เลือกเรียบร้อยแล้ว', 'success');
                                                selectedExplorerIds.clear();
                                            }
                                            update();
                                        };
                                    }}>
                                        <input type="hidden" name="ids" value={JSON.stringify([...selectedExplorerIds])}>
                                        <button type="submit" onclick={(e) => { if (!confirm('ลบไฟล์ภาพที่เลือกหรือไม่?')) e.preventDefault(); }} class="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded hover:bg-rose-500/20 transition-all" title="ลบที่เลือก">
                                            <Trash2 class="w-4 h-4" />
                                        </button>
                                    </form>
                                {/if}
                            </div>
                        </div>

                        <!-- Grid content -->
                        <div class="flex-1 flex overflow-hidden">
                            <!-- Sidebar tree -->
                            <div class="w-48 border-r border-zinc-855 bg-zinc-900/10 p-3.5 overflow-y-auto hidden sm:block select-none text-xs text-zinc-400 space-y-2">
                                <div class="font-semibold text-[10px] text-zinc-500 uppercase tracking-wider mb-2">โครงสร้างไดเรกทอรี</div>
                                <button onclick={() => navigateToPath([])} class="flex items-center space-x-2 py-1 px-1.5 w-full rounded hover:bg-zinc-850 hover:text-white transition-all {currentExplorerPath.length === 0 ? 'bg-zinc-850 text-white font-medium' : ''}">
                                    <HardDrive class="w-3.5 h-3.5 text-zinc-500" />
                                    <span class="truncate">Root /</span>
                                </button>
                                {#each data.collections as col}
                                    {@const colSubmissions = data.submissions.filter(s => s.collection_id === col.id)}
                                    {@const groups = [...new Set(colSubmissions.map(s => s.group_name))]}
                                    {@const isExpanded = expandedCollections[col.id] !== undefined ? expandedCollections[col.id] : (currentExplorerPath[0] === col.name)}
                                    <div class="space-y-1">
                                        <!-- Root collection folder row -->
                                        <div class="flex items-center w-full rounded hover:bg-zinc-850 hover:text-white transition-all group/item
                                            {currentExplorerPath.length === 1 && currentExplorerPath[0] === col.name ? 'bg-zinc-850 text-white font-medium' : ''}">
                                            
                                            <!-- Chevron toggle button -->
                                            <button onclick={() => toggleCollectionExpand(col.id)} class="p-1.5 text-zinc-500 hover:text-zinc-300 focus:outline-none shrink-0" title={isExpanded ? 'พับเก็บ' : 'ขยายออก'}>
                                                {#if isExpanded}
                                                    <ChevronDown class="w-3 h-3" />
                                                {:else}
                                                    <ChevronRight class="w-3 h-3" />
                                                {/if}
                                            </button>

                                            <!-- Navigation button -->
                                            <button onclick={() => navigateToPath([col.name])} class="flex items-center space-x-1.5 py-1 px-1 flex-1 text-left truncate">
                                                <Folder class="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                                <span class="truncate">/{col.name}</span>
                                            </button>
                                        </div>
                                        
                                        <!-- Nested subfolders (Groups) -->
                                        {#if isExpanded && groups.length > 0}
                                            <div class="pl-4.5 space-y-1 border-l border-zinc-850 ml-5 my-1">
                                                {#each groups as gp}
                                                    <button onclick={() => navigateToPath([col.name, gp])} class="flex items-center space-x-2 py-0.5 px-1.5 w-full rounded hover:bg-zinc-850 hover:text-white transition-all text-[10px]
                                                        {currentExplorerPath.length === 2 && currentExplorerPath[0] === col.name && currentExplorerPath[1] === gp ? 'bg-zinc-850 text-white font-semibold' : 'text-zinc-500'}">
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
                                    {#each explorerItems as it}
                                        {#if it.type === 'folder'}
                                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <div onclick={it.onClick} class="flex flex-col items-center p-4 rounded-xl border border-zinc-900 bg-zinc-900/30 hover:bg-zinc-850/20 hover:border-zinc-800 cursor-pointer select-none text-center transition-all group relative w-[130px] shrink-0">
                                                <button onclick={(e) => downloadFolderZipDirect(it.name, e)} class="absolute top-2 right-2 p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-850/80 rounded bg-zinc-950/40 opacity-0 group-hover:opacity-100 transition-all z-20" title="ดาวน์โหลดไดรฟ์นี้ (.zip)">
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
                                            <div onclick={() => openAdminLightbox(it.id)} class="flex flex-col rounded-xl overflow-hidden border cursor-pointer select-none transition-all group relative w-[130px] shrink-0
                                                {selectedExplorerIds.has(it.id) ? 'border-brand-500 bg-brand-500/10' : 'border-zinc-900 bg-zinc-900/30 hover:bg-zinc-850/20 hover:border-zinc-800'}">
                                                
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
                                                        <span class="truncate">ดิบ: {formatBytes(it.original_size)}</span>
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
    {/if}
</main>

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
                <h3 class="text-sm font-bold text-white">ดาวน์โหลดไฟล์บีบอัด (.ZIP)</h3>
                <button onclick={() => isDownloadZipModalOpen = false} class="text-zinc-500 hover:text-white">
                    <X class="w-4 h-4" />
                </button>
            </div>
            
            <div class="space-y-3">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div onclick={() => handleZipDownload('folder')} class="flex items-start p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-850/30 cursor-pointer transition-all">
                    <div class="p-2 bg-brand-500/10 rounded-lg text-brand-500 border border-brand-500/20 mr-3 mt-0.5">
                        <Folder class="w-4 h-4" />
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-zinc-200">
                            {#if currentExplorerPath.length === 0}
                                ดาวน์โหลดเฉพาะจุดนำทาง (เลือกไฟล์ก่อน)
                            {:else if currentExplorerPath.length === 1}
                                ดาวน์โหลดเฉพาะไดรฟ์ /{currentExplorerPath[0]}
                            {:else}
                                ดาวน์โหลดเฉพาะกลุ่ม {currentExplorerPath[1]}
                            {/if}
                        </h4>
                        <p class="text-[10px] text-zinc-500 mt-1">รูปภาพผลงานจะถูกแปลงเป็นสกุล JPEG (.jpg) ทั้งหมดก่อนบรรจุลง ZIP</p>
                    </div>
                </div>

                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div onclick={() => handleZipDownload('all')} class="flex items-start p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-850/30 cursor-pointer transition-all">
                    <div class="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20 mr-3 mt-0.5">
                        <HardDrive class="w-4 h-4" />
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-zinc-200">ดาวน์โหลดรูปภาพทั้งหมดในระบบ</h4>
                        <p class="text-[10px] text-zinc-500 mt-1">บีบอัดรูปภาพทุกหัวข้อเปิดรับงาน แบ่งโฟลเดอร์ตามโครงสร้างจริงเป็น JPEG</p>
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
    <div class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm" onclick={() => isAdminLightboxOpen = false}>
        <button onclick={() => isAdminLightboxOpen = false} class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2.5 z-50 transition-colors" title="ปิด">
            <X class="w-6 h-6" />
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
                <div class="text-center space-y-1 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 w-full max-w-lg">
                    <h4 class="text-sm font-semibold text-white">{file.name}</h4>
                    <p class="text-[10px] text-zinc-500 font-sans">พาธ: images/{file.file_path} | ขนาดเดิม: {formatBytes(file.original_size)}</p>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Modal: Upload Success Alert Popup -->
{#if isUploadSuccessModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4" onclick={() => isUploadSuccessModalOpen = false}>
        <div class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 space-y-6 text-center animate-scale-up" onclick={(e) => e.stopPropagation()}>
            <div class="absolute top-0 left-0 w-full h-[3px] bg-emerald-500"></div>
            
            <div class="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CircleCheck class="w-8 h-8" />
            </div>
            
            <div class="space-y-2">
                <h3 class="text-xl font-bold text-white">ส่งรูปภาพสำเร็จ!</h3>
                <p class="text-zinc-400 text-xs sm:text-sm">รูปภาพผลงานของคุณถูกบันทึกเข้าสู่ระบบชั่วคราวอย่างปลอดภัยแล้ว</p>
            </div>
            
            <button onclick={() => isUploadSuccessModalOpen = false} 
                class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-emerald-600/10 focus:outline-none">
                ตกลง
            </button>
        </div>
    </div>
{/if}

<!-- Toast Notifications Container -->
<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
    {#each toasts as toast (toast.id)}
        <div class="glass px-4 py-3 rounded-xl shadow-xl flex flex-col border border-zinc-800 text-left min-w-[250px]">
            <span class="text-xs font-bold {toast.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}">{toast.title}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5">{toast.desc}</span>
        </div>
    {/each}
</div>
