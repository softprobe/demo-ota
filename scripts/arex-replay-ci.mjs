#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const TERMINAL_STATUSES = new Set([2, 3, 4]); // DONE, INTERRUPTED, CANCELLED
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_RECORD_LOOKBACK_HOURS = 24 * 7;

function printHelp() {
  console.log(`AREX replay CI helper

Usage:
  node scripts/arex-replay-ci.mjs [options]

Core options:
  --web-api-url URL           Base URL for AREX webApi service
  --schedule-url URL          Base URL for AREX schedule service
  --app-id ID                 AREX app/service id
  --target-env URL            Base URL of the application under test

Selection options:
  --suite-file PATH           JSON file describing a replay suite
  --last-n N                  Fallback mode: replay the most recent N recordings
  --all-sessions              Replay all matched sessions in the time window
  --begin-time VALUE          Record window start, ISO-8601 or epoch millis
  --end-time VALUE            Record window end, ISO-8601 or epoch millis

Optional:
  --source-env NAME           Source environment label sent to AREX (default: pro)
  --operator NAME             Operator name/email (default: GITHUB_ACTOR or ci)
  --plan-name NAME            Override replay plan name
  --access-token TOKEN        AREX access token
  --enable-mock true|false    Whether to ask AREX to enable mock during replay (default: true)
  --poll-interval-ms N        Poll interval in ms (default: 3000)
  --poll-timeout-ms N         Poll timeout in ms (default: 1200000)
  --wait-for-url URL          Health/readiness URL for the AUT before replay starts
  --wait-timeout-ms N         Wait timeout for --wait-for-url (default: 180000)
  --report-json PATH          Write a JSON summary artifact
  --verbose                   Print extra request/debug output
  --help                      Show this message

Environment variable equivalents:
  AREX_WEB_API_URL
  AREX_SCHEDULE_URL
  AREX_APP_ID
  AREX_TARGET_ENV
  AREX_SOURCE_ENV
  AREX_OPERATOR
  AREX_ACCESS_TOKEN
  AREX_SUITE_FILE
  AREX_LAST_N
  AREX_BEGIN_TIME
  AREX_END_TIME
  AREX_ENABLE_MOCK
  AREX_WAIT_FOR_URL
  AREX_REPORT_JSON

Suite file formats:
  1. last-n selection
     {
       "appId": "checkout-service",
       "targetEnv": "http://127.0.0.1:8080",
       "sourceEnv": "pro",
       "enableMock": true,
       "caseSelection": {
         "type": "last-n",
         "lastN": 10,
         "beginTime": "2026-04-01T00:00:00Z",
         "endTime": "2026-04-09T00:00:00Z"
       }
     }

  2. all matched sessions
     {
       "appId": "checkout-service",
       "targetEnv": "http://127.0.0.1:8080",
       "caseSelection": {
         "type": "all",
         "beginTime": "2026-04-01T00:00:00Z",
         "endTime": "2026-04-09T00:00:00Z"
       }
     }

  3. explicit suite
     {
       "appId": "checkout-service",
       "targetEnv": "http://127.0.0.1:8080",
       "caseSelection": {
         "type": "explicit",
         "caseSourceFrom": 1712620800000,
         "caseSourceTo": 1712707200000,
         "operationCaseInfoList": [
           { "operationId": "op-1", "replayIdList": ["rec-1", "rec-2"] }
         ]
       }
     }
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function die(message, code = 2) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

function readJsonFile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function toNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function toTimestamp(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function coerceUrl(raw) {
  if (!raw) return '';
  return String(raw).replace(/\/+$/, '');
}

function buildHeaders(appId, accessToken) {
  const headers = {
    'content-type': 'application/json',
    appId,
  };
  if (accessToken) headers['access-token'] = accessToken;
  return headers;
}

function unwrapPayload(payload) {
  if (payload && typeof payload === 'object' && 'body' in payload) {
    return payload.body;
  }
  return payload;
}

function extractResponseError(payload, response) {
  const wrapper = payload && typeof payload === 'object' ? payload : {};
  const statusType = wrapper.responseStatusType;
  if (statusType?.responseCode && Number(statusType.responseCode) !== 0) {
    return statusType.responseDesc || `AREX response code ${statusType.responseCode}`;
  }

  if (response && !response.ok) {
    return `HTTP ${response.status} ${response.statusText}`;
  }

  return '';
}

async function postJson(baseUrl, endpoint, body, headers, verbose = false) {
  const url = `${coerceUrl(baseUrl)}${endpoint}`;
  if (verbose) {
    console.log(`POST ${url}`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to parse JSON from ${url}: ${text || error.message}`);
  }

  const errorMessage = extractResponseError(payload, response);
  if (errorMessage) {
    throw new Error(`${url}: ${errorMessage}`);
  }

  return payload;
}

