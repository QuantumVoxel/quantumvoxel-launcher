const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const apiExports = {};
const source = ts.transpileModule(readFileSync('src/main/serverExport.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
vm.runInNewContext(source, { exports: apiExports });

test('writes VM arguments for the selected heap in user_vmargs.txt', () => {
  assert.equal(apiExports.serverVmArgs(4096), '-Xmx4096M\n');
  assert.equal(apiExports.serverVmArgsFile, 'user_vmargs.txt');
  assert.equal(apiExports.serverArgsFile, 'user_args.txt');
  assert.throws(() => apiExports.serverVmArgs(511), /Memory/);
  assert.throws(() => apiExports.serverVmArgs(32769), /Memory/);
});

test('creates launch scripts that run from the export directory and read user arguments', () => {
  const scripts = apiExports.serverLauncherScripts();
  const mainClass = 'net\\.fabricmc\\.loader\\.impl\\.launch\\.knot\\.KnotServer';
  assert.match(scripts.windows, /cd \/d "%~dp0"/);
  assert.match(scripts.windows, /java .*-cp libraries\/\*/);
  assert.match(scripts.windows, new RegExp(mainClass));
  assert.match(scripts.windows, /user_vmargs\.txt/);
  assert.match(scripts.windows, /user_args\.txt/);
  assert.doesNotMatch(scripts.windows, /@server\.args/);
  assert.match(scripts.unix, /cd "\$\(dirname "\$0"\)"/);
  assert.match(scripts.unix, new RegExp(`exec java .*-cp "libraries\\/\\*" ${mainClass}`));
  assert.match(scripts.unix, /user_vmargs\.txt/);
  assert.match(scripts.unix, /user_args\.txt/);
  assert.doesNotMatch(scripts.unix, /@server\.args/);
});

test('creates a POM for the selected server version and enables snapshot dependencies', () => {
  const releasePom = apiExports.serverPom('releases', '0.1.0-alpha.2026.11.03');
  assert.match(releasePom, /<artifactId>server<\/artifactId><version>0\.1\.0-alpha\.2026\.11\.03<\/version>/);
  assert.match(releasePom, /https:\/\/maven\.ultreon\.dev\/releases/);
  assert.match(releasePom, /https:\/\/maven\.ultreon\.dev\/snapshots/);
  assert.match(releasePom, /<snapshots><enabled>true<\/enabled>/);
  const snapshotPom = apiExports.serverPom('snapshots', '0.1.0-SNAPSHOT');
  assert.match(snapshotPom, /<updatePolicy>always<\/updatePolicy>/);
  assert.throws(() => apiExports.serverPom('invalid', '1.0'), /channel/i);
  assert.throws(() => apiExports.serverPom('releases', '../1.0'), /version/i);
});