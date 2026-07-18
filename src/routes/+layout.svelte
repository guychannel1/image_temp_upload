<script lang="ts">
    import './layout.css';
    import { onMount } from 'svelte';
    import { dev } from '$app/environment';
    import { navigating } from '$app/state';
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

{#if navigating}
    <div class="route-progress" role="progressbar" aria-label="กำลังโหลดหน้า" aria-valuetext="กำลังโหลด">
        <div class="route-progress__bar"></div>
    </div>
{/if}

<main class="flex-1 w-full z-10 flex flex-col relative  ">
    {@render children()}
</main>

<style>
    .route-progress {
        position: fixed;
        inset: 0 0 auto;
        z-index: 9999;
        height: 3px;
        overflow: hidden;
        background: rgba(161, 161, 170, 0.16);
        pointer-events: none;
    }

    .route-progress__bar {
        width: 100%;
        height: 100%;
        transform-origin: left;
        background: linear-gradient(90deg, #22c55e, #06b6d4);
        box-shadow: 0 0 10px rgba(34, 197, 94, 0.45);
        animation: route-progress 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) infinite;
    }

    @keyframes route-progress {
        0% { transform: translateX(-100%) scaleX(0.35); }
        55% { transform: translateX(20%) scaleX(0.7); }
        100% { transform: translateX(120%) scaleX(0.25); }
    }

    @media (prefers-reduced-motion: reduce) {
        .route-progress__bar {
            animation-duration: 2.4s;
        }
    }
</style>
