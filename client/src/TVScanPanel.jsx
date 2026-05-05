import { useRef } from "react";

function TVScanPanel({
  imagePreview,
  croppedPreview,
  ocrText,
  parsedGame,
  scanStatus,
  onFileChange,
  runOcrScan
}) {
  const fileInputRef = useRef(null);

  return (
    <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid #444" }}>
      <h2>TV Recognition Prototype</h2>

      <div style={{ marginBottom: "1rem" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ marginRight: "1rem" }}
        >
          Upload Screenshot
        </button>

        <button onClick={runOcrScan} disabled={!imagePreview}>
          Scan Scoreboard
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Scan Status:</strong> {scanStatus}
      </div>

      {imagePreview && (
        <div style={{ marginBottom: "1rem" }}>
          <strong>Preview:</strong>
          <div style={{ marginTop: "0.5rem" }}>
            <img
              src={imagePreview}
              alt="TV screenshot preview"
              style={{ maxWidth: "100%", maxHeight: "400px", border: "1px solid #666" }}
            />
          </div>
        </div>
      )}

      {croppedPreview && (
        <div style={{ marginBottom: "1rem" }}>
            <strong>Processed Scoreboard Crop:</strong>
            <div style={{ marginTop: "0.5rem" }}>
            <img
                src={croppedPreview}
                alt="Processed scoreboard crop"
                style={{ maxWidth: "100%", border: "1px solid #666" }}
            />
            </div>
        </div>
        )}

      <div>
        <strong>Raw OCR Text:</strong>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#111",
            padding: "1rem",
            border: "1px solid #444",
            minHeight: "120px"
          }}
        >
          {ocrText || "No OCR output yet."}
        </pre>
      </div>
      {parsedGame && (
        <div style={{ marginTop: "1rem" }}>
            <strong>Parsed Game Data:</strong>
            <div style={{ marginTop: "0.5rem", lineHeight: "1.6" }}>
            <div>Team 1: {parsedGame.team1 || "-"}</div>
            <div>Score 1: {parsedGame.score1 || "-"}</div>
            <div>Team 2: {parsedGame.team2 || "-"}</div>
            <div>Score 2: {parsedGame.score2 || "-"}</div>
            <div>Quarter: {parsedGame.quarter || "-"}</div>
            <div>Clock: {parsedGame.clock || "-"}</div>
            </div>
        </div>
        )}
    </div>
  );
}

export default TVScanPanel;