import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const DESKTOP_DIR = path.resolve(ROOT_DIR, 'apps/desktop');
const RELEASE_DIR = path.resolve(DESKTOP_DIR, 'release');

console.log('====================================================');
console.log(' OpenOb Official Desktop Release Verification Gate');
console.log('====================================================\n');

function run(cmd, cwd = ROOT_DIR, env = {}) {
  console.log(`> [${path.relative(ROOT_DIR, cwd) || '.'}] ${cmd}`);
  child_process.execSync(cmd, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function getSha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function checkPEHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(2);
  fs.readSync(fd, buffer, 0, 2, 0);
  fs.closeSync(fd);
  return buffer[0] === 0x4d && buffer[1] === 0x5a; // 'MZ'
}

function checkCleanSource() {
  const status = child_process
    .execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' })
    .trim();

  // Filter out any transient release output lines if any
  const relevantLines = status
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes('apps/desktop/release'));

  if (relevantLines.length > 0) {
    console.error('❌ Dirty source tree detected:');
    console.error(relevantLines.join('\n'));
    throw new Error(
      'Official desktop release verification requires a clean source tree. Commit or stash changes before running this gate.'
    );
  }
}

async function verify() {
  // 1. Enforce Clean Source Tree at the very start (Section 3)
  console.log('--- Step 1: Enforcing Clean Committed Source Tree ---');
  checkCleanSource();
  const buildSha = child_process
    .execSync('git rev-parse HEAD', { cwd: ROOT_DIR, encoding: 'utf8' })
    .trim();
  console.log(`✔ Source tree is clean. Committed HEAD SHA: ${buildSha}`);

  // 2. Clean stale release output directory completely (Section 5)
  console.log('\n--- Step 2: Cleaning Stale Release Output ---');
  if (fs.existsSync(RELEASE_DIR)) {
    fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
    console.log(`✔ Removed existing release directory: ${RELEASE_DIR}`);
  }
  if (fs.existsSync(RELEASE_DIR)) {
    throw new Error(`Failed to clean release directory: ${RELEASE_DIR}`);
  }

  // 3. Build Web & Desktop production bundles
  console.log('\n--- Step 3: Building Web and Desktop Production Bundles ---');
  run('npm run build:web');
  run('npm run build:desktop');

  // 4. Create fresh unpacked package directory
  console.log('\n--- Step 4: Creating Fresh Unpacked Package ---');
  run('npm run pack:desktop');

  // 5. Verify unpacked executable exists and has valid PE header
  console.log('\n--- Step 5: Verifying Unpacked Package Integrity ---');
  if (process.platform === 'win32') {
    const unpackedExe = path.join(RELEASE_DIR, 'win-unpacked', 'OpenOb.exe');
    if (!fs.existsSync(unpackedExe)) {
      throw new Error(`Required unpacked executable missing at: ${unpackedExe}`);
    }
    if (!checkPEHeader(unpackedExe)) {
      throw new Error(`Invalid PE header on unpacked executable: ${unpackedExe}`);
    }
    console.log('✔ Unpacked executable verified with valid PE header:', unpackedExe);
  }

  // 6. Run Real Packaged Electron E2E Tests inside the release gate (Section 7)
  console.log('\n--- Step 6: Running Real Packaged Electron E2E Tests ---');
  run('npx playwright test tests/e2e/desktop-electron.spec.ts', ROOT_DIR, {
    OPENOB_REQUIRE_PACKAGED: '1',
  });
  console.log('✔ Real packaged Electron E2E tests passed');

  // 7. Build official distributables (NSIS + Portable)
  console.log('\n--- Step 7: Building Official Distributables (electron-builder) ---');
  run('npx electron-builder', DESKTOP_DIR);

  // 8. Validate all release artifacts
  console.log('\n--- Step 8: Validating Release Artifacts & Checksums ---');
  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`Release directory does not exist: ${RELEASE_DIR}`);
  }

  const files = fs.readdirSync(RELEASE_DIR);
  const manifestArtifacts = [];

  if (process.platform === 'win32') {
    const setupExe = files.find((f) => f.includes('Setup') && f.endsWith('.exe'));
    const portableExe = files.find((f) => f.includes('Portable') && f.endsWith('.exe'));

    if (!setupExe) {
      throw new Error('Required NSIS Setup executable missing in release output');
    }
    if (!portableExe) {
      throw new Error('Required Portable executable missing in release output');
    }

    const setupPath = path.join(RELEASE_DIR, setupExe);
    const portablePath = path.join(RELEASE_DIR, portableExe);

    const setupStats = fs.statSync(setupPath);
    const portableStats = fs.statSync(portablePath);

    if (setupStats.size < 10000000) {
      throw new Error(`NSIS Setup executable seems too small (${setupStats.size} bytes)`);
    }
    if (portableStats.size < 10000000) {
      throw new Error(`Portable executable seems too small (${portableStats.size} bytes)`);
    }

    if (!checkPEHeader(setupPath)) {
      throw new Error(`Invalid PE header on NSIS installer: ${setupPath}`);
    }
    if (!checkPEHeader(portablePath)) {
      throw new Error(`Invalid PE header on Portable executable: ${portablePath}`);
    }

    const setupHash = getSha256(setupPath);
    const portableHash = getSha256(portablePath);

    console.log(
      `✔ NSIS Setup Validated: ${setupExe} (${(setupStats.size / (1024 * 1024)).toFixed(2)} MB)`
    );
    console.log(`  SHA256: ${setupHash}`);
    console.log(
      `✔ Portable Executable Validated: ${portableExe} (${(portableStats.size / (1024 * 1024)).toFixed(2)} MB)`
    );
    console.log(`  SHA256: ${portableHash}`);

    manifestArtifacts.push(
      {
        name: setupExe,
        type: 'nsis-installer',
        size: setupStats.size,
        sha256: setupHash,
      },
      {
        name: portableExe,
        type: 'portable-executable',
        size: portableStats.size,
        sha256: portableHash,
      }
    );
  }

  // 9. Generate Official Release Manifest
  console.log('\n--- Step 9: Writing Official Release Manifest ---');
  const manifest = {
    appName: 'OpenOb',
    version: '0.1.0',
    buildSha,
    sourceClean: true,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    artifacts: manifestArtifacts,
    notarization: 'unsigned-dogfood-candidate',
  };

  const manifestPath = path.join(RELEASE_DIR, 'release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✔ Official release manifest written: ${manifestPath}`);

  console.log('\n====================================================');
  console.log(' 🎉 Official OpenOb Desktop Release Gate PASSED');
  console.log('====================================================\n');
}

verify().catch((err) => {
  console.error('\n❌ Release verification FAILED:', err.message || err);
  process.exit(1);
});
