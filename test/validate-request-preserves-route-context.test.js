const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const validateRequest = require('../MVC/middleware/validateRequest');
const { editUserSchema } = require('../MVC/validators/userValidators');

test('body-only user validation preserves route params and query values', () => {
  const req = {
    body: {
      email: 'user@example.com',
      username: 'example-user',
      passwordHash: '',
      status: 'active',
      registrationSource: 'admin_create',
      accessLevel: '2',
      active: 'true',
      isEmailVerified: 'true',
      organizations: '[]',
      actionStateId: 'ACTION_1'
    },
    params: { id: '247551' },
    query: { returnTo: '/users' },
    headers: { 'x-ajax-request': 'true' }
  };
  let nextCalls = 0;

  validateRequest(editUserSchema)(req, {}, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.deepEqual(req.params, { id: '247551' });
  assert.deepEqual(req.query, { returnTo: '/users' });
  assert.equal(req.body.accessLevel, 2);
  assert.equal(Object.hasOwn(req.body, 'actionStateId'), false);
});

test('validated route params still replace the original params', () => {
  const schema = z.object({
    params: z.object({
      id: z.coerce.number().int().positive()
    })
  });
  const req = {
    body: { untouched: true },
    params: { id: '42', discarded: 'value' },
    query: { untouched: 'yes' },
    headers: {}
  };
  let nextCalls = 0;

  validateRequest(schema)(req, {}, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.deepEqual(req.params, { id: 42 });
  assert.deepEqual(req.body, { untouched: true });
  assert.deepEqual(req.query, { untouched: 'yes' });
});
