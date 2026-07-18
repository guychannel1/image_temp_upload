<script lang="ts">
    import { page } from '$app/state';
    import { appState } from '$lib/appState.svelte';
    import { Upload, Send, LayoutDashboard, Sun, Moon, X, Menu } from '@lucide/svelte';

    /**
     * XML comments:
     * Header component that renders the top navigation, logo, theme toggler, and mobile menu drawer.
     * Integrates with appState to handle theme triggers and active tab changes.
     */
    interface Props {
        data: {
            isSupabaseLive: boolean;
            loggedIn: boolean;
        };
    }

    let { data }: Props = $props();
    const isDashboardRoute = $derived(page.url.pathname.startsWith('/dashboard'));
</script>

<!-- Redesigned responsive navigation bar -->
<header class="site-header sticky top-0 z-40 w-full">
    <div class="header-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

        <!-- Logo / Brand element with micro-interaction hover scaling -->
        <a href="/" class="logo-area flex items-center gap-2.5 shrink-0" onclick={() => { appState.activeTab = 'portal'; }}>
            <div class="flex flex-col leading-none">
                <span class="logo-title text-xl font-bold tracking-tight">Temporarily</span>
                {#if !data.isSupabaseLive}
                    <span class="text-[9px] font-semibold text-amber-500 uppercase tracking-wide">Mock DB</span>
                {/if}
            </div>
        </a>

        <!-- Desktop Navigation Tabs -->
        <nav class="hidden sm:flex items-center gap-1 nav-tabs-wrapper px-1.5 py-1.5 rounded-2xl" aria-label="เมนูหลัก">
            <a
                href="/"
                data-sveltekit-preload-data="hover"
                data-sveltekit-preload-code="hover"
                onclick={() => appState.activeTab = 'portal'}
                class="nav-tab {!isDashboardRoute ? 'nav-tab--active' : ''}"
                aria-current={!isDashboardRoute ? 'page' : undefined}
            >
                <Send class="w-3.5 h-3.5" />
                <span>ส่งรูปภาพ</span>
            </a>
            <a
                href="/dashboard"
                data-sveltekit-preload-data="hover"
                data-sveltekit-preload-code="hover"
                onclick={() => appState.activeTab = data.loggedIn ? 'admin' : 'login'}
                class="nav-tab {isDashboardRoute ? 'nav-tab--active' : ''}"
                aria-current={isDashboardRoute ? 'page' : undefined}
            >
                <LayoutDashboard class="w-3.5 h-3.5" />
                <span>Dashboard</span>
            </a>
        </nav>

        <!-- Right side controls (Theme switch, Hamburger menu) -->
        <div class="flex items-center gap-2 shrink-0">
            <!-- iOS-style Theme Switcher Pill -->
            <button
                onclick={() => appState.toggleTheme()}
                class="theme-pill"
                aria-label={appState.isDarkMode ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
                title={appState.isDarkMode ? 'โหมดสว่าง' : 'โหมดมืด'}
            >
                <span class="theme-pill__track">
                    <span class="theme-pill__thumb">
                        {#if appState.isDarkMode}
                            <Moon class="w-3 h-3" />
                        {:else}
                            <Sun class="w-3 h-3 text-amber-500" />
                        {/if}
                    </span>
                </span>
            </button>

            <!-- Mobile Hamburger Button -->
            <button
                onclick={() => appState.isMobileMenuOpen = !appState.isMobileMenuOpen}
                class="sm:hidden hamburger-btn"
                aria-label="เมนู"
                aria-expanded={appState.isMobileMenuOpen}
            >
                {#if appState.isMobileMenuOpen}
                    <X class="w-4 h-4" />
                {:else}
                    <Menu class="w-4 h-4" />
                {/if}
            </button>
        </div>
    </div>

    <!-- Mobile Navigation Drawer Panel -->
    {#if appState.isMobileMenuOpen}
        <div class="sm:hidden mobile-drawer mx-4 mb-3 rounded-2xl overflow-hidden shadow-lg border border-zinc-800/80">
            <a
                href="/"
                onclick={() => { appState.activeTab = 'portal'; appState.isMobileMenuOpen = false; }}
                class="mobile-nav-item w-full {!isDashboardRoute ? 'mobile-nav-item--active' : ''}"
            >
                <Send class="w-4 h-4" />
                <span>ส่งรูปภาพ</span>
            </a>
            <div class="mobile-nav-divider"></div>
            <a
                href="/dashboard"
                onclick={() => { appState.activeTab = data.loggedIn ? 'admin' : 'login'; appState.isMobileMenuOpen = false; }}
                class="mobile-nav-item w-full {isDashboardRoute ? 'mobile-nav-item--active' : ''}"
            >
                <LayoutDashboard class="w-4 h-4" />
                <span>Dashboard</span>
            </a>
        </div>
    {/if}
</header>
