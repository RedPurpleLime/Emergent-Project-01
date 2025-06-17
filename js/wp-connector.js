/**
 * WordPress Connector for Content Autopilot PWA
 * Handles WordPress REST API integration for content publishing
 */

class WordPressConnector {
    constructor() {
        this.config = null;
        this.isConnected = false;
        this.authToken = null;
        this.siteInfo = null;
        this.categories = [];
        this.tags = [];
        this.init();
    }

    async init() {
        // Load WordPress configuration
        await this.loadConfig();
    }

    /**
     * Load WordPress configuration from storage
     */
    async loadConfig() {
        try {
            this.config = await dbManager.getActiveWPConfig();
            if (this.config) {
                this.authToken = btoa(`${this.config.username}:${this.config.password}`);
                await this.testConnection();
            }
        } catch (error) {
            console.error('Failed to load WordPress config:', error);
        }
    }

    /**
     * Save WordPress configuration
     */
    async saveConfig(wpUrl, username, password) {
        try {
            // Normalize URL
            wpUrl = this.normalizeUrl(wpUrl);
            
            // Test connection first
            const testConfig = {
                url: wpUrl,
                username: username,
                password: password
            };
            
            const testResult = await this.testConnectionWithConfig(testConfig);
            if (!testResult.success) {
                throw new Error(testResult.error);
            }

            // Save configuration
            const config = {
                id: 'wp_main_config',
                url: wpUrl,
                username: username,
                password: password, // In production, this should be encrypted
                isActive: true,
                siteInfo: testResult.siteInfo,
                createdAt: new Date().toISOString()
            };

            await dbManager.saveWPConfig(config);
            this.config = config;
            this.authToken = btoa(`${username}:${password}`);
            this.isConnected = true;
            this.siteInfo = testResult.siteInfo;

            // Load categories and tags
            await this.loadCategoriesAndTags();

            return { success: true, siteInfo: this.siteInfo };

        } catch (error) {
            console.error('Failed to save WordPress config:', error);
            throw error;
        }
    }

    /**
     * Test WordPress connection
     */
    async testConnection() {
        if (!this.config) {
            return { success: false, error: 'No configuration found' };
        }

        return this.testConnectionWithConfig(this.config);
    }

