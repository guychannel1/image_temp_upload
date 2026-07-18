<script lang="ts">
    import { appState } from '$lib/appState.svelte';
</script>

<!-- Toast Notifications Container -->
<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite" aria-atomic="false">
    {#each appState.toasts as toast (toast.id)}
        <div class="glass px-4 py-3 rounded-xl shadow-xl flex flex-col border border-zinc-800 text-left min-w-[250px]">
            <span class="text-xs font-bold {toast.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}">{toast.title}</span>
            <span class="text-[10px] text-zinc-400 mt-0.5">{toast.desc}</span>
        </div>
    {/each}
</div>
