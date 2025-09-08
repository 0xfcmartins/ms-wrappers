/**
 * StreamSelector Renderer Script
 * 
 * Handles UI interactions for screen source selection
 * Communicates with main process through secure preload API
 */

class ScreenSourceSelector {
  constructor() {
    this.selectedSource = null;
    this.sources = [];
    this.isSubmitting = false;
    this.activeTab = 'screens'; // Default to screens tab
    
    // DOM elements
    this.loadingEl = document.getElementById('loading');
    this.sourcesGridEl = document.getElementById('sourcesGrid');
    this.noSourcesEl = document.getElementById('noSources');
    this.shareBtn = document.getElementById('shareBtn');
    this.cancelBtn = document.getElementById('cancelBtn');
    this.screensTab = document.getElementById('screensTab');
    this.windowsTab = document.getElementById('windowsTab');
    
    this.init();
  }

  init() {
    // Set up event listeners with null guards
    if (this.shareBtn) {
      this.shareBtn.addEventListener('click', () => this.handleShare());
    } else {
      console.warn('[ScreenSourceSelector] shareBtn element not found');
    }
    
    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.handleCancel());
    } else {
      console.warn('[ScreenSourceSelector] cancelBtn element not found');
    }
    
    // Set up tab event listeners
    if (this.screensTab) {
      this.screensTab.addEventListener('click', () => this.switchTab('screens'));
    } else {
      console.warn('[ScreenSourceSelector] screensTab element not found');
    }
    
    if (this.windowsTab) {
      this.windowsTab.addEventListener('click', () => this.switchTab('windows'));
    } else {
      console.warn('[ScreenSourceSelector] windowsTab element not found');
    }
    
    // Listen for sources from main process
    if (window.streamSelector) {
      window.streamSelector.onSourcesAvailable((sources) => {
        this.handleSourcesReceived(sources);
      });
    } else {
      console.error('[ScreenSourceSelector] streamSelector API not available');
      this.showError('Security error: Unable to access screen sources');
    }
    
    // Handle keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    
    console.log('[ScreenSourceSelector] Initialized');
  }

  handleSourcesReceived(sources) {
    console.log(`[ScreenSourceSelector] Received ${sources.length} sources`);
    this.sources = sources;
    
    this.loadingEl.style.display = 'none';
    
    if (sources.length === 0) {
      this.noSourcesEl.style.display = 'block';
      return;
    }
    
    this.renderFilteredSources();
    this.sourcesGridEl.style.display = 'grid';
  }

  switchTab(tabName) {
    // Update active tab
    this.activeTab = tabName;
    
    // Update tab button states
    document.querySelectorAll('.teams-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    // Clear current selection when switching tabs
    this.selectedSource = null;
    this.shareBtn.disabled = true;
    
    // Re-render sources with new filter
    this.renderFilteredSources();
    
    console.log(`[ScreenSourceSelector] Switched to ${tabName} tab`);
  }

  renderFilteredSources() {
    if (!this.sources || this.sources.length === 0) {
      return;
    }
    
    // Filter sources based on active tab
    const filteredSources = this.sources.filter(source => {
      const isScreen = source.id.startsWith('screen:');
      return this.activeTab === 'screens' ? isScreen : !isScreen;
    });
    
    if (filteredSources.length === 0) {
      this.sourcesGridEl.style.display = 'none';
      this.noSourcesEl.style.display = 'block';
      this.noSourcesEl.innerHTML = `
        <p>No ${this.activeTab === 'screens' ? 'screens' : 'applications'} available for sharing.</p>
        <p>Try switching to the other tab or check your system permissions.</p>
      `;
      return;
    }
    
    this.noSourcesEl.style.display = 'none';
    this.sourcesGridEl.style.display = 'grid';
    this.renderSources(filteredSources);
  }

  renderSources(sources) {
    this.sourcesGridEl.innerHTML = '';
    
    sources.forEach((source, index) => {
      const sourceEl = this.createSourceElement(source, index);
      this.sourcesGridEl.appendChild(sourceEl);
    });
  }

  createSourceElement(source, index) {
    const sourceEl = document.createElement('div');
    sourceEl.className = 'teams-source source-item';
    sourceEl.setAttribute('tabindex', '0');
    sourceEl.setAttribute('role', 'button');
    sourceEl.setAttribute('aria-label', `Share ${source.name}`);
    sourceEl.dataset.sourceId = source.id;
    sourceEl.dataset.index = index;

    // Create thumbnail image
    const thumbnailEl = document.createElement('img');
    thumbnailEl.className = 'teams-source-thumbnail source-thumbnail';
    // Handle both string data URLs and NativeImage objects
    thumbnailEl.src = typeof source.thumbnail === 'string' ? source.thumbnail : source.thumbnail.toDataURL();
    thumbnailEl.alt = `Thumbnail of ${source.name}`;
    thumbnailEl.loading = 'lazy';

    // Create source info
    const infoEl = document.createElement('div');
    infoEl.className = 'teams-source-info source-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'teams-source-name source-name';
    nameEl.textContent = source.name;
    nameEl.title = source.name; // Tooltip for long names

    const typeEl = document.createElement('div');
    typeEl.className = 'teams-source-type source-type';
    typeEl.textContent = source.id.startsWith('screen:') ? 'Screen' : 'Window';

    infoEl.appendChild(nameEl);
    infoEl.appendChild(typeEl);

    sourceEl.appendChild(thumbnailEl);
    sourceEl.appendChild(infoEl);

    // Event listeners
    sourceEl.addEventListener('click', () => this.selectSource(source, sourceEl));
    sourceEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.selectSource(source, sourceEl);
      }
    });

    return sourceEl;
  }

  selectSource(source, sourceEl) {
    // Remove previous selection
    const previousSelected = this.sourcesGridEl.querySelector('.teams-source.selected, .source-item.selected');
    if (previousSelected) {
      previousSelected.classList.remove('selected');
      previousSelected.setAttribute('aria-selected', 'false');
    }

    // Mark new selection
    sourceEl.classList.add('selected');
    sourceEl.setAttribute('aria-selected', 'true');
    
    this.selectedSource = source;
    this.shareBtn.disabled = false;
    
    console.log(`[ScreenSourceSelector] Selected source: ${source.name} (${source.id})`);
  }

  handleShare() {
    if (this.isSubmitting) {
      return; // Prevent duplicate submissions
    }

    if (!this.selectedSource) {
      console.error('[ScreenSourceSelector] No source selected');
      return;
    }

    this.isSubmitting = true;
    this.shareBtn.disabled = true;

    console.log(`[ScreenSourceSelector] Sharing source: ${this.selectedSource.name}`);
    
    try {
      if (window.streamSelector) {
        // Create a serializable version of the source object
        // Only include the essential properties and exclude non-serializable thumbnail
        const serializableSource = {
          id: this.selectedSource.id,
          name: this.selectedSource.name,
          display_id: this.selectedSource.display_id,
          appIcon: this.selectedSource.appIcon
        };
        
        window.streamSelector.selectSource(serializableSource);
      } else {
        console.error('[ScreenSourceSelector] streamSelector API not available');
        // Re-enable on failure path inside the picker
        this.isSubmitting = false;
        this.shareBtn.disabled = false;
      }
    } catch (e) {
      console.error('[ScreenSourceSelector] Unhandled error while sharing:', e);
      this.isSubmitting = false;
      this.shareBtn.disabled = false;
    }
  }

  handleCancel() {
    console.log('[ScreenSourceSelector] Selection cancelled');

    // Disable actions to prevent duplicate events
    this.isSubmitting = false;
    if (this.shareBtn) this.shareBtn.disabled = true;

    try {
      if (window.streamSelector && typeof window.streamSelector.cancelSelection === 'function') {
        window.streamSelector.cancelSelection();
      } else {
        console.warn('[ScreenSourceSelector] cancelSelection API not available, closing window locally');
      }
    } catch (e) {
      console.error('[ScreenSourceSelector] Error during cancelSelection:', e);
    } finally {
      // Ensure we cleanup listeners and close the picker gracefully even if IPC path is unavailable
      try { this.cleanup(); } catch {}
      // Close the window; main process will treat this as a cancel if needed
      try { window.close(); } catch {}
    }
  }

  handleKeyDown(e) {
    // Handle Escape key to cancel
    if (e.key === 'Escape') {
      this.handleCancel();
      return;
    }

    // Handle Enter key on share button
    if (e.key === 'Enter' && document.activeElement === this.shareBtn) {
      this.handleShare();
    }
  }

  showError(message) {
    this.loadingEl.style.display = 'none';
    this.sourcesGridEl.style.display = 'none';
    this.noSourcesEl.style.display = 'block';
    this.noSourcesEl.innerHTML = `
      <p>Error: ${message}</p>
      <p>Please try again or contact support.</p>
    `;
  }

  cleanup() {
    if (window.streamSelector) {
      window.streamSelector.removeAllListeners();
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Attempt to embed the picker into a specific host element if present.
  // This supports embedding into the Teams app container:
  // XPath: //*[@id="app"]/div/div/div/div[9]/div/div[1]
  try {
    const resolveXPath = (xpath, contextNode = document) => {
      const result = document.evaluate(xpath, contextNode, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue || null;
    };

    const hostXPath = '//*[@id="app"]/div/div/div/div[9]/div/div[1]';
    const host = resolveXPath(hostXPath);
    const container = document.getElementById('obf-MainContainer');

    if (host && container && container.parentElement !== host) {
      host.appendChild(container);
      // Ensure the container fits the host area instead of viewport
      container.style.setProperty('height', '100%', 'important');
      container.style.setProperty('width', '100%', 'important');
      // Avoid overlay background when embedded
      document.body && (document.body.style.background = 'transparent');
      console.log('[ScreenSourceSelector] Embedded into host element via XPath.');
    }
  } catch (e) {
    console.warn('[ScreenSourceSelector] Embedding attempt failed:', e);
  }

  const selector = new ScreenSourceSelector();
  
  // Cleanup when window is unloaded
  window.addEventListener('beforeunload', () => {
    selector.cleanup();
  });
});

// Handle any unhandled errors
window.addEventListener('error', (e) => {
  console.error('[ScreenSourceSelector] Unhandled error:', e.error);
});

console.log('[ScreenSourceSelector] Script loaded');