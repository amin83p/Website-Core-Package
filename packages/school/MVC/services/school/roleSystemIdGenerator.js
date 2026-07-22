const ROLE_PREFIXES = Object.freeze({
  teacher: 'TCH',
  staff: 'STF'
});

function generateRoleSystemIdCandidate(roleType, existingIds = new Set()) {
  const prefix = ROLE_PREFIXES[String(roleType || '').trim().toLowerCase()];
  if (!prefix) throw new Error('Unsupported School role ID type.');

  const normalizedIds = existingIds instanceof Set
    ? existingIds
    : new Set(Array.from(existingIds || [], (id) => String(id)));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = prefix + Math.floor(10000 + Math.random() * 90000);
    if (!normalizedIds.has(id)) return id;
  }

  for (let number = 10000; number <= 99999; number += 1) {
    const id = prefix + number;
    if (!normalizedIds.has(id)) return id;
  }

  throw new Error(`No available ${prefix}##### System Record IDs remain.`);
}

module.exports = {
  ROLE_PREFIXES,
  generateRoleSystemIdCandidate
};
