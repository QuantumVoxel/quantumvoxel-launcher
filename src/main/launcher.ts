import { app, BrowserWindow, dialog, ipcMain, net } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ClientVersion, LaunchOptions, LaunchState, ServerExportOptions, VersionResult } from "../shared/launcher";
import { ensureJava, javaEnvironment, requiredJava, requiredJavaArtifact } from "./javaRuntime";
import { ensureMaven, mavenInvocation } from "./mavenRuntime";
import { serverArgsFile, serverExportDirectoryName, serverLauncherScripts, serverPom, serverVmArgs, serverVmArgsFile } from "./serverExport";

const repositories = { releases: "https://maven.ultreon.dev/releases", snapshots: "https://maven.ultreon.dev/snapshots" };
let state: LaunchState = { phase: "idle", message: "Ready to play", log: "" };
let child: ChildProcess | undefined;
let available: ClientVersion[] = [];
let forceQuitRequested = false;

function gamePidFile(): string {
  return join(app.getPath("userData"), "game.pid");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function saveGamePid(pid: number): Promise<void> {
  await writeFile(gamePidFile(), String(pid), "utf8");
}

async function readGamePid(): Promise<number | undefined> {
  try {
    const pid = Number.parseInt((await readFile(gamePidFile(), "utf8")).trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function clearGamePid(): Promise<void> {
  await rm(gamePidFile(), { force: true });
}

async function createServerExportDirectory(parent: string, version: string): Promise<string> {
  const base = serverExportDirectoryName(version);
  for (let suffix = 1; ; suffix++) {
    const directory = join(parent, suffix === 1 ? base : `${base} (${suffix})`);
    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

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

export async function registerLauncher(getWindow: () => BrowserWindow): Promise<void> {
  const update = (patch: Partial<LaunchState>) => {
    state = { ...state, ...patch };
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send("launcher:state", state);
  };
  const log = (data: Buffer) => update({ log: (state.log + data.toString()).slice(-80000) });
  const logError = (data: Buffer) => update({ log: (state.log + '\x1b[31m' + data.toString() + '\x1b[0m').slice(-80000) });
  const savedPid = await readGamePid();
  if (savedPid && isProcessAlive(savedPid)) update({ phase: "running", message: "Game is still running from a previous launch.", pid: savedPid });
  ipcMain.handle("launcher:versions", versions);
  ipcMain.handle("launcher:state", () => state);
  ipcMain.handle("launcher:force-quit", async () => {
    const pids = new Set<number>();
    if (child?.pid) pids.add(child.pid);
    const pid = await readGamePid();
    if (pid) pids.add(pid);
    let forced = false;
    for (const processId of pids) {
      if (!isProcessAlive(processId)) continue;
      try {
        process.kill(processId, "SIGKILL");
        forced = true;
        forceQuitRequested = true;
      } catch {
        // The process exited between the check and the kill.
      }
    }
    return forced;
  });
  ipcMain.handle("launcher:launch", async (_event, options: LaunchOptions) => {
    forceQuitRequested = false;
    if (state.phase === "resolving" || state.phase === "running") throw new Error("A launch is already active.");
    if (!options || !available.some(v => v.version === options.version && v.channel === options.channel)) throw new Error("Refresh and select an available version.");
    if (!Number.isInteger(options.memory) || options.memory < 512 || options.memory > 32768) throw new Error("Memory must be between 512 and 32768 MiB.");
    if (typeof options.mavenPath === "string" && options.mavenPath.trim() && /["\r\n&|<>^%!]/.test(options.mavenPath)) throw new Error("Enter a valid executable path without shell special characters.");
    const savedPid = await readGamePid();
    const pid = savedPid && isProcessAlive(savedPid) ? savedPid : undefined;
    if (!pid) void clearGamePid();
    update({ phase: "resolving", message: "Resolving client and runtime dependencies…", log: "", pid });
    try {
      update({ message: "Checking Java requirement in module metadata…" });
      const major = await requiredJava(options.channel, options.version);
      const runtime = await ensureJava(major, "", app.getPath("userData"), message => {
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
        child.stderr?.on("data", logError);
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`Maven exited with code ${code}. Check the log and your Maven installation.`)));
      });
      const classpath = (await readFile(classpathFile, "utf8")).trim();
      if (!classpath) throw new Error("Maven produced an empty runtime classpath.");
      const javaArgs = [`-Xmx${options.memory}M`, ...(process.platform === "darwin" ? ["-XstartOnFirstThread"] : []), "-cp", classpath, "net.fabricmc.loader.impl.launch.knot.KnotClient"];
      const gameProcess = spawn(runtime.executable, javaArgs, { cwd: gameDirectory, windowsHide: true, env });
      child = gameProcess;
      if (gameProcess.pid) await saveGamePid(gameProcess.pid);
      gameProcess.stdout?.on("data", log);
      gameProcess.stderr?.on("data", logError);
      gameProcess.once("spawn", () => update({ phase: "running", message: `Playing ${options.version}`, pid: gameProcess.pid }));
      gameProcess.once("error", error => update({ phase: "error", message: `Could not start Java: ${error.message}` }));
      gameProcess.once("close", code => {
        child = undefined;
        void clearGamePid();
        if (state.phase !== "error") update({
          phase: forceQuitRequested ? "idle" : code === 0 ? "idle" : "error",
          message: forceQuitRequested ? "Game closed. Ready to play." : code === 0 ? "Game closed. Ready to play." : `Client exited with code ${code}. See the launch log.`,
          pid: undefined
        });
      });
    } catch (error) {
      child = undefined;
      update({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return state;
  });
  ipcMain.handle("launcher:export-server", async (_event, options: ServerExportOptions) => {
    if (state.phase === "resolving" || state.phase === "running") throw new Error("Wait for the current launch to finish before exporting a server.");
    if (!options || !available.some(v => v.version === options.version && v.channel === options.channel)) throw new Error("Refresh and select an available version.");
    if (!Number.isInteger(options.memory) || options.memory < 512 || options.memory > 32768) throw new Error("Memory must be between 512 and 32768 MiB.");
    if (typeof options.mavenPath !== "string") throw new Error("Enter a valid Maven executable path.");
    if (options.mavenPath.trim() && /["\r\n&|<>^%!]/.test(options.mavenPath)) throw new Error("Enter a valid executable path without shell special characters.");
    const selection = await dialog.showOpenDialog(getWindow(), { title: "Choose a location for the exported server launcher", properties: ["openDirectory"] });
    if (selection.canceled || !selection.filePaths[0]) return undefined;

    const userData = resolve(app.getPath("userData"));
    let staging: string | undefined;
    let destination: string | undefined;
    let completed = false;
    update({ phase: "resolving", message: "Preparing server launcher…", log: "" });
    try {
      update({ message: "Checking server Java requirement…" });
      const major = await requiredJavaArtifact(options.channel, "server", options.version);
      const runtime = await ensureJava(major, "", userData, message => {
        update({ message });
        log(Buffer.from(`${message}\n`));
      });
      const env = javaEnvironment(runtime.home);
      const mavenPath = await ensureMaven(options.mavenPath, userData, env, message => {
        update({ message });
        log(Buffer.from(`${message}\n`));
      });
      staging = await mkdtemp(join(userData, "server-export-"));
      const pom = join(staging, "pom.xml");
      const libraries = join(staging, "libraries");
      await writeFile(pom, serverPom(options.channel, options.version), "utf8");
      await mkdir(libraries);
      update({ message: "Resolving server and runtime dependencies…" });
      const args = ["-B", "-U", "-f", pom, "org.apache.maven.plugins:maven-dependency-plugin:3.8.1:copy-dependencies", "-DincludeScope=runtime", `-DoutputDirectory=${libraries}`];
      await new Promise<void>((resolvePromise, reject) => {
        const invocation = mavenInvocation(mavenPath, args);
        const mavenProcess = spawn(invocation.command, invocation.args, { windowsHide: true, env, windowsVerbatimArguments: invocation.windowsVerbatimArguments });
        mavenProcess.stdout?.on("data", log);
        mavenProcess.stderr?.on("data", logError);
        mavenProcess.once("error", reject);
        mavenProcess.once("close", code => code === 0 ? resolvePromise() : reject(new Error(`Maven exited with code ${code}. Check the log and your Maven installation.`)));
      });
      if (!(await readdir(libraries)).some(name => name === `server-${options.version}.jar`)) throw new Error("Maven did not copy the selected server JAR.");

      update({ message: "Assembling the portable server launcher…" });
      destination = await createServerExportDirectory(selection.filePaths[0], options.version);
      await cp(libraries, join(destination, "libraries"), { recursive: true });
      const scripts = serverLauncherScripts();
      await writeFile(join(destination, serverVmArgsFile), serverVmArgs(options.memory), "utf8");
      await writeFile(join(destination, serverArgsFile), "", "utf8");
      await writeFile(join(destination, "run-server.bat"), scripts.windows, "utf8");
      const unixScript = join(destination, "run-server.sh");
      await writeFile(unixScript, scripts.unix, "utf8");
      await chmod(unixScript, 0o755);
      await writeFile(join(destination, "README.txt"), `QuantumVoxel dedicated server ${options.version}\n\nRequires Java ${major} or newer available as java on PATH.\n\nWindows: run run-server.bat\nLinux/macOS: run sh run-server.sh\n\nJava VM arguments live in user_vmargs.txt (prefilled with the selected heap); program arguments in user_args.txt (for example nogui).\n`, "utf8");
      completed = true;
      update({ phase: "idle", message: `Server launcher exported to ${destination}` });
      return destination;
    } catch (error) {
      update({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (staging) {
        const withinUserData = relative(userData, staging);
        if (withinUserData.startsWith("server-export-") && !withinUserData.includes("..")) await rm(staging, { recursive: true, force: true });
      }
      if (destination && !completed) await rm(destination, { recursive: true, force: true });
    }
  });
}
