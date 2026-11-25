import type { Channel } from "../shared/launcher";

export const serverMainClass = "net.fabricmc.loader.impl.launch.knot.KnotServer";
export const serverVmArgsFile = "user_vmargs.txt";
export const serverArgsFile = "user_args.txt";

export function serverVmArgs(memory: number): string {
  if (!Number.isInteger(memory) || memory < 512 || memory > 32768) throw new Error("Memory must be between 512 and 32768 MiB.");
  return `-Xmx${memory}M\n`;
}

export function serverLauncherScripts(): { windows: string; unix: string } {
  return {
    windows: `@echo off\r\ncd /d "%~dp0"\r\nsetlocal EnableDelayedExpansion\r\nset "VMARGS="\r\nif exist user_vmargs.txt for /f "usebackq delims=" %%a in ("user_vmargs.txt") do set "VMARGS=!VMARGS!%%a "\r\nset "PROGARGS="\r\nif exist user_args.txt for /f "usebackq delims=" %%a in ("user_args.txt") do set "PROGARGS=!PROGARGS!%%a "\r\njava !VMARGS!-cp libraries/* ${serverMainClass} !PROGARGS!%*\r\n`,
    unix: `#!/bin/sh\ncd "$(dirname "$0")"\nvmargs=$(cat user_vmargs.txt 2>/dev/null)\nprogargs=$(cat user_args.txt 2>/dev/null)\nexec java $vmargs -cp "libraries/*" ${serverMainClass} $progargs "$@"\n`
  };
}

export function serverPom(channel: Channel, version: string): string {
  if (channel !== "releases" && channel !== "snapshots") throw new Error("Invalid server repository channel.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version)) throw new Error("Invalid server version.");
  const repositories = { releases: "https://maven.ultreon.dev/releases", snapshots: "https://maven.ultreon.dev/snapshots" };
  const isSnapshot = channel === "snapshots";
  const order: Channel[] = [channel, isSnapshot ? "releases" : "snapshots"];
  return `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>net.quantumvoxel.launcher</groupId><artifactId>server-export</artifactId><version>1</version><repositories>${order.map(repository => `<repository><id>ultreon-${repository}</id><url>${repositories[repository]}</url><releases><enabled>true</enabled>${isSnapshot ? "<updatePolicy>always</updatePolicy>" : ""}</releases><snapshots><enabled>true</enabled><updatePolicy>always</updatePolicy></snapshots></repository>`).join("")}<repository><id>fabric</id><url>https://maven.fabricmc.net/</url></repository><repository><id>jitpack</id><url>https://jitpack.io</url></repository></repositories><dependencies><dependency><groupId>net.quantumvoxel</groupId><artifactId>server</artifactId><version>${version}</version></dependency></dependencies></project>`;
}

export function serverExportDirectoryName(version: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(version)) throw new Error("Invalid server version.");
  return `QuantumVoxel Server ${version}`;
}