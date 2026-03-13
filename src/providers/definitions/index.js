const clip = require('./clip');
const azure = require('./azure');
const ollama = require('./ollama');
const huggingface = require('./huggingface');
const openai = require('./openai');
const openrouter = require('./openrouter');
const together = require('./together');

module.exports = Object.freeze([
  clip,
  azure,
  ollama,
  huggingface,
  openai,
  openrouter,
  together,
]);
