/**
 * API Manager for Content Autopilot PWA
 * Handles all external API calls and rate limiting
 */

class APIManager {
    constructor() {
        this.configs = {
            brave: null,
            huggingface: null
        };
        this.rateLimits = {
            brave: { remaining: 2000, resetDate: null },
            huggingface: { remaining: 500, resetDate: null }
        };
        this.isOnline = navigator.onLine;
        this.pendingRequests = new Map();
        
        // Listen for online/offline events
        window.addEventListener('online', () => this.handleOnlineStatus(true));
        window.addEventListener('offline', () => this.handleOnlineStatus(false));
        
        this.init();
    }

    async init() {
        // Load API configurations from IndexedDB
        await this.loadConfigs();
        this.updateConnectionStatus();
    }

    /**
     * Load API configurations from storage
     */
    async loadConfigs() {
        try {
            const braveConfig = await dbManager.getAPIConfig('brave');
            const hfConfig = await dbManager.getAPIConfig('huggingface');
            
            if (braveConfig) {
                this.configs.brave = braveConfig;
            }
            
            if (hfConfig) {
                this.configs.huggingface = hfConfig;
            }

            // Load rate limit data
            const braveLimit = await dbManager.getSetting('brave_rate_limit');
            const hfLimit = await dbManager.getSetting('hf_rate_limit');
            
            if (braveLimit) {
                this.rateLimits.brave = JSON.parse(braveLimit);
            }
            
            if (hfLimit) {
                this.rateLimits.huggingface = JSON.parse(hfLimit);
            }

            console.log('API configurations loaded');
        } catch (error) {
            console.error('Failed to load API configs:', error);
        }
    }

    /**
     * Save API configuration
     */
    async saveAPIConfig(provider, apiKey) {
        try {
            const config = {
                id: `${provider}_config`,
                provider: provider,
                apiKey: apiKey,
                isActive: true,
                createdAt: new Date().toISOString()
            };

            await dbManager.saveAPIConfig(config);
            this.configs[provider] = config;
            
            // Test the configuration
            const isValid = await this.testAPIConfig(provider);
            
            if (isValid) {
                this.showToast('API key salvata e testata con successo', 'success');
            } else {
                this.showToast('API key salvata ma il test è fallito', 'warning');
            }

            return isValid;
        } catch (error) {
            console.error('Failed to save API config:', error);
            this.showToast('Errore nel salvare la configurazione API', 'error');
            return false;
        }
    }

    /**
     * Test API configuration
     */
    async testAPIConfig(provider) {
        try {
            switch (provider) {
                case 'brave':
                    return await this.testBraveAPI();
                case 'huggingface':
                    return await this.testHuggingFaceAPI();
                default:
                    return false;
            }
        } catch (error) {
            console.error(`API test failed for ${provider}:`, error);
            return false;
        }
    }

    /**
     * Test Brave Search API
     */
    async testBraveAPI() {
        if (!this.configs.brave?.apiKey) {
            throw new Error('Brave API key not configured');
        }

        try {
            const response = await fetch('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.configs.brave.apiKey
                }
            });

