<script lang="ts">
    import './layout.css';
    import { onMount } from 'svelte';
    import { dev } from '$app/environment';
    import { injectAnalytics } from '@vercel/analytics/sveltekit';
    import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';

    let { children } = $props();

    onMount(() => {
        injectAnalytics({ mode: dev ? 'development' : 'production' });
        injectSpeedInsights();
    });
</script>

<svelte:head>
    <title>Temp</title>
</svelte:head>

<main class="flex-1 w-full z-10 flex flex-col relative">
    {@render children()}
</main>
