export type Channel = "releases" | "snapshots";
export interface ClientVersion { version: string; channel: Channel; javaVersion?: number; javaError?: string }
export interface LaunchOptions extends ClientVersion { javaPath: string; mavenPath: string; memory: number }
export interface LaunchState { phase: "idle" | "resolving" | "running" | "error"; message: string; log: string }
export interface VersionResult { versions: ClientVersion[]; warnings: string[] }
