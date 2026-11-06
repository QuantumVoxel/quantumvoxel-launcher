import { net } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const execute = promisify(execFile);
const repository = "https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven";
const stable = /^3\.(?:9|[1-9]\d+)\.\d+$/;
export function latestMaven(xml: string): string {
  const versions = [...xml.matchAll(/<version>\s*([^<]+)\s*<\/version>/g)].map(match => match[1].trim()).filter(version => stable.test(version));
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!versions[0]) throw new Error("Apache Maven metadata contains no supported stable release.");
  return versions[0];
}

export function mavenInvocation(executable: string, args: string[]) {
  if (process.platform !== "win32") return { command: executable, args, windowsVerbatimArguments: false };
  const values = [executable, ...args];
  if (values.some(value => /["\r\n&|<>^%!]/.test(value))) throw new Error("Maven paths contain unsupported shell characters.");
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${values.map(value => `"${value}"`).join(" ")}"`], windowsVerbatimArguments: true };
}

async function inspectMaven(executable: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const invocation = mavenInvocation(executable, ["--version"]);
    const { stdout, stderr } = await execute(invocation.command, invocation.args, { env, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments, timeout: 30000 });
    const version = (stdout + stderr).match(/Apache Maven (\d+\.\d+\.\d+)/)?.[1];
    return version && stable.test(version) ? version : undefined;
  } catch { return undefined; }
}

async function text(url: string): Promise<string> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(20000), headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Maven download failed: HTTP ${response.status}`);
  return response.text();
}

export async function ensureMaven(preferred: string, dataDirectory: string, env: NodeJS.ProcessEnv, report: (message: string) => void): Promise<string> {
  // Blank and the old default "mvn" select automatic management; explicit paths stay under user control.
  if (preferred.trim() && preferred.trim() !== "mvn") {
    const version = await inspectMaven(preferred, env);
    if (!version) throw new Error("The configured Maven executable could not run a stable Maven 3.9+ version. Clear it to install Maven automatically.");
    report(`Using configured Maven ${version}: ${preferred}`);
    return preferred;
  }
  const root = resolve(dataDirectory, "tools", "maven");
  await mkdir(root, { recursive: true });
  const executable = (base: string, version: string) => join(base, `apache-maven-${version}`, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn");
  const cached = async () => {
    const entries = (await readdir(root)).filter(name => stable.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of entries) {
      const path = executable(join(root, version), version);
      if (await inspectMaven(path, env) === version) return path;
    }
  };
  let version: string;
  report("Checking for Apache Maven updates…");
  try { version = latestMaven(await text(`${repository}/maven-metadata.xml`)); }
  catch (error) {
    const existing = await cached();
    if (existing) { report(`Maven update check failed; using cached installation: ${existing}`); return existing; }
    throw error;
  }
  const target = join(root, version);
  const ready = executable(target, version);
  if (await inspectMaven(ready, env) === version) { report(`Using Maven ${version}: ${ready}`); return ready; }
  const staging = await mkdtemp(join(root, ".install-"));
  try {
    const extension = process.platform === "win32" ? "zip" : "tar.gz";
    const url = `${repository}/${version}/apache-maven-${version}-bin.${extension}`;
    const checksum = (await text(`${url}.sha512`)).trim().split(/\s/)[0];
    if (!/^[a-f0-9]{128}$/i.test(checksum)) throw new Error("Invalid Apache Maven SHA-512 checksum.");
    report(`Downloading Apache Maven ${version}…`);
    const response = await net.fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`Maven download failed: HTTP ${response.status}`);
    const archive = join(staging, `maven.${extension}`);
    const reader = response.body.getReader();
    const file = await open(archive, "w");
    const hash = createHash("sha512");
    let bytes = 0;
    let lastProgress = Date.now();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        await file.writeFile(value);
        bytes += value.byteLength;
        if (Date.now() - lastProgress > 1000) { report(`Downloading Maven ${version}: ${Math.round(bytes / 1048576)} MiB`); lastProgress = Date.now(); }
      }
    } finally { await file.close(); reader.releaseLock(); }
    if (hash.digest("hex").toLowerCase() !== checksum.toLowerCase()) throw new Error("Apache Maven download failed SHA-512 verification.");
    report(`Installing Apache Maven ${version}…`);
    const extracted = join(staging, "extracted");
    await mkdir(extracted);
    if (process.platform === "win32") {
      await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:QV_MAVEN_ARCHIVE -DestinationPath $env:QV_MAVEN_DESTINATION"], { windowsHide: true, timeout: 120000, env: { ...env, QV_MAVEN_ARCHIVE: archive, QV_MAVEN_DESTINATION: extracted } });
    } else await execute("tar", ["-xzf", archive, "-C", extracted], { timeout: 120000 });
    if (await inspectMaven(executable(extracted, version), env) !== version) throw new Error("Downloaded Maven did not pass its version check.");
    // A broken directory from an earlier install is retained for diagnosis, never used as a fallback.
    try { await rename(target, join(root, `.broken-${version}-${Date.now()}`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rename(extracted, target);
    report(`Installed Apache Maven ${version}: ${ready}`);
    return ready;
  } catch (error) {
    const existing = await cached();
    if (existing) { report(`Maven update failed (${error instanceof Error ? error.message : String(error)}); using cached Maven: ${existing}`); return existing; }
    throw error;
  } finally {
    const withinRoot = relative(root, staging);
    if (withinRoot.startsWith(".install-") && !withinRoot.includes("..")) await rm(staging, { recursive: true, force: true });
  }
}
