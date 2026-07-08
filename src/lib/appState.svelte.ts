import { browser } from '$app/environment';

/**
 * Interface definition for Toast notification items.
 */
export interface Toast {
    /** Unique identifier for the toast */
    id: string;
    /** The title of the alert toast */
    title: string;
    /** Detailed description message */
    desc: string;
    /** Visual style type: 'success' | 'error' | 'info' */
    type: 'success' | 'error' | 'info';
}

/**
 * Interface definition for image viewer items.
 */
export interface ViewerFile {
    id: string;
    name: string;
    file_path: string;
    img_data: string;
    original_size: number;
}

/**
 * Class representing the global application state (equivalent to a Svelte store).
 * Built with Svelte 5 Runes for fine-grained reactivity and professional state design.
 */
export class AppState {
    /// <summary>
    /// Current theme status. Default is light mode.
    /// </summary>
    isDarkMode = $state(false);
    
    /// <summary>
    /// Currently visible tab portal/view. Options: 'portal' | 'admin' | 'login'.
    /// </summary>
    activeTab = $state('portal');
    
    /// <summary>
    /// Tracks if mobile overlay dropdown navigation is open.
    /// </summary>
    isMobileMenuOpen = $state(false);
    
    /// <summary>
    /// Control flag for the public upload success dialog modal.
    /// </summary>
    isUploadSuccessModalOpen = $state(false);
    
    /// <summary>
    /// Toggle state for the admin collections panel sidebar.
    /// </summary>
    isCollectionsPanelOpen = $state(true);
    
    /// <summary>
    /// Collection of active Toast notifications.
    /// </summary>
    toasts = $state<Toast[]>([]);
    
    /// <summary>
    /// Array representing the current path in the admin file explorer (e.g. ['camp-science', 'group-1']).
    /// </summary>
    currentExplorerPath = $state<string[]>([]);
    
    /// <summary>
    /// Set containing IDs of files currently checked/selected in the explorer window.
    /// </summary>
    selectedExplorerIds = $state(new Set<string>());
    
    /// <summary>
    /// Object mapping collection IDs to their sidebar tree expanded state (boolean).
    /// </summary>
    expandedCollections = $state<Record<string, boolean>>({});
    
    /// <summary>
    /// Text query binding for filtering explorer folder items.
    /// </summary>
    searchExplorerQuery = $state('');

    /// <summary>
    /// Array of images loaded into the full-screen lightbox slides.
    /// </summary>
    viewerFiles = $state<ViewerFile[]>([]);

    /// <summary>
    /// Index of the current file being viewed in the lightbox slider.
    /// </summary>
    currentViewerIndex = $state(-1);

    /// <summary>
    /// Control flag for showing/hiding full-screen admin lightbox.
    /// </summary>
    isAdminLightboxOpen = $state(false);

    constructor() {
        if (browser) {
            // Load theme state synchronized with the DOM set by app.html's script
            this.isDarkMode = document.documentElement.classList.contains('dark');
            document.documentElement.dataset.mounted = '1';
        }
    }

    /// <summary>
    /// Toggle system layout between Dark and Light mode. Saves selection in LocalStorage.
    /// </summary>
    toggleTheme() {
        this.isDarkMode = !this.isDarkMode;
        if (browser) {
            if (this.isDarkMode) {
                document.documentElement.classList.add('dark');
                document.documentElement.classList.remove('light-mode');
                localStorage.setItem('theme', 'dark');
            } else {
                document.documentElement.classList.add('light-mode');
                document.documentElement.classList.remove('dark');
                localStorage.setItem('theme', 'light');
            }
        }
    }

    /// <summary>
    /// Navigate file explorer window to a specific sub-directory path.
    /// </summary>
    /// <param name="path">Array of directory names (e.g., ['science', 'team-A'])</param>
    navigateToPath(path: string[]) {
        this.currentExplorerPath = path;
        this.selectedExplorerIds.clear();
        this.searchExplorerQuery = '';
    }

    /// <summary>
    /// Navigate file explorer up by one directory level.
    /// </summary>
    navigateUp() {
        if (this.currentExplorerPath.length > 0) {
            this.navigateToPath(this.currentExplorerPath.slice(0, -1));
        }
    }

    /// <summary>
    /// Toggle select checkbox on individual explorer file.
    /// </summary>
    /// <param name="id">Unique file identifier</param>
    /// <param name="event">Click DOM event to prevent propagation</param>
    toggleSelectFile(id: string, event: Event) {
        event.stopPropagation();
        if (this.selectedExplorerIds.has(id)) {
            this.selectedExplorerIds.delete(id);
        } else {
            this.selectedExplorerIds.add(id);
        }
        this.selectedExplorerIds = new Set(this.selectedExplorerIds);
    }

    /// <summary>
    /// Open the full-screen image viewer lightbox.
    /// </summary>
    /// <param name="fileId">ID of file to focus on initially</param>
    /// <param name="explorerItems">Filtered list of files available in current folder</param>
    openAdminLightbox(fileId: string, explorerItems: any[]) {
        this.viewerFiles = explorerItems
            .filter(item => item.type === 'file')
            .map(item => ({
                id: item.id,
                name: item.name,
                file_path: item.file_path,
                img_data: item.img_data,
                original_size: item.original_size
            }));

        this.currentViewerIndex = this.viewerFiles.findIndex(f => f.id === fileId);
        if (this.currentViewerIndex !== -1) {
            this.isAdminLightboxOpen = true;
        }
    }

    /// <summary>
    /// Show previous image in lightbox slider.
    /// </summary>
    prevImage() {
        if (this.currentViewerIndex > 0) {
            this.currentViewerIndex--;
        }
    }

    /// <summary>
    /// Show next image in lightbox slider.
    /// </summary>
    nextImage() {
        if (this.currentViewerIndex < this.viewerFiles.length - 1) {
            this.currentViewerIndex++;
        }
    }

    /// <summary>
    /// Toggle tree collection expand/collapse state in explorer sidebar.
    /// </summary>
    /// <param name="colId">Unique collection identifier</param>
    toggleCollectionExpand(colId: string) {
        const isCurrent = this.expandedCollections[colId];
        this.expandedCollections[colId] = isCurrent === undefined ? false : !isCurrent;
    }

    /// <summary>
    /// Push a notification alert to the dashboard interface. Auto dismisses after 4 seconds.
    /// </summary>
    /// <param name="title">Heading of notification card</param>
    /// <param name="desc">Short helper details text</param>
    /// <param name="type">Type parameter determining card style: 'success' | 'error' | 'info'</param>
    showToast(title: string, desc: string, type: 'success' | 'error' | 'info' = 'success') {
        const id = Math.random().toString(36).substring(2, 9);
        this.toasts.push({ id, title, desc, type });
        
        setTimeout(() => {
            this.toasts = this.toasts.filter(t => t.id !== id);
        }, 4000);
    }
}

// Global Singleton Application Store Store instance.
export const appState = new AppState();
