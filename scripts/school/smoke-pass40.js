#!/usr/bin/env node
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs.map((item) => item.toLowerCase()));
const argPort = rawArgs.find((item) => item.startsWith('--port='));
const explicitPort = argPort ? Number(argPort.split('=')[1]) : null;
const argCookie = rawArgs.find((item) => item.startsWith('--cookie='));
const argCookieFile = rawArgs.find((item) => item.startsWith('--cookie-file='));
const explicitCookie = argCookie ? argCookie.slice(argCookie.indexOf('=') + 1) : '';
const explicitCookieFile = argCookieFile ? argCookieFile.split('=')[1] : '';
const isWindows = process.platform === 'win32';
const skipAuthChecksArg = args.has('--skip-auth-checks');

function sanitizeCookieSource(value) {
  return (value || '').toString().trim();
}

function collectCookieSeeds(rawValues) {
  const seeds = [];
  for (const raw of rawValues) {
    const cleaned = sanitizeCookieSource(raw);
    if (!cleaned) continue;
    cleaned.split('\n').forEach((line) => {
      const segment = line.trim();
      if (!segment) return;
      for (const chunk of segment.split(';')) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;
        if (!seeds.includes(trimmed)) {
          seeds.push(trimmed);
        }
      }
    });
  }
  return seeds;
}

const fileCookieSeed = (() => {
  if (!explicitCookieFile) return '';
  try {
    return fs.readFileSync(explicitCookieFile, 'utf8');
  } catch (error) {
    console.warn(`[school-pass40] cookie-file read failed: ${error.message || String(error)}`);
    return '';
  }
})();

const configCookieSeeds = collectCookieSeeds([
  explicitCookie || '',
  process.env.SCHOOL_SMOKE_COOKIE || '',
  fileCookieSeed
]);

const config = {
  host: process.env.SCHOOL_SMOKE_HOST || '127.0.0.1',
  port: Number(
    Number.isFinite(explicitPort)
      ? explicitPort
      : process.env.SCHOOL_SMOKE_PORT || process.env.PORT || 3100,
  ),
  startupWaitMs: Number(process.env.SCHOOL_SMOKE_STARTUP_WAIT_MS || 90000),
  requestTimeoutMs: Number(process.env.SCHOOL_SMOKE_REQUEST_TIMEOUT_MS || 7000),
  startupPollMs: Number(process.env.SCHOOL_SMOKE_STARTUP_POLL_MS || 1000),
  heartbeatMs: Number(process.env.SCHOOL_SMOKE_HEARTBEAT_MS || 2000),
  username: process.env.SCHOOL_SMOKE_USERNAME || '',
  password: process.env.SCHOOL_SMOKE_PASSWORD || '',
  authCookieSeeds: configCookieSeeds,
  authCheckMode: args.has('--cookie-only') ? 'cookie-only' : 'auto'
};
const shouldStartServer = !args.has('--no-server-start');
const shouldSkipAuthChecks = skipAuthChecksArg
  || (config.authCheckMode === 'cookie-only' && config.authCookieSeeds.length === 0 && (!config.username || !config.password))
  || (!config.username && !config.password && config.authCookieSeeds.length === 0);
const authFailurePenalty = 1;
const baseUrl = `http://${config.host}:${config.port}`;
const routeChecks = [
  '/school',
  '/school/students',
  '/school/teachers',
  '/school/staff',
  '/dashboard/section-nav/SCHOOL',
];

function now() {
  return new Date().toISOString();
}

function log(message) {
  process.stdout.write(`[school-pass40][${now()}] ${message}\n`);
}

function normalizeCookieHeader(value) {
  if (!value) return '';
  return value
    .toString()
    .split(';')[0]
    .trim();
}

function parseAuthCookieHealth(response) {
  const location = response.headers['location'] || response.headers['Location'] || '';
  const isLoginRedirect = response.statusCode === 302 && String(location).includes('/login');
  const looksLikeLoggedIn = response.statusCode >= 200 && response.statusCode < 400 && !isLoginRedirect;
  return { location, isLoginRedirect, looksLikeLoggedIn };
}