            if (response.ok) {
                this.updateRateLimit('brave', response.headers);
                return true;
            } else if (response.status === 401) {
                throw new Error('Invalid API key');
            } else if (response.status === 429) {
                throw new Error('Rate limit exceeded');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Brave API test failed:', error);
            throw error;
        }
    }

    /**
     * Test Hugging Face API
     */
    async testHuggingFaceAPI() {
        if (!this.configs.huggingface?.apiKey) {
            throw new Error('Hugging Face token not configured');
        }

        try {
            const response = await fetch('https://api-inference.huggingface.co/models/gpt2', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.configs.huggingface.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: "Test",
                    parameters: { max_length: 10 }
                })
            });

            if (response.ok || response.status === 503) {
                // 503 means model is loading, which is still a valid response
                return true;
            } else if (response.status === 401) {
                throw new Error('Invalid token');
            } else if (response.status === 429) {
                throw new Error('Rate limit exceeded');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Hugging Face API test failed:', error);
            throw error;
        }
    }

    /**
     * Brave Search API methods
     */
    async searchWeb(query, options = {}) {
        if (!this.configs.brave?.apiKey) {
            throw new Error('Brave API key not configured');
        }

        if (!this.isOnline) {
            throw new Error('No internet connection');
        }

        if (this.rateLimits.brave.remaining <= 0) {
            throw new Error('Brave API rate limit exceeded');
        }

        const params = new URLSearchParams({
            q: query,
            count: options.count || 10,
            offset: options.offset || 0,
            mkt: options.market || 'it-IT',
            safesearch: options.safesearch || 'moderate',
            textDecorations: false,
            textFormat: 'Raw',
            freshness: options.freshness || ''
        });

        try {
            const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.configs.brave.apiKey
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid Brave API key');
                } else if (response.status === 429) {
                    throw new Error('Brave API rate limit exceeded');
                } else {
                    throw new Error(`Brave API error: ${response.status}`);
                }
            }

            const data = await response.json();
            this.updateRateLimit('brave', response.headers);
            
            return this.formatBraveResults(data);
        } catch (error) {
            console.error('Brave Search API error:', error);
            throw error;
        }
    }

    /**
     * Format Brave Search results
     */
    formatBraveResults(data) {
        return {
            query: data.query?.original || '',
            totalResults: data.web?.totalEstimatedMatches || 0,
            results: data.web?.results?.map(result => ({
                title: result.title,
                url: result.url,
                description: result.description,
                displayUrl: result.display_url,
                datePublished: result.date,
                snippet: result.description,
                language: result.language,
                location: result.location
            })) || [],
            suggestions: data.query?.spellcheck || [],
            news: data.news?.results?.map(news => ({
                title: news.title,
                url: news.url,
                description: news.description,
                datePublished: news.age,
                source: news.source
            })) || []
        };
    }

    /**
     * Hugging Face API methods
     */
    async generateText(prompt, options = {}) {
        if (!this.configs.huggingface?.apiKey) {
            throw new Error('Hugging Face token not configured');
        }

        if (!this.isOnline) {
            // Check if we have offline fallback
            const offlineResponse = await this.getOfflineContent('text', prompt);
            if (offlineResponse) {
                return offlineResponse;
            }
            throw new Error('No internet connection and no offline content available');
        }

        const model = options.model || 'microsoft/DialoGPT-large';
        const maxLength = options.maxLength || 500;
        const temperature = options.temperature || 0.7;

        try {
            const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.configs.huggingface.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_length: maxLength,
                        temperature: temperature,
                        return_full_text: false,
                        do_sample: true
                    }
                })
            });

            if (response.status === 503) {
                // Model is loading, try again after a delay
                await new Promise(resolve => setTimeout(resolve, 20000));
                return this.generateText(prompt, options);
            }

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid Hugging Face token');
                } else if (response.status === 429) {
                    throw new Error('Hugging Face API rate limit exceeded');
                } else {
                    throw new Error(`Hugging Face API error: ${response.status}`);
                }
            }

            const data = await response.json();
            let generatedText = '';

            if (Array.isArray(data) && data.length > 0) {
                generatedText = data[0].generated_text || data[0].text || '';
            } else if (data.generated_text) {
                generatedText = data.generated_text;
            }

            // Cache the result for offline use
            await this.cacheOfflineContent('text', prompt, generatedText);

            return {
                text: generatedText,
                model: model,
                prompt: prompt,
                success: true
            };
        } catch (error) {
            console.error('Hugging Face text generation error:', error);
            throw error;
        }
    }

    /**
     * Generate image with Hugging Face
     */
    async generateImage(prompt, options = {}) {
        if (!this.configs.huggingface?.apiKey) {
            throw new Error('Hugging Face token not configured');
        }

        if (!this.isOnline) {
            throw new Error('No internet connection');
        }

        const model = options.model || 'stabilityai/stable-diffusion-2-1';

        try {
            const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.configs.huggingface.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        guidance_scale: options.guidance_scale || 7.5,
                        num_inference_steps: options.steps || 50
                    }
                })
            });

            if (response.status === 503) {
                // Model is loading
                throw new Error('Image generation model is loading. Please try again in a few minutes.');
            }

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid Hugging Face token');
                } else if (response.status === 429) {
                    throw new Error('Hugging Face API rate limit exceeded');
                } else {
                    throw new Error(`Hugging Face API error: ${response.status}`);
                }
            }

            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);

            return {
                imageUrl: imageUrl,
                blob: blob,
                model: model,
                prompt: prompt,
                success: true
            };
        } catch (error) {
            console.error('Hugging Face image generation error:', error);
            throw error;
        }
    }

    /**
     * Update rate limit information
     */
    updateRateLimit(provider, headers) {
        const remaining = headers.get('x-ratelimit-remaining');
        const reset = headers.get('x-ratelimit-reset');

        if (remaining !== null) {
            this.rateLimits[provider].remaining = parseInt(remaining);
        }

        if (reset !== null) {
            this.rateLimits[provider].resetDate = new Date(parseInt(reset) * 1000);
        }

        // Save to storage
        dbManager.saveSetting(`${provider}_rate_limit`, JSON.stringify(this.rateLimits[provider]));
        
        // Update UI
        this.updateRateLimitDisplay();
    }

    /**
     * Update rate limit display in UI
     */
    updateRateLimitDisplay() {
        const braveRemaining = this.rateLimits.brave.remaining;
        const element = document.getElementById('apiCallsRemaining');
        
        if (element) {
            element.textContent = braveRemaining.toString();
        }
    }

    /**
     * Handle online/offline status
     */
    handleOnlineStatus(isOnline) {
        this.isOnline = isOnline;
        this.updateConnectionStatus();
        
        if (isOnline) {
            this.processPendingRequests();
        }
    }

    /**
     * Update connection status in UI
     */
    updateConnectionStatus() {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            const dot = statusElement.querySelector('.status-dot');
            const text = statusElement.querySelector('span');
            
            if (this.isOnline) {
                dot.className = 'status-dot';
                text.textContent = 'Online';
            } else {
                dot.className = 'status-dot offline';
                text.textContent = 'Offline';
            }
        }
    }

    /**
     * Cache content for offline use
     */
    async cacheOfflineContent(type, prompt, content) {
        try {
            const cacheData = {
                type: type,
                prompt: prompt,
                content: content,
                timestamp: new Date().toISOString()
            };

            await dbManager.saveSetting(`offline_${type}_${this.hashString(prompt)}`, JSON.stringify(cacheData));
        } catch (error) {
            console.error('Failed to cache offline content:', error);
        }
    }

    /**
     * Get cached offline content
     */
    async getOfflineContent(type, prompt) {
        try {
            const cacheKey = `offline_${type}_${this.hashString(prompt)}`;
            const cached = await dbManager.getSetting(cacheKey);
            
            if (cached) {
                const cacheData = JSON.parse(cached);
                // Return cached content if it's less than 24 hours old
                const cacheAge = Date.now() - new Date(cacheData.timestamp).getTime();
                if (cacheAge < 24 * 60 * 60 * 1000) {
                    return {
                        text: cacheData.content,
                        cached: true,
                        success: true
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error('Failed to get offline content:', error);
            return null;
        }
    }

    /**
     * Process pending requests when back online
     */
    async processPendingRequests() {
        const pendingOps = await dbManager.getAllPendingOperations();
        
        for (const op of pendingOps) {
            try {
                switch (op.type) {
                    case 'search':
                        await this.searchWeb(op.data.query, op.data.options);
                        break;
                    case 'generateText':
                        await this.generateText(op.data.prompt, op.data.options);
                        break;
                    case 'generateImage':
                        await this.generateImage(op.data.prompt, op.data.options);
                        break;
                }
                
                await dbManager.deletePendingOperation(op.id);
            } catch (error) {
                console.error('Failed to process pending request:', error);
            }
        }
    }

    /**
     * Queue request for when back online
     */
    async queuePendingRequest(type, data) {
        const operation = {
            id: dbManager.generateId(),
            type: type,
            data: data,
            createdAt: new Date().toISOString()
        };

        await dbManager.savePendingOperation(operation);
    }

    /**
     * Check if APIs are configured
     */
    isConfigured(provider) {
        return !!(this.configs[provider]?.apiKey);
    }

    /**
     * Get API status
     */
    getAPIStatus() {
        return {
            brave: {
                configured: this.isConfigured('brave'),
                remaining: this.rateLimits.brave.remaining,
                resetDate: this.rateLimits.brave.resetDate
            },
            huggingface: {
                configured: this.isConfigured('huggingface'),
                remaining: this.rateLimits.huggingface.remaining,
                resetDate: this.rateLimits.huggingface.resetDate
            },
            online: this.isOnline
        };
    }

    /**
     * Utility methods
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        // This will be handled by the main app
        if (window.app && window.app.showToast) {
            window.app.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Create global instance
window.apiManager = new APIManager();