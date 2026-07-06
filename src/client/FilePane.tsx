// biome-ignore-all lint: file content comes from the server wire shape.
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "Untitled";
}

function formatBytes(size?: number): string {
  if (typeof size !== "number" || !Number.isFinite(size)) return "unknown size";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} TB`;
}

function lineCount(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  return `${content.split("\n").length} lines`;
}

export function FilePane({ file }: { file: any }) {
  if (!file)
    return (
      <div className="file-pane empty-file-pane">
        <section className="file-empty-card">
          <div className="panel-title">File preview</div>
          <h2>Open a file from the sidebar</h2>
          <p>
            Select a workspace file to inspect text, images, or binary metadata.
          </p>
        </section>
      </div>
    );

  const title = baseName(file.path);
  const displayPath = file.path ? `./${file.path}` : "./";
  const kind = file.image ? "Image" : file.binary ? "Binary" : "Text";
  const details = [
    formatBytes(file.size),
    file.mimeType,
    lineCount(file.content),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="file-pane file-viewer">
      <header className="file-header">
        <div className="file-heading">
          <div className="panel-title">Workspace file</div>
          <h2>{title}</h2>
          <div className="file-path-full" title={displayPath}>
            {displayPath}
          </div>
        </div>
        <div className="file-badges">
          <span className="status-pill info">{kind}</span>
          <span className="state-badge muted">{formatBytes(file.size)}</span>
        </div>
      </header>

      <section className="file-preview-panel">
        <div className="file-preview-meta">{details}</div>
        {file.binary ? (
          <div className="file-binary-card">
            <div className="panel-title">Binary file</div>
            <p>
              Preview is disabled for this file type. The workspace file remains
              available from the sidebar.
            </p>
          </div>
        ) : file.image ? (
          <div className="file-image-frame">
            <img
              className="file-image"
              src={`data:${file.mimeType};base64,${file.content}`}
              alt={file.path}
            />
          </div>
        ) : (
          <pre className="file-code">{file.content}</pre>
        )}
      </section>
    </div>
  );
}
