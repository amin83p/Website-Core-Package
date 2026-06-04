#!/usr/bin/env node
/**
 * IELTS tuning preflight runner:
 * 1) Freeze baseline drift check
 * 2) Full IELTS regression gate
 * 3) Patch impact comparison against accepted vs current export
 *
 * Usage:
 *   node scripts/ielts/tuningPreflight.js --before <accepted.json> --after <current.json>
 *   node scripts/ielts/tuningPreflight.js --before a.json --after b.json --out reports/ielts/preflight-impact.json --top 25
 *   node scripts/ielts/tuningPreflight.js --before a.json --after b.json --skip-gate
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildReport } = require('./scoringPatchImpactReport');

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function parseArgs(argv) {
  const args = {
    before: '',
    after: '',
    out: '',
    profile: path.join('scripts', 'ielts', 'phaseProfiles', 'current.json'),
    top: 20,
    skipFreeze: false,
    skipGate: false,
    skipAcceptance: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    const next = argv[i + 1];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--before' && next) {
      args.before = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--after' && next) {
      args.after = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--out' && next) {
      args.out = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--profile' && next) {
      args.profile = String(next).trim();
      i += 1;
      continue;
    }
    if (token === '--top' && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) args.top = n;
      i += 1;
      continue;
    }
    if (token === '--skip-freeze') {
      args.skipFreeze = true;
      continue;
    }
    if (token === '--skip-gate') {
      args.skipGate = true;
      continue;
    }
    if (token === '--skip-acceptance') {
      args.skipAcceptance = true;
    }
  }

  return args;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log([
    'IELTS tuning preflight',
    '',
    'Usage:',
    '  node scripts/ielts/tuningPreflight.js --before <accepted.json> --after <current.json>',
    '  node scripts/ielts/tuningPreflight.js --before a.json --after b.json --profile scripts/ielts/phaseProfiles/current.json --out reports/ielts/preflight-impact.json --top 25',
    '',
    'Options:',
    '  --before <path>      Accepted/reference export JSON (required)',
    '  --after <path>       Current export JSON (required)',
    '  --profile <path>     Phase profile JSON (default: scripts/ielts/phaseProfiles/current.json)',
    '  --out <path>         Output impact report JSON (optional)',
    '  --top <n>            Top key count in impact report summary (default 20)',
    '  --skip-freeze        Skip baseline freeze check',
    '  --skip-gate          Skip full IELTS gate',
    '  --skip-acceptance    Skip phase acceptance-gate evaluation',
    '  --help, -h           Show this help'
  ].join('\n'));
}

function fail(message, code = 1) {
  // eslint-disable-next-line no-console
  console.error(`[preflight] ${message}`);
  process.exit(code);
}

function resolveExistingFile(inputPath, flagName) {
  if (!String(inputPath || '').trim()) {
    fail(`${flagName} is required`);
  }
  const absPath = path.resolve(String(inputPath));
  if (!fs.existsSync(absPath)) {
    fail(`${flagName} file not found: ${absPath}`);
  }
  return absPath;
}

function readJsonFile(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    fail(`JSON file not found: ${absPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON (${absPath}): ${error.message}`);
  }
  return null;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeLooseToken(value) {
  return normalizeToken(value).replace(/[^a-z0-9]/g, '');
}

function parseIsoTime(value) {
  const ms = Date.parse(String(value || '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

function resolvePhaseProfile(profilePath) {
  const absPath = resolveExistingFile(profilePath, '--profile');
  const payload = readJsonFile(absPath);
  if (!payload || typeof payload !== 'object') {
    fail(`Invalid phase profile at ${absPath}`);
  }
  if (!Array.isArray(payload?.samplePack?.targets) || !Array.isArray(payload?.samplePack?.guards)) {
    fail(`Phase profile missing samplePack.targets/guards arrays: ${absPath}`);
  }
  return { absPath, payload };
}

function step4ProfileFieldValue(profileObj, field) {
  if (!profileObj || typeof profileObj !== 'object') return null;
  const value = profileObj[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== '') return n;
  return String(value);
}

function sampleMatchesSpec(report, spec) {
  const specId = normalizeToken(spec?.sampleId || '');
  const specName = normalizeToken(spec?.sampleName || '');
  const reportId = normalizeToken(report?.sampleId || '');
  const reportName = normalizeToken(report?.sampleName || '');

  let idMatch = true;
  if (specId) {
    idMatch = Boolean(reportId) && reportId === specId;
  }

  let nameMatch = true;
  if (specName) {
    if (!reportName) {
      nameMatch = false;
    } else if (reportName === specName) {
      nameMatch = true;
    } else {
      const specLoose = normalizeLooseToken(specName);
      const reportLoose = normalizeLooseToken(reportName);
      nameMatch = reportLoose.includes(specLoose) || specLoose.includes(reportLoose);
    }
  }

  if (specId && specName) return idMatch && nameMatch;
  if (specId) return idMatch;
  if (specName) return nameMatch;
  return false;
}

function pickPrimaryMatch(matches) {
  if (!Array.isArray(matches) || !matches.length) return null;
  return matches
    .slice()
    .sort((a, b) => {
      const ta = parseIsoTime(a?.afterSavedAt);
      const tb = parseIsoTime(b?.afterSavedAt);
      return tb - ta;
    })[0];
}

function buildSpecLabel(spec, role, index) {
  const idPart = String(spec?.sampleId || '').trim();
  const namePart = String(spec?.sampleName || '').trim();
  return `${role.toUpperCase()}#${index + 1}:${idPart || namePart || 'unknown'}`;
}

function collectPackSpecs(profile) {
  const targets = (profile?.samplePack?.targets || []).map((spec, index) => ({
    ...spec,
    role: 'target',
    label: buildSpecLabel(spec, 'target', index)
  }));
  const guards = (profile?.samplePack?.guards || []).map((spec, index) => ({
    ...spec,
    role: 'guard',
    label: buildSpecLabel(spec, 'guard', index)
  }));
  return targets.concat(guards);
}

function evaluateSamplePack(report, profile) {
  const specs = collectPackSpecs(profile);
  const pairReports = Array.isArray(report?.pairReports) ? report.pairReports : [];
  const results = specs.map((spec) => {
    const matches = pairReports.filter((row) => sampleMatchesSpec(row, spec));
    return {
      spec,
      matches,
      primary: pickPrimaryMatch(matches)
    };
  });

  const missing = results.filter((row) => !row.primary);
  const enforceExactSet = profile?.samplePack?.enforceExactSet === true;
  const extra = enforceExactSet
    ? pairReports.filter((row) => !results.some((specRow) => sampleMatchesSpec(row, specRow.spec)))
    : [];

  return {
    specs: results,
    missing,
    extra,
    pairReports
  };
}

function evaluateRuntimeFreeze(profile, packEval) {
  const runtime = profile?.runtimeProfile || {};
  const expectedStep3 = normalizeToken(runtime?.step3Model || runtime?.step3ModelUsed || '');
  const expectedStep4 = normalizeToken(runtime?.step4Model || runtime?.step4ModelUsed || '');
  const enforceBefore = runtime?.enforceBeforeModelMatch !== false;
  const expectedStep4Req = runtime?.step4RequestProfile || {};
  const mismatches = [];

  for (const specRow of packEval.specs) {
    for (const match of specRow.matches) {
      if (expectedStep3) {
        const actualAfter = normalizeToken(match?.step3ModelAfter || '');
        if (actualAfter !== expectedStep3) {
          mismatches.push(`${specRow.spec.label} step3ModelAfter expected='${expectedStep3}' actual='${actualAfter || 'missing'}'`);
        }
        if (enforceBefore) {
          const actualBefore = normalizeToken(match?.step3ModelBefore || '');
          if (actualBefore && actualBefore !== expectedStep3) {
            mismatches.push(`${specRow.spec.label} step3ModelBefore expected='${expectedStep3}' actual='${actualBefore}'`);
          }
        }
      }

      if (expectedStep4) {
        const actualAfter = normalizeToken(match?.step4ModelAfter || '');
        if (actualAfter !== expectedStep4) {
          mismatches.push(`${specRow.spec.label} step4ModelAfter expected='${expectedStep4}' actual='${actualAfter || 'missing'}'`);
        }
        if (enforceBefore) {
          const actualBefore = normalizeToken(match?.step4ModelBefore || '');
          if (actualBefore && actualBefore !== expectedStep4) {
            mismatches.push(`${specRow.spec.label} step4ModelBefore expected='${expectedStep4}' actual='${actualBefore}'`);
          }
        }
      }

      const actualReq = match?.step4RequestProfileAfter || {};
      const profileFields = [
        'batchSize',
        'concurrency',
        'retryLimit',
        'retryBackoffMs',
        'retryBackoffMultiplier',
        'retryBackoffMaxMs',
        'timeoutMs',
        'providerId',
        'apiProviderId',
        'modelId'
      ];
      for (const field of profileFields) {
        const expectedValue = step4ProfileFieldValue(expectedStep4Req, field);
        if (expectedValue === null || expectedValue === undefined || expectedValue === '') continue;
        const actualValue = step4ProfileFieldValue(actualReq, field);
        if (actualValue === null || actualValue === undefined || actualValue === '') {
          mismatches.push(`${specRow.spec.label} step4Request.${field} expected='${expectedValue}' actual='missing'`);
          continue;
        }
        if (typeof expectedValue === 'number' || typeof actualValue === 'number') {
          const e = Number(expectedValue);
          const a = Number(actualValue);
          if (!Number.isFinite(e) || !Number.isFinite(a) || e !== a) {
            mismatches.push(`${specRow.spec.label} step4Request.${field} expected='${expectedValue}' actual='${actualValue}'`);
          }
        } else {
          const e = normalizeToken(expectedValue);
          const a = normalizeToken(actualValue);
          if (e !== a) {
            mismatches.push(`${specRow.spec.label} step4Request.${field} expected='${expectedValue}' actual='${actualValue}'`);
          }
        }
      }
    }
  }

  return mismatches;
}

function evaluateAcceptance(profile, packEval, gateExecuted) {
  const acceptance = profile?.acceptance || {};
  const targetDefault = Number.isFinite(Number(acceptance?.targetMinDelta))
    ? Number(acceptance.targetMinDelta)
    : 0.5;
  const guardMaxNegative = Number.isFinite(Number(acceptance?.guardMaxNegativeDelta))
    ? Number(acceptance.guardMaxNegativeDelta)
    : 0;
  const requireLowBandGateGreen = acceptance?.requireLowBandGateGreen !== false;

  if (requireLowBandGateGreen && !gateExecuted) {
    return {
      passed: false,
      reasons: ['Low-band gate is required but --skip-gate was used.'],
      summary: null
    };
  }

  const targetRows = [];
  const guardRows = [];
  for (const row of packEval.specs) {
    const primary = row.primary;
    const delta = Number(primary?.overallBand?.delta);
    if (row.spec.role === 'target') {
      const threshold = Number.isFinite(Number(row.spec?.minDelta)) ? Number(row.spec.minDelta) : targetDefault;
      const pass = Number.isFinite(delta) && delta >= threshold;
      targetRows.push({ label: row.spec.label, delta: Number.isFinite(delta) ? delta : null, threshold, pass });
    } else {
      const threshold = Number.isFinite(Number(row.spec?.maxNegativeDelta))
        ? Number(row.spec.maxNegativeDelta)
        : guardMaxNegative;
      const pass = Number.isFinite(delta) && delta >= (-1 * threshold);
      guardRows.push({ label: row.spec.label, delta: Number.isFinite(delta) ? delta : null, maxNegativeDelta: threshold, pass });
    }
  }

  const targetPassCount = targetRows.filter((row) => row.pass).length;
  const guardPassCount = guardRows.filter((row) => row.pass).length;
  const requiredTargetPassCount = Number.isFinite(Number(acceptance?.requiredTargetPassCount))
    ? Number(acceptance.requiredTargetPassCount)
    : targetRows.length;
  const requiredGuardPassCount = Number.isFinite(Number(acceptance?.requiredGuardPassCount))
    ? Number(acceptance.requiredGuardPassCount)
    : guardRows.length;

  const reasons = [];
  if (targetPassCount < requiredTargetPassCount) {
    reasons.push(`Target pass count ${targetPassCount}/${targetRows.length} is below required ${requiredTargetPassCount}.`);
  }
  if (guardPassCount < requiredGuardPassCount) {
    reasons.push(`Guard pass count ${guardPassCount}/${guardRows.length} is below required ${requiredGuardPassCount}.`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    summary: {
      targetRows,
      guardRows,
      targetPassCount,
      guardPassCount,
      requiredTargetPassCount,
      requiredGuardPassCount,
      requireLowBandGateGreen
    }
  };
}

function runStep(label, command, commandArgs) {
  // eslint-disable-next-line no-console
  console.log(`[preflight] ${label}...`);
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    fail(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${label} failed with exit code ${result.status}`, result.status || 1);
  }
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function summarizeImpact(reportPath) {
  try {
    const payload = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const topPass = Array.isArray(payload?.summary?.topPassImpactKeys) ? payload.summary.topPassImpactKeys.slice(0, 5) : [];
    const topValue = Array.isArray(payload?.summary?.topValueChangedKeys) ? payload.summary.topValueChangedKeys.slice(0, 5) : [];
    // eslint-disable-next-line no-console
    console.log(`[preflight] impact report: ${reportPath}`);
    // eslint-disable-next-line no-console
    console.log(`[preflight] top pass-impact keys: ${topPass.map((row) => `${row.key}(${row.count})`).join(', ') || '(none)'}`);
    // eslint-disable-next-line no-console
    console.log(`[preflight] top value-changed keys: ${topValue.map((row) => `${row.key}(${row.count})`).join(', ') || '(none)'}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[preflight] impact summary skipped: ${error.message}`);
  }
}

function printProfileSummary(profile) {
  const runtime = profile?.runtimeProfile || {};
  // eslint-disable-next-line no-console
  console.log(`[preflight] phase=${profile?.phaseId || 'unknown'} step3=${runtime?.step3Model || 'n/a'} step4=${runtime?.step4Model || 'n/a'}`);
  const step4Req = runtime?.step4RequestProfile || {};
  const compactReq = Object.entries(step4Req)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  // eslint-disable-next-line no-console
  console.log(`[preflight] runtime step4-request-profile: ${compactReq || '(not set)'}`);
}

function printPackSummary(packEval) {
  // eslint-disable-next-line no-console
  console.log(`[preflight] pack specs=${packEval.specs.length} missing=${packEval.missing.length} extra=${packEval.extra.length}`);
  for (const row of packEval.specs) {
    // eslint-disable-next-line no-console
    console.log(`[preflight] ${row.spec.label} matches=${row.matches.length} primaryDelta=${Number(row?.primary?.overallBand?.delta) || 0}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const beforePath = resolveExistingFile(args.before, '--before');
  const afterPath = resolveExistingFile(args.after, '--after');
  const phaseProfile = resolvePhaseProfile(args.profile);
  const outPath = path.resolve(args.out || path.join('reports', 'ielts', `preflight-impact-${nowStamp()}.json`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  printProfileSummary(phaseProfile.payload);

  if (!args.skipFreeze) {
    runStep('Freeze baseline check', process.execPath, [path.join('scripts', 'ielts', 'scoringBaselineGuardCheck.js')]);
  }

  const gateExecuted = !args.skipGate;
  if (!args.skipGate) {
    runStep('IELTS gate', getNpmCommand(), ['run', 'test:ielts:gate']);
  }

  const beforePayload = readJsonFile(beforePath);
  const afterPayload = readJsonFile(afterPath);
  const report = buildReport(beforePayload, afterPayload, { top: args.top });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[preflight] impact report written: ${outPath}`);

  const packEval = evaluateSamplePack(report, phaseProfile.payload);
  printPackSummary(packEval);
  if (packEval.missing.length) {
    const details = packEval.missing.map((row) => row.spec.label).join(', ');
    fail(`Sample pack missing required specs: ${details}`);
  }
  if (packEval.extra.length) {
    const details = packEval.extra.map((row) => `${row.sampleName || row.sampleId || 'unknown'}`).join(', ');
    fail(`Sample pack has extra items while enforceExactSet=true: ${details}`);
  }

  const runtimeMismatches = evaluateRuntimeFreeze(phaseProfile.payload, packEval);
  if (runtimeMismatches.length) {
    fail(`Runtime profile freeze mismatch:\n- ${runtimeMismatches.join('\n- ')}`);
  }

  if (!args.skipAcceptance) {
    const acceptance = evaluateAcceptance(phaseProfile.payload, packEval, gateExecuted);
    if (!acceptance.passed) {
      fail(`Acceptance gate failed:\n- ${acceptance.reasons.join('\n- ')}`);
    }
    if (acceptance.summary) {
      // eslint-disable-next-line no-console
      console.log(`[preflight] acceptance targets ${acceptance.summary.targetPassCount}/${acceptance.summary.targetRows.length} guards ${acceptance.summary.guardPassCount}/${acceptance.summary.guardRows.length}`);
    }
  }

  summarizeImpact(outPath);
  // eslint-disable-next-line no-console
  console.log('[preflight] PASS: freeze + gate + impact + profile + acceptance checks completed.');
}

if (require.main === module) {
  main();
}
