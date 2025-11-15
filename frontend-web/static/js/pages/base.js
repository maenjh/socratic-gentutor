export class Page {
    constructor(container) {
        this.container = container;
    }

    async render() {
        throw new Error('render method must be implemented');
    }
}