async function waitForUrl(url, timeoutMs, verbose = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (verbose) console.log(`AUT ready: ${url}`);
        return;
      }
    } catch {
      // Ignore until timeout.
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for AUT readiness URL: ${url}`);
}

async function fetchOperations({ webApiUrl, appId, beginTime, endTime, headers, verbose }) {
  const payload = await postJson(
    webApiUrl,
    '/api/report/aggCount',
    { appId, beginTime, endTime },
    headers,
    verbose,
  );
  const body = unwrapPayload(payload);
  return (body.operationList || []).filter((operation) => {
    const normalized = String(operation.operationName || '').replace(/\s+/g, '');
    return normalized !== '/**';
  });
}

async function fetchAllRecordsForOperation({
  webApiUrl,
  appId,
  operation,
  beginTime,
  endTime,
  headers,
  verbose,
}) {
  const operationType = operation.operationTypes?.[0] || operation.operationType || 'Servlet';
  const pageSize = 200;
  let pageIndex = 1;
  let total = Infinity;
  const records = [];

  while (records.length < total) {
    const payload = await postJson(
      webApiUrl,
      '/api/report/listRecord',
      {
        appId,
        operationName: operation.operationName,
        operationType,
        beginTime,
        endTime,
        pageSize,
        pageIndex,
      },
      headers,
      verbose,
    );
    const body = unwrapPayload(payload);
    const list = body.recordList || [];
    total = Number(body.totalCount || list.length || 0);
    records.push(
      ...list.map((record) => ({
        operationId: operation.id,
        recordId: record.recordId,
        createTime: Number(record.createTime) || 0,
      })),
    );
    if (list.length < pageSize) break;
    pageIndex += 1;
  }

  return records;
}

async function buildSelectionFromLastN({
  webApiUrl,
  appId,
  beginTime,
  endTime,
  lastN,
  headers,
  verbose,
}) {
  const operations = await fetchOperations({
    webApiUrl,
    appId,
    beginTime,
    endTime,
    headers,
    verbose,
  });

  const recordsByOperation = await Promise.all(
    operations.map((operation) =>
      fetchAllRecordsForOperation({
        webApiUrl,
        appId,
        operation,
        beginTime,
        endTime,
        headers,
        verbose,
      }),
    ),
  );

  const selectedRecords = recordsByOperation
    .flat()
    .filter((record) => Boolean(record.recordId))
    .sort((a, b) => b.createTime - a.createTime)
    .slice(0, lastN);

  const grouped = selectedRecords.reduce((acc, record) => {
    if (!acc[record.operationId]) acc[record.operationId] = [];
    acc[record.operationId].push(record.recordId);
    return acc;
  }, {});

  const operationCaseInfoList = Object.entries(grouped).map(([operationId, replayIdList]) => ({
    operationId,
    replayIdList: Array.from(new Set(replayIdList)),
  }));

  return {
    selectedRecordCount: selectedRecords.length,
    caseSourceFrom: beginTime,
    caseSourceTo: endTime,
    operationCaseInfoList,
  };
}

async function buildSelectionFromAll({
  webApiUrl,
  appId,
  beginTime,
  endTime,
  headers,
  verbose,
}) {
  const operations = await fetchOperations({
    webApiUrl,
    appId,
    beginTime,
    endTime,
    headers,
    verbose,
  });

  const recordsByOperation = await Promise.all(
    operations.map((operation) =>
      fetchAllRecordsForOperation({
        webApiUrl,
        appId,
        operation,
        beginTime,
        endTime,
        headers,
        verbose,
      }),
    ),
  );

  const selectedRecords = recordsByOperation
    .flat()
    .filter((record) => Boolean(record.recordId))
    .sort((a, b) => b.createTime - a.createTime);

  const grouped = selectedRecords.reduce((acc, record) => {
    if (!acc[record.operationId]) acc[record.operationId] = [];
    acc[record.operationId].push(record.recordId);
    return acc;
  }, {});

  const operationCaseInfoList = Object.entries(grouped).map(([operationId, replayIdList]) => ({
    operationId,
    replayIdList: Array.from(new Set(replayIdList)),
  }));

  return {
    selectedRecordCount: selectedRecords.length,
    caseSourceFrom: beginTime,
    caseSourceTo: endTime,
    operationCaseInfoList,
  };
}

function normalizeExplicitSelection(selection, defaultBeginTime, defaultEndTime) {
  const operationCaseInfoList = (selection.operationCaseInfoList || [])
    .map((item) => ({
      operationId: String(item.operationId || ''),
      replayIdList: Array.isArray(item.replayIdList)
        ? item.replayIdList.map((id) => String(id)).filter(Boolean)
        : [],
    }))
    .filter((item) => item.operationId && item.replayIdList.length > 0);

  return {
    selectedRecordCount: operationCaseInfoList.reduce((sum, item) => sum + item.replayIdList.length, 0),
    caseSourceFrom: toTimestamp(selection.caseSourceFrom, defaultBeginTime),
    caseSourceTo: toTimestamp(selection.caseSourceTo, defaultEndTime),
    operationCaseInfoList,
  };
}

async function createPlan({
  scheduleUrl,
  appId,
  accessToken,
  sourceEnv,
  targetEnv,
  operator,
  planName,
  caseSourceFrom,
  caseSourceTo,
  operationCaseInfoList,
  enableMock,
  verbose,
}) {
  const headers = buildHeaders(appId, accessToken);
  const payload = await postJson(
    scheduleUrl,
    '/api/createPlan',
    {
      appId,
      sourceEnv,
      targetEnv,
      operator,
      replayPlanType: Number(operationCaseInfoList.length > 0),
      planName,
      caseSourceFrom,
      caseSourceTo,
      operationCaseInfoList,
      enableMock,
    },
    headers,
    verbose,
  );

  const body = unwrapPayload(payload);
  if (Number(body.result) !== 1 || !body.data?.replayPlanId) {
    throw new Error(body.desc || 'Failed to create replay plan');
  }
  return body;
}

function isPlanFinished(plan) {
  if (!plan) return false;

  if (TERMINAL_STATUSES.has(Number(plan.status))) {
    return true;
  }

  const totalCaseCount = Number(plan.totalCaseCount || 0);
  const completedCaseCount =
    Number(plan.successCaseCount || 0) +
    Number(plan.failCaseCount || 0) +
    Number(plan.errorCaseCount || 0);
  const waitCaseCount = Number(plan.waitCaseCount || 0);

  if (totalCaseCount > 0) {
    return completedCaseCount >= totalCaseCount && waitCaseCount === 0;
  }

  return false;
}

async function queryPlanStatistics({ webApiUrl, appId, planId, accessToken, verbose }) {
  const headers = buildHeaders(appId, accessToken);
  const payload = await postJson(
    webApiUrl,
    '/api/report/queryPlanStatistics',
    {
      appId,
      planId,
      needTotal: true,
      pageIndex: 1,
      pageSize: 1,
    },
    headers,
    verbose,
  );
  const body = unwrapPayload(payload);
  const list = Array.isArray(body.planStatisticList) ? body.planStatisticList : [];
  return list.find((item) => item.planId === planId) || list[0];
}

async function pollPlan({
  webApiUrl,
  appId,
  planId,
  accessToken,
  pollIntervalMs,
  pollTimeoutMs,
  verbose,
}) {
  const deadline = Date.now() + pollTimeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const plan = await queryPlanStatistics({
        webApiUrl,
        appId,
        planId,
        accessToken,
        verbose,
      });

      if (plan) {
        const progress = `${Number(plan.successCaseCount || 0) + Number(plan.failCaseCount || 0) + Number(plan.errorCaseCount || 0)}/${Number(plan.totalCaseCount || 0)}`;
        console.log(
          `Poll ${attempt}: status=${plan.status} progress=${progress} wait=${Number(plan.waitCaseCount || 0)} fail=${Number(plan.failCaseCount || 0)} error=${Number(plan.errorCaseCount || 0)}`,
        );

        if (isPlanFinished(plan)) {
          return plan;
        }
      } else if (verbose) {
        console.log(`Poll ${attempt}: plan not visible yet`);
      }
    } catch (error) {
      console.error(`Poll ${attempt} failed: ${error.message}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for replay plan ${planId} to finish`);
}

function buildConfig(args) {
  const suite = args['suite-file']
    ? readJsonFile(args['suite-file'])
    : process.env.AREX_SUITE_FILE
      ? readJsonFile(process.env.AREX_SUITE_FILE)
      : {};

  const now = Date.now();
  const defaultBeginTime = now - DEFAULT_RECORD_LOOKBACK_HOURS * 60 * 60 * 1000;

  const appId = args['app-id'] || process.env.AREX_APP_ID || suite.appId || '';
  const targetEnv = args['target-env'] || process.env.AREX_TARGET_ENV || suite.targetEnv || '';
  const sourceEnv =
    args['source-env'] || process.env.AREX_SOURCE_ENV || suite.sourceEnv || 'pro';
  const operator =
    args.operator || process.env.AREX_OPERATOR || suite.operator || process.env.GITHUB_ACTOR || 'ci';
  const accessToken = args['access-token'] || process.env.AREX_ACCESS_TOKEN || suite.accessToken || '';
  const webApiUrl = args['web-api-url'] || process.env.AREX_WEB_API_URL || suite.webApiUrl || '';
  const scheduleUrl =
    args['schedule-url'] || process.env.AREX_SCHEDULE_URL || suite.scheduleUrl || '';
  const enableMock = toBoolean(
    args['enable-mock'] ?? process.env.AREX_ENABLE_MOCK ?? suite.enableMock,
    true,
  );
  const verbose = toBoolean(args.verbose, false);

  const planNameOverride = args['plan-name'] || suite.planName;
  const pollIntervalMs = toNumber(args['poll-interval-ms'], DEFAULT_POLL_INTERVAL_MS);
  const pollTimeoutMs = toNumber(args['poll-timeout-ms'], DEFAULT_POLL_TIMEOUT_MS);
  const waitForUrl = args['wait-for-url'] || process.env.AREX_WAIT_FOR_URL || suite.waitForUrl || '';
  const waitTimeoutMs = toNumber(args['wait-timeout-ms'], DEFAULT_WAIT_TIMEOUT_MS);
  const reportJson = args['report-json'] || process.env.AREX_REPORT_JSON || '';

  const suiteSelection = suite.caseSelection || {};
  const selectionType =
    suiteSelection.type ||
    (args['all-sessions'] ? 'all' : args['last-n'] || process.env.AREX_LAST_N ? 'last-n' : 'explicit');
  const beginTime = toTimestamp(
    args['begin-time'] ?? process.env.AREX_BEGIN_TIME ?? suiteSelection.beginTime ?? suite.beginTime,
    defaultBeginTime,
  );
  const endTime = toTimestamp(
    args['end-time'] ?? process.env.AREX_END_TIME ?? suiteSelection.endTime ?? suite.endTime,
    now,
  );

  const config = {
    appId,
    targetEnv,
    sourceEnv,
    operator,
    accessToken,
    webApiUrl,
    scheduleUrl,
    enableMock,
    verbose,
    planNameOverride,
    pollIntervalMs,
    pollTimeoutMs,
    waitForUrl,
    waitTimeoutMs,
    reportJson,
    selectionType,
    beginTime,
    endTime,
    suiteSelection,
    lastN: toNumber(args['last-n'] ?? process.env.AREX_LAST_N ?? suiteSelection.lastN, undefined),
  };

  if (!config.webApiUrl) die('Missing --web-api-url or AREX_WEB_API_URL');
  if (!config.scheduleUrl) die('Missing --schedule-url or AREX_SCHEDULE_URL');
  if (!config.appId) die('Missing --app-id or AREX_APP_ID');
  if (!config.targetEnv) die('Missing --target-env or AREX_TARGET_ENV');

  if (config.selectionType === 'last-n' && (!config.lastN || config.lastN <= 0)) {
    die('last-n mode requires --last-n > 0 or caseSelection.lastN');
  }

  return config;
}

function maybeWriteReport(reportPath, summary) {
  if (!reportPath) return;
  const resolved = path.resolve(process.cwd(), reportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Wrote replay summary: ${resolved}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = buildConfig(args);

  if (config.waitForUrl) {
    console.log(`Waiting for AUT: ${config.waitForUrl}`);
    await waitForUrl(config.waitForUrl, config.waitTimeoutMs, config.verbose);
  }

  const headers = buildHeaders(config.appId, config.accessToken);
  let selection;
  if (config.selectionType === 'last-n') {
    selection = await buildSelectionFromLastN({
      webApiUrl: config.webApiUrl,
      appId: config.appId,
      beginTime: config.beginTime,
      endTime: config.endTime,
      lastN: config.lastN,
      headers,
      verbose: config.verbose,
    });
  } else if (config.selectionType === 'all') {
    selection = await buildSelectionFromAll({
      webApiUrl: config.webApiUrl,
      appId: config.appId,
      beginTime: config.beginTime,
      endTime: config.endTime,
      headers,
      verbose: config.verbose,
    });
  } else {
    selection = normalizeExplicitSelection(
      config.suiteSelection,
      config.beginTime,
      config.endTime,
    );
  }

  if (!selection.operationCaseInfoList.length) {
    throw new Error('No replayable sessions selected. Check appId, time range, or suite file.');
  }

  const planName =
    config.planNameOverride ||
    `ci-${config.appId}-${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;

  console.log(
    `Creating replay plan for app ${config.appId} with ${selection.selectedRecordCount} recordings across ${selection.operationCaseInfoList.length} operations`,
  );

  const createResult = await createPlan({
    scheduleUrl: config.scheduleUrl,
    appId: config.appId,
    accessToken: config.accessToken,
    sourceEnv: config.sourceEnv,
    targetEnv: config.targetEnv,
    operator: config.operator,
    planName,
    caseSourceFrom: selection.caseSourceFrom,
    caseSourceTo: selection.caseSourceTo,
    operationCaseInfoList: selection.operationCaseInfoList,
    enableMock: config.enableMock,
    verbose: config.verbose,
  });

  const planId = createResult.data.replayPlanId;
  console.log(`Replay plan started: ${planId}`);

  const finalPlan = await pollPlan({
    webApiUrl: config.webApiUrl,
    appId: config.appId,
    planId,
    accessToken: config.accessToken,
    pollIntervalMs: config.pollIntervalMs,
    pollTimeoutMs: config.pollTimeoutMs,
    verbose: config.verbose,
  });

  const summary = {
    appId: config.appId,
    planId,
    planName: finalPlan.planName || planName,
    targetEnv: config.targetEnv,
    status: finalPlan.status,
    totalCaseCount: Number(finalPlan.totalCaseCount || 0),
    successCaseCount: Number(finalPlan.successCaseCount || 0),
    failCaseCount: Number(finalPlan.failCaseCount || 0),
    errorCaseCount: Number(finalPlan.errorCaseCount || 0),
    waitCaseCount: Number(finalPlan.waitCaseCount || 0),
    replayStartTime: finalPlan.replayStartTime,
    replayEndTime: finalPlan.replayEndTime,
    selectedRecordCount: selection.selectedRecordCount,
  };

  maybeWriteReport(config.reportJson, summary);

  console.log(`Final summary: ${JSON.stringify(summary)}`);

  const hasBlockingFailures =
    Number(finalPlan.status) !== 2 ||
    Number(finalPlan.failCaseCount || 0) > 0 ||
    Number(finalPlan.errorCaseCount || 0) > 0;

  if (hasBlockingFailures) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
