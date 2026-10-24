import { ImageResponse } from "next/og";

export const alt = "SwapChan: best swap route on every chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "linear-gradient(135deg,#2e1065,#4c1d95)",
        color: "white",
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 900, color: "#fcd34d" }}>SwapChan</div>
      <div style={{ fontSize: 48, fontWeight: 800, marginTop: 16 }}>Best route, every chain</div>
      <div style={{ fontSize: 30, marginTop: 24, color: "#ddd6fe" }}>
        0x · CoW · Velora · LI.FI · Across · Relay compared at once. Free MCP for agents.
      </div>
    </div>,
    size,
  );
}
