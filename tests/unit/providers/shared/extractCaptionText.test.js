const {
  extractCaptionText,
} = require('../../../../src/providers/shared/extractCaptionText');

describe('Unit | Providers | Shared | Extract Caption Text', () => {
  it('extracts trimmed direct string payloads', () => {
    expect(extractCaptionText('  a cat on a chair  ')).toBe('a cat on a chair');
  });

  it('extracts the first caption from array payloads', () => {
    expect(extractCaptionText([
      null,
      { generated_text: 'a dog in a field' },
    ])).toBe('a dog in a field');
  });

  it('extracts text from chat-completion content parts', () => {
    expect(extractCaptionText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'a lighthouse' },
              { type: 'text', text: 'by the sea' },
            ],
          },
        },
      ],
    })).toBe('a lighthouse by the sea');
  });

  it('extracts nested output and data payloads', () => {
    expect(extractCaptionText({
      output: [
        { content: [{ text: 'a runner crossing a bridge' }] },
      ],
    })).toBe('a runner crossing a bridge');
    expect(extractCaptionText({
      data: [
        { response: 'a bicycle parked outside' },
      ],
    })).toBe('a bicycle parked outside');
  });

  it('returns null when no caption-like text is present', () => {
    expect(extractCaptionText({ choices: [{ message: { content: [] } }] })).toBeNull();
    expect(extractCaptionText(42)).toBeNull();
  });
});
