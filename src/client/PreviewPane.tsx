import { useState } from "react";
import { COMPOSER_ATTACH_IMAGE_EVENT } from "./composerIntents";
import { previewUrlAllowed } from "./previewUrl";

function attachImage(image: {
  data: string;
  mimeType: string;
  previewUrl: string;
}) {
  window.dispatchEvent(
    new CustomEvent(COMPOSER_ATTACH_IMAGE_EVENT, { detail: image }),
  );
}

export function PreviewPane({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [input, setInput] = useState("http://127.0.0.1:30142");
  const [url, setUrl] = useState("http://127.0.0.1:30142");
  const [confirmed, setConfirmed] = useState(false);

  function open() {
    if (!previewUrlAllowed(input, confirmed)) {
      if (!confirm("This URL is not localhost. Load it anyway?")) return;
      setConfirmed(true);
    }
    setUrl(input);
  }

  async function screenshot() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    const dataUrl = canvas.toDataURL("image/png");
    attachImage({
      data: dataUrl.split(",")[1] ?? "",
      mimeType: "image/png",
      previewUrl: dataUrl,
    });
    onNotice("Screenshot attached to chat draft");
  }

  return (
    <div className="tool-pane preview-pane">
      <section className="panel">
        <div className="section-head">
          <div>
            <div className="panel-title">Browser preview</div>
            <h2>Local app preview + screenshot</h2>
            <p>Localhost loads directly; external URLs ask first.</p>
          </div>
          <div className="hero-actions">
            <input
              className="input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="button" onClick={open}>
              Load
            </button>
            <button
              type="button"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              Open external
            </button>
            <button type="button" onClick={() => void screenshot()}>
              Attach screenshot
            </button>
          </div>
        </div>
      </section>
      <iframe className="preview-frame" src={url} title="Preview" />
    </div>
  );
}
