/**
 * @param {unknown} value
 * @returns {string | null}
 */
const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

/**
 * @param {unknown} content
 * @returns {string | null}
 */
const extractTextFromContent = (content) => {
  if (typeof content === 'string') {
    return normalizeText(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return part.text;
      }

      return null;
    })
    .filter(Boolean)
    .join(' ')
    .trim();

  return text.length > 0 ? text : null;
};

/**
 * Extracts the first non-empty caption-like text from common multimodal APIs.
 *
 * @param {unknown} payload
 * @returns {string | null}
 */
const extractCaptionText = (payload) => {
  if (!payload) {
    return null;
  }

  if (typeof payload === 'string') {
    return normalizeText(payload);
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => extractCaptionText(item))
      .find(Boolean) || null;
  }

  if (typeof payload !== 'object') {
    return null;
  }

  const record = /** @type {Record<string, any>} */ (payload);

  const directText = normalizeText(record.output_text)
    || normalizeText(record.response)
    || normalizeText(record.generated_text)
    || extractTextFromContent(record.message?.content)
    || extractTextFromContent(record.content);

  if (directText) {
    return directText;
  }

  if (Array.isArray(record.choices)) {
    const choiceText = record.choices
      .map((choice) => extractTextFromContent(choice?.message?.content)
        || extractTextFromContent(choice?.delta?.content))
      .find(Boolean);

    if (choiceText) {
      return choiceText;
    }
  }

  if (Array.isArray(record.output)) {
    return record.output
      .map((item) => extractCaptionText(item))
      .find(Boolean) || null;
  }

  if (Array.isArray(record.data)) {
    return extractCaptionText(record.data);
  }

  return null;
};

module.exports = {
  extractCaptionText,
};
