/**
 * IndexedDB Manager for Content Autopilot PWA
 * Handles all local data storage operations
 */

class DBManager {
    constructor() {
        this.dbName = 'ContentAutopilotDB';
        this.dbVersion = 1;
        this.db = null;
        this.isReady = false;
    }

    /**
     * Initialize the database
     */
    async init() {
        if (this.isReady) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isReady = true;
                console.log('Database initialized successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createObjectStores(db);
            };
        });
    }

    /**
     * Create object stores (tables)
     */
    createObjectStores(db) {
        console.log('Creating object stores...');

        // Projects store
        if (!db.objectStoreNames.contains('projects')) {
            const projectStore = db.createObjectStore('projects', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            projectStore.createIndex('name', 'name', { unique: false });
            projectStore.createIndex('topic', 'topic', { unique: false });
            projectStore.createIndex('createdAt', 'createdAt', { unique: false });
            projectStore.createIndex('status', 'status', { unique: false });
        }

        // Articles store
        if (!db.objectStoreNames.contains('articles')) {
            const articleStore = db.createObjectStore('articles', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            articleStore.createIndex('projectId', 'projectId', { unique: false });
            articleStore.createIndex('title', 'title', { unique: false });
            articleStore.createIndex('status', 'status', { unique: false });
            articleStore.createIndex('createdAt', 'createdAt', { unique: false });
            articleStore.createIndex('publishedAt', 'publishedAt', { unique: false });
        }

        // Search results store
        if (!db.objectStoreNames.contains('searchResults')) {
            const searchStore = db.createObjectStore('searchResults', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            searchStore.createIndex('projectId', 'projectId', { unique: false });
            searchStore.createIndex('query', 'query', { unique: false });
            searchStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // WordPress configurations store
        if (!db.objectStoreNames.contains('wpConfigs')) {
            const wpStore = db.createObjectStore('wpConfigs', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            wpStore.createIndex('url', 'url', { unique: true });
            wpStore.createIndex('isActive', 'isActive', { unique: false });
        }

        // API configurations store
        if (!db.objectStoreNames.contains('apiConfigs')) {
            const apiStore = db.createObjectStore('apiConfigs', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            apiStore.createIndex('provider', 'provider', { unique: false });
        }

        // App settings store
        if (!db.objectStoreNames.contains('appSettings')) {
            const settingsStore = db.createObjectStore('appSettings', { 
                keyPath: 'key', 
                autoIncrement: false 
            });
        }

        // Scheduled tasks store
        if (!db.objectStoreNames.contains('scheduledTasks')) {
            const taskStore = db.createObjectStore('scheduledTasks', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            taskStore.createIndex('nextRun', 'nextRun', { unique: false });
            taskStore.createIndex('type', 'type', { unique: false });
            taskStore.createIndex('isActive', 'isActive', { unique: false });
        }

        // Pending operations for offline functionality
        if (!db.objectStoreNames.contains('pendingOperations')) {
            const pendingStore = db.createObjectStore('pendingOperations', { 
                keyPath: 'id', 
                autoIncrement: false 
            });
            pendingStore.createIndex('type', 'type', { unique: false });
            pendingStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        console.log('Object stores created successfully');
    }

    /**
     * Generic method to add/update data
     */
    async save(storeName, data) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        
        // Add timestamp if not present
        if (!data.id) {
            data.id = this.generateId();
        }
        if (!data.createdAt) {
            data.createdAt = new Date().toISOString();
        }
        data.updatedAt = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const request = store.put(data);
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Generic method to get data by ID
     */
    async get(storeName, id) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);

        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Generic method to get all data from a store
     */
    async getAll(storeName, index = null, query = null) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        
        let source = store;
        if (index) {
            source = store.index(index);
        }

        return new Promise((resolve, reject) => {
            const request = query ? source.getAll(query) : source.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Generic method to delete data
     */
    async delete(storeName, id) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Count records in a store
     */
    async count(storeName, index = null, query = null) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        
        let source = store;
        if (index) {
            source = store.index(index);
        }

        return new Promise((resolve, reject) => {
            const request = query ? source.count(query) : source.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all data from a store
     */
    async clear(storeName) {
        await this.ensureReady();
        
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);

        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // Specific methods for each data type

    /**
     * Project methods
     */
    async saveProject(project) {
        return this.save('projects', project);
    }

    async getProject(id) {
        return this.get('projects', id);
    }

    async getAllProjects() {
        const projects = await this.getAll('projects');
        return projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    async deleteProject(id) {
        // Also delete related articles and search results
        const articles = await this.getAll('articles', 'projectId', id);
        const searchResults = await this.getAll('searchResults', 'projectId', id);
        
        for (const article of articles) {
            await this.delete('articles', article.id);
        }
        
        for (const result of searchResults) {
            await this.delete('searchResults', result.id);
        }
        
        return this.delete('projects', id);
    }

    /**
     * Article methods
     */
    async saveArticle(article) {
        return this.save('articles', article);
    }

    async getArticle(id) {
        return this.get('articles', id);
    }

    async getArticlesByProject(projectId) {
        return this.getAll('articles', 'projectId', projectId);
    }

    async getAllArticles() {
        return this.getAll('articles');
    }

    /**
     * Search results methods
     */
    async saveSearchResults(searchResults) {
        return this.save('searchResults', searchResults);
    }

    async getSearchResultsByProject(projectId) {
        return this.getAll('searchResults', 'projectId', projectId);
    }

    /**
     * WordPress configuration methods
     */
    async saveWPConfig(config) {
        // Set all others as inactive if this one is active
        if (config.isActive) {
            const allConfigs = await this.getAll('wpConfigs');
            for (const cfg of allConfigs) {
                if (cfg.id !== config.id) {
                    cfg.isActive = false;
                    await this.save('wpConfigs', cfg);
                }
            }
        }
        return this.save('wpConfigs', config);
    }

    async getActiveWPConfig() {
        const configs = await this.getAll('wpConfigs', 'isActive', true);
        return configs.length > 0 ? configs[0] : null;
    }

    async getAllWPConfigs() {
        return this.getAll('wpConfigs');
    }

    /**
     * API configuration methods
     */
    async saveAPIConfig(config) {
        return this.save('apiConfigs', config);
    }

    async getAPIConfig(provider) {
        const configs = await this.getAll('apiConfigs', 'provider', provider);
        return configs.length > 0 ? configs[0] : null;
    }

    async getAllAPIConfigs() {
        return this.getAll('apiConfigs');
    }

    /**
     * App settings methods
     */
    async saveSetting(key, value) {
        return this.save('appSettings', { key, value });
    }

    async getSetting(key, defaultValue = null) {
        const setting = await this.get('appSettings', key);
        return setting ? setting.value : defaultValue;
    }

    /**
     * Scheduled tasks methods
     */
    async saveScheduledTask(task) {
        return this.save('scheduledTasks', task);
    }

    async getActiveScheduledTasks() {
        return this.getAll('scheduledTasks', 'isActive', true);
    }

    async getScheduledTasksDue() {
        const now = new Date().toISOString();
        const allTasks = await this.getActiveScheduledTasks();
        return allTasks.filter(task => task.nextRun <= now);
    }

    /**
     * Pending operations for offline functionality
     */
    async savePendingOperation(operation) {
        return this.save('pendingOperations', operation);
    }

    async getAllPendingOperations() {
        return this.getAll('pendingOperations');
    }

    async deletePendingOperation(id) {
        return this.delete('pendingOperations', id);
    }

    /**
     * Export all data
     */
    async exportData() {
        await this.ensureReady();
        
        const stores = [
            'projects', 'articles', 'searchResults', 'wpConfigs', 
            'apiConfigs', 'appSettings', 'scheduledTasks'
        ];
        
        const exportData = {
            version: this.dbVersion,
            timestamp: new Date().toISOString(),
            data: {}
        };

        for (const storeName of stores) {
            exportData.data[storeName] = await this.getAll(storeName);
        }

        return exportData;
    }

    /**
     * Import data
     */
    async importData(importData) {
        if (!importData.data) {
            throw new Error('Invalid import data format');
        }

        await this.ensureReady();

        // Clear existing data (except pendingOperations)
        const storesToClear = [
            'projects', 'articles', 'searchResults', 'wpConfigs', 
            'apiConfigs', 'appSettings', 'scheduledTasks'
        ];

        for (const storeName of storesToClear) {
            await this.clear(storeName);
        }

        // Import new data
        for (const [storeName, records] of Object.entries(importData.data)) {
            if (Array.isArray(records)) {
                for (const record of records) {
                    await this.save(storeName, record);
                }
            }
        }

        return true;
    }

    /**
     * Get database statistics
     */
    async getStats() {
        const stats = {};
        const stores = [
            'projects', 'articles', 'searchResults', 'wpConfigs', 
            'apiConfigs', 'appSettings', 'scheduledTasks', 'pendingOperations'
        ];

        for (const storeName of stores) {
            stats[storeName] = await this.count(storeName);
        }

        return stats;
    }

    /**
     * Utility methods
     */
    async ensureReady() {
        if (!this.isReady) {
            await this.init();
        }
    }

    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Clear all data (dangerous operation)
     */
    async clearAllData() {
        await this.ensureReady();
        
        const stores = [
            'projects', 'articles', 'searchResults', 'wpConfigs', 
            'apiConfigs', 'appSettings', 'scheduledTasks', 'pendingOperations'
        ];

        for (const storeName of stores) {
            await this.clear(storeName);
        }

        return true;
    }
}

// Create global instance
window.dbManager = new DBManager();