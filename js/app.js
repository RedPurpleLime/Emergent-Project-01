/**
 * Main Application Controller for Content Autopilot PWA
 * Handles UI interactions and coordinates between modules
 */

class ContentAutopilotApp {
    constructor() {
        this.currentTab = 'dashboard';
        this.isLoading = false;
        this.notifications = [];
        this.init();
    }

    async init() {
        try {
            // Initialize database
            await dbManager.init();
            
            // Initialize API manager
            await apiManager.init();
            
            // Initialize WordPress connector
            await wpConnector.init();
            
            // Initialize components
            this.initEventListeners();
            this.initPWAFeatures();
            
            // Load initial data
            await this.loadDashboardData();
            
            console.log('Content Autopilot PWA initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showToast('Errore nell\'inizializzazione dell\'app', 'error');
        }
    }

    /**
     * Initialize event listeners
     */
    initEventListeners() {
        // Navigation tabs
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.closest('.nav-tab').dataset.tab;
                this.switchTab(tabName);
            });
        });

        // New project form
        const newProjectForm = document.getElementById('newProjectForm');
        if (newProjectForm) {
            newProjectForm.addEventListener('submit', (e) => this.handleNewProject(e));
        }

        // API configuration form
        const apiConfigForm = document.getElementById('apiConfigForm');
        if (apiConfigForm) {
            apiConfigForm.addEventListener('submit', (e) => this.handleAPIConfig(e));
        }

        // WordPress configuration form
        const wpConfigForm = document.getElementById('wpConfigForm');
        if (wpConfigForm) {
            wpConfigForm.addEventListener('submit', (e) => this.handleWPConfig(e));
        }

        // WordPress connection test
        const testWpButton = document.getElementById('testWpConnection');
        if (testWpButton) {
            testWpButton.addEventListener('click', () => this.testWordPressConnection());
        }

        // App settings form
        const appSettingsForm = document.getElementById('appSettingsForm');
        if (appSettingsForm) {
            appSettingsForm.addEventListener('submit', (e) => this.handleAppSettings(e));
        }

        // Schedule form
        const scheduleForm = document.getElementById('scheduleForm');
        if (scheduleForm) {
            scheduleForm.addEventListener('submit', (e) => this.handleScheduleConfig(e));
        }

        // Data management buttons
        this.initDataManagementButtons();

        // PWA install button
        const installButton = document.getElementById('installPwa');
        if (installButton) {
            installButton.addEventListener('click', () => this.installPWA());
        }
    }

    /**
     * Initialize data management buttons
     */
    initDataManagementButtons() {
        const exportButton = document.getElementById('exportData');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.exportData());
        }

        const importButton = document.getElementById('importData');
        if (importButton) {
            importButton.addEventListener('click', () => this.importData());
        }

        const clearButton = document.getElementById('clearData');
        if (clearButton) {
            clearButton.addEventListener('click', () => this.clearAllData());
        }

        // Hidden file input for import
        const fileInput = document.getElementById('importFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleImportFile(e));
        }
    }

    /**
     * Switch between tabs
     */
    switchTab(tabName) {
        // Update navigation
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`tab-${tabName}`).classList.add('active');

        this.currentTab = tabName;

        // Load tab-specific data
        this.loadTabData(tabName);
    }

    /**
     * Load data for specific tab
     */
    async loadTabData(tabName) {
        switch (tabName) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'search':
                await this.loadSearchData();
                break;
            case 'articles':
                await this.loadArticlesData();
                break;
            case 'wordpress':
                await this.loadWordPressData();
                break;
            case 'scheduler':
                await this.loadSchedulerData();
                break;
            case 'settings':
                await this.loadSettingsData();
                break;
        }
    }

    /**
     * Handle new project creation
     */
    async handleNewProject(e) {
        e.preventDefault();
        
        try {
            this.showLoading('Creazione progetto...');

            const formData = new FormData(e.target);
            const projectData = {
                name: formData.get('projectName'),
                topic: formData.get('topic'),
                keywords: formData.get('keywords'),
                articleCount: parseInt(formData.get('articleCount')),
                status: 'created'
            };

            // Save project
            const project = await dbManager.saveProject(projectData);

            // Start web search
            await this.startWebSearch(project);

            // Generate articles
            await contentGenerator.generateArticlesFromProject(project.id, {
                articleCount: project.articleCount,
                articleLength: await dbManager.getSetting('articleLength', 'medium'),
                generateImages: await dbManager.getSetting('autoImages', true)
            });

            this.showToast('Progetto creato e articoli generati con successo!', 'success');
            
            // Refresh dashboard
            await this.loadDashboardData();
            
            // Reset form
            e.target.reset();

        } catch (error) {
            console.error('Project creation failed:', error);
            this.showToast(`Errore nella creazione del progetto: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Start web search for project
     */
    async startWebSearch(project) {
        try {
            const keywords = Array.isArray(project.keywords) ? 
                project.keywords : project.keywords.split(',').map(k => k.trim());

            const searchResults = [];
            
            for (const keyword of keywords) {
                const query = `${project.topic} ${keyword}`.trim();
                
                try {
                    const result = await apiManager.searchWeb(query, {
                        count: 10,
                        market: 'it-IT',
                        freshness: 'pm' // Past month
                    });

                    const searchData = {
                        id: dbManager.generateId(),
                        projectId: project.id,
                        query: query,
                        results: result.results,
                        totalResults: result.totalResults,
                        createdAt: new Date().toISOString()
                    };

                    await dbManager.saveSearchResults(searchData);
                    searchResults.push(searchData);
                } catch (error) {
                    console.error(`Search failed for keyword: ${keyword}`, error);
                }
            }

            return searchResults;
        } catch (error) {
            console.error('Web search failed:', error);
            throw error;
        }
    }

    /**
     * Handle API configuration
     */
    async handleAPIConfig(e) {
        e.preventDefault();

        try {
            const formData = new FormData(e.target);
            const braveApiKey = formData.get('braveApiKey');
            const hfToken = formData.get('hfToken');

            if (braveApiKey) {
                await apiManager.saveAPIConfig('brave', braveApiKey);
            }

            if (hfToken) {
                await apiManager.saveAPIConfig('huggingface', hfToken);
            }

            this.showToast('Configurazione API salvata con successo!', 'success');
            
            // Update API status display
            this.updateAPIStatus();

        } catch (error) {
            console.error('API configuration failed:', error);
            this.showToast(`Errore nella configurazione API: ${error.message}`, 'error');
        }
    }

    /**
     * Handle WordPress configuration
     */
    async handleWPConfig(e) {
        e.preventDefault();

        try {
            const formData = new FormData(e.target);
            const wpUrl = formData.get('wpUrl');
            const wpUsername = formData.get('wpUsername');
            const wpPassword = formData.get('wpPassword');

            const result = await wpConnector.saveConfig(wpUrl, wpUsername, wpPassword);
            
            if (result.success) {
                this.showToast('Configurazione WordPress salvata con successo!', 'success');
                await this.loadWordPressData();
            }

        } catch (error) {
            console.error('WordPress configuration failed:', error);
            this.showToast(`Errore nella configurazione WordPress: ${error.message}`, 'error');
        }
    }

    /**
     * Test WordPress connection
     */
    async testWordPressConnection() {
        try {
            this.showLoading('Test connessione WordPress...');
            
            const result = await wpConnector.testConnection();
            
            if (result.success) {
                this.showToast('Connessione WordPress riuscita!', 'success');
            } else {
                this.showToast(`Test connessione fallito: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('WordPress connection test failed:', error);
            this.showToast(`Errore nel test di connessione: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Handle app settings
     */
    async handleAppSettings(e) {
        e.preventDefault();

        try {
            const formData = new FormData(e.target);
            
            await dbManager.saveSetting('defaultLanguage', formData.get('defaultLanguage'));
            await dbManager.saveSetting('articleLength', formData.get('articleLength'));
            await dbManager.saveSetting('autoImages', formData.has('autoImages'));

            this.showToast('Impostazioni salvate con successo!', 'success');

        } catch (error) {
            console.error('Settings save failed:', error);
            this.showToast(`Errore nel salvare le impostazioni: ${error.message}`, 'error');
        }
    }

    /**
     * Handle schedule configuration
     */
    async handleScheduleConfig(e) {
        e.preventDefault();

        try {
            const formData = new FormData(e.target);
            const enabled = formData.has('scheduleEnabled');
            const frequency = formData.get('scheduleFrequency');
            const time = formData.get('scheduleTime');

            await dbManager.saveSetting('scheduleEnabled', enabled);
            await dbManager.saveSetting('scheduleFrequency', frequency);
            await dbManager.saveSetting('scheduleTime', time);

            if (enabled) {
                // Set up recurring publishing schedule
                await scheduler.scheduleRecurringPublishing(frequency, time);
                this.showToast('Pubblicazione automatica attivata!', 'success');
            } else {
                // Cancel existing schedules
                const publishTasks = await scheduler.getTasksByType('publish_article');
                for (const task of publishTasks) {
                    await scheduler.cancelTask(task.id);
                }
                this.showToast('Pubblicazione automatica disattivata', 'info');
            }

        } catch (error) {
            console.error('Schedule configuration failed:', error);
            this.showToast(`Errore nella configurazione dello scheduler: ${error.message}`, 'error');
        }
    }

    /**
     * Load dashboard data
     */
    async loadDashboardData() {
        try {
            const projects = await dbManager.getAllProjects();
            const articles = await dbManager.getAllArticles();
            const stats = await contentGenerator.getGenerationStats();
            const apiStatus = apiManager.getAPIStatus();

            // Update recent projects
            this.updateRecentProjects(projects.slice(0, 5));

            // Update statistics
            document.getElementById('totalProjects').textContent = stats.totalProjects;
            document.getElementById('totalArticles').textContent = stats.totalArticles;
            document.getElementById('totalPublished').textContent = 
                articles.filter(a => a.status === 'published').length;
            document.getElementById('apiCallsRemaining').textContent = 
                apiStatus.brave.remaining || '--';

        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        }
    }

    /**
     * Update recent projects display
     */
    updateRecentProjects(projects) {
        const container = document.getElementById('recentProjects');
        
        if (projects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                    </svg>
                    <p>Nessun progetto ancora creato</p>
                </div>
            `;
            return;
        }

        const projectsHTML = projects.map(project => `
            <div class="project-item" data-project-id="${project.id}">
                <div class="project-info">
                    <h4>${project.name}</h4>
                    <p>${project.topic}</p>
                    <small>Creato il ${new Date(project.createdAt).toLocaleDateString('it-IT')}</small>
                </div>
                <div class="project-status">
                    <span class="status-badge status-${project.status}">${project.status}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = projectsHTML;

        // Add click handlers for project items
        container.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', () => {
                const projectId = item.dataset.projectId;
                this.viewProject(projectId);
            });
        });
    }

    /**
     * Load search data
     */
    async loadSearchData() {
        try {
            const searchResults = await dbManager.getAll('searchResults');
            this.updateSearchResults(searchResults);
        } catch (error) {
            console.error('Failed to load search data:', error);
        }
    }

    /**
     * Update search results display
     */
    updateSearchResults(searchResults) {
        const container = document.getElementById('searchResults');
        
        if (searchResults.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="21 21l-4.35-4.35"/>
                    </svg>
                    <p>Avvia un progetto dalla Dashboard per vedere i risultati della ricerca</p>
                </div>
            `;
            return;
        }

        const resultsHTML = searchResults.map(search => `
            <div class="search-result-group">
                <h3>Query: "${search.query}"</h3>
                <p>Trovati ${search.totalResults} risultati</p>
                <div class="search-results">
                    ${search.results.slice(0, 5).map(result => `
                        <div class="search-result-item">
                            <h4><a href="${result.url}" target="_blank">${result.title}</a></h4>
                            <p class="result-url">${result.displayUrl}</p>
                            <p class="result-description">${result.description}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        container.innerHTML = resultsHTML;
    }

    /**
     * Load articles data
     */
    async loadArticlesData() {
        try {
            const articles = await dbManager.getAllArticles();
            this.updateArticlesList(articles);
        } catch (error) {
            console.error('Failed to load articles data:', error);
        }
    }

    /**
     * Update articles list display
     */
    updateArticlesList(articles) {
        const container = document.getElementById('articlesContainer');
        
        if (articles.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                    </svg>
                    <p>Nessun articolo ancora generato</p>
                </div>
            `;
            return;
        }

        const articlesHTML = articles.map(article => `
            <div class="article-card" data-article-id="${article.id}">
                <div class="article-header">
                    <h3>${article.title}</h3>
                    <span class="status-badge status-${article.status}">${article.status}</span>
                </div>
                <div class="article-info">
                    <p class="article-excerpt">${article.excerpt}</p>
                    <div class="article-meta">
                        <span>${article.wordCount} parole</span>
                        <span>${article.readingTime}</span>
                        <span>Creato: ${new Date(article.createdAt).toLocaleDateString('it-IT')}</span>
                    </div>
                </div>
                <div class="article-actions">
                    <button class="btn btn-secondary" onclick="app.editArticle('${article.id}')">Modifica</button>
                    <button class="btn btn-primary" onclick="app.publishArticle('${article.id}')">Pubblica</button>
                </div>
            </div>
        `).join('');

        container.innerHTML = articlesHTML;
    }

    /**
     * Load WordPress data
     */
    async loadWordPressData() {
        try {
            const wpStatus = wpConnector.getConnectionStatus();
            this.updateWordPressStatus(wpStatus);
        } catch (error) {
            console.error('Failed to load WordPress data:', error);
        }
    }

    /**
     * Update WordPress status display
     */
    updateWordPressStatus(status) {
        // This would update the WordPress connection status in the UI
        console.log('WordPress Status:', status);
    }

    /**
     * Load scheduler data
     */
    async loadSchedulerData() {
        try {
            const schedulerStatus = scheduler.getStatus();
            const scheduledTasks = await scheduler.getAllTasks();
            this.updateSchedulerStatus(schedulerStatus, scheduledTasks);
        } catch (error) {
            console.error('Failed to load scheduler data:', error);
        }
    }

    /**
     * Update scheduler status display
     */
    updateSchedulerStatus(status, tasks) {
        // This would update the scheduler status and tasks list in the UI
        console.log('Scheduler Status:', status);
        console.log('Scheduled Tasks:', tasks);
    }

    /**
     * Load settings data
     */
    async loadSettingsData() {
        try {
            // Load current settings into forms
            const defaultLanguage = await dbManager.getSetting('defaultLanguage', 'it');
            const articleLength = await dbManager.getSetting('articleLength', 'medium');
            const autoImages = await dbManager.getSetting('autoImages', true);

            document.getElementById('defaultLanguage').value = defaultLanguage;
            document.getElementById('articleLength').value = articleLength;
            document.getElementById('autoImages').checked = autoImages;

            // Load API keys (masked)
            const braveConfig = await dbManager.getAPIConfig('brave');
            const hfConfig = await dbManager.getAPIConfig('huggingface');

            if (braveConfig) {
                document.getElementById('braveApiKey').placeholder = '••••••••••••••••';
            }
            
            if (hfConfig) {
                document.getElementById('hfToken').placeholder = '••••••••••••••••';
            }

        } catch (error) {
            console.error('Failed to load settings data:', error);
        }
    }

    /**
     * Update API status display
     */
    updateAPIStatus() {
        const status = apiManager.getAPIStatus();
        
        // Update rate limit display
        const remainingElement = document.getElementById('apiCallsRemaining');
        if (remainingElement) {
            remainingElement.textContent = status.brave.remaining || '--';
        }
    }

    /**
     * Publish article
     */
    async publishArticle(articleId) {
        try {
            this.showLoading('Pubblicazione articolo...');
            
            const article = await dbManager.getArticle(articleId);
            if (!article) {
                throw new Error('Articolo non trovato');
            }

            const result = await wpConnector.publishArticle(article, {
                status: 'publish'
            });

            if (result.success) {
                this.showToast(`Articolo "${article.title}" pubblicato con successo!`, 'success');
                await this.loadArticlesData(); // Refresh articles list
            }

        } catch (error) {
            console.error('Article publishing failed:', error);
            this.showToast(`Errore nella pubblicazione: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Export data
     */
    async exportData() {
        try {
            this.showLoading('Esportazione dati...');
            
            const exportData = await dbManager.exportData();
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `content-autopilot-export-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('Dati esportati con successo!', 'success');

        } catch (error) {
            console.error('Data export failed:', error);
            this.showToast(`Errore nell'esportazione: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Import data
     */
    importData() {
        document.getElementById('importFileInput').click();
    }

    /**
     * Handle import file selection
     */
    async handleImportFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            this.showLoading('Importazione dati...');
            
            const text = await file.text();
            const importData = JSON.parse(text);
            
            await dbManager.importData(importData);
            
            this.showToast('Dati importati con successo!', 'success');
            
            // Refresh current tab
            await this.loadTabData(this.currentTab);

        } catch (error) {
            console.error('Data import failed:', error);
            this.showToast(`Errore nell'importazione: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
            e.target.value = ''; // Reset file input
        }
    }

    /**
     * Clear all data
     */
    async clearAllData() {
        if (!confirm('Sei sicuro di voler cancellare tutti i dati? Questa azione non può essere annullata.')) {
            return;
        }

        try {
            this.showLoading('Cancellazione dati...');
            
            await dbManager.clearAllData();
            
            this.showToast('Tutti i dati sono stati cancellati', 'info');
            
            // Refresh current tab
            await this.loadTabData(this.currentTab);

        } catch (error) {
            console.error('Data clearing failed:', error);
            this.showToast(`Errore nella cancellazione: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Initialize PWA features
     */
    initPWAFeatures() {
        // Handle install prompt
        let deferredPrompt;
        
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            
            const installButton = document.getElementById('installPwa');
            if (installButton) {
                installButton.style.display = 'inline-flex';
            }
        });

        // Handle app installed
        window.addEventListener('appinstalled', () => {
            console.log('PWA was installed');
            this.showToast('App installata con successo!', 'success');
            
            const installButton = document.getElementById('installPwa');
            if (installButton) {
                installButton.style.display = 'none';
            }
            
            document.getElementById('pwaInstalled').style.display = 'block';
        });

        this.deferredPrompt = deferredPrompt;
    }

    /**
     * Install PWA
     */
    async installPWA() {
        if (!this.deferredPrompt) {
            this.showToast('Installazione PWA non disponibile', 'warning');
            return;
        }

        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        
        if (outcome === 'accepted') {
            console.log('User accepted the install prompt');
        } else {
            console.log('User dismissed the install prompt');
        }

        this.deferredPrompt = null;
    }

    /**
     * Show loading overlay
     */
    showLoading(text = 'Caricamento...') {
        this.isLoading = true;
        const overlay = document.getElementById('loadingOverlay');
        const loadingText = document.getElementById('loadingText');
        
        if (loadingText) {
            loadingText.textContent = text;
        }
        
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.isLoading = false;
        const overlay = document.getElementById('loadingOverlay');
        
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <p>${message}</p>
            </div>
        `;

        container.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    /**
     * View project details
     */
    async viewProject(projectId) {
        // This would open a project detail view
        console.log('Viewing project:', projectId);
        // Implementation depends on UI design
    }

    /**
     * Edit article
     */
    async editArticle(articleId) {
        // This would open an article editor
        console.log('Editing article:', articleId);
        // Implementation depends on UI design
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ContentAutopilotApp();
});

// Make app globally available
window.ContentAutopilotApp = ContentAutopilotApp;