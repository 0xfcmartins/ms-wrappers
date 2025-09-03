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
    
    // DOM elements
    this.loadingEl = document.getElementById('loading');
    this.sourcesGridEl = document.getElementById('sourcesGrid');
    this.noSourcesEl = document.getElementById('noSources');
    this.shareBtn = document.getElementById('shareBtn');
    this.cancelBtn = document.getElementById('cancelBtn');
    
    this.init();
  }

  init() {
    // Set up event listeners
    this.shareBtn.addEventListener('click', () => this.handleShare());
    this.cancelBtn.addEventListener('click', () => this.handleCancel());
    
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
    
    this.renderSources(sources);
    this.sourcesGridEl.style.display = 'grid';
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
    sourceEl.className = 'source-item';
    sourceEl.setAttribute('tabindex', '0');
    sourceEl.setAttribute('role', 'button');
    sourceEl.setAttribute('aria-label', `Share ${source.name}`);
    sourceEl.dataset.sourceId = source.id;
    sourceEl.dataset.index = index;

    // Create thumbnail image
    const thumbnailEl = document.createElement('img');
    thumbnailEl.className = 'source-thumbnail';
    thumbnailEl.src = source.thumbnail.toDataURL();
    thumbnailEl.alt = `Thumbnail of ${source.name}`;
    thumbnailEl.loading = 'lazy';

    // Create source info
    const infoEl = document.createElement('div');
    infoEl.className = 'source-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'source-name';
    nameEl.textContent = source.name;
    nameEl.title = source.name; // Tooltip for long names

    const typeEl = document.createElement('div');
    typeEl.className = 'source-type';
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
    const previousSelected = this.sourcesGridEl.querySelector('.source-item.selected');
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
    
    if (window.streamSelector) {
      window.streamSelector.cancelSelection();
    } else {
      console.error('[ScreenSourceSelector] streamSelector API not available');
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
      return;
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