/**
 * IELTS gate runner with package/runtime compatibility.
 *
 * Core Package mode:
 * - runs the full IELTS gate when package-owned IELTS assets are available.
 *
 * Core-Only mode:
 * - skips gate cleanly when IELTS package assets are not present,
 *   keeping CI green for package-lean repos.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const TEST_GATE_FILES = [
  'test/ielts.behavior-freeze.step6t.test.js',
  'test/ielts.rule-patch-hardening.step6s.test.js',
  'test/ielts.stability-accuracy.step6r.test.js',
  'test/ielts.tr-cc-runprofile.step6q.test.js',
  'test/ielts.low-band-activation.step6.test.js',
  'test/ielts.low-band-followup.step6b.test.js',
  'test/ielts.low-band-polarity-regression.step6d.test.js'
];

const IELS_REQUIRE_TARGETS = [
  'services/ielts/scoringRules.js',
  'services/ielts/step3ScoringService.js',
  'services/ielts/step5FeedbackService.js',
  'services/ielts/aiService.js',
  'views/ielts/scoringV0326.ejs',
  'controllers/ielts/ieltsController.js'
];

const PACKAGE_BASE = path.join(ROOT_DIR, 'packages', 'ielts', 'MVC');
const LEGACY_BASE = path.join(ROOT_DIR, 'MVC');

function hasIeltsArtifact(relativePath) {
  const candidates = [PACKAGE_BASE, LEGACY_BASE]
    .map((baseDir) => path.join(baseDir, relativePath))
    .filter((candidate) => fs.existsSync(candidate));
  return candidates.length > 0;
}

function resolveModeLabel() {
  const hasPackageScoringRules = fs.existsSync(path.join(PACKAGE_BASE, 'services/ielts/scoringRules.js'));
  const hasLegacyScoringRules = fs.existsSync(path.join(LEGACY_BASE, 'services/ielts/scoringRules.js'));
  if (hasPackageScoringRules) return 'core-package';
  if (hasLegacyScoringRules) return 'core-only';
  return 'missing';
}

function runGateTests() {
  const requireLoader = path.join(ROOT_DIR, 'scripts', 'ielts', 'runIeltsGateLoader.js');
  console.log('Core Package: runs full IELTS gate if package path exists.');
  console.log('Core-Only: skips gate cleanly when IELTS artifacts are absent.');

  const missing = IELS_REQUIRE_TARGETS.filter((target) => !hasIeltsArtifact(target));
  if (missing.length > 0) {
    const detail = missing.join(', ');
    console.log(`[skip] IELTS gate skipped: required IELTS artifacts unavailable in this repo: ${detail}`);
    if (process.env.IELTS_GATE_STRICT === '1') {
      process.exit(1);
    }
    return;
  }

  for (const testFile of TEST_GATE_FILES) {
    const testPath = path.join(ROOT_DIR, testFile);
    if (!fs.existsSync(testPath)) {
      throw new Error(`Missing test file: ${testFile}`);
    }

    const result = spawnSync(process.execPath, ['--require', requireLoader, testPath], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        IELTS_GATE_ROOT: ROOT_DIR
      }
    });

    if (result.error) {
      throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      process.exit(result.status);
    }
  }
}

if (require.main === module) {
  const mode = resolveModeLabel();
  if (mode === 'core-package') {
    console.log('[info] IELTS environment detected as package-owned runtime.');
  } else if (mode === 'core-only') {
    console.log('[info] IELTS environment detected as legacy shim fallback mode.');
  } else {
    console.log('[info] IELTS environment assets not found yet.');
  }

  runGateTests();
}

