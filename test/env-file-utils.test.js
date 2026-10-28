const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnvLine, parseEnvValue } = require('../MVC/utils/envFileUtils');

test('parseEnvLine keeps special characters inside double quotes', () => {
  const parsed = parseEnvLine('FILE_GATEWAY_SHARED_KEY="amin@@key#with=equals"');
  assert.equal(parsed.key, 'FILE_GATEWAY_SHARED_KEY');
  assert.equal(parsed.value, 'amin@@key#with=equals');
});

test('parseEnvLine supports export prefix and single-quoted values', () => {
  const parsed = parseEnvLine("export FILE_GATEWAY_SHARED_KEY='a@b#c$d%e'");
  assert.equal(parsed.value, 'a@b#c$d%e');
});

test('parseEnvLine preserves unquoted equals and hash in value', () => {
  const parsed = parseEnvLine('FILE_GATEWAY_SHARED_KEY=part1=part2#still');
  assert.equal(parsed.value, 'part1=part2#still');
});

test('parseEnvValue strips trailing inline comments for unquoted values', () => {
  assert.equal(parseEnvValue('visible  # not part of value'), 'visible');
});

test('parseEnvValue supports escaped quotes in double-quoted values', () => {
  assert.equal(parseEnvValue('"say \\"hi\\""'), 'say "hi"');
});
