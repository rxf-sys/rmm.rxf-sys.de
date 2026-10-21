import '@testing-library/jest-dom/vitest';

// jsdom does no layout, so it has no scrollIntoView; pages call it to bring
// a linked entry into view.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
