<script lang="ts">
    import { onMount } from 'svelte';
    import { appState } from '$lib/appState.svelte';
    import Header from '$lib/components/Header.svelte';
    import AdminDashboard from '$lib/components/AdminDashboard.svelte';
    import ToastContainer from '$lib/components/ToastContainer.svelte';

    let { data } = $props<{
        data: {
            isSupabaseLive: boolean;
            loggedIn: boolean;
            [key: string]: any;
        };
    }>();

    const MAX_SUBMISSIONS_PER_COLLECTION = 500;

    function getCollectionSubmissionCount(collectionId: string) {
        const collectionStats = data.collectionStats as Record<string, { count: number; totalFileSize: number }>;
        return collectionStats?.[collectionId]?.count
            ?? data.submissions.filter((s: any) => s.collection_id === collectionId && !s.is_deleted).length;
    }

    let overQuotaCollections = $derived(
        data.collections.filter((c: any) => {
            const limit = c.submission_limit ?? 500;
            return getCollectionSubmissionCount(c.id) >= limit;
        })
    );

    let nearQuotaCollections = $derived(
        data.collections.filter((c: any) => {
            const limit = c.submission_limit ?? 500;
            const count = getCollectionSubmissionCount(c.id);
            return count >= Math.floor(limit * 0.9) && count < limit;
        })
    );

    let totalStorageMB = $derived(
        Math.round(
            data.submissions.reduce((acc: number, s: any) => acc + (s.file_size || 0), 0) / (1024 * 1024) * 10
        ) / 10
    );

    onMount(() => {
        appState.activeTab = data.loggedIn ? 'admin' : 'login';
    });
</script>

<Header {data} />

<main class="flex-1 w-full max-w-7xl mx-auto px-4 pb-12 sm:px-6 lg:px-8 z-10 flex flex-col relative min-h-[70vh]">
    <AdminDashboard
        bind:data
        {MAX_SUBMISSIONS_PER_COLLECTION}
        {overQuotaCollections}
        {nearQuotaCollections}
        {totalStorageMB}
    />
</main>

<ToastContainer />