function mergeCookies(cookieHeaderLines, jar) {
  const lines = Array.isArray(cookieHeaderLines)
    ? cookieHeaderLines
    : [cookieHeaderLines].filter(Boolean);
  for (const rawLine of lines) {
    const normalized = normalizeCookieHeader(rawLine);
    if (!normalized) continue;
    const [nameValue] = normalized.split(';', 1);
    const key = (nameValue || '').split('=')[0]?.trim();
    if (!key) continue;
    const existingIndex = jar.findIndex((entry) => entry.name === key);
    if (existingIndex >= 0) {
      jar[existingIndex].value = nameValue;
      continue;
    }
    jar.push({ name: key, value: nameValue });
  }
}

function buildCookieHeader(jar) {
  return jar.map((entry) => entry.value).join('; ');
}

function sendRequest(path, { method = 'GET', headers = {}, body = '', jar = [], timeoutMs = config.requestTimeoutMs } = {}) {
  const requestUrl = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  const parsedUrl = new URL(requestUrl);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;
  const requestHeaders = { ...headers };
  if (jar.length > 0) {
    requestHeaders.Cookie = buildCookieHeader(jar);
  }
  if (body) {
    requestHeaders['Content-Length'] = Buffer.byteLength(body);
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/x-www-form-urlencoded';
  }

  return new Promise((resolve, reject) => {
    const req = protocol.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers: requestHeaders,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          bodyText,
          statusMessage: res.statusMessage || '',
          url: requestUrl,
        });
      });
    });

    const timer = setTimeout(() => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on('close', () => clearTimeout(timer));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function waitForServerReady() {
  const start = Date.now();
  let heartbeat = 0;
  let interval = null;
  let started = false;
  interval = setInterval(() => {
    heartbeat += 1;
    const elapsed = Date.now() - start;
    log(`waiting for /login readiness... ${heartbeat} polls (${elapsed}ms)`);
  }, config.heartbeatMs);

  try {
    while (Date.now() - start < config.startupWaitMs) {
      try {
        const res = await sendRequest('/login');
        if (res.statusCode === 200 || res.statusCode === 302) {
          log(`app ready signal received from /login with status ${res.statusCode}.`);
          started = true;
          return;
        }
      } catch (error) {
        // keep waiting, no stack spam
      }
      await new Promise((resolve) => setTimeout(resolve, config.startupPollMs));
    }
  } finally {
    if (interval) clearInterval(interval);
  }

  if (!started) {
    throw new Error(`startup did not become ready within ${config.startupWaitMs}ms`);
  }
}

async function runRouteChecks(routes, jar = [], expectedUnauthRedirect = true) {
  const results = [];
  for (const route of routes) {
    const start = Date.now();
    const response = await sendRequest(route, { jar });
    const elapsed = Date.now() - start;
    const location = response.headers['location'] || response.headers['Location'] || '';
    const status = response.statusCode;
    if (expectedUnauthRedirect) {
      const isRedirectToLogin = status === 302 && String(location).includes('/login');
      results.push({
        route,
        status,
        location,
        success: isRedirectToLogin || status === 200,
        elapsedMs: elapsed,
        expected: '302 /login or 200',
      });
      log(`unauth check ${route} => status=${status} location=${location || '-'} elapsed=${elapsed}ms`);
      continue;
    }
    const isRedirectToLogin = status === 302 && String(location).includes('/login');
    const isAllowed = status >= 200 && status < 400 && !isRedirectToLogin;
    results.push({
      route,
      status,
      location,
      success: isAllowed || status === 200,
      elapsedMs: elapsed,
      expected: 'authorized 2xx/3xx (excluding login redirect)',
    });
    log(`auth check ${route} => status=${status} location=${location || '-'} elapsed=${elapsed}ms`);
  }
  return results;
}

function parseLoaderSummary(lines) {
  const output = lines.join('\n');
  const routeSummaryMatch = output.match(/requested=(\d+)\s*,?\s*prepared=(\d+)\s*,?\s*mounted=(\d+)\s*,?\s*failed=(\d+)/i);
  const packageSummaryMatch = output.match(/Package\s+loader\s+finished[^|]*\|[^|]*enabled=(\d+)\s+[^|]*loaded=(\d+)\s+[^|]*failed=(\d+)/i);
  return {
    routeSummary: routeSummaryMatch
      ? {
          requested: Number(routeSummaryMatch[1]),
          prepared: Number(routeSummaryMatch[2]),
          mounted: Number(routeSummaryMatch[3]),
          failed: Number(routeSummaryMatch[4]),
        }
      : null,
    packageSummary: packageSummaryMatch
      ? {
          enabled: Number(packageSummaryMatch[1]),
          loaded: Number(packageSummaryMatch[2]),
          failed: Number(packageSummaryMatch[3]),
        }
      : null,
  };
}

function summarize(results, label) {
  let failed = 0;
  for (const row of results) {
    const status = row.success ? 'PASS' : 'FAIL';
    if (!row.success) failed += 1;
    log(`${label} ${status} ${row.route} status=${row.status} location=${row.location || '-'} elapsed=${row.elapsedMs}ms expected=${row.expected}`);
  }
  return failed;
}

async function attemptLogin(jar) {
  if (config.authCookieSeeds.length > 0) {
    mergeCookies(config.authCookieSeeds, jar);
    const probe = await sendRequest('/dashboard/section-nav/SCHOOL', { jar });
    const health = parseAuthCookieHealth(probe);
    if (health.looksLikeLoggedIn) {
      log(`reused SCHOOL_SMOKE_COOKIE / --cookie for auth session. status=${probe.statusCode} location=${health.location || '-'}`);
      return { success: true, data: { status: 'success', redirectUrl: '/dashboard/section-nav/SCHOOL', source: 'cookie' } };
    }
    log(`cookie auth probe did not look authorized: status=${probe.statusCode} location=${health.location || '-'}`);
    if (!config.username || !config.password) {
      return { success: false, data: { status: 'error', message: 'Provided auth cookie does not establish an authenticated session.' } };
    }
  }

  if (!config.username || !config.password) {
    log('No SCHOOL_SMOKE_USERNAME/PASSWORD set; skipping authenticated route checks.');
    return { success: false, data: null };
  }

  const loginGet = await sendRequest('/login', { jar });
  mergeCookies(loginGet.headers['set-cookie'], jar);

  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
  }).toString();

  const loginPost = await sendRequest('/login', {
    method: 'POST',
    body,
    jar,
  });
  if (loginPost.headers && loginPost.headers['set-cookie']) {
    mergeCookies(loginPost.headers['set-cookie'], jar);
  }
  let payload = null;
  try {
    payload = JSON.parse(loginPost.bodyText || '{}');
  } catch (_) {
    payload = null;
  }
  if (loginPost.statusCode !== 200 || !payload || payload.status !== 'success') {
    log(`login attempt failed status=${loginPost.statusCode} payload=${loginPost.bodyText || '(empty)'}`);
    return { success: false, data: payload };
  }
  log(`login success (username=${config.username ? 'set' : 'missing'}). redirect=${payload.redirectUrl || '/dashboard'}`);
  return { success: true, data: payload };
}

