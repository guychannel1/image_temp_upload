<script lang="ts">
    import { page } from '$app/state';
    import { onMount } from 'svelte';
    import { gsap } from 'gsap';
    import { ArrowLeft, ShieldAlert } from '@lucide/svelte';
    import Header from '$lib/components/Header.svelte';

    const fallbackData = {
        isSupabaseLive: true,
        loggedIn: false
    };

    onMount(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) return;

        const ctx = gsap.context(() => {
            gsap.from('.error-shell', { opacity: 0, y: 18, duration: 0.45, ease: 'power3.out' });
            gsap.from('.error-item', {
                opacity: 0,
                y: 12,
                duration: 0.38,
                ease: 'power3.out',
                stagger: 0.07,
                delay: 0.12
            });
            gsap.fromTo('.error-code-line', { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power3.out', delay: 0.18 });
        });

        return () => ctx.revert();
    });
</script>

<Header data={fallbackData} />

<main class="min-h-[72vh] w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-center">
    <section class="error-shell relative w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-xl shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-950/75 dark:shadow-black/20">
        <div class="absolute inset-x-0 top-0 h-1 bg-brand-600"></div>

        <div class="error-item mb-5 flex items-center justify-between gap-4">
            <div class="grid h-11 w-11 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <ShieldAlert class="h-5 w-5" />
            </div>
            <div class="text-right">
                <div class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status</div>
                <div class="text-3xl font-black leading-none text-zinc-950 dark:text-white">{page.status}</div>
            </div>
        </div>

        <div class="error-item">
            <div class="mb-3 h-px w-full origin-left bg-zinc-200 dark:bg-zinc-800">
                <div class="error-code-line h-px origin-left bg-brand-600"></div>
            </div>
            <h1 class="text-2xl font-black tracking-tight text-zinc-950 dark:text-white">
                {page.status === 404 ? 'ไม่พบหน้านี้' : 'เกิดข้อผิดพลาด'}
            </h1>
            <p class="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {page.status === 404
                    ? 'ลิงก์นี้อาจถูกย้าย ถูกจำกัดสิทธิ์ หรือไม่มีอยู่ในระบบ'
                    : page.error?.message}
            </p>
        </div>

        <div class="error-item mt-6 flex flex-col gap-2 sm:flex-row">
            <a href="/" class="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
                <ArrowLeft class="h-4 w-4" />
                กลับหน้าแรก
            </a>
        </div>
    </section>
</main>