    /**
     * Test connection with given configuration
     */
    async testConnectionWithConfig(config) {
        try {
            const restUrl = `${config.url}/wp-json/wp/v2/users/me`;
            const authToken = btoa(`${config.username}:${config.password}`);

            const response = await fetch(restUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                let errorMessage = 'Connection failed';
                
                switch (response.status) {
                    case 401:
                        errorMessage = 'Invalid credentials';
                        break;
                    case 403:
                        errorMessage = 'Insufficient permissions';
                        break;
                    case 404:
                        errorMessage = 'WordPress REST API not found. Check URL.';
                        break;
                    default:
                        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
                
                return { success: false, error: errorMessage };
            }

            const userData = await response.json();
            
            // Get site info
            const siteResponse = await fetch(`${config.url}/wp-json/wp/v2/settings`, {
                headers: {
                    'Authorization': `Basic ${authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            let siteInfo = { title: 'WordPress Site' };
            if (siteResponse.ok) {
                siteInfo = await siteResponse.json();
            }

            this.isConnected = true;
            
            return { 
                success: true, 
                userData: userData,
                siteInfo: {
                    title: siteInfo.title,
                    description: siteInfo.description,
                    url: config.url,
                    user: userData.name
                }
            };

        } catch (error) {
            console.error('WordPress connection test failed:', error);
            return { 
                success: false, 
                error: error.message || 'Network error. Check your connection and URL.' 
            };
        }
    }

    /**
     * Publish article to WordPress
     */
    async publishArticle(article, options = {}) {
        if (!this.isConnected || !this.config) {
            throw new Error('WordPress not configured or connected');
        }

        try {
            // Prepare post data
            const postData = await this.preparePostData(article, options);
            
            // Create the post
            const response = await fetch(`${this.config.url}/wp-json/wp/v2/posts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(postData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`WordPress publish failed: ${errorData.message || response.statusText}`);
            }

            const publishedPost = await response.json();

            // Upload featured image if exists
            if (article.featuredImage && article.featuredImage.url) {
                try {
                    const mediaId = await this.uploadFeaturedImage(article.featuredImage, publishedPost.id);
                    if (mediaId) {
                        await this.updatePostFeaturedImage(publishedPost.id, mediaId);
                    }
                } catch (error) {
                    console.error('Failed to upload featured image:', error);
                    // Continue without featured image
                }
            }

            // Update article status in database
            article.status = 'published';
            article.publishedAt = new Date().toISOString();
            article.wordpressId = publishedPost.id;
            article.wordpressUrl = publishedPost.link;
            await dbManager.saveArticle(article);

            return {
                success: true,
                wordpressId: publishedPost.id,
                url: publishedPost.link,
                article: article
            };

        } catch (error) {
            console.error('Article publishing failed:', error);
            throw error;
        }
    }

    /**
     * Prepare post data for WordPress
     */
    async preparePostData(article, options = {}) {
        // Get or create categories
        const categoryIds = await this.processCategoriesAndTags(article.categories || [], 'categories');
        const tagIds = await this.processCategoriesAndTags(article.tags || [], 'tags');

        const postData = {
            title: article.title,
            content: article.content,
            excerpt: article.excerpt || '',
            status: options.status || 'draft', // draft, publish, private
            slug: article.seo?.slug || this.generateSlug(article.title),
            categories: categoryIds,
            tags: tagIds,
            meta: {
                _yoast_wpseo_title: article.seo?.metaTitle || article.title,
                _yoast_wpseo_metadesc: article.seo?.metaDescription || article.excerpt,
                _yoast_wpseo_focuskw: article.seo?.focusKeyword || ''
            }
        };

        // Add custom fields if needed
        if (article.generatedWith) {
            postData.meta.content_autopilot_generated = true;
            postData.meta.content_autopilot_model = article.generatedWith.model;
            postData.meta.content_autopilot_created = article.createdAt;
        }

        return postData;
    }

    /**
     * Process categories and tags
     */
    async processCategoriesAndTags(items, type) {
        const ids = [];
        const endpoint = type === 'categories' ? 'categories' : 'tags';
        
        for (const item of items) {
            try {
                // Check if category/tag exists
                let existingItem = await this.findCategoryOrTag(item, type);
                
                if (!existingItem) {
                    // Create new category/tag
                    existingItem = await this.createCategoryOrTag(item, type);
                }
                
                if (existingItem && existingItem.id) {
                    ids.push(existingItem.id);
                }
            } catch (error) {
                console.error(`Failed to process ${type} item "${item}":`, error);
            }
        }
        
        return ids;
    }

    /**
     * Find existing category or tag
     */
    async findCategoryOrTag(name, type) {
        const endpoint = type === 'categories' ? 'categories' : 'tags';
        
        try {
            const response = await fetch(`${this.config.url}/wp-json/wp/v2/${endpoint}?search=${encodeURIComponent(name)}`, {
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const items = await response.json();
                return items.find(item => item.name.toLowerCase() === name.toLowerCase());
            }
        } catch (error) {
            console.error(`Failed to search ${type}:`, error);
        }
        
        return null;
    }

    /**
     * Create new category or tag
     */
    async createCategoryOrTag(name, type) {
        const endpoint = type === 'categories' ? 'categories' : 'tags';
        
        try {
            const response = await fetch(`${this.config.url}/wp-json/wp/v2/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    slug: this.generateSlug(name)
                })
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error(`Failed to create ${type}:`, error);
        }
        
        return null;
    }

    /**
     * Upload featured image
     */
    async uploadFeaturedImage(featuredImage, postId) {
        try {
            // If it's a blob URL, fetch the blob first
            let blob;
            if (featuredImage.url.startsWith('blob:')) {
                const response = await fetch(featuredImage.url);
                blob = await response.blob();
            } else if (featuredImage.blob) {
                blob = featuredImage.blob;
            } else {
                throw new Error('No image data available');
            }

            // Create form data
            const formData = new FormData();
            formData.append('file', blob, 'featured-image.png');
            formData.append('title', featuredImage.alt || 'Featured Image');
            formData.append('alt_text', featuredImage.alt || '');
            formData.append('post', postId);

            const response = await fetch(`${this.config.url}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.authToken}`
                },
                body: formData
            });

            if (response.ok) {
                const mediaData = await response.json();
                return mediaData.id;
            } else {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

        } catch (error) {
            console.error('Featured image upload failed:', error);
            throw error;
        }
    }

    /**
     * Update post featured image
     */
    async updatePostFeaturedImage(postId, mediaId) {
        try {
            const response = await fetch(`${this.config.url}/wp-json/wp/v2/posts/${postId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    featured_media: mediaId
                })
            });

            return response.ok;
        } catch (error) {
            console.error('Failed to update featured image:', error);
            return false;
        }
    }

    /**
     * Load categories and tags from WordPress
     */
    async loadCategoriesAndTags() {
        if (!this.isConnected) return;

        try {
            // Load categories
            const categoriesResponse = await fetch(`${this.config.url}/wp-json/wp/v2/categories?per_page=100`, {
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (categoriesResponse.ok) {
                this.categories = await categoriesResponse.json();
            }

            // Load tags
            const tagsResponse = await fetch(`${this.config.url}/wp-json/wp/v2/tags?per_page=100`, {
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (tagsResponse.ok) {
                this.tags = await tagsResponse.json();
            }

        } catch (error) {
            console.error('Failed to load categories and tags:', error);
        }
    }

    /**
     * Batch publish articles
     */
    async batchPublishArticles(articleIds, options = {}) {
        const results = [];
        const batchSize = options.batchSize || 5;
        const delay = options.delay || 5000; // 5 seconds between batches

        for (let i = 0; i < articleIds.length; i += batchSize) {
            const batch = articleIds.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (articleId) => {
                try {
                    const article = await dbManager.getArticle(articleId);
                    if (!article) {
                        return { id: articleId, success: false, error: 'Article not found' };
                    }

                    const result = await this.publishArticle(article, options);
                    return { id: articleId, success: true, result };
                } catch (error) {
                    return { id: articleId, success: false, error: error.message };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Delay between batches to avoid overwhelming WordPress
            if (i + batchSize < articleIds.length) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }

    /**
     * Schedule article publication
     */
    async scheduleArticle(articleId, publishDate, options = {}) {
        try {
            const article = await dbManager.getArticle(articleId);
            if (!article) {
                throw new Error('Article not found');
            }

            // Create scheduled task
            const scheduledTask = {
                id: dbManager.generateId(),
                type: 'publish_article',
                articleId: articleId,
                scheduledFor: publishDate,
                options: options,
                status: 'pending',
                isActive: true,
                nextRun: publishDate,
                createdAt: new Date().toISOString()
            };

            await dbManager.saveScheduledTask(scheduledTask);

            // Update article status
            article.status = 'scheduled';
            article.scheduledFor = publishDate;
            await dbManager.saveArticle(article);

            return { success: true, scheduledTask };

        } catch (error) {
            console.error('Article scheduling failed:', error);
            throw error;
        }
    }

    /**
     * Get WordPress site statistics
     */
    async getSiteStats() {
        if (!this.isConnected) {
            return null;
        }

        try {
            const stats = {};

            // Get posts count
            const postsResponse = await fetch(`${this.config.url}/wp-json/wp/v2/posts?per_page=1`, {
                headers: {
                    'Authorization': `Basic ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (postsResponse.ok) {
                stats.totalPosts = parseInt(postsResponse.headers.get('X-WP-Total') || '0');
            }

            // Get categories count
            stats.totalCategories = this.categories.length;
            stats.totalTags = this.tags.length;

            return stats;

        } catch (error) {
            console.error('Failed to get site stats:', error);
            return null;
        }
    }

    /**
     * Utility methods
     */
    normalizeUrl(url) {
        // Remove trailing slash and ensure proper format
        url = url.replace(/\/+$/, '');
        
        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        return url;
    }

    generateSlug(text) {
        return text
            .toLowerCase()
            .replace(/[àáâãäå]/g, 'a')
            .replace(/[èéêë]/g, 'e')
            .replace(/[ìíîï]/g, 'i')
            .replace(/[òóôõö]/g, 'o')
            .replace(/[ùúûü]/g, 'u')
            .replace(/[ñ]/g, 'n')
            .replace(/[ç]/g, 'c')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            config: this.config ? {
                url: this.config.url,
                username: this.config.username,
                siteTitle: this.siteInfo?.title
            } : null,
            siteInfo: this.siteInfo,
            categoriesCount: this.categories.length,
            tagsCount: this.tags.length
        };
    }

    /**
     * Disconnect from WordPress
     */
    disconnect() {
        this.config = null;
        this.isConnected = false;
        this.authToken = null;
        this.siteInfo = null;
        this.categories = [];
        this.tags = [];
    }

    /**
     * Delete WordPress configuration
     */
    async deleteConfig() {
        if (this.config) {
            await dbManager.delete('wpConfigs', this.config.id);
            this.disconnect();
        }
    }
}

// Create global instance
window.wpConnector = new WordPressConnector();