import { app, BrowserWindow, ipcMain, net } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClientVersion, LaunchOptions, LaunchState, VersionResult } from "../shared/launcher";
import { ensureJava, javaEnvironment, requiredJava } from "./javaRuntime";
import { ensureMaven, mavenInvocation } from "./mavenRuntime";

const repositories = { releases: "https://maven.ultreon.dev/releases", snapshots: "https://maven.ultreon.dev/snapshots" };
let state: LaunchState = { phase: "idle", message: "Ready to play", log: "" };
let child: ChildProcess | undefined;
let available: ClientVersion[] = [];

async function versions(): Promise<VersionResult> {
  const result: VersionResult = { versions: [], warnings: [] };
  await Promise.all(Object.entries(repositories).map(async ([channel, url]) => {
    try {
      const response = await net.fetch(`${url}/net/quantumvoxel/client/maven-metadata.xml`, { signal: AbortSignal.timeout(20000), headers: { "Cache-Control": "no-cache" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      for (const match of xml.matchAll(/<version>\s*([^<]+?)\s*<\/version>/g)) {
        if (/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(match[1])) result.versions.push({ version: match[1], channel: channel as ClientVersion["channel"] });
      }
    } catch (error) { result.warnings.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  result.versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }) || a.channel.localeCompare(b.channel));
  await Promise.all(result.versions.map(async version => {
    try { version.javaVersion = await requiredJava(version.channel, version.version); }
    catch (error) { version.javaError = error instanceof Error ? error.message : String(error); }
  }));
  available = result.versions;
  return result;
}

export function registerLauncher(getWindow: () => BrowserWindow): void {
  const update = (patch: Partial<LaunchState>) => {
    state = { ...state, ...patch };
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("launcher:state", state);
  };
  const log = (data: Buffer) => update({ log: (state.log + data.toString()).slice(-80000) });
  ipcMain.handle("launcher:versions", versions);
  ipcMain.handle("launcher:state", () => state);
  ipcMain.handle("launcher:launch", async (_event, options: LaunchOptions) => {
    if (state.phase === "resolving" || state.phase === "running") throw new Error("A launch is already active.");
    if (!options || !available.some(v => v.version === options.version && v.channel === options.channel)) throw new Error("Refresh and select an available version.");
    if (!Number.isInteger(options.memory) || options.memory < 512 || options.memory > 32768) throw new Error("Memory must be between 512 and 32768 MiB.");
    for (const path of [options.javaPath || "java", options.mavenPath || "mvn"]) {
      if (typeof path !== "string" || !path.trim() || /["\r\n&|<>^%!]/.test(path)) throw new Error("Enter a valid executable path without shell special characters.");
    }
    update({ phase: "resolving", message: "Resolving client and runtime dependencies…", log: "" });
    try {
      update({ message: "Checking Java requirement in module metadata…" });
      const major = await requiredJava(options.channel, options.version);
      const runtime = await ensureJava(major, options.javaPath, app.getPath("userData"), message => {
        update({ message });
        log(Buffer.from(`${message}\n`));
      });
      const env = javaEnvironment(runtime.home);
      const mavenPath = await ensureMaven(options.mavenPath, app.getPath("userData"), env, message => {
        update({ message });
        log(Buffer.from(`${message}\n`));
      });
      update({ message: "Resolving client and runtime dependencies…" });
      const directory = join(app.getPath("userData"), "clients", options.channel, options.version);
      const gameDirectory = join(app.getPath("userData"), "game");
      await mkdir(directory, { recursive: true });
      await mkdir(gameDirectory, { recursive: true });
      const pom = join(directory, "pom.xml");
      const classpathFile = join(directory, "classpath.txt");
      const isSnapshot = options.channel === "snapshots";
      await writeFile(pom, `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>net.quantumvoxel.launcher</groupId><artifactId>runtime</artifactId><version>1</version><repositories>${[options.channel, options.channel === "releases" ? "snapshots" : "releases"].map(channel => `<repository><id>ultreon-${channel}</id><url>${repositories[channel as keyof typeof repositories]}</url><releases><enabled>true</enabled>${isSnapshot ? "<updatePolicy>always</updatePolicy>" : ""}</releases><snapshots><enabled>true</enabled><updatePolicy>always</updatePolicy></snapshots></repository>`).join("")}<repository><id>fabric</id><url>https://maven.fabricmc.net/</url></repository><repository><id>jitpack</id><url>https://jitpack.io</url></repository></repositories><dependencies><dependency><groupId>net.quantumvoxel</groupId><artifactId>client</artifactId><version>${options.version}</version></dependency></dependencies></project>`);
      const args = ["-B", "-U", "-f", pom, "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:build-classpath", "-DincludeScope=runtime", `-Dmdep.outputFile=${classpathFile}`];
      await new Promise<void>((resolve, reject) => {
        const invocation = mavenInvocation(mavenPath, args);
        child = spawn(invocation.command, invocation.args, { windowsHide: true, env, windowsVerbatimArguments: invocation.windowsVerbatimArguments });
        child.stdout?.on("data", log);
        child.stderr?.on("data", log);
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`Maven exited with code ${code}. Check the log and your Maven installation.`)));
      });
      const classpath = (await readFile(classpathFile, "utf8")).trim();
      if (!classpath) throw new Error("Maven produced an empty runtime classpath.");
      const javaArgs = [`-Xmx${options.memory}M`, ...(process.platform === "darwin" ? ["-XstartOnFirstThread"] : []), "-cp", classpath, "net.fabricmc.loader.impl.launch.knot.KnotClient"];
      child = spawn(runtime.executable, javaArgs, { cwd: gameDirectory, windowsHide: true, env });
      child.stdout?.on("data", log);
      child.stderr?.on("data", log);
      child.once("spawn", () => update({ phase: "running", message: `Playing ${options.version}` }));
      child.once("error", error => update({ phase: "error", message: `Could not start Java: ${error.message}` }));
      child.once("close", code => {
        child = undefined;
        if (state.phase !== "error") update({ phase: code === 0 ? "idle" : "error", message: code === 0 ? "Game closed. Ready to play." : `Client exited with code ${code}. See the launch log.` });
      });
    } catch (error) {
      child = undefined;
      update({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return state;
  });
}
