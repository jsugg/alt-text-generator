const replicate = require('./replicate');
const azure = require('./azure');
const ollama = require('./ollama');
const huggingface = require('./huggingface');
const openai = require('./openai');
const openrouter = require('./openrouter');
const together = require('./together');

module.exports = Object.freeze([
  replicate,
  azure,
  ollama,
  huggingface,
  openai,
  openrouter,
  together,
]);
