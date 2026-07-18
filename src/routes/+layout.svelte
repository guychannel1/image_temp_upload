<script lang="ts">
    import './layout.css';
    import { onMount } from 'svelte';
    import { navigating } from '$app/state';
    import { dev } from '$app/environment';
    import { injectAnalytics } from '@vercel/analytics/sveltekit';
    import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';

    let { children } = $props();

    function preventTextDrag(event: DragEvent) {
        const dragTypes = Array.from(event.dataTransfer?.types ?? []);
        if (!dragTypes.includes('Files')) {
            event.preventDefault();
        }
    }

    onMount(() => {
        injectAnalytics({ mode: dev ? 'development' : 'production' });
        injectSpeedInsights();
    });
</script>

<svelte:window ondragstart={preventTextDrag} />

<svelte:head>
    <title>Temp</title>
    <meta name="description" content="ระบบส่งและจัดการรูปภาพหลักฐานออนไลน์" />
</svelte:head>

{#if navigating.to}
    <div class="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/20 px-4 backdrop-blur-[2px]" role="status" aria-live="polite" aria-label="กำลังโหลดหน้า" aria-busy="true">
        <div class="pointer-events-none flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/95 px-5 py-4 text-sm font-semibold text-zinc-700 shadow-2xl shadow-zinc-950/15 dark:border-zinc-700/80 dark:bg-zinc-900/95 dark:text-zinc-200">
            <span class="h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-500" aria-hidden="true"></span>
            <span>กำลังโหลด…</span>
        </div>
    </div>
{/if}

<main class="flex-1 w-full z-10 flex flex-col relative  ">
    {@render children()}
</main>
