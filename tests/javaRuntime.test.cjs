const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { join, dirname, resolve, relative } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const vm = require('node:vm');
const ts = require('typescript');
function load(fetch, execute) {
  const exports = {};
  const execFile = () => {};
  execFile[promisify.custom] = execute;
  const source = ts.transpileModule(readFileSync('src/main/javaRuntime.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, process, AbortSignal, Buffer, require: id => id === 'electron' ? { net: { fetch } } : id === 'node:child_process' && execute ? { execFile } : require(id) });
  return exports;
}
const variant = (usage, java, category = 'library') => ({ attributes: { 'org.gradle.usage': usage, 'org.gradle.jvm.version': java, 'org.gradle.category': category } });
test('reads runtime JVM attributes, ignores documentation, rejects unknown requirements', () => {
  const api = load();
  assert.equal(api.javaRequirement({ variants: [variant('java-api', 21), variant('java-runtime', 25), variant('java-runtime', undefined, 'documentation')] }), 25);
  assert.equal(api.javaRequirement({ variants: [variant('java-api', 17)] }), 17);
  assert.throws(() => api.javaRequirement({ variants: [] }));
  assert.throws(() => api.javaRequirement({ variants: [variant('java-runtime', undefined)] }));
  assert.equal(api.parseJavaVersion('java.version = 25.0.4'), 25);
  assert.equal(api.parseJavaVersion('java version "1.8.0_492"'), 8);
});
test('resolves timestamped snapshot module metadata', async () => {
  const urls = [];
  const api = load(async url => { urls.push(url); return { ok: true, text: async () => url.endsWith('.xml') ? '<snapshotVersion><extension>module</extension><value>1.0-20261106.123456-3</value></snapshotVersion>' : JSON.stringify({ variants: [variant('java-runtime', 25)] }) }; });
  assert.equal(await api.requiredJava('snapshots', '1.0-SNAPSHOT'), 25);
  assert(urls[1].endsWith('/1.0-SNAPSHOT/client-1.0-20261106.123456-3.module'));
});
test('uses a compatible system Java without downloading or installing', async () => {
  const api = load(() => { throw Error('Unexpected download'); }, async () => ({ stdout: '', stderr: 'java.version = 25.0.4\njava.home = C:/existing-jdk\n' }));
  const runtime = await api.ensureJava(25, 'java', 'unused', () => {});
  assert.equal(runtime.major, 25);
  assert.equal(runtime.home, 'C:/existing-jdk');
});
async function installerFixture(checksumValid) {
  const root = await fs.mkdtemp(join(tmpdir(), 'qv-runtime-test-'));
  const archive = Buffer.from('fake verified JDK archive');
  let downloads = 0;
  let extracts = 0;
  const api = load(async url => {
    if (url.startsWith('https://api.adoptium.net/')) return { ok: true, text: async () => JSON.stringify([{ binary: { package: { link: 'https://example.test/jdk.zip', checksum: checksumValid ? createHash('sha256').update(archive).digest('hex') : '0'.repeat(64), size: archive.length } } }]) };
    downloads++;
    return new Response(archive);
  }, async (command, args, options) => {
    if (command === 'powershell.exe' || command === 'tar') {
      extracts++;
      const target = options.env?.QV_JDK_DESTINATION || args[3];
      const home = join(target, 'jdk-25');
      await fs.mkdir(join(home, 'bin'), { recursive: true });
      await fs.writeFile(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), 'fake');
      return { stdout: '', stderr: '' };
    }
    await fs.access(command);
    return { stdout: '', stderr: `java.version = 25.0.4\njava.home = ${dirname(dirname(command))}\n` };
  });
  try {
    if (!checksumValid) {
      await assert.rejects(api.ensureJava(25, 'missing-java', root, () => {}), /SHA-256/);
      assert.equal(extracts, 0);
    } else {
      const runtime = await api.ensureJava(25, 'missing-java', root, () => {});
      assert.equal(runtime.major, 25);
      await fs.access(runtime.executable);
      const again = await api.ensureJava(25, 'missing-java', root, () => {});
      assert.equal(again.executable, runtime.executable);
      assert.equal(downloads, 1);
      assert.equal(extracts, 1);
    }
    assert(!(await fs.readdir(join(root, 'runtimes'))).some(name => name.startsWith('.install-')));
  } finally {
    assert(relative(resolve(tmpdir()), root).startsWith('qv-runtime-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}
test('installs, verifies and reuses a managed Temurin JDK', () => installerFixture(true));
test('rejects checksum mismatch before extraction and cleans partial download', () => installerFixture(false));
