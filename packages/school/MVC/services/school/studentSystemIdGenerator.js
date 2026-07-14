function generateStudentSystemIdCandidate(existingIds = new Set()) {
  const normalizedIds = existingIds instanceof Set
    ? existingIds
    : new Set(Array.from(existingIds || [], (id) => String(id)));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `STU${Math.floor(10000 + Math.random() * 90000)}`;
    if (!normalizedIds.has(id)) return id;
  }

  for (let number = 10000; number <= 99999; number += 1) {
    const id = `STU${number}`;
    if (!normalizedIds.has(id)) return id;
  }

  throw new Error('No available Student System Record IDs remain in the STU##### range.');
}

module.exports = {
  generateStudentSystemIdCandidate
};
