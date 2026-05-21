const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ROLLING_PAGE = path.join(ROOT, 'MVC', 'views', 'school', 'class', 'rollingEnrollment.ejs');
const ROLLOVER_PAGE = path.join(ROOT, 'MVC', 'views', 'school', 'class', 'cycleRolloverWizard.ejs');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hasAll(content, needles) {
  return needles.every((needle) => content.includes(needle));
}

function printResult(label, pass, details) {
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`${status} | ${label} | ${details}`);
}

function run() {
  const rolling = readFile(ROLLING_PAGE);
  const rollover = readFile(ROLLOVER_PAGE);

  const checks = [];

  checks.push({
    label: 'Pending UI #1 - Keyboard flow hooks',
    pass:
      hasAll(rolling, [
        "event.altKey && key === 's'",
        "event.altKey && key === 'a'",
        "event.key !== 'Enter'",
        "event.key === 'Enter' && event.ctrlKey"
      ]) &&
      hasAll(rollover, [
        "event.altKey && key === 'p'",
        "event.altKey && key === 'e'",
        "event.key !== 'Enter'",
        "event.key === 'Enter' && event.ctrlKey"
      ]),
    details: 'Rolling + Rollover pages include Enter/Ctrl+Enter and Alt shortcut handlers.'
  });

  checks.push({
    label: 'Pending UI #2 - Modal focus hooks',
    pass: hasAll(rolling, [
      "closeModalEl?.addEventListener('shown.bs.modal'",
      "reentryModalEl?.addEventListener('shown.bs.modal'",
      "qs('close_endDate')?.focus()",
      "qs('reentry_startDate')?.focus()",
      "event.key === 'Escape'"
    ]),
    details: 'Rolling page includes modal focus-on-open and Escape close hooks.'
  });

  let failed = 0;
  checks.forEach((check) => {
    if (!check.pass) failed += 1;
    printResult(check.label, check.pass, check.details);
  });

  if (failed > 0) {
    console.log(`\nPhase 6 UI checklist result: FAIL (${failed} check(s) failed).`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPhase 6 UI checklist result: PASS (all checks passed).');
}

run();
