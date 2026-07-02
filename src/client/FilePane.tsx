// biome-ignore-all lint: file content comes from the server wire shape.
export function FilePane({ file }: { file: any }) {
  if (!file) return <div className="empty">Open a file from the sidebar.</div>;
  if (file.binary)
    return (
      <div className="empty">
        Binary file: {file.path} ({file.size} bytes)
      </div>
    );
  return (
    <div className="file-pane">
      <div className="file-title">{file.path}</div>
      {file.image ? (
        <img
          className="file-image"
          src={`data:${file.mimeType};base64,${file.content}`}
          alt={file.path}
        />
      ) : (
        <pre>{file.content}</pre>
      )}
    </div>
  );
}
