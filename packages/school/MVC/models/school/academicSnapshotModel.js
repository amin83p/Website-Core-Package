const { requireCoreModule, resolveCoreRoot } = require('../../services/school/schoolCoreModuleResolver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { queueWrite } = requireCoreModule('MVC/models/fileQueue');

const dataPath = path.join(resolveCoreRoot(), 'data/school/academicSnapshots.json');

if (!fsSync.existsSync(dataPath)) {
  fsSync.writeFileSync(dataPath, '[]');
}

async function getAllSnapshots() {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Failed to retrieve academic snapshots.');
  }
}

async function getSnapshotByStudentProgram(studentId, programId) {
  const all = await getAllSnapshots();
  return all.find((row) =>
    String(row.studentId || '') === String(studentId || '') &&
    String(row.programId || '') === String(programId || '')
  ) || null;
}

async function upsertSnapshot(snapshot) {
  return queueWrite(async () => {
    const all = await getAllSnapshots();
    const studentId = String(snapshot?.studentId || '').trim();
    const programId = String(snapshot?.programId || '').trim();
    if (!studentId) throw new Error('studentId is required for academic snapshot.');
    if (!programId) throw new Error('programId is required for academic snapshot.');

    const next = {
      id: String(snapshot.id || `ASNP-${studentId}-${programId}`),
      ...snapshot
    };

    const index = all.findIndex((row) =>
      String(row.studentId || '') === studentId &&
      String(row.programId || '') === programId
    );

    if (index === -1) all.push(next);
    else all[index] = next;

    await fs.writeFile(dataPath, JSON.stringify(all, null, 2));
    return next;
  });
}

async function clearSnapshotsByOrg(orgId) {
  return queueWrite(async () => {
    const targetOrgId = String(orgId || '').trim();
    if (!targetOrgId) throw new Error('orgId is required to clear academic snapshots.');

    const all = await getAllSnapshots();
    const before = all.length;
    const filtered = all.filter((row) => String(row?.orgId || '') !== targetOrgId);
    const removed = before - filtered.length;
    if (!removed) return { removed: 0, remaining: before };

    await fs.writeFile(dataPath, JSON.stringify(filtered, null, 2));
    return { removed, remaining: filtered.length };
  });
}

module.exports = {
  getAllSnapshots,
  getSnapshotByStudentProgram,
  upsertSnapshot,
  clearSnapshotsByOrg
};


