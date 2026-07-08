<script lang="ts">
    import { appState } from '$lib/appState.svelte';
    import { enhance } from '$app/forms';
    import { browser } from '$app/environment';
    import { Upload, X, Eye, Loader, CircleCheck, ShieldAlert, Send } from '@lucide/svelte';
    import { gsap } from 'gsap';

    /**
     * XML comments:
     * UploadForm component for student picture submission.
     * Manages client-side drag-and-drop upload and file compression
     * before uploading files to the backend through the SvelteKit form action.
     */
    interface Props {
        data: {
            activeCollections: Array<{ id: string; name: string; is_active: boolean }>;
        };
        MAX_SUBMISSIONS_PER_COLLECTION: number;
        overQuotaCollections: Array<{ id: string; name: string }>;
        nearQuotaCollections: Array<{ id: string; name: string }>;
    }

    let { data, MAX_SUBMISSIONS_PER_COLLECTION, overQuotaCollections, nearQuotaCollections }: Props = $props();

    $effect(() => {
        if (appState.isUploadSuccessModalOpen) {
            setTimeout(() => {
                const modalBg = document.getElementById('success-modal-bg');
                const modalBox = document.getElementById('success-modal-box');
                if (modalBg && modalBox) {
                    gsap.fromTo(modalBg, { opacity: 0 }, { opacity: 1, duration: 0.3 });
                    gsap.fromTo(modalBox, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.7)' });
                }
            }, 10);

            // Auto close after 1 second
            const timer = setTimeout(() => {
                closeSuccessModal();
            }, 1000);

            return () => clearTimeout(timer);
        }
    });

    function closeSuccessModal() {
        const modalBg = document.getElementById('success-modal-bg');
        const modalBox = document.getElementById('success-modal-box');
        if (modalBg && modalBox) {
            gsap.to(modalBox, { scale: 0.8, opacity: 0, duration: 0.2, ease: 'power2.in' });
            gsap.to(modalBg, { opacity: 0, duration: 0.25, onComplete: () => {
                appState.isUploadSuccessModalOpen = false;
            }});
        } else {
            appState.isUploadSuccessModalOpen = false;
        }
    }

    // Internal form states
    let studentName = $state('');
    let studentGroup = $state('');
    let selectedCollectionId = $state('');
    let isDragging = $state(false);
    let previewUrl = $state<string | null>(null);
    let compressionStatus = $state<'idle' | 'compressing' | 'done' | 'error'>('idle');
    let compressionProgress = $state(0);
    let isSubmitting = $state(false);
    
    let currentUploadedFile = $state<File | null>(null);
    let compressedFileBlob = $state<Blob | null>(null);
    let originalSize = $state(0);
    let isStudentLightboxOpen = $state(false);

    /**
     * Toggle collection folder selection.
     */
    function selectCollection(id: string) {
        selectedCollectionId = selectedCollectionId === id ? '' : id;
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
        studentGroup = '';
        selectedCollectionId = '';
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

<section class="max-w-2xl mx-auto w-full space-y-6 animate-fade-in flex flex-col justify-center min-h-[60vh] py-8">
    <!-- Header title -->
    <!-- <div class="text-center space-y-2">
        <h2 class="text-2xl font-bold text-zinc-100 tracking-tight dark-mode-text">ส่งรูปภาพผลงาน / กิจกรรม</h2>
        <p class="text-zinc-400 text-xs sm:text-sm light-subtext">อัปโหลดรูปภาพกิจกรรมของคุณเพื่อบันทึกลงระบบชั่วคราวอย่างรวดเร็ว</p>
    </div> -->

    <!-- Main upload glass box -->
    <div class="glass rounded-3xl p-6 sm:p-8 shadow-2xl relative border border-zinc-800/80 light-card">
    
        
        {#if data.activeCollections.length === 0}
            <div class="text-center py-12 space-y-4">
                <div class="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl max-w-sm mx-auto">
                    <p class="text-sm text-zinc-400">ขณะนี้ไม่มีหัวข้อเปิดรับส่งรูปภาพในระบบ</p>
                    <p class="text-xs text-zinc-500 mt-1">กรุณาติดต่อผู้ดูแลระบบเพื่อสร้างหัวข้อเปิดรับ</p>
                </div>
            </div>
        {:else}
            <form method="POST" action="?/submitForm" enctype="multipart/form-data" use:enhance={({ formData }) => {
                if (isSubmitting) return;
                isSubmitting = true;

                if (compressedFileBlob && currentUploadedFile) {
                    formData.set('file', compressedFileBlob, currentUploadedFile.name);
                    formData.set('original_size', originalSize.toString());
                }
                return async ({ update, result }) => {
                    if (result.type === 'success') {
                        appState.isUploadSuccessModalOpen = true;
                        resetStudentForm();
                    } else {
                        // @ts-ignore
                        appState.showToast('เกิดข้อผิดพลาด', result.data?.message || 'ส่งรูปล้มเหลว', 'error');
                    }
                    isSubmitting = false;
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
                    <div class="block text-sm font-medium" style="color: var(--text-secondary)">
                        <span>หัวข้อการส่งรูปภาพ / หมวดหมู่ <span class="text-rose-500">*</span></span>
                    </div>
                    <!-- Hidden input to submit the collection ID -->
                    <input type="hidden" name="collection_id" value={selectedCollectionId}>

                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {#each data.activeCollections as col}
                            <button 
                                type="button"
                                onclick={() => selectCollection(col.id)}
                                class="collection-btn {selectedCollectionId === col.id ? 'collection-btn--active' : ''}"
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
                            class="upload-zone {isDragging ? 'upload-zone--dragging' : ''}"
                        >
                            <input type="file" accept="image/*" onchange={handleFileSelect} class="absolute inset-0 opacity-0 cursor-pointer z-10">
                            <div class="space-y-3">
                                <div class="upload-icon-wrap mx-auto">
                                    <Upload class="w-5 h-5" />
                                </div>
                                <div>
                                    <p class="text-sm font-semibold" style="color: var(--text-primary)">ลากและวางรูปภาพที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
                                    <p class="text-xs mt-1" style="color: var(--text-muted)">รองรับ JPG, PNG, AVIF, WebP (จำกัดสูงสุด 15MB ต่อไฟล์)</p>
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
                            <div class="file-status-box max-w-md mx-auto text-left space-y-2 text-xs">
                                <div class="flex justify-between items-center" style="color: var(--text-secondary)">
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
                                <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--divider)">
                                    <div class="h-full bg-emerald-500 transition-all duration-500" style="width: {compressionProgress}%;"></div>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>

                <!-- Submit Button with quota alert block -->
                {#if overQuotaCollections.some(c => c.id === selectedCollectionId)}
                    <div class="w-full flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold mt-4">
                        <ShieldAlert class="w-4 h-4 shrink-0" />
                        <span>หัวข้อนี้ถึงขีดจำกัดการรับส่งแล้ว ({MAX_SUBMISSIONS_PER_COLLECTION} รูป) กรุณาติดต่อผู้ดูแลระบบ</span>
                    </div>
                {:else}
                    {#if nearQuotaCollections.some(c => c.id === selectedCollectionId)}
                        <div class="w-full flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs mt-4">
                            <ShieldAlert class="w-4 h-4 shrink-0" />
                            <span>หัวข้อนี้ใกล้เต็มแล้ว (รับได้อีกไม่มาก)</span>
                        </div>
                    {/if}
                    <button type="submit" 
                        disabled={isSubmitting || compressionStatus === 'compressing' || !studentName || !previewUrl || !selectedCollectionId}
                        class="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl shadow-lg shadow-brand-500/10 hover:shadow-brand-600/20 transition-all duration-300 flex items-center justify-center space-x-2 text-sm mt-4">
                        {#if isSubmitting}
                            <Loader class="w-4 h-4 animate-spin" />
                            <span>กำลังอัปโหลด...</span>
                        {:else}
                            <Send class="w-4 h-4" />
                            <span>บันทึกและส่งรูปภาพ</span>
                        {/if}
                    </button>
                {/if}
            </form>
        {/if}
    </div>
</section>

<!-- Student Lightbox modal for previewing image -->
{#if isStudentLightboxOpen && previewUrl}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm" onclick={() => isStudentLightboxOpen = false}>
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
    <div id="success-modal-bg" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 opacity-0" onclick={closeSuccessModal}>
        <div id="success-modal-box" class="glass max-w-sm w-full rounded-3xl p-6 shadow-2xl relative border border-zinc-800 space-y-6 text-center opacity-0 scale-90" onclick={(e) => e.stopPropagation()}>
            
            <div class="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <CircleCheck class="w-8 h-8" />
            </div>
            
            <div class="space-y-2">
                <h3 class="text-xl font-bold text-white">ส่งรูปภาพสำเร็จ!</h3>
                <p class="text-zinc-400 text-xs sm:text-sm">รูปภาพผลงานของคุณถูกบันทึกเข้าระบบชั่วคราวอย่างปลอดภัยแล้ว</p>
            </div>
            
            <button onclick={closeSuccessModal} 
                class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-emerald-600/10 focus:outline-none">
                ตกลง
            </button>
        </div>
    </div>
{/if}
