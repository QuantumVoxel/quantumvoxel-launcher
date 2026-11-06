const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const vm = require('node:vm');
const ts = require('typescript');
function load(fetch, execute) {
  const exports = {};
  const execFile = () => {};
  execFile[promisify.custom] = execute;
  vm.runInNewContext(ts.transpileModule(readFileSync('src/main/mavenRuntime.ts','utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText, {
    exports, process, AbortSignal, Buffer, require:id => id === 'electron' ? {net:{fetch}} : id === 'node:child_process' ? {execFile} : require(id)
  });
  return exports;
}
test('selects latest supported stable release numerically, excluding Maven 4 prereleases', () => {
  const api = load();
  assert.equal(api.latestMaven('<version>3.9.9</version><version>4.0.0-rc-7</version><version>3.10.0</version><version>3.8.9</version>'), '3.10.0');
  assert.throws(()=>api.latestMaven('<version>4.0.0-rc-7</version>'));
  if(process.platform === 'win32') assert.throws(()=>api.mavenInvocation('mvn & evil',[]));
});
test('installs, reuses, updates, falls back offline, and rejects corrupt updates', async () => {
  const root = await fs.mkdtemp(join(tmpdir(),'qv-maven-test-'));
  const archive = Buffer.from('fake Maven distribution');
  let version = '3.9.9', offline = false, corrupt = false, downloads = 0, extracts = 0;
  const messages = [];
  const api = load(async url => {
    if(offline) throw Error('offline');
    if(url.endsWith('.xml')) return {ok:true,text:async()=>`<version>${version}</version><version>4.0.0-rc-1</version>`};
    if(url.endsWith('.sha512')) return {ok:true,text:async()=>corrupt ? '0'.repeat(128) : createHash('sha512').update(archive).digest('hex')};
    downloads++;
    return new Response(archive);
  }, async(command,args,options)=>{
    if(command === 'powershell.exe' || command === 'tar') {
      extracts++;
      const directory = options.env?.QV_MAVEN_DESTINATION || args[3];
      const bin = join(directory,`apache-maven-${version}`,'bin');
      await fs.mkdir(bin,{recursive:true});
      await fs.writeFile(join(bin,process.platform === 'win32' ? 'mvn.cmd' : 'mvn'),'fake');
      return {stdout:'',stderr:''};
    }
    const path = process.platform === 'win32' ? args[3].match(/"([^"\r\n]*apache-maven-[^"\r\n]*[\\/]bin[\\/]mvn\.cmd)"/)?.[1] : command;
    if(!path) throw Error('missing executable');
    await fs.access(path);
    const installed = path.match(/apache-maven-(\d+\.\d+\.\d+)/)[1];
    return {stdout:`Apache Maven ${installed}`,stderr:''};
  });
  try {
    const first = await api.ensureMaven('',root,process.env,message=>messages.push(message));
    assert(first.includes('3.9.9'));
    assert.equal(await api.ensureMaven('mvn',root,process.env,()=>{}),first);
    assert.equal(downloads,1);
    version = '3.10.0'; corrupt = true;
    assert.equal(await api.ensureMaven('',root,process.env,message=>messages.push(message)),first);
    assert.equal(extracts,1);
    assert(messages.some(message=>message.includes('SHA-512')));
    corrupt = false;
    const updated = await api.ensureMaven('',root,process.env,()=>{});
    assert(updated.includes('3.10.0'));
    assert.equal(extracts,2);
    offline = true;
    assert.equal(await api.ensureMaven('',root,process.env,()=>{}),updated);
    assert.equal(await api.ensureMaven(updated,root,process.env,()=>{}),updated);
    await assert.rejects(api.ensureMaven(join(root,'missing','mvn'),root,process.env,()=>{}),/configured Maven/);
    assert(!(await fs.readdir(join(root,'tools','maven'))).some(name=>name.startsWith('.install-')));
  } finally {
    assert(relative(resolve(tmpdir()),root).startsWith('qv-maven-test-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});
test('fails clearly when offline without a cached installation', async()=>{
  const root = await fs.mkdtemp(join(tmpdir(),'qv-maven-test-'));
  try {
    const api = load(async()=>{throw Error('offline');});
    await assert.rejects(api.ensureMaven('',root,process.env,()=>{}),/offline/);
  } finally {
    assert(relative(resolve(tmpdir()),root).startsWith('qv-maven-test-'));
    await fs.rm(root,{recursive:true,force:true});
  }
});
