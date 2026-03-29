#!/usr/bin/env node
/**
 * run_strict.mjs — Single entry-point for a full pipeline run.
 *
 * Every invocation:
 *   1. Wipes ALL runtime cache (including camofox-urls.txt — no reuse)
 *   2. Real-time collection via collect_camofox.mjs
 *   3. URL → ID conversion
 *   4. Account-attempts coverage check
 *   5. Candidate generation
 *   6. Requires AI-written generated-report.md to exist
 *   7. Sends to Teams
 */
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = dirname(__dirname);

function runNode(args) {
  return execFileSync('node', args, {
    cwd: baseDir,
    env: process.env,
    stdio: 'inherit',
    maxBuffer: 50 * 1024 * 1024
  });
}

function resetCache() {
  const cacheDir = join(baseDir, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const targets = [
    'camofox-urls.txt',
    'camofox-latest-ids.json',
    'candidates.json',
    'generated-report.md',
    'execution-report.txt',
    'account-attempts.json',
    'fxtwitter-state.json'
  ];
  for (const f of targets) {
    const p = join(cacheDir, f);
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

function expectedHandleCount() {
  const presetsPath = join(baseDir, 'references/query-presets.json');
  if (!existsSync(presetsPath)) return 0;
  const presets = JSON.parse(readFileSync(presetsPath, 'utf8'));
  return [...(presets.bloggers || []), ...(presets.official || [])].length;
}

function ensureAttemptsCoverage() {
  const p = join(baseDir, 'cache/account-attempts.json');
  if (!existsSync(p)) throw new Error('missing account-attempts.json');

  const attempts = JSON.parse(readFileSync(p, 'utf8'));
  const handles = Object.keys(attempts || {});
  const expected = expectedHandleCount();
  if (expected > 0 && handles.length !== expected) {
    throw new Error(`account attempts coverage: expected ${expected}, got ${handles.length}`);
  }
}

function main() {
  const payloadMode = process.env.TEAMS_PAYLOAD_MODE || 'card';
  const reportFile = 'cache/generated-report.md';

  // Step 1: wipe all runtime cache
  console.error('== strict: reset ALL cache ==');
  resetCache();

  // Step 2: real-time collection (Camofox → fxtwitter per-account fallback)
  console.error('== strict: collect tweets from all accounts ==');
  runNode(['scripts/collect_camofox.mjs', '--hours', '24', '--output', 'cache/camofox-urls.txt']);

  if (!existsSync(join(baseDir, 'cache/camofox-urls.txt'))) {
    throw new Error('collect_camofox.mjs finished but cache/camofox-urls.txt not created');
  }

  // Step 3: URL → ID
  console.error('== strict: collect ids ==');
  runNode([
    'scripts/collect_ids_camofox.mjs',
    '--input', 'cache/camofox-urls.txt',
    '--output', 'cache/camofox-latest-ids.json',
    '--hours', '24'
  ]);

  // Step 4: account attempts + coverage check
  console.error('== strict: build account attempts ==');
  runNode(['scripts/build_account_attempts.mjs', '--hours', '24']);
  ensureAttemptsCoverage();

  // Step 5: generate candidates
  console.error('== strict: generate candidates ==');
  runNode([
    'scripts/generate_report.mjs',
    '--hours', '24',
    '--ids-file', 'cache/camofox-latest-ids.json',
    '--candidates-only',
    '--output', 'cache/candidates.json'
  ]);

  // Step 6: AI-written report must exist before send
  if (!existsSync(join(baseDir, reportFile))) {
    throw new Error(
      'missing generated-report.md — AI must write the daily report from cache/candidates.json per SKILL.md before send.\n' +
      'Hint: read cache/candidates.json, follow SKILL.md instructions, write cache/generated-report.md, then re-run.'
    );
  }

  // Step 7: send
  console.error('== strict: send to Teams ==');
  runNode(['scripts/send_to_teams.mjs', '--report-file', reportFile, '--payload-mode', payloadMode]);

  console.error('== strict: done ==');
}

try {
  main();
} catch (e) {
  console.error('strict run failed:', e.message || e);
  process.exit(1);
}
