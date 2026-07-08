<script lang="ts">
    import { appState } from '$lib/appState.svelte';
    import Header from '$lib/components/Header.svelte';
    import UploadForm from '$lib/components/UploadForm.svelte';
    import AdminDashboard from '$lib/components/AdminDashboard.svelte';
    import ToastContainer from '$lib/components/ToastContainer.svelte';

    /**
     * XML comments:
     * Main page wrapper.
     * Delegates public portal uploading and admin management to modular components.
     * Shared state is managed via the appState Svelte 5 store.
     */
    let { data } = $props();

    const MAX_SUBMISSIONS_PER_COLLECTION = 500; // Hard limit of 500
    const WARN_SUBMISSIONS_PER_COLLECTION = 450; // 90% threshold

    let overQuotaCollections = $derived(
        data.collections.filter(c => 
            data.submissions.filter(s => s.collection_id === c.id).length >= MAX_SUBMISSIONS_PER_COLLECTION
        )
    );

    let nearQuotaCollections = $derived(
        data.collections.filter(c => {
            const count = data.submissions.filter(s => s.collection_id === c.id).length;
            return count >= WARN_SUBMISSIONS_PER_COLLECTION && count < MAX_SUBMISSIONS_PER_COLLECTION;
        })
    );

    // Total storage estimate (compressed avg 1MB per image)
    let totalStorageMB = $derived(
        Math.round(
            data.submissions.reduce((acc, s) => acc + (s.file_size || 0), 0) / (1024 * 1024) * 10
        ) / 10
    );
</script>

<Header {data} />

<main class="flex-1 w-full max-w-7xl mx-auto px-4 pb-12 sm:px-6 lg:px-8 z-10 flex flex-col relative min-h-[70vh]">
    <!-- TAB 1: PORTAL (STUDENT UPLOAD FORM) -->
    {#if appState.activeTab === 'portal'}
        <UploadForm 
            {data} 
            {MAX_SUBMISSIONS_PER_COLLECTION} 
            {overQuotaCollections} 
            {nearQuotaCollections} 
        />
    {/if}

    <!-- TAB 2 & 3: ADMIN PORTIONS (LOGIN & DASHBOARD) -->
    {#if appState.activeTab === 'login' || appState.activeTab === 'admin'}
        <AdminDashboard 
            bind:data
            {MAX_SUBMISSIONS_PER_COLLECTION}
            {overQuotaCollections}
            {nearQuotaCollections}
            {totalStorageMB}
        />
    {/if}
</main>

<ToastContainer />
