/**
 * Attribution patterns shared with the repository rulesets and local agent guards.
 *
 * The strings are vendored byte-for-byte from the shared reference (RE2- and
 * Python-compatible) so every enforcement layer agrees; do not edit them here.
 * JavaScript has no inline flag groups, so `toRegExp` lifts the leading
 * `(?im)` / `(?i)` prefix into RegExp flags.
 */
const REF_NAME = String.raw`(?i)^(?:refs/(?:heads|tags)/)?(?:(?:ai|agents?|assistants?|bots?|llm)[/._-])?(?:claude|anthropic|codex|openai|chatgpt|copilot)(?:/|\n?$)`;
const COMMIT_MESSAGE = String.raw`(?im)(?:^[ \t]*(?:co-authored-by|assisted-by|generated-by|ai-assisted-by)[ \t]*:[^\n]*(?:claude|anthropic|codex|openai|chatgpt|copilot|gemini|cursor|windsurf|devin|aider|cline))`
  + String.raw`|(?:^[^a-z0-9\n]{0,8}(?:generated|created|written|authored|produced|assisted)[ \t]+(?:by|with|using|via)[ \t]+(?:an?[ \t]+|the[ \t]+)?\[?(?:claude|anthropic|codex|openai|chatgpt|copilot|gemini|cursor|windsurf|devin|aider|cline)(?:[^a-z0-9\n-]|\n?$))`
  + String.raw`|(?:claude\.ai/(?:code|share)|claude\.com/claude-code|chatgpt\.com/(?:codex|share))`
  + String.raw`|(?:noreply@(?:anthropic|openai)\.com)`
  + String.raw`|(?:^merge pull request #[0-9]+ from [^ \n]+/(?:claude|anthropic|codex|openai|chatgpt|copilot)/)`;
const EMAIL = String.raw`(?i)@(?:anthropic|openai)\.com\n?$`;
const LABEL = String.raw`(?i)(?:claude|anthropic|codex|openai)`;

const INLINE_FLAGS_PATTERN = /^\(\?([a-z]+)\)/u;

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function toRegExp(pattern) {
  const match = pattern.match(INLINE_FLAGS_PATTERN);

  return match
    ? new RegExp(pattern.slice(match[0].length), match[1])
    : new RegExp(pattern);
}

module.exports = {
  COMMIT_MESSAGE,
  COMMIT_MESSAGE_RE: toRegExp(COMMIT_MESSAGE),
  EMAIL,
  EMAIL_RE: toRegExp(EMAIL),
  LABEL,
  LABEL_RE: toRegExp(LABEL),
  REF_NAME,
  REF_NAME_RE: toRegExp(REF_NAME),
  toRegExp,
};
