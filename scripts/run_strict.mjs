#!/usr/bin/env node
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
    'camofox-latest-ids.json',
    'candidates.json',
    'generated-report.md',
    'execution-report.txt',
    'account-attempts.json'
  ];
  for (const f of targets) {
    const p = join(cacheDir, f);
    if (existsSync(p)) rmSync(p, { force: true });
  }
}

function ensureAttemptsCoverage() {
  const p = join(baseDir, 'cache/account-attempts.json');
  if (!existsSync(p)) throw new Error('missing account-attempts.json');

  const attempts = JSON.parse(readFileSync(p, 'utf8'));
  const handles = Object.keys(attempts || {});
  if (handles.length !== 15) {
    throw new Error(`account attempts coverage failed: expected 15, got ${handles.length}`);
  }
}

function main() {
  // Required env/args:
  // - TEAMS_WEBHOOK_URL or .teams-webhook
  // Optional env:
  // - TEAMS_PAYLOAD_MODE=card|workflow|text (default card here)
  const payloadMode = process.env.TEAMS_PAYLOAD_MODE || 'card';
  const reportFile = 'cache/generated-report.md';

  console.error('== strict run: reset cache ==');
  resetCache();

  if (!existsSync(join(baseDir, 'cache/camofox-urls.txt'))) {
    throw new Error('missing cache/camofox-urls.txt (collect URLs first)');
  }

  console.error('== strict run: collect ids from camofox urls ==');
  runNode(['scripts/collect_ids_camofox.mjs', '--input', 'cache/camofox-urls.txt', '--output', 'cache/camofox-latest-ids.json', '--hours', '24']);

  console.error('== strict run: build account attempts ==');
  runNode(['scripts/build_account_attempts.mjs']);
  ensureAttemptsCoverage();

  console.error('== strict run: generate candidates ==');
  runNode(['scripts/generate_report.mjs', '--hours', '24', '--ids-file', 'cache/camofox-latest-ids.json', '--candidates-only', '--output', 'cache/candidates.json']);

  if (!existsSync(join(baseDir, reportFile))) {
    throw new Error('missing generated-report.md (must be AI-written per SKILL.md before send)');
  }

  console.error('== strict run: send teams ==');
  runNode(['scripts/send_to_teams.mjs', '--report-file', reportFile, '--payload-mode', payloadMode]);

  console.error('== strict run: done ==');
}

try {
  main();
} catch (e) {
  console.error('strict run failed:', e.message || e);
  process.exit(1);
}
