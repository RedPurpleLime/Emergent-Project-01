/**
 * Scheduler for Content Autopilot PWA
 * Handles automated task scheduling and execution
 */

class Scheduler {
    constructor() {
        this.isRunning = false;
        this.intervals = new Map();
        this.scheduledTasks = new Map();
        this.config = {
            checkInterval: 60000, // Check every minute
            maxRetries: 3,
            retryDelay: 300000 // 5 minutes
        };
        this.init();
    }

    async init() {
        await this.loadScheduledTasks();
        this.startScheduler();
    }

    /**
     * Start the scheduler
     */
    startScheduler() {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('Scheduler started');

        // Main scheduler loop
        this.mainInterval = setInterval(() => {
            this.processScheduledTasks();
        }, this.config.checkInterval);

        // Process tasks immediately on start
        this.processScheduledTasks();
    }

    /**
     * Stop the scheduler
     */
    stopScheduler() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.mainInterval) {
            clearInterval(this.mainInterval);
            this.mainInterval = null;
        }

        // Clear all task intervals
        this.intervals.forEach((interval, taskId) => {
            clearInterval(interval);
        });
        this.intervals.clear();

        console.log('Scheduler stopped');
    }

    /**
     * Load scheduled tasks from database
     */
    async loadScheduledTasks() {
        try {
            const tasks = await dbManager.getActiveScheduledTasks();
            this.scheduledTasks.clear();
            
            tasks.forEach(task => {
                this.scheduledTasks.set(task.id, task);
            });

            console.log(`Loaded ${tasks.length} scheduled tasks`);
        } catch (error) {
            console.error('Failed to load scheduled tasks:', error);
        }
    }

    /**
     * Process scheduled tasks
     */
    async processScheduledTasks() {
        if (!this.isRunning) return;

        try {
            const now = new Date();
            const dueTasks = await dbManager.getScheduledTasksDue();

            for (const task of dueTasks) {
                if (this.scheduledTasks.has(task.id)) {
                    await this.executeTask(task);
                }
            }
        } catch (error) {
            console.error('Error processing scheduled tasks:', error);
        }
    }

    /**
     * Execute a scheduled task
     */
    async executeTask(task) {
        console.log(`Executing task: ${task.type} (${task.id})`);

        try {
            let result = false;

            switch (task.type) {
                case 'publish_article':
                    result = await this.executePublishArticle(task);
                    break;
                case 'generate_content':
                    result = await this.executeGenerateContent(task);
                    break;
                case 'search_topics':
                    result = await this.executeSearchTopics(task);
                    break;
                case 'backup_data':
                    result = await this.executeBackupData(task);
                    break;
                case 'cleanup_old_data':
                    result = await this.executeCleanupOldData(task);
                    break;
                default:
                    console.warn(`Unknown task type: ${task.type}`);
                    return;
            }

            if (result) {
                await this.handleTaskSuccess(task);
            } else {
                await this.handleTaskFailure(task, 'Task execution returned false');
            }

        } catch (error) {
            console.error(`Task execution failed: ${task.type}`, error);
            await this.handleTaskFailure(task, error.message);
        }
    }

    /**
     * Execute publish article task
     */
    async executePublishArticle(task) {
        const article = await dbManager.getArticle(task.articleId);
        if (!article) {
            throw new Error('Article not found');
        }

        const result = await wpConnector.publishArticle(article, {
            status: 'publish',
            ...task.options
        });

        // Send notification
        if ('serviceWorker' in navigator && 'Notification' in window) {
            this.sendNotification(
                'Articolo Pubblicato',
                `"${article.title}" è stato pubblicato su WordPress`,
                { article: article, url: result.url }
            );
        }

        return result.success;
    }

    /**
     * Execute generate content task
     */
    async executeGenerateContent(task) {
        const project = await dbManager.getProject(task.projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        const result = await contentGenerator.generateArticlesFromProject(
            task.projectId, 
            task.options || {}
        );

        // Send notification
        if ('serviceWorker' in navigator && 'Notification' in window) {
            this.sendNotification(
                'Contenuti Generati',
                `${result.count} articoli generati per "${project.name}"`
            );
        }

        return result.success;
    }

    /**
     * Execute search topics task
     */
    async executeSearchTopics(task) {
        const project = await dbManager.getProject(task.projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        // Perform web searches for project keywords
        const keywords = Array.isArray(project.keywords) ? 
            project.keywords : project.keywords.split(',').map(k => k.trim());

        const searchResults = [];
        for (const keyword of keywords) {
            try {
                const result = await apiManager.searchWeb(`${project.topic} ${keyword}`, {
                    count: 10,
                    market: 'it-IT'
                });
                
                const searchData = {
                    id: dbManager.generateId(),
                    projectId: project.id,
                    query: `${project.topic} ${keyword}`,
                    results: result.results,
                    totalResults: result.totalResults,
                    searchedAt: new Date().toISOString()
                };

                await dbManager.saveSearchResults(searchData);
                searchResults.push(searchData);
            } catch (error) {
                console.error(`Search failed for keyword: ${keyword}`, error);
            }
        }

        return searchResults.length > 0;
    }

    /**
     * Execute backup data task
     */
    async executeBackupData(task) {
        try {
            const exportData = await dbManager.exportData();
            
            // Create backup file
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const filename = `content-autopilot-backup-${new Date().toISOString().split('T')[0]}.json`;
            
            // For PWA, we can store in IndexedDB or trigger download
            // Here we'll trigger a download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('Backup failed:', error);
            return false;
        }
    }

    /**
     * Execute cleanup old data task
     */
    async executeCleanupOldData(task) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - (task.options?.daysToKeep || 30));
            
            // Clean up old search results
            const allSearchResults = await dbManager.getAll('searchResults');
            let cleanedCount = 0;

            for (const result of allSearchResults) {
                if (new Date(result.createdAt) < cutoffDate) {
                    await dbManager.delete('searchResults', result.id);
                    cleanedCount++;
                }
            }

            // Clean up old pending operations
            const allPendingOps = await dbManager.getAllPendingOperations();
            for (const op of allPendingOps) {
                if (new Date(op.createdAt) < cutoffDate) {
                    await dbManager.deletePendingOperation(op.id);
                    cleanedCount++;
                }
            }

            console.log(`Cleaned up ${cleanedCount} old records`);
            return true;
        } catch (error) {
            console.error('Cleanup failed:', error);
            return false;
        }
    }

    /**
     * Handle successful task execution
     */
    async handleTaskSuccess(task) {
        try {
            // Update task status
            task.lastRun = new Date().toISOString();
            task.status = 'completed';
            task.retryCount = 0;

            // Calculate next run time if it's a recurring task
            if (task.recurring) {
                task.nextRun = this.calculateNextRun(task);
                task.status = 'pending'; // Reset for next run
            } else {
                task.isActive = false; // Disable one-time tasks
            }

            await dbManager.saveScheduledTask(task);
            this.scheduledTasks.set(task.id, task);

            console.log(`Task completed successfully: ${task.type}`);
        } catch (error) {
            console.error('Failed to handle task success:', error);
        }
    }

    /**
     * Handle failed task execution
     */
    async handleTaskFailure(task, errorMessage) {
        try {
            task.lastRun = new Date().toISOString();
            task.lastError = errorMessage;
            task.retryCount = (task.retryCount || 0) + 1;

            if (task.retryCount >= this.config.maxRetries) {
                // Max retries reached, disable task
                task.status = 'failed';
                task.isActive = false;
                
                // Send failure notification
                this.sendNotification(
                    'Task Failed',
                    `Task "${task.type}" failed after ${this.config.maxRetries} attempts`,
                    { error: errorMessage }
                );
            } else {
                // Schedule retry
                const retryDelay = this.config.retryDelay * task.retryCount; // Exponential backoff
                task.nextRun = new Date(Date.now() + retryDelay).toISOString();
                task.status = 'retry';
            }

            await dbManager.saveScheduledTask(task);
            this.scheduledTasks.set(task.id, task);

            console.log(`Task failed: ${task.type}, retry count: ${task.retryCount}`);
        } catch (error) {
            console.error('Failed to handle task failure:', error);
        }
    }

    /**
     * Schedule a new task
     */
    async scheduleTask(taskType, scheduledFor, options = {}) {
        try {
            const task = {
                id: dbManager.generateId(),
                type: taskType,
                scheduledFor: scheduledFor,
                nextRun: scheduledFor,
                isActive: true,
                status: 'pending',
                retryCount: 0,
                recurring: options.recurring || false,
                frequency: options.frequency || null,
                options: options.taskOptions || {},
                createdAt: new Date().toISOString(),
                ...options
            };

            await dbManager.saveScheduledTask(task);
            this.scheduledTasks.set(task.id, task);

            console.log(`Task scheduled: ${taskType} for ${scheduledFor}`);
            return task;
        } catch (error) {
            console.error('Failed to schedule task:', error);
            throw error;
        }
    }

    /**
     * Schedule recurring content generation
     */
    async scheduleRecurringGeneration(projectId, frequency, startTime, options = {}) {
        const scheduledFor = this.createScheduleDateTime(frequency, startTime);
        
        return this.scheduleTask('generate_content', scheduledFor, {
            projectId: projectId,
            recurring: true,
            frequency: frequency,
            taskOptions: options
        });
    }

    /**
     * Schedule recurring publishing
     */
    async scheduleRecurringPublishing(frequency, startTime, options = {}) {
        const scheduledFor = this.createScheduleDateTime(frequency, startTime);
        
        return this.scheduleTask('publish_article', scheduledFor, {
            recurring: true,
            frequency: frequency,
            taskOptions: options
        });
    }

    /**
     * Create schedule date/time
     */
    createScheduleDateTime(frequency, time) {
        const now = new Date();
        const [hours, minutes] = time.split(':').map(Number);
        
        let scheduledDate = new Date();
        scheduledDate.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for next occurrence
        if (scheduledDate <= now) {
            switch (frequency) {
                case 'daily':
                    scheduledDate.setDate(scheduledDate.getDate() + 1);
                    break;
                case 'weekly':
                    scheduledDate.setDate(scheduledDate.getDate() + 7);
                    break;
                case 'monthly':
                    scheduledDate.setMonth(scheduledDate.getMonth() + 1);
                    break;
            }
        }

        return scheduledDate.toISOString();
    }

    /**
     * Calculate next run time for recurring tasks
     */
    calculateNextRun(task) {
        const lastRun = new Date(task.lastRun);
        const nextRun = new Date(lastRun);

        switch (task.frequency) {
            case 'daily':
                nextRun.setDate(nextRun.getDate() + 1);
                break;
            case 'weekly':
                nextRun.setDate(nextRun.getDate() + 7);
                break;
            case 'monthly':
                nextRun.setMonth(nextRun.getMonth() + 1);
                break;
            case 'custom':
                if (task.options?.intervalMinutes) {
                    nextRun.setMinutes(nextRun.getMinutes() + task.options.intervalMinutes);
                }
                break;
        }

        return nextRun.toISOString();
    }

    /**
     * Cancel a scheduled task
     */
    async cancelTask(taskId) {
        try {
            const task = this.scheduledTasks.get(taskId);
            if (task) {
                task.isActive = false;
                task.status = 'cancelled';
                await dbManager.saveScheduledTask(task);
                this.scheduledTasks.delete(taskId);
            }

            // Clear any active intervals
            if (this.intervals.has(taskId)) {
                clearInterval(this.intervals.get(taskId));
                this.intervals.delete(taskId);
            }

            console.log(`Task cancelled: ${taskId}`);
            return true;
        } catch (error) {
            console.error('Failed to cancel task:', error);
            return false;
        }
    }

    /**
     * Get all scheduled tasks
     */
    async getAllTasks() {
        return Array.from(this.scheduledTasks.values());
    }

    /**
     * Get tasks by type
     */
    async getTasksByType(taskType) {
        return Array.from(this.scheduledTasks.values()).filter(task => task.type === taskType);
    }

    /**
     * Send notification
     */
    sendNotification(title, body, data = {}) {
        if ('serviceWorker' in navigator && 'Notification' in window) {
            if (Notification.permission === 'granted') {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, {
                        body: body,
                        icon: '/assets/icons/icon-192.png',
                        badge: '/assets/icons/icon-96.png',
                        data: data,
                        tag: 'content-autopilot-notification'
                    });
                });
            }
        }
    }

    /**
     * Request notification permission
     */
    async requestNotificationPermission() {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        return false;
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            totalTasks: this.scheduledTasks.size,
            activeTasks: Array.from(this.scheduledTasks.values()).filter(t => t.isActive).length,
            failedTasks: Array.from(this.scheduledTasks.values()).filter(t => t.status === 'failed').length,
            nextTask: this.getNextTask()
        };
    }

    /**
     * Get next scheduled task
     */
    getNextTask() {
        const activeTasks = Array.from(this.scheduledTasks.values())
            .filter(task => task.isActive && task.nextRun)
            .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));

        return activeTasks.length > 0 ? activeTasks[0] : null;
    }
}

// Create global instance
window.scheduler = new Scheduler();