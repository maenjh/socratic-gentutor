import { state } from './state.js';

class Router {
    constructor() {
        this.pageContent = document.getElementById('page-content');
        this.routes = new Map();
        
        // Set up navigation event listeners
        window.addEventListener('hashchange', () => this.handleRoute());
        
        // Set up sidebar navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const page = e.currentTarget.dataset.page;
                this.navigateTo(page);
                
                // Update active state
                document.querySelectorAll('.nav-item').forEach(nav => 
                    nav.classList.remove('active'));
                e.currentTarget.classList.add('active');
            });
        });

        // Add button click event handling for navigation
        const actionButtons = document.querySelectorAll('.button');
        actionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const targetPage = e.currentTarget.dataset.page;
                if (targetPage) {
                    this.navigateTo(targetPage);
                }
            });
        });
    }

    addRoute(path, pageComponent) {
        this.routes.set(path, pageComponent);
    }

    async navigateTo(pageName) {
        window.location.hash = `#/${pageName}`;
    }

    async handleRoute() {
        const hash = window.location.hash || '#/onboarding';
        const pageName = hash.slice(2); // Remove '#/' from the hash

        // Clear current page content
        if (this.pageContent) {
            this.pageContent.innerHTML = '';
        }

        try {
            // Retrieve registered page module (can be a class constructor or an instance)
            const PageModule = this.routes.get(pageName);
            if (!PageModule) {
                this.pageContent.innerHTML = '<div class="error">Page not found</div>';
                return;
            }

            // If PageModule is a constructor (function), instantiate it and call render
            if (typeof PageModule === 'function') {
                const pageInstance = new PageModule(this.pageContent);
                if (typeof pageInstance.initialize === 'function') {
                    await pageInstance.initialize();
                }
                if (typeof pageInstance.render === 'function') {
                    await pageInstance.render(this.pageContent);
                }
            } else if (typeof PageModule === 'object') {
                // If it's an object instance exported as default from module
                if (typeof PageModule.initialize === 'function') {
                    await PageModule.initialize();
                }
                if (typeof PageModule.render === 'function') {
                    await PageModule.render(this.pageContent);
                }
            } else {
                this.pageContent.innerHTML = '<div class="error">Invalid page module</div>';
            }

            // Update state
            state.setState({ selectedPage: pageName });

            // Update active navigation item
            document.querySelectorAll('.nav-item').forEach(nav => {
                if (nav.dataset.page === pageName) {
                    nav.classList.add('active');
                } else {
                    nav.classList.remove('active');
                }
            });
        } catch (error) {
            console.error('Error rendering page:', error);
            this.pageContent.innerHTML = '<div class="error">Error loading page</div>';
        }
    }

    init() {
        // Handle the initial route
        this.handleRoute();
    }
}

export const router = new Router();