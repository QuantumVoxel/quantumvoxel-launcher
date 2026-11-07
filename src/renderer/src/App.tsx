import {useEffect, useState, useMemo} from "react";
import {FaCube, FaPlay, FaSyncAlt} from "react-icons/fa";
import {TitleBar} from "./components/TitleBar";
import {Combobox} from "./components/Combobox";
import type {ClientVersion, LaunchState} from "../../shared/launcher";
import {parseANSI, stylesToCSS} from "./ansi";
import "./App.css";
import "./launcher.css";

function renderANSILog(log: string) {
  const segments = parseANSI(log);
  if (segments.length === 0) return null;
  return segments.map((segment, i) => {
    const style = stylesToCSS(segment.styles);
    return <span key={i} style={style}>{segment.text}</span>;
  });
}

export function App() {
  const [versions, setVersions] = useState<ClientVersion[]>([]);
  const [channel, setChannel] = useState("releases");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [state, setState] = useState<LaunchState>({phase: "idle", message: "Ready to play", log: ""});
  const [javaPath, setJavaPath] = useState(() => localStorage.getItem("launcher.java") || "java");
  const [mavenPath, setMavenPath] = useState(() => localStorage.getItem("launcher.maven") || "");
  const [memory, setMemory] = useState(() => Number(localStorage.getItem("launcher.memory")) || 4096);
  const [maximized, setMaximized] = useState(false);
  const busy = state.phase === "resolving" || state.phase === "running";
  const filtered = versions.filter(version => version.channel === channel);
  const selectedVersion = versions.find(v => v.version === selected);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await window.electronAPI.getClientVersions();
      setVersions(result.versions);
      setWarnings(result.warnings);
      setSelected(previous => result.versions.some(v => v.version === previous) ? previous : result.versions.length ? result.versions[0].version : "");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void window.electronAPI.getLaunchState().then(setState).catch(reason => setError(String(reason)));
    void window.electronAPI.isMaximized().then(setMaximized);
    const offWindow = window.electronAPI.onWindowState(setMaximized);
    const offLaunch = window.electronAPI.onLaunchState(setState);
    return () => {
      offLaunch();
      offWindow();
    };
  }, []);
  useEffect(() => {
    if (!filtered.some(v => v.version === selected)) setSelected(filtered[0] ? filtered[0].version : "");
  }, [channel, versions, selected]);

  async function launch() {
    const version = versions.find(v => v.version === selected);
    if (!version) return;
    setError("");
    setState({phase: "resolving", message: "Preparing launch…", log: ""});
    localStorage.setItem("launcher.java", javaPath);
    localStorage.setItem("launcher.maven", mavenPath);
    localStorage.setItem("launcher.memory", String(memory));
    try {
      await window.electronAPI.launchClient({...version, javaPath, mavenPath, memory});
    } catch (reason) {
      setError(String(reason));
      setState(previous => ({...previous, phase: "error", message: "Launch failed"}));
    }
  }

  return <div className={`app${maximized ? " maximized" : ""}`}>
    <TitleBar actions={<span className="launcher-brand"><FaCube/> QuantumVoxel Launcher</span>}/>
    <main className="launcher">
      <section className="launcher-hero">

      </section>
      <section className="launch-card" aria-label="Client launcher">
        <div className="card-heading">
          <div>
            <span className="eyebrow">PLAY QUANTUMVOXEL</span>
            <h2>Select your version</h2>
          </div>
          <button className="refresh" onClick={refresh} disabled={loading || busy} aria-label="Refresh versions">
            <FaSyncAlt className={loading ? "spinning" : ""}/></button>
        </div>
        <div className="channel-tabs" role="group" aria-label="Repository">{["releases", "snapshots"].map(value =>
          <button key={value} aria-pressed={channel === value} disabled={busy}
                  onClick={() => setChannel(value)}>{value === "releases" ? "Releases" : "Snapshots"}</button>)}</div>
        <label className="field">Client version
          <Combobox
            disabled={loading || busy}
            value={selected}
            onChange={setSelected}
            placeholder={loading ? "Loading versions…" : filtered.length ? "Select a version" : "No versions available"}
            options={filtered.map(v => ({
              value: v.version,
              label: v.version,
            }))}
            className="version-selector"
            editable={false}
          />
        </label>
        <p className="repository">maven.ultreon.dev/{channel}</p>
        {selectedVersion && <p
          className="runtime-help">{selectedVersion.javaVersion ? `Requires Java ${selectedVersion.javaVersion} · Temurin installs automatically if needed.` : "Java requirement unavailable. Launch will retry module metadata."}</p>}
        {channel === "snapshots" &&
          <p className="snapshot-note">Development builds may contain game breaking bugs.</p>}
        <details>
          <summary>Runtime settings</summary>
          <p className="runtime-help">Java requirements come from the selected version. A compatible runtime is detected
            or Eclipse Temurin is downloaded automatically. Apache Maven is downloaded automatically and checked for
            updates at launch.</p><label className="field">Preferred Java executable (optional)<input disabled={busy}
                                                                                                      value={javaPath}
                                                                                                      onChange={e => setJavaPath(e.target.value)}
                                                                                                      placeholder="Automatic"/></label><label
          className="field">Maven executable override (optional)<input disabled={busy} value={mavenPath}
                                                                       onChange={e => setMavenPath(e.target.value)}
                                                                       placeholder="Automatic (latest stable Maven 3)"/></label><label
          className="field">Maximum memory (MiB)<input disabled={busy} type="number" min="512" max="32768" step="512"
                                                       value={memory}
                                                       onChange={e => setMemory(Number(e.target.value))}/></label>
        </details>
        <button className="play-button" disabled={busy || loading || !selected} onClick={launch}>
          <FaPlay/>{state.phase === "resolving" ? "Preparing client…" : state.phase === "running" ? "Client running" : "Launch client"}
        </button>
        <p className={`launch-status ${state.phase}`} role="status">{state.message}</p>
        {error && <p className="launch-error" role="alert">{error}</p>}
        {warnings.length > 0 &&
          <div className="repository-warnings">{warnings.map(w => <p key={w}>Repository unavailable — {w}</p>)}</div>}
      </section>
    </main>
    <details className="launch-log" open={state.phase === "error"}>
      <summary>Launch log</summary>
      <pre aria-label="Launch output">
        {state.log ? renderANSILog(state.log) : "Client and dependency output will appear here."}
      </pre>
    </details>
  </div>;
}


