const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('PTE AI provider adapters include package-scoped env fallbacks', () => {
  const openaiSource = readText('packages/pte/MVC/services/pte/ai/providers/openaiService.js');
  const anthropicSource = readText('packages/pte/MVC/services/pte/ai/providers/anthropicService.js');
  const azureSource = readText('packages/pte/MVC/services/pte/ai/providers/azureOpenAIService.js');
  const geminiSource = readText('packages/pte/MVC/services/pte/ai/providers/googleGeminiService.js');
  const vertexSource = readText('packages/pte/MVC/services/pte/ai/providers/googleVertexService.js');

  assert.ok(openaiSource.includes('PTE_OPENAI_API_KEY'), 'OpenAI provider should read PTE_OPENAI_API_KEY');
  assert.ok(openaiSource.includes('PTE_OPENAI_BASE_URL'), 'OpenAI provider should read PTE_OPENAI_BASE_URL');
  assert.ok(openaiSource.includes('PTE_OPENAI_MODEL_ID'), 'OpenAI provider should read PTE_OPENAI_MODEL_ID');
  assert.ok(openaiSource.includes('PTE_OPENAI_REASONING_EFFORT'), 'OpenAI provider should read PTE_OPENAI_REASONING_EFFORT');
  assert.ok(!openaiSource.includes('ielts_response_schema'), 'OpenAI provider response schema should not use IELTS-specific key');

  assert.ok(anthropicSource.includes('PTE_ANTHROPIC_API_KEY'), 'Anthropic provider should read PTE_ANTHROPIC_API_KEY');
  assert.ok(anthropicSource.includes('PTE_ANTHROPIC_BASE_URL'), 'Anthropic provider should read PTE_ANTHROPIC_BASE_URL');
  assert.ok(anthropicSource.includes('PTE_ANTHROPIC_API_VERSION'), 'Anthropic provider should read PTE_ANTHROPIC_API_VERSION');
  assert.ok(anthropicSource.includes('PTE_ANTHROPIC_MODEL_ID'), 'Anthropic provider should read PTE_ANTHROPIC_MODEL_ID');

  assert.ok(azureSource.includes('PTE_AZURE_OPENAI_API_KEY'), 'Azure OpenAI provider should read PTE_AZURE_OPENAI_API_KEY');
  assert.ok(azureSource.includes('PTE_AZURE_OPENAI_ENDPOINT'), 'Azure OpenAI provider should read PTE_AZURE_OPENAI_ENDPOINT');
  assert.ok(azureSource.includes('PTE_AZURE_OPENAI_API_VERSION'), 'Azure OpenAI provider should read PTE_AZURE_OPENAI_API_VERSION');
  assert.ok(azureSource.includes('PTE_AZURE_OPENAI_DEPLOYMENT'), 'Azure OpenAI provider should read PTE_AZURE_OPENAI_DEPLOYMENT');
  assert.ok(!azureSource.includes('name: \'ielts_response_schema\''), 'Azure provider response schema should not use IELTS-specific key');

  assert.ok(geminiSource.includes('PTE_GEMINI_API_KEY'), 'Gemini provider should read PTE_GEMINI_API_KEY');
  assert.ok(geminiSource.includes('PTE_GEMINI_MODEL_ID'), 'Gemini provider should read PTE_GEMINI_MODEL_ID');

  assert.ok(vertexSource.includes('PTE_VERTEX_API_KEY'), 'Vertex provider should read PTE_VERTEX_API_KEY');
  assert.ok(vertexSource.includes('PTE_VERTEX_ACCESS_TOKEN'), 'Vertex provider should read PTE_VERTEX_ACCESS_TOKEN');
  assert.ok(vertexSource.includes('PTE_VERTEX_PROJECT_ID'), 'Vertex provider should read PTE_VERTEX_PROJECT_ID');
  assert.ok(vertexSource.includes('PTE_VERTEX_LOCATION'), 'Vertex provider should read PTE_VERTEX_LOCATION');
  assert.ok(vertexSource.includes('PTE_VERTEX_BASE_URL'), 'Vertex provider should read PTE_VERTEX_BASE_URL');
  assert.ok(vertexSource.includes('PTE_GEMINI_BASE_URL'), 'Vertex provider should read PTE_GEMINI_BASE_URL');
  assert.ok(vertexSource.includes('PTE_VERTEX_MODEL_ID'), 'Vertex provider should read PTE_VERTEX_MODEL_ID');
});
