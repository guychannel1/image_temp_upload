<script lang="ts">
    import './layout.css';
    let { children } = $props();
</script>

<svelte:head>
    <title>Temp</title>
</svelte:head>



<main class="flex-1 w-full z-10 flex flex-col relative">
    {@render children()}
</main>
