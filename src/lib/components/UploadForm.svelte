<script lang="ts">
    import { appState } from '$lib/appState.svelte';
    import { enhance } from '$app/forms';
    import { browser } from '$app/environment';
    import { Upload, X, Eye, Loader, CircleCheck, ShieldAlert, Send, User, Camera, Image, Check } from '@lucide/svelte';

    /**
     * XML comments:
     * UploadForm component for student picture submission.
     * Manages client-side drag-and-drop upload and file compression
     * before uploading files to the backend through the SvelteKit form action.
     */
    interface Props {
        data: {
            activeCollections: Array<{ id: string; name: string; is_active: boolean; submission_limit?: number }>;
        };
        MAX_SUBMISSIONS_PER_COLLECTION: number;
        overQuotaCollections: Array<{ id: string; name: string }>;
        nearQuotaCollections: Array<{ id: string; name: string }>;
    }

    let { data, MAX_SUBMISSIONS_PER_COLLECTION, overQuotaCollections, nearQuotaCollections }: Props = $props();

    $effect(() => {
        if (appState.isUploadSuccessModalOpen) {
            // Auto close after 1 second
            const timer = setTimeout(() => {
                closeSuccessModal();
            }, 1000);

            return () => clearTimeout(timer);
        }
    });

    function closeSuccessModal() {
        appState.isUploadSuccessModalOpen = false;
    }

    // Internal form states
    let studentName = $state('');
    let selectedCollectionId = $state('');
    let checkName = $state('');
    let statusResult = $state<{ eve: boolean; cer: boolean; count: number; name: string } | null>(null);
    let isCheckingStatus = $state(false);
    let isDragging = $state(false);
    let previewUrl = $state<string | null>(null);
    let compressionStatus = $state<'idle' | 'compressing' | 'done' | 'error'>('idle');
    let compressionProgress = $state(0);
    let isSubmitting = $state(false);

    let selectedCol = $derived(data.activeCollections.find((c: any) => c.id === selectedCollectionId));
    let selectedColLimit = $derived(selectedCol?.submission_limit ?? 500);
    
    let currentUploadedFile = $state<File | null>(null);
    let compressedFileBlob = $state<Blob | null>(null);
    let originalSize = $state(0);
    let isStudentLightboxOpen = $state(false);
    let retryCount = $state(0);
    const MAX_RETRIES = 2;

    // Error codes that should NOT be retried (user/quota errors)
    const NON_RETRYABLE_MESSAGES = ['ถึงขีดจำกัด', 'ไม่พบหัวข้อ', 'ปิดรับ', 'ไม่มีหัวข้อ', 'ส่งรูปครบ'];

    /**
     * Toggle collection folder selection.
     */
    function selectCollection(id: string) {
        selectedCollectionId = selectedCollectionId === id ? '' : id;
    }

    function evidenceTypeForCollection(id: string) {
        const col = data.activeCollections.find((c: any) => c.id === id);
        const value = `${id} ${col?.name ?? ''}`.toLowerCase();
        if (value.includes('cer')) return 'cer';
        return 'eve';
    }

    /**
     * Handle file input element selection.
     */
    async function handleFileSelect(e: Event) {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
            await processFile(target.files[0]);
        }
    }

    /**
     * Validate and compress files before submission.
     */
    async function processFile(file: File) {
        if (!file.type.startsWith('image/')) {
            appState.showToast('ไฟล์ไม่รองรับ', 'กรุณาอัปโหลดเฉพาะไฟล์รูปภาพเท่านั้น', 'error');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            appState.showToast('ไฟล์ใหญ่เกินไป', 'ขนาดไฟล์สูงสุดไม่เกิน 15MB', 'error');
            return;
        }

        currentUploadedFile = file;
        originalSize = file.size;
        previewUrl = URL.createObjectURL(file);
        
        if (file.size <= 2.5 * 1024 * 1024) {
            compressionStatus = 'done';
            compressionProgress = 100;
            compressedFileBlob = file;
            return;
        }

        compressionStatus = 'compressing';
        compressionProgress = 30;

        try {
            if (browser) {
                const imageCompression = (await import('browser-image-compression')).default;
                const options = {
                    maxSizeMB: 2.5,
                    maxWidthOrHeight: 3840,
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

    /**
     * Clear currently selected image file.
     */
    function resetFile() {
        currentUploadedFile = null;
        compressedFileBlob = null;
        previewUrl = null;
        compressionStatus = 'idle';
        compressionProgress = 0;
    }

    /**
     * Clear all fields in student form.
     */
    function resetStudentForm() {
        studentName = '';
        selectedCollectionId = '';
        statusResult = null;
        checkName = '';
        retryCount = 0;
        resetFile();
    }

    /**
     * Formats bytes count to human readable format.
     */
    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
</script>

<section class="max-w-2xl mx-auto w-full space-y-8 animate-fade-in py-6 sm:py-10">
    <!-- Header title -->
    <div class="text-center space-y-3">
        <h2 class="text-3xl sm:text-4xl font-black tracking-tight text-white dark-mode-text bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
            ส่งรูปภาพ
        </h2>
        <p class="text-zinc-400 text-sm sm:text-base font-medium max-w-md mx-auto leading-relaxed">
            กรอกข้อมูลสั้นๆ และอัปโหลดภาพของคุณใน 3 ขั้นตอนง่ายๆ
        </p>
    </div>

    {#if data.activeCollections.length === 0}
        <div class="glass rounded-3xl p-8 text-center space-y-4 shadow-2xl border border-zinc-800">
            <div class="mx-auto w-16 h-16 rounded-full bg-zinc-300/80 dark:bg-zinc-900/80 flex items-center justify-center border border-zinc-805">
                <ShieldAlert class="w-8 h-8 text-zinc-500" />
            </div>
            <div class="space-y-2">
                <h3 class="text-lg font-bold text-white">ขณะนี้ไม่มีหัวข้อเปิดรับรูปภาพ</h3>
                <!-- <p class="text-sm text-zinc-400 max-w-xs mx-auto">กรุณาติดต่อผู้ดูแลระบบ</p> -->
            </div>
        </div>
    {:else}
        <form method="POST" action="?/checkEvidenceStatus" use:enhance={() => {
            isCheckingStatus = true;
            return async ({ result, update }) => {
                isCheckingStatus = false;
                if (result.type === 'success') {
                    const payload = result.data as any;
                    statusResult = {
                        eve: !!payload.eve,
                        cer: !!payload.cer,
                        count: payload.count ?? 0,
                        name: payload.name ?? checkName
                    };
                    studentName = payload.name ?? checkName;
                } else {
                    statusResult = null;
                    // @ts-ignore
                    appState.showToast('ตรวจสถานะไม่สำเร็จ', result.data?.message || 'กรุณาลองใหม่อีกครั้ง', 'error');
                }
                await update({ reset: false });
            };
        }} class="glass rounded-3xl p-5 sm:p-6 shadow-xl border border-zinc-800/80 space-y-4">
            <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div class="flex-1 space-y-2">
                    <label for="check_name" class="block text-sm font-semibold text-zinc-300">ตรวจสอบสถานะจากชื่อ-สกุล</label>
                    <input
                        id="check_name"
                        name="name"
                        bind:value={checkName}
                        placeholder="เช่น สมศักดิ์ วันจันทร์"
                        class="w-full bg-zinc-950/40 border border-zinc-800 rounded-2xl px-4 py-3 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                    >
                    <p class="text-xs text-zinc-500">ใช้ชื่อภาษาไทยเท่านั้น ไม่ต้องใส่คำนำหน้า และไม่ใช้อักขระพิเศษ เช่น . , / \ |</p>
                </div>
                <button type="submit" disabled={isCheckingStatus || !checkName.trim()} class="bg-zinc-100 text-zinc-950 dark:bg-zinc-100 dark:text-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed font-bold px-5 py-3 rounded-2xl transition-all flex items-center justify-center gap-2">
                    {#if isCheckingStatus}
                        <Loader class="w-4 h-4 animate-spin" />
                        <span>กำลังตรวจ</span>
                    {:else}
                        <Check class="w-4 h-4" />
                        <span>ตรวจสถานะ</span>
                    {/if}
                </button>
            </div>

            {#if statusResult}
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="rounded-2xl border p-4 {statusResult.eve ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}">
                        <div class="text-xs text-zinc-400 font-semibold uppercase">eve</div>
                        <div class="text-lg font-black {statusResult.eve ? 'text-emerald-400' : 'text-amber-300'}">{statusResult.eve ? 'ส่งแล้ว' : 'ยังไม่ได้ส่ง'}</div>
                    </div>
                    <div class="rounded-2xl border p-4 {statusResult.cer ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}">
                        <div class="text-xs text-zinc-400 font-semibold uppercase">cer</div>
                        <div class="text-lg font-black {statusResult.cer ? 'text-emerald-400' : 'text-amber-300'}">{statusResult.cer ? 'ส่งแล้ว' : 'ยังไม่ได้ส่ง'}</div>
                    </div>
                </div>
            {/if}
        </form>

        <form method="POST" action="?/submitForm" enctype="multipart/form-data" use:enhance={({ formData }) => {
            if (isSubmitting) return;
            isSubmitting = true;

            if (compressedFileBlob && currentUploadedFile) {
                formData.set('file', compressedFileBlob, currentUploadedFile.name);
                formData.set('original_size', originalSize.toString());
            }
            if (selectedCollectionId) {
                formData.set('evidence_type', evidenceTypeForCollection(selectedCollectionId));
            }
            return async ({ update, result }) => {
                if (result.type === 'success') {
                    retryCount = 0;
                    appState.isUploadSuccessModalOpen = true;
                    resetStudentForm();
                } else {
                    // @ts-ignore
                    const msg: string = result.data?.message || 'ส่งรูปล้มเหลว';
                    const isNonRetryable = NON_RETRYABLE_MESSAGES.some(k => msg.includes(k));

                    if (!isNonRetryable && retryCount < MAX_RETRIES) {
                        retryCount++;
                        isSubmitting = false;
                        await update();
                        setTimeout(() => {
                            const form = document.querySelector<HTMLFormElement>('form[action="?/submitForm"]');
                            form?.requestSubmit();
                        }, 1000);
                        return;
                    }

                    retryCount = 0;
                    appState.showToast('เกิดข้อผิดพลาด', msg, 'error');
                }
                isSubmitting = false;
                update();
            };
        }} class="space-y-6">

            <!-- STEP 1: Personal Info -->
            <div class="glass rounded-3xl p-6 sm:p-8 shadow-xl border border-zinc-800/80 relative overflow-hidden group hover:border-zinc-700/80 transition-all duration-300">
                <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div class="flex items-start space-x-4">
                    <div class="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                        1
                    </div>
                    <div class="flex-1 space-y-4">
                        <div>
                            <h3 class="text-lg font-bold text-white leading-6">กรอกข้อมูลผู้ส่งรูปภาพ</h3>
                            <!-- <p class="text-xs text-zinc-400">กรุณาแจ้งชื่อและกลุ่มเพื่อการเช็คงานที่ถูกต้อง</p> -->
                        </div>
                        
                        <div class="grid grid-cols-1 gap-4">
                            <!-- Name input -->
                            <div class="space-y-2">
                                <label for="name" class="block text-sm font-semibold text-zinc-300">ชื่อ - นามสกุล <span class="text-rose-500">*</span></label>
                                <div class="relative flex items-center focus-within:text-emerald-400 text-zinc-500">
                                    <span class="absolute left-4 pointer-events-none">
                                        <User class="w-5 h-5 transition-colors" />
                                    </span>
                                    <input 
                                        type="text" 
                                        id="name" 
                                        name="name" 
                                        bind:value={studentName} 
                                        required 
                                        placeholder="เช่น สมศักดิ์ วันจันทร์"
                                        class="w-full bg-zinc-950/40 border border-zinc-800 rounded-2xl pl-12 pr-4 py-3.5 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                                    >
                                </div>
                                <p class="text-xs text-zinc-500">ใช้ชื่อภาษาไทยเท่านั้น ไม่ต้องใส่คำนำหน้า และไม่ใช้อักขระพิเศษ เช่น . , / \ |</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- STEP 2: Selection of Category -->
            <div class="glass rounded-3xl p-6 sm:p-8 shadow-xl border border-zinc-800/80 relative overflow-hidden group hover:border-zinc-700/80 transition-all duration-300">
                <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div class="flex items-start space-x-4">
                    <div class="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                        2
                    </div>
                    <div class="flex-1 space-y-4 flex flex-col">
                        <div>
                            <h3 class="text-lg font-bold text-white leading-6">เลือกหัวข้อส่งงาน <span class="text-rose-500">*</span></h3>
                            <p class="text-xs text-zinc-400">กดเลือกหัวข้อหรือกิจกรรมที่ต้องการส่งรูปภาพ</p>
                        </div>
                        
                        <!-- Hidden input to submit the collection ID -->
                        <input type="hidden" name="collection_id" value={selectedCollectionId}>
                        <input type="hidden" name="evidence_type" value={selectedCollectionId ? evidenceTypeForCollection(selectedCollectionId) : ''}>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                            {#each data.activeCollections as col}
                                {@const isSelected = selectedCollectionId === col.id}
                                {@const isOver = overQuotaCollections.some(o => o.id === col.id)}
                                {@const isNear = nearQuotaCollections.some(n => n.id === col.id)}
                                <button 
                                    type="button"
                                    onclick={() => selectCollection(col.id)}
                                    disabled={isOver}
                                    class="relative flex items-center justify-between p-4 rounded-2xl border text-left transition-all duration-200 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                                        {isSelected 
                                            ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/20' 
                                            : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100/50 hover:border-zinc-300 dark:bg-zinc-950/40 dark:border-zinc-800 dark:hover:border-zinc-700 dark:text-zinc-300'}"
                                >
                                    <div class="space-y-1 pr-6 flex-1">
                                        <div class="font-bold text-base flex items-center gap-1.5 truncate">
                                            <span>{col.name}</span>
                                            {#if isSelected}
                                                <Check class="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                            {/if}
                                        </div>
                                        <div class="text-xs text-zinc-500">
                                            {#if isOver}
                                                <span class="text-rose-400 font-semibold">เต็มโควต้าแล้ว</span>
                                            {:else if isNear}
                                                <span class="text-amber-400 font-semibold">ใกล้เต็มโควต้า</span>
                                            {:else}
                                                <!-- <span>หัวข้อส่งงานทั่วไป</span> -->
                                            {/if}
                                        </div>
                                    </div>
                                    
                                    <div class="w-5 h-5 rounded-full border flex items-center justify-center shrink-0
                                        {isSelected 
                                            ? 'border-emerald-500 bg-emerald-500 text-white' 
                                            : 'border-zinc-700 bg-transparent text-transparent'}"
                                    >
                                        {#if isSelected}
                                            <Check class="w-3.5 h-3.5 stroke-[3]" />
                                        {/if}
                                    </div>
                                </button>
                            {/each}
                        </div>
                    </div>
                </div>
            </div>

            <!-- STEP 3: Upload/Capture Photo -->
            <div class="glass rounded-3xl p-6 sm:p-8 shadow-xl border border-zinc-800/80 relative overflow-hidden group hover:border-zinc-700/80 transition-all duration-300">
                <div class="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <div class="flex items-start space-x-4">
                    <div class="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                        3
                    </div>
                    <div class="flex-1 space-y-4">
                        <div>
                            <h3 class="text-lg font-bold text-white leading-6">เลือกรูปภาพ หรือ ถ่ายรูป <span class="text-rose-500">*</span></h3>
                            <p class="text-xs text-zinc-400">อัปโหลดภาพไม่เกิน 15MB</p>
                        </div>
                        
                        {#if !previewUrl}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div 
                                ondragover={e => { e.preventDefault(); isDragging = true; }}
                                ondragleave={() => isDragging = false}
                                ondrop={async e => { e.preventDefault(); isDragging = false; if (e.dataTransfer?.files?.length) await processFile(e.dataTransfer.files[0]); }}
                                class="relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 min-h-[160px] flex flex-col items-center justify-center space-y-4
                                    {isDragging 
                                        ? 'border-emerald-500 bg-emerald-500/5' 
                                        : 'border-zinc-200 bg-zinc-50 hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-zinc-800 dark:bg-zinc-950/20 dark:hover:border-emerald-500/60 dark:hover:bg-emerald-500/[0.01]'}"
                            >
                                <input type="file" accept="image/*" onchange={handleFileSelect} class="absolute inset-0 opacity-0 cursor-pointer z-10">
                                
                                <div class="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 group-hover:text-emerald-500 dark:group-hover:text-emerald-400 group-hover:border-emerald-400 dark:group-hover:border-emerald-500/40 transition-colors">
                                    <Camera class="w-8 h-8" />
                                </div>
                                <div class="space-y-1">
                                    <p class="text-base font-bold text-white leading-5">กดตรงนี้เพื่อเลือกรูปภาพ</p>
                                    <p class="text-xs text-zinc-500">สามารถลากรูปภาพมาวางได้เช่นกัน (JPG, PNG, AVIF, WebP)</p>
                                </div>
                            </div>
                        {:else}
                            <!-- Preview Image Container -->
                            <div class="space-y-4 text-center">
                                <div class="relative inline-block rounded-2xl overflow-hidden shadow-2xl border border-zinc-700 bg-zinc-950/80 p-1 group">
                                    <button type="button" onclick={() => isStudentLightboxOpen = true} class="focus:outline-none block w-full h-full rounded-xl overflow-hidden" title="คลิกเพื่อดูรูปขนาดเต็ม">
                                        <img src={previewUrl} alt="Preview" class="max-h-56 w-auto object-contain mx-auto rounded-xl transition-transform duration-300 group-hover:scale-[1.02]">
                                    </button>
                                    
                                    <button 
                                        type="button" 
                                        onclick={resetFile} 
                                        class="absolute top-3 right-3 bg-zinc-950/90 hover:bg-rose-600 text-white rounded-full p-2.5 transition-colors z-20 shadow-lg border border-zinc-800"
                                        style="color: #ffffff !important;"
                                        title="ลบและเลือกรูปใหม่"
                                    >
                                        <X class="w-4 h-4" />
                                    </button>
                                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none z-10 rounded-xl">
                                        <Eye class="w-8 h-8 text-white drop-shadow-md" />
                                    </div>
                                </div>

                                <!-- Compression Quality status indicator -->
                                <div class="max-w-md mx-auto bg-zinc-950/40 border border-zinc-900 rounded-2xl p-4 space-y-3 text-left">
                                    <div class="flex justify-between items-center text-sm">
                                        <span class="text-zinc-400 font-medium">การจัดเตรียมภาพ:</span>
                                        {#if compressionStatus === 'compressing'}
                                            <span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center animate-pulse">
                                                <Loader class="w-4 h-4 mr-1.5 animate-spin text-emerald-500" /> กำลังย่อขนาดภาพ...
                                            </span>
                                        {:else if compressionStatus === 'done'}
                                            {#if originalSize <= 2.5 * 1024 * 1024}
                                                <span class="text-emerald-500 font-semibold flex items-center">
                                                    <CircleCheck class="w-4 h-4 mr-1.5 shrink-0" /> รูปภาพพร้อมส่ง (ขนาดเดิม)
                                                </span>
                                            {:else}
                                                <span class="text-emerald-500 font-semibold flex items-center">
                                                    <CircleCheck class="w-4 h-4 mr-1.5 shrink-0" /> ย่อขนาดภาพให้ส่งเร็วขึ้นแล้ว!
                                                </span>
                                            {/if}
                                        {:else}
                                            <span class="text-rose-500 font-semibold flex items-center">
                                                <X class="w-4 h-4 mr-1.5 shrink-0" /> เกิดข้อผิดพลาด (ใช้ขนาดเดิม)
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="h-2 rounded-full bg-zinc-900 overflow-hidden">
                                        <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300" style="width: {compressionProgress}%;"></div>
                                    </div>
                                    <div class="flex justify-between text-xs text-zinc-500">
                                        <span>ขนาดเดิม: {formatBytes(originalSize)}</span>
                                        {#if compressionStatus === 'done' && compressedFileBlob}
                                            <span class="text-emerald-500/80">ขนาดใหม่: {formatBytes(compressedFileBlob.size)}</span>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- STEP 4: Submit section -->
            <div class="pt-2">
                {#if overQuotaCollections.some(c => c.id === selectedCollectionId)}
                    <div class="w-full flex items-center gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm font-semibold">
                        <ShieldAlert class="w-5 h-5 shrink-0" />
                        <span>ขออภัย หัวข้อนี้ส่งงานครบตามโควต้าแล้ว ({selectedColLimit} รูป) กรุณาติดต่อผู้ดูแล</span>
                    </div>
                {:else}
                    {#if nearQuotaCollections.some(c => c.id === selectedCollectionId)}
                        <div class="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-4">
                            <ShieldAlert class="w-5 h-5 shrink-0" />
                            <span>ประกาศ: หัวข้อส่งงานนี้ใกล้เต็มแล้ว</span>
                        </div>
                    {/if}

                    <button 
                        type="submit" 
                        disabled={isSubmitting || compressionStatus === 'compressing' || !studentName || !previewUrl || !selectedCollectionId}
                        class="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700  font-bold py-4 px-6 rounded-2xl shadow-xl shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all duration-300 flex items-center justify-center space-x-2 text-base md:text-lg border border-emerald-400/20 select-none cursor-pointer disabled:bg-zinc-200 disabled:bg-none disabled:text-gray-400 disabled:border-zinc-500 disabled:shadow-none disabled:cursor-not-allowed dark:disabled:bg-zinc-950 dark:disabled:bg-none dark:disabled:text-zinc-600 dark:disabled:border-zinc-800"
                    >
                        {#if isSubmitting}
                            <Loader class="w-5 h-5 animate-spin" />
                            <span>{retryCount > 0 ? `กำลังส่งอีกครั้ง (${retryCount}/${MAX_RETRIES})...` : 'กำลังอัปโหลด...'}</span>
                        {:else}
                            <Send class="w-5 h-5" />
                            <span>บันทึกและส่งรูปภาพ</span>
                        {/if}
                    </button>
                {/if}
            </div>
        </form>
    {/if}
</section>

<!-- Student Lightbox modal for previewing image -->
{#if isStudentLightboxOpen && previewUrl}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm" onclick={() => isStudentLightboxOpen = false}>
        <button onclick={() => isStudentLightboxOpen = false} class="absolute top-4 right-4 text-zinc-400 hover:text-white p-2.5 z-50 transition-colors" title="ปิด">
            <X class="w-6 h-6" />
        </button>
        
        <div class="max-w-4xl max-h-[85vh] w-full px-4 flex flex-col items-center justify-center space-y-4" onclick={(e) => e.stopPropagation()}>
            <div class="relative group max-h-[70vh] flex items-center justify-center">
                <img src={previewUrl} class="max-h-[70vh] max-w-full w-auto object-contain rounded-lg shadow-2xl border border-zinc-800 select-none" alt="Viewer Full">
            </div>
            
            <div class="text-center space-y-1 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-900 w-full max-w-lg" style="background: rgba(9, 9, 11, 0.85) !important; border-color: rgba(63, 63, 70, 0.4) !important;">
                <h4 class="text-sm font-semibold" style="color: #ffffff !important;">{currentUploadedFile?.name || 'ภาพตัวอย่างส่งงาน'}</h4>
                <p class="text-xs font-sans" style="color: #a1a1aa !important;">ขนาดไฟล์จริง: {formatBytes(originalSize)}</p>
            </div>
        </div>
    </div>
{/if}

<!-- Modal: Upload Success Alert Popup -->
{#if appState.isUploadSuccessModalOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="success-modal-bg" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4" onclick={closeSuccessModal}>
        <div id="success-modal-box" class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 space-y-6 text-center" onclick={(e) => e.stopPropagation()}>
            
            <div class="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CircleCheck class="w-8 h-8" />
            </div>
            
            <div class="space-y-2">
                <h3 class="text-xl font-bold text-white">ส่งรูปภาพสำเร็จ!</h3>
                <p class="text-zinc-400 text-xs sm:text-sm">รูปภาพผลงานของคุณถูกบันทึกเข้าระบบเรียบร้อยแล้ว</p>
            </div>
            
            <button onclick={closeSuccessModal} 
                class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-emerald-600/10 focus:outline-none">
                ตกลง
            </button>
        </div>
    </div>
{/if}
