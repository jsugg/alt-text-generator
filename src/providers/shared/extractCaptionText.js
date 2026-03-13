const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

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

  const directText = normalizeText(payload.output_text)
    || normalizeText(payload.response)
    || normalizeText(payload.generated_text)
    || extractTextFromContent(payload.message?.content)
    || extractTextFromContent(payload.content);

  if (directText) {
    return directText;
  }

  if (Array.isArray(payload.choices)) {
    const choiceText = payload.choices
      .map((choice) => extractTextFromContent(choice?.message?.content)
        || extractTextFromContent(choice?.delta?.content))
      .find(Boolean);

    if (choiceText) {
      return choiceText;
    }
  }

  if (Array.isArray(payload.output)) {
    return payload.output
      .map((item) => extractCaptionText(item))
      .find(Boolean) || null;
  }

  if (Array.isArray(payload.data)) {
    return extractCaptionText(payload.data);
  }

  return null;
};

module.exports = {
  extractCaptionText,
};
