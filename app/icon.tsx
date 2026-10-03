import { ImageResponse } from "next/og";

export const contentType = "image/png";

export function generateImageMetadata() {
  return [192, 512].map((s) => ({
    id: String(s),
    size: { width: s, height: s },
    contentType: "image/png",
  }));
}

// Monogram stays inside the centre 60% so the same image is safe as a maskable icon.
export default async function Icon({ id }: { id: Promise<string | number> }) {
  const s = Number(await id);
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
        <div style={{ fontSize: s * 0.42, fontWeight: 700, lineHeight: 1 }}>T</div>
        <div style={{ width: s * 0.22, height: s * 0.035, marginTop: s * 0.03, background: "#22d3ee" }} />
      </div>
    ),
    { width: s, height: s },
  );
}
