const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const userFormPath = path.join(__dirname, '../MVC/views/user/userForm.ejs');

function readUserForm() {
  return fs.readFileSync(userFormPath, 'utf8');
}

test('org-level access profile picker requests profiles for the target organization', () => {
  const source = readUserForm();

  assert.match(
    source,
    /apiEndpoint:\s*`\/accesses\?orgId=\$\{encodeURIComponent\(targetOrgId\)\}`/,
    'org-level picker should pass the target organization to /accesses'
  );
  assert.match(
    source,
    /searchFields:\s*'id,name,description,orgId,adminCategories'/,
    'picker should use explicit access-profile search fields'
  );
  assert.match(
    source,
    /limit:\s*50/,
    'picker should use a stable page size'
  );
  assert.match(
    source,
    /String\(item\.orgId\)\s*!==\s*String\(targetOrg\.orgId\)/,
    'client-side org mismatch validation should remain in place'
  );
});

test('system access profile picker remains global-only', () => {
  const source = readUserForm();

  assert.match(
    source,
    /title:\s*'Select System Access Profile'[\s\S]*?GenericPickerContexts\.globalSystemProfiles\(\)/,
    'system picker should keep the global-system profile context'
  );
  assert.match(
    source,
    /if\s*\(item\.orgId\)\s*\{/,
    'system picker should still reject organization-bound profiles'
  );
});
