import { net } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { delimiter, join, relative, resolve } from "node:path";

const execute = promisify(execFile);
const repositories = { releases: "https://maven.ultreon.dev/releases", snapshots: "https://maven.ultreon.dev/snapshots" };

export function javaRequirement(metadata: unknown): number {
  const variants = (metadata as { variants?: { attributes?: Record<string, unknown> }[] })?.variants;
  if (!Array.isArray(variants)) throw new Error("Module metadata has no variants.");
  const libraries = variants.filter(v => v.attributes?.["org.gradle.category"] !== "documentation");
  const runtime = libraries.filter(v => v.attributes?.["org.gradle.usage"] === "java-runtime");
  const requirements = (runtime.length ? runtime : libraries).map(v => v.attributes?.["org.gradle.jvm.version"]);
  if (!requirements.length || requirements.some(v => !Number.isInteger(v) || Number(v) < 8 || Number(v) > 100)) {
    throw new Error("Module metadata does not declare a valid Java requirement.");
  }
  return Math.max(...requirements.map(Number));
}

async function fetchText(url: string): Promise<string> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(30000), headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Could not read ${url}: HTTP ${response.status}`);
  return response.text();
}

export async function requiredJava(channel: keyof typeof repositories, version: string): Promise<number> {
  const base = `${repositories[channel]}/net/quantumvoxel/client/${version}`;
  let publishedVersion = version;
  if (version.endsWith("-SNAPSHOT")) {
    const xml = await fetchText(`${base}/maven-metadata.xml`);
    const module = [...xml.matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)]
      .map(match => match[1]).find(entry => /<extension>\s*module\s*<\/extension>/.test(entry) && !/<classifier>\s*\S/.test(entry));
    const value = module?.match(/<value>\s*([^<]+)\s*<\/value>/)?.[1]?.trim();
    const timestamp = xml.match(/<timestamp>\s*([^<]+)\s*<\/timestamp>/)?.[1]?.trim();
    const build = xml.match(/<buildNumber>\s*(\d+)\s*<\/buildNumber>/)?.[1];
    publishedVersion = value || (timestamp && build ? version.replace(/SNAPSHOT$/, `${timestamp}-${build}`) : version);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(publishedVersion)) throw new Error("Invalid snapshot module version.");
  }
  return javaRequirement(JSON.parse(await fetchText(`${base}/client-${publishedVersion}.module`)));
}

export function parseJavaVersion(output: string): number | undefined {
  const value = output.match(/(?:java\.version\s*=\s*|(?:openjdk|java) version ")(\d+)(?:\.(\d+))?/);
  return value ? Number(value[1] === "1" ? value[2] : value[1]) : undefined;
}

export async function inspectJava(executable: string): Promise<{ executable: string; home: string; major: number } | undefined> {
  try {
    const { stdout, stderr } = await execute(executable, ["-XshowSettings:properties", "-version"], { windowsHide: true, timeout: 15000 });
    const output = stdout + stderr;
    const major = parseJavaVersion(output);
    const home = output.match(/java\.home\s*=\s*(.+)/)?.[1]?.trim();
    if (major && home) return { executable: join(home, "bin", process.platform === "win32" ? "java.exe" : "java"), home, major };
  } catch { /* Missing or unusable Java: try a managed runtime. */ }
}

async function findJava(directory: string): Promise<string | undefined> {
  const executable = join(directory, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (await inspectJava(executable)) return executable;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const candidates = [join(directory, entry.name), ...(process.platform === "darwin" ? [join(directory, entry.name, "Contents", "Home")] : [])];
      for (const candidate of candidates) {
        const path = join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
        if (await inspectJava(path)) return path;
      }
    }
  }
}

export async function ensureJava(required: number, preferred: string, dataDirectory: string, report: (message: string) => void) {
  const installed = await inspectJava(preferred || "java");
  if (installed && installed.major >= required) {
    report(`Using Java ${installed.major} (module requires Java ${required}): ${installed.executable}`);
    return installed;
  }
  const os = { win32: "windows", darwin: "mac", linux: "linux" }[process.platform as "win32" | "darwin" | "linux"];
  const arch = { x64: "x64", arm64: "aarch64", ia32: "x86", arm: "arm" }[process.arch as "x64" | "arm64" | "ia32" | "arm"];
  if (!os || !arch) throw new Error(`Automatic Temurin installation is unavailable on ${process.platform}/${process.arch}. Configure a Java ${required}+ executable.`);
  const root = resolve(dataDirectory, "runtimes");
  const target = join(root, `temurin-${required}-${os}-${arch}`);
  await mkdir(target, { recursive: true });
  const cached = await findJava(target);
  if (cached) {
    const runtime = await inspectJava(cached);
    if (runtime && runtime.major >= required) { report(`Using cached Temurin ${runtime.major}: ${runtime.executable}`); return runtime; }
  }
  report(`Java ${required}+ is needed. Finding Eclipse Temurin ${required}…`);
  const assets = JSON.parse(await fetchText(`https://api.adoptium.net/v3/assets/latest/${required}/hotspot?architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`));
  const pkg = assets[0]?.binary?.package;
  if (typeof pkg?.link !== "string" || !pkg.link.startsWith("https://") || !/^[a-f0-9]{64}$/i.test(pkg.checksum)) throw new Error(`No verified Temurin ${required} JDK is available for ${os}/${arch}.`);
  const staging = await mkdtemp(join(root, ".install-"));
  try {
    const archive = join(staging, os === "windows" ? "jdk.zip" : "jdk.tar.gz");
    const extracted = join(staging, "extracted");
    await mkdir(extracted);
    report(`Downloading Temurin ${required}…`);
    const response = await net.fetch(pkg.link, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`Temurin download failed: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const file = await open(archive, "w");
    const hash = createHash("sha256");
    let received = 0;
    let lastProgress = Date.now();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        await file.writeFile(value);
        received += value.byteLength;
        if (Date.now() - lastProgress > 1000) {
          report(`Downloading Temurin ${required}: ${Math.round(received / 1048576)} MiB${pkg.size ? ` / ${Math.round(pkg.size / 1048576)} MiB` : ""}`);
          lastProgress = Date.now();
        }
      }
    } finally { await file.close(); reader.releaseLock(); }
    if (hash.digest("hex").toLowerCase() !== pkg.checksum.toLowerCase()) throw new Error("Temurin download failed SHA-256 verification. Please retry.");
    report(`Installing Temurin ${required}…`);
    if (os === "windows") {
      await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:QV_JDK_ARCHIVE -DestinationPath $env:QV_JDK_DESTINATION"], {
        windowsHide: true, timeout: 180000, env: { ...process.env, QV_JDK_ARCHIVE: archive, QV_JDK_DESTINATION: extracted }
      });
    } else await execute("tar", ["-xzf", archive, "-C", extracted], { timeout: 180000 });
    const java = await findJava(extracted);
    const runtime = java && await inspectJava(java);
    if (!runtime || runtime.major !== required) throw new Error("Downloaded Temurin JDK did not pass its Java version check.");
    // Publish only a verified JDK; interrupted downloads never become installed runtimes.
    await rename(runtime.home, join(target, `jdk-${Date.now()}`));
    const finalJava = await findJava(target);
    const result = finalJava && await inspectJava(finalJava);
    if (!result) throw new Error("Installed Temurin JDK could not be started.");
    report(`Installed Temurin ${required}: ${result.executable}`);
    return result;
  } finally {
    const withinRoot = relative(root, staging);
    if (withinRoot.startsWith(".install-") && !withinRoot.includes("..")) await rm(staging, { recursive: true, force: true });
  }
}

export function javaEnvironment(home: string): NodeJS.ProcessEnv {
  // Windows treats environment names case-insensitively; avoid duplicate Path/PATH entries.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "java_home"].includes(key.toLowerCase())));
  return { ...env, JAVA_HOME: home, PATH: `${join(home, "bin")}${delimiter}${process.env.PATH || process.env.Path || ""}` };
}