async function probeAuthenticatedMenuLinks(jar) {
  const route = '/dashboard/section-nav/SCHOOL';
  const response = await sendRequest(route, { jar });
  const body = response.bodyText || '';
  const hasTeachersLink = /href\s*=\s*['"]\/school\/teachers/i.test(body);
  const hasStaffLink = /href\s*=\s*['"]\/school\/staff/i.test(body);
  log(`menu probe ${route} status=${response.statusCode} teachersLink=${hasTeachersLink} staffLink=${hasStaffLink} location=${response.headers['location'] || response.headers['Location'] || '-'}`);
  return { route, status: response.statusCode, hasTeachersLink, hasStaffLink };
}

async function startAppProcess(startupLines) {
  const launchConfigs = [
    {
      label: 'node-process-execpath',
      command: process.execPath,
      args: ['app.js'],
    },
    {
      label: 'node-process-name',
      command: 'node',
      args: ['app.js'],
    },
    ...(isWindows
      ? [
          {
            label: 'cmd-shell-node',
            command: 'cmd',
            args: ['/c', `set PORT=${config.port} && node app.js`],
          },
        ]
      : []),
  ];

  let launchError = null;
  for (const launchConfig of launchConfigs) {
    try {
      const env = {
        ...process.env,
        PORT: String(config.port),
      };
      const appProcess = spawn(launchConfig.command, launchConfig.args, {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      appProcess.stdout.on('data', (chunk) => {
        const lines = chunk.toString().replace(/\r?\n$/, '').split('\n');
        for (const line of lines) {
          if (!line) continue;
          if (/APP|HTTP_SERVER|PACKAGE_LOADER|ERROR|WARN|ERR/i.test(line)) {
            startupLines.push(line);
            log(`server-out ${line}`);
          }
        }
      });
      appProcess.stderr.on('data', (chunk) => {
        const lines = chunk.toString().replace(/\r?\n$/, '').split('\n');
        for (const line of lines) {
          if (!line) continue;
          startupLines.push(line);
          log(`server-err ${line}`);
        }
      });

      appProcess.on('error', (error) => {
        startupLines.push(`[APP_START_ERROR] ${String(error.message || error)}`);
      });

      appProcess.on('exit', (code) => {
        startupLines.push(`[APP_EXIT] code=${code}`);
      });

      log(`started app.js via ${launchConfig.label} on port ${config.port}`);
      return appProcess;
    } catch (error) {
      launchError = error;
      log(`launch attempt failed (${launchConfig.label}): ${error.code || error.message}`);
    }
  }
  throw launchError || new Error('Failed to start app process');
}

async function main() {
  const startupLines = [];
  let appProcess = null;
  let appExitCode = null;
  const cookieJar = [];
  let startedByScript = false;

  try {
    if (shouldStartServer) {
      log(`starting app.js with PORT=${config.port}`);
      try {
        appProcess = await startAppProcess(startupLines);
        startedByScript = true;
        appProcess.on('exit', (code) => {
          appExitCode = code;
          log(`app.js exited with code ${code}`);
        });
        await waitForServerReady();
      } catch (error) {
        const errCode = error && error.code ? ` ${error.code}` : '';
        log(`failed to auto-start app.js (${error.message || error}${errCode}).`);
        log('If you already have an app running, retry with --no-server-start.');
        log('Otherwise run app.js manually before re-running this script.');
        if (!startedByScript) {
          await waitForServerReady();
        }
      }
    } else {
      await waitForServerReady();
    }

    const unauthResults = await runRouteChecks(routeChecks, cookieJar, true);
    const unauthFailures = summarize(unauthResults, 'UNAUTH');

    let authFailures = 0;
    if (!shouldSkipAuthChecks) {
      const loginResult = await attemptLogin(cookieJar);
      if (loginResult.success) {
        const authResults = await runRouteChecks(routeChecks, cookieJar, false);
        authFailures = summarize(authResults, 'AUTH');
        await probeAuthenticatedMenuLinks(cookieJar);
      } else {
        authFailures = authFailurePenalty;
      }
    }

    const summaries = parseLoaderSummary(startupLines);
    if (summaries.routeSummary) {
      log(`route summary: requested=${summaries.routeSummary.requested} prepared=${summaries.routeSummary.prepared} mounted=${summaries.routeSummary.mounted} failed=${summaries.routeSummary.failed}`);
    }
    if (summaries.packageSummary) {
      log(`package summary: loaded=${summaries.packageSummary.loaded} failed=${summaries.packageSummary.failed}`);
    }

    const failed = unauthFailures + authFailures;
    if (failed > 0) {
      log(`summary: FAIL (${failed} checks failed)`);
      return process.exit(1);
    }
    log('summary: PASS');
    return process.exit(0);
  } catch (error) {
    log(`fatal error: ${error && error.message ? error.message : String(error)}`);
    return process.exit(1);
  } finally {
    if (shouldStartServer && appProcess) {
      if (!appProcess.killed && appExitCode === null) {
        try {
          appProcess.kill('SIGINT');
        } catch (_) {
          // ignore
        }
      }
    }
  }
}

main().catch((error) => {
  log(`unhandled error: ${error && error.message ? error.message : String(error)}`);
  process.exit(1);
});
