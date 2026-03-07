/**
 * Strategy registry for image description providers.
 *
 * Providers are registered by name at startup. Route handlers never import
 * concrete describer classes directly — they call factory.get(model).
 * Adding a new provider means calling factory.register(...) with no changes
 * to existing code (Open/Closed Principle).
 */
class ImageDescriberFactory {
  constructor() {
    this.strategies = new Map();
  }

  /**
   * Register a describer under a model name.
   * @param {string} name
   * @param {object} describer - Instance implementing describeImage(imageUrl)
   * @returns {ImageDescriberFactory} for chaining
   */
  register(name, describer) {
    this.strategies.set(name, describer);
    return this;
  }

  /**
   * Retrieve a registered describer by model name.
   * Throws a descriptive error (caught in the controller as a 400) if not found.
   * @param {string} name
   * @returns {object}
   */
  get(name) {
    const describer = this.strategies.get(name);
    if (!describer) {
      const available = Array.from(this.strategies.keys()).join(', ');
      throw new Error(`Unknown model '${name}'. Available models: ${available}`);
    }
    return describer;
  }

  /**
   * @returns {string[]} list of registered model names
   */
  getAvailableModels() {
    return Array.from(this.strategies.keys());
  }
}

module.exports = ImageDescriberFactory;
