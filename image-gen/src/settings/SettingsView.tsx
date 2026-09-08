import { useState } from "react";
import * as api from "../app/api";
import type { EffectiveSettings } from "../app/types";

interface SettingsViewProps {
  settings: EffectiveSettings;
  onSaved: (settings: EffectiveSettings) => void;
}

export function SettingsView({ settings, onSaved }: SettingsViewProps) {
  const [outputDir, setOutputDir] = useState(settings.stored.outputDir ?? "");
  const [codexPath, setCodexPath] = useState(settings.stored.codexPath ?? "");
  const [agyPath, setAgyPath] = useState(settings.stored.agyPath ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const save = () => {
    api
      .updateSettings({
        outputDir: outputDir.trim() || null,
        codexPath: codexPath.trim() || null,
        agyPath: agyPath.trim() || null,
      })
      .then((updated) => {
        onSaved(updated);
        setNotice("Saved. Output directory changes apply after restart.");
      })
      .catch((reason) => setNotice(String(reason)));
  };

  return (
    <div className="settings">
      <label className="settings-field">
        <span className="field-label">Output directory</span>
        <input
          type="text"
          value={outputDir}
          placeholder={settings.resolvedOutputDir}
          onChange={(event) => setOutputDir(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span className="field-label">codex executable path</span>
        <input
          type="text"
          value={codexPath}
          placeholder={settings.resolvedCodex ?? "not found — set an absolute path"}
          onChange={(event) => setCodexPath(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span className="field-label">agy executable path</span>
        <input
          type="text"
          value={agyPath}
          placeholder={settings.resolvedAgy ?? "not found — set an absolute path"}
          onChange={(event) => setAgyPath(event.target.value)}
        />
      </label>

      <div className="settings-actions">
        <button type="button" className="primary-button" onClick={save}>
          Save
        </button>
        {notice && <span className="settings-notice">{notice}</span>}
      </div>
    </div>
  );
}
