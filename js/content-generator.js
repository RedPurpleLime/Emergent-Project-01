/**
 * Content Generator for Content Autopilot PWA
 * Handles AI-powered article generation from search results
 */

class ContentGenerator {
    constructor() {
        this.isGenerating = false;
        this.generationQueue = [];
        this.templates = {
            blog: {
                structure: ['introduction', 'main_content', 'conclusion'],
                wordCounts: { short: 400, medium: 700, long: 1200 }
            },
            news: {
                structure: ['headline', 'lead', 'body', 'summary'],
                wordCounts: { short: 300, medium: 500, long: 800 }
            },
            tutorial: {
                structure: ['introduction', 'prerequisites', 'steps', 'conclusion'],
                wordCounts: { short: 600, medium: 1000, long: 1500 }
            }
        };
    }

    /**
     * Generate articles from a project
     */
    async generateArticlesFromProject(projectId, options = {}) {
        try {
            this.isGenerating = true;
            this.updateGenerationStatus('Inizializzazione generazione...');

            // Get project data
            const project = await dbManager.getProject(projectId);
            if (!project) {
                throw new Error('Progetto non trovato');
            }

            // Get search results for the project
            const searchResults = await dbManager.getSearchResultsByProject(projectId);
            if (!searchResults || searchResults.length === 0) {
                throw new Error('Nessun risultato di ricerca disponibile per questo progetto');
            }

            // Generate articles
            const articles = [];
            const articleCount = options.articleCount || project.articleCount || 5;
            const articleLength = options.articleLength || project.articleLength || 'medium';
            const generateImages = options.generateImages !== false;

            for (let i = 0; i < articleCount; i++) {
                this.updateGenerationStatus(`Generazione articolo ${i + 1} di ${articleCount}...`);
                
                try {
                    const article = await this.generateSingleArticle(project, searchResults, {
                        index: i,
                        total: articleCount,
                        length: articleLength,
                        generateImage: generateImages
                    });
                    
                    if (article) {
                        articles.push(article);
                        await dbManager.saveArticle(article);
                    }
                } catch (error) {
                    console.error(`Failed to generate article ${i + 1}:`, error);
                    // Continue with next article
                }

                // Small delay to prevent overwhelming the API
                await this.delay(2000);
            }

            // Update project status
            project.status = 'completed';
            project.articlesGenerated = articles.length;
            await dbManager.saveProject(project);

            this.updateGenerationStatus('Generazione completata!');
            
            return {
                success: true,
                articles: articles,
                count: articles.length
            };

        } catch (error) {
            console.error('Article generation failed:', error);
            this.updateGenerationStatus('Errore nella generazione');
            throw error;
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Generate a single article
     */
    async generateSingleArticle(project, searchResults, options = {}) {
        try {
            // Prepare context from search results
            const context = this.prepareContentContext(searchResults, options.index);
            
            // Generate article title
            const titlePrompt = this.createTitlePrompt(project.topic, project.keywords, context);
            const titleResult = await apiManager.generateText(titlePrompt, {
                maxLength: 100,
                temperature: 0.8
            });
            
            const title = this.extractTitle(titleResult.text);

            // Generate article content
            const contentPrompt = this.createContentPrompt(
                title, 
                project.topic, 
                project.keywords, 
                context, 
                options.length
            );
            
            const contentResult = await apiManager.generateText(contentPrompt, {
                maxLength: this.getMaxLength(options.length),
                temperature: 0.7
            });

            const content = this.formatArticleContent(contentResult.text);

            // Generate excerpt
            const excerpt = this.generateExcerpt(content);

            // Generate image if requested
            let featuredImage = null;
            if (options.generateImage) {
                try {
                    const imagePrompt = this.createImagePrompt(title, project.topic);
                    const imageResult = await apiManager.generateImage(imagePrompt);
                    featuredImage = {
                        url: imageResult.imageUrl,
                        alt: title,
                        prompt: imagePrompt
                    };
                } catch (error) {
                    console.error('Failed to generate image:', error);
                    // Continue without image
                }
            }

            // Generate SEO metadata
            const seoData = this.generateSEOMetadata(title, content, project.keywords);

            // Create article object
            const article = {
                id: dbManager.generateId(),
                projectId: project.id,
                title: title,
                content: content,
                excerpt: excerpt,
                featuredImage: featuredImage,
                seo: seoData,
                status: 'draft',
                wordCount: this.countWords(content),
                readingTime: this.calculateReadingTime(content),
                tags: this.extractTags(project.keywords, content),
                categories: this.suggestCategories(project.topic, content),
                createdAt: new Date().toISOString(),
                generatedWith: {
                    model: 'huggingface',
                    prompt: contentPrompt,
                    searchContext: context.summary
                }
            };

            return article;

        } catch (error) {
            console.error('Single article generation failed:', error);
            throw error;
        }
    }

    /**
     * Prepare content context from search results
     */
    prepareContentContext(searchResults, index = 0) {
        const allResults = searchResults.flatMap(sr => sr.results || []);
        
        // Rotate through results to get variety
        const startIndex = index * 3;
        const relevantResults = allResults.slice(startIndex, startIndex + 5);
        
        const context = {
            summary: relevantResults.map(r => r.snippet || r.description).join(' '),
            titles: relevantResults.map(r => r.title),
            urls: relevantResults.map(r => r.url),
            sources: relevantResults.map(r => r.displayUrl || r.url)
        };

        return context;
    }

    /**
     * Create title generation prompt
     */
    createTitlePrompt(topic, keywords, context) {
        const keywordList = Array.isArray(keywords) ? keywords.join(', ') : keywords;
        
        return `Scrivi un titolo accattivante e SEO-friendly per un articolo di blog in italiano su: "${topic}".
        
Keywords da includere: ${keywordList}

Contesto dalle ricerche web:
${context.summary.substring(0, 500)}

Il titolo deve essere:
- Massimo 60 caratteri
- Coinvolgente e cliccabile
- Ottimizzato per i motori di ricerca
- In lingua italiana

Titolo:`;
    }

    /**
     * Create content generation prompt
     */
    createContentPrompt(title, topic, keywords, context, length = 'medium') {
        const keywordList = Array.isArray(keywords) ? keywords.join(', ') : keywords;
        const wordCount = this.templates.blog.wordCounts[length];
        
        return `Scrivi un articolo di blog completo in italiano di circa ${wordCount} parole.

Titolo: "${title}"
Argomento principale: ${topic}
Keywords da includere: ${keywordList}

Informazioni di contesto dalle ricerche web:
${context.summary.substring(0, 1000)}

L'articolo deve:
- Avere una struttura chiara con sottotitoli
- Essere informativo e coinvolgente
- Includere naturalmente le keywords
- Essere scritto in italiano corretto
- Avere un tono professionale ma accessibile
- Includere esempi pratici quando possibile

Struttura richiesta:
1. Introduzione coinvolgente
2. Corpo principale con sottosezioni
3. Conclusione con call-to-action

Articolo:`;
    }

    /**
     * Create image generation prompt
     */
    createImagePrompt(title, topic) {
        return `Professional blog illustration for "${title}", modern digital art style, clean and minimalist, related to ${topic}, high quality, 16:9 aspect ratio`;
    }

    /**
     * Extract clean title from generated text
     */
    extractTitle(generatedText) {
        // Clean up the generated title
        let title = generatedText.split('\n')[0].trim();
        
        // Remove common prefixes
        title = title.replace(/^(Titolo:|Title:|Titolo dell'articolo:)/i, '').trim();
        
        // Remove quotes if present
        title = title.replace(/^["']|["']$/g, '');
        
        // Ensure proper length
        if (title.length > 60) {
            title = title.substring(0, 57) + '...';
        }
        
        return title || 'Articolo Senza Titolo';
    }

    /**
     * Format article content
     */
    formatArticleContent(generatedText) {
        let content = generatedText.trim();
        
        // Add basic HTML formatting
        content = content.replace(/\n\n/g, '</p><p>');
        content = content.replace(/\n/g, '<br>');
        content = `<p>${content}</p>`;
        
        // Fix common formatting issues
        content = content.replace(/<p><\/p>/g, '');
        content = content.replace(/<p><br>/g, '<p>');
        content = content.replace(/<br><\/p>/g, '</p>');
        
        return content;
    }

    /**
     * Generate article excerpt
     */
    generateExcerpt(content) {
        // Strip HTML tags
        const plainText = content.replace(/<[^>]*>/g, '');
        
        // Get first 150 characters
        let excerpt = plainText.substring(0, 150);
        
        // Cut at the last complete word
        const lastSpace = excerpt.lastIndexOf(' ');
        if (lastSpace > 100) {
            excerpt = excerpt.substring(0, lastSpace);
        }
        
        return excerpt + '...';
    }

    /**
     * Generate SEO metadata
     */
    generateSEOMetadata(title, content, keywords) {
        const plainText = content.replace(/<[^>]*>/g, '');
        const keywordList = Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim());
        
        return {
            metaTitle: title.length > 60 ? title.substring(0, 57) + '...' : title,
            metaDescription: this.generateMetaDescription(plainText, keywordList),
            focusKeyword: keywordList[0] || '',
            keywords: keywordList,
            slug: this.generateSlug(title)
        };
    }

    /**
     * Generate meta description
     */
    generateMetaDescription(plainText, keywords) {
        let description = plainText.substring(0, 150);
        
        // Try to include the main keyword
        const mainKeyword = keywords[0];
        if (mainKeyword && !description.toLowerCase().includes(mainKeyword.toLowerCase())) {
            description = `${mainKeyword}: ${description}`;
        }
        
        // Cut at the last complete word
        const lastSpace = description.lastIndexOf(' ');
        if (lastSpace > 120) {
            description = description.substring(0, lastSpace);
        }
        
        return description + '...';
    }

    /**
     * Generate URL slug
     */
    generateSlug(title) {
        return title
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
     * Extract tags from keywords and content
     */
    extractTags(keywords, content) {
        const keywordList = Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim());
        const plainText = content.replace(/<[^>]*>/g, '').toLowerCase();
        
        // Filter keywords that appear in the content
        const relevantTags = keywordList.filter(keyword => 
            plainText.includes(keyword.toLowerCase())
        );
        
        return relevantTags.slice(0, 5); // Limit to 5 tags
    }

    /**
     * Suggest categories based on topic and content
     */
    suggestCategories(topic, content) {
        const categories = [];
        const plainText = content.replace(/<[^>]*>/g, '').toLowerCase();
        
        // Category mapping based on common topics
        const categoryMap = {
            'tecnologia': ['Tecnologia', 'Innovazione'],
            'business': ['Business', 'Economia'],
            'marketing': ['Marketing', 'Business'],
            'salute': ['Salute', 'Benessere'],
            'viaggi': ['Viaggi', 'Lifestyle'],
            'cucina': ['Cucina', 'Lifestyle'],
            'sport': ['Sport', 'Salute'],
            'moda': ['Moda', 'Lifestyle'],
            'arte': ['Arte', 'Cultura'],
            'musica': ['Musica', 'Cultura'],
            'educazione': ['Educazione', 'Cultura'],
            'ambiente': ['Ambiente', 'Sostenibilità']
        };
        
        // Check topic against category map
        const topicLower = topic.toLowerCase();
        for (const [key, cats] of Object.entries(categoryMap)) {
            if (topicLower.includes(key) || plainText.includes(key)) {
                categories.push(...cats);
                break;
            }
        }
        
        // Default category if none found
        if (categories.length === 0) {
            categories.push('General');
        }
        
        return [...new Set(categories)]; // Remove duplicates
    }

    /**
     * Count words in text
     */
    countWords(text) {
        const plainText = text.replace(/<[^>]*>/g, '');
        return plainText.split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Calculate reading time
     */
    calculateReadingTime(text) {
        const wordCount = this.countWords(text);
        const wordsPerMinute = 200; // Average reading speed
        const minutes = Math.ceil(wordCount / wordsPerMinute);
        return `${minutes} min di lettura`;
    }

    /**
     * Get max length for content generation
     */
    getMaxLength(length) {
        const lengthMap = {
            short: 800,
            medium: 1200,
            long: 2000
        };
        return lengthMap[length] || 1200;
    }

    /**
     * Update generation status in UI
     */
    updateGenerationStatus(status) {
        const statusElement = document.getElementById('loadingText');
        if (statusElement) {
            statusElement.textContent = status;
        }
        console.log('Generation status:', status);
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Regenerate a specific article
     */
    async regenerateArticle(articleId, options = {}) {
        try {
            const article = await dbManager.getArticle(articleId);
            if (!article) {
                throw new Error('Articolo non trovato');
            }

            const project = await dbManager.getProject(article.projectId);
            const searchResults = await dbManager.getSearchResultsByProject(article.projectId);

            // Generate new version
            const newArticle = await this.generateSingleArticle(project, searchResults, {
                ...options,
                index: Math.floor(Math.random() * 10) // Random variation
            });

            // Update existing article
            newArticle.id = articleId;
            newArticle.regeneratedAt = new Date().toISOString();
            newArticle.version = (article.version || 1) + 1;

            await dbManager.saveArticle(newArticle);
            return newArticle;

        } catch (error) {
            console.error('Article regeneration failed:', error);
            throw error;
        }
    }

    /**
     * Batch regenerate articles
     */
    async batchRegenerateArticles(articleIds, options = {}) {
        const results = [];
        
        for (const articleId of articleIds) {
            try {
                const article = await this.regenerateArticle(articleId, options);
                results.push({ id: articleId, success: true, article });
            } catch (error) {
                results.push({ id: articleId, success: false, error: error.message });
            }
            
            // Delay between regenerations
            await this.delay(3000);
        }
        
        return results;
    }

    /**
     * Get content generation statistics
     */
    async getGenerationStats() {
        const articles = await dbManager.getAllArticles();
        const projects = await dbManager.getAllProjects();
        
        return {
            totalArticles: articles.length,
            totalProjects: projects.length,
            averageWordsPerArticle: articles.length > 0 ? 
                Math.round(articles.reduce((sum, a) => sum + (a.wordCount || 0), 0) / articles.length) : 0,
            articlesWithImages: articles.filter(a => a.featuredImage).length,
            articlesByStatus: articles.reduce((acc, a) => {
                acc[a.status] = (acc[a.status] || 0) + 1;
                return acc;
            }, {}),
            generatedToday: articles.filter(a => {
                const today = new Date().toDateString();
                return new Date(a.createdAt).toDateString() === today;
            }).length
        };
    }
}

// Create global instance
window.contentGenerator = new ContentGenerator();