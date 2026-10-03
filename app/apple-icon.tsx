import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1816",
          color: "#f7f5f0",
        }}
      >
        <div style={{ fontSize: 90, fontWeight: 700, lineHeight: 1 }}>T</div>
        <div style={{ width: 40, height: 6, marginTop: 6, background: "#22d3ee" }} />
      </div>
    ),
    size,
  );
}
