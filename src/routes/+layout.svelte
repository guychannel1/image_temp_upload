<script lang="ts">
    import './layout.css';
    let { children } = $props();
</script>

<svelte:head>
    <title>Temp</title>
</svelte:head>

<!-- Glowing Blobs -->
<div class="glow-bg top-[-10%] left-[-10%]"></div>
<div class="glow-bg bottom-[-10%] right-[-10%]"></div>

<main class="flex-1 w-full z-10 flex flex-col relative">
    {@render children()}
</main>
