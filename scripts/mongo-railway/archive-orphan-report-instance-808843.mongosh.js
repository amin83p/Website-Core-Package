const INSTANCE_ID = '808843';
const ORPHAN_ASSIGNMENT_ID = '485463';

const instance = db.schoolReportInstances.findOne({ id: INSTANCE_ID });
if (!instance) {
  print(`[report-instance-repair] Instance ${INSTANCE_ID} was not found. Nothing to do.`);
} else if (String(instance.assignmentId || '') !== ORPHAN_ASSIGNMENT_ID) {
  print(`[report-instance-repair] Instance ${INSTANCE_ID} no longer points to assignment ${ORPHAN_ASSIGNMENT_ID}. Skipping.`);
} else {
  const assignment = db.schoolReportAssignments.findOne({ id: ORPHAN_ASSIGNMENT_ID });
  if (assignment) {
    print(`[report-instance-repair] Assignment ${ORPHAN_ASSIGNMENT_ID} exists. Instance ${INSTANCE_ID} was not archived.`);
  } else if (String(instance.status || '').toLowerCase() === 'archived') {
    print(`[report-instance-repair] Instance ${INSTANCE_ID} is already archived.`);
  } else {
    const now = new Date().toISOString();
    const result = db.schoolReportInstances.updateOne(
      { id: INSTANCE_ID, assignmentId: ORPHAN_ASSIGNMENT_ID },
      {
        $set: {
          status: 'archived',
          'audit.archivedAt': now,
          'audit.archivedReason': `Archived orphan report instance because assignment ${ORPHAN_ASSIGNMENT_ID} no longer exists.`,
          'audit.lastUpdateDateTime': now,
          'audit.lastUpdateUser': 'system:report-instance-repair'
        }
      }
    );
    print(`[report-instance-repair] Archived instance ${INSTANCE_ID}. matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }
}
