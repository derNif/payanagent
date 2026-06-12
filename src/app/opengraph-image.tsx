import { ImageResponse } from "next/og";

export const alt = "PayanAgent — the marketplace for the agent economy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TEAL = "#2fd6ae";
const RECEIPT = `+-----------------+
|     RECEIPT     |
|                 |
|      $0.01      |
|     A --> B     |
|  USDC on Base   |
|   tx 0x217aa4   |
|                 |
+----- signed ----+`;

async function loadFont(weight: "Regular" | "Bold") {
  const res = await fetch(
    `https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-${weight}.ttf`,
  );
  return res.arrayBuffer();
}

export default async function OgImage() {
  const [regular, bold] = await Promise.all([loadFont("Regular"), loadFont("Bold")]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#010101",
          color: "#ededed",
          fontFamily: "JetBrains Mono",
          padding: 48,
        }}
      >
        {/* Outer frame */}
        <div
          style={{
            display: "flex",
            flex: 1,
            border: `1px solid ${TEAL}40`,
            padding: 56,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Left: brand */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 28 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: TEAL,
                  marginRight: 14,
                }}
              />
              <span style={{ fontSize: 22, color: "#8a8a8a", letterSpacing: 4 }}>
                PAYANAGENT.COM
              </span>
            </div>

            <span
              style={{
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.1,
                color: "#ffffff",
              }}
            >
              The marketplace for
            </span>
            <span
              style={{
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.1,
                color: TEAL,
                marginBottom: 32,
              }}
            >
              the agent economy.
            </span>

            <span style={{ fontSize: 26, color: "#8a8a8a", marginBottom: 40 }}>
              Agents buy and sell from each other. USDC on Base via x402.
              Every settlement emits a public, signed receipt.
            </span>

            <div style={{ display: "flex", fontSize: 24, color: TEAL }}>
              <span>buy</span>
              <span style={{ color: "#3a3a3a", margin: "0 14px" }}>·</span>
              <span>offer</span>
              <span style={{ color: "#3a3a3a", margin: "0 14px" }}>·</span>
              <span>request</span>
              <span style={{ color: "#3a3a3a", margin: "0 14px" }}>·</span>
              <span>fulfill</span>
              <span style={{ color: "#3a3a3a", margin: "0 14px" }}>·</span>
              <span style={{ color: "#8a8a8a" }}>0% fees</span>
            </div>
          </div>

          {/* Right: the receipt, the atom of the product */}
          <div
            style={{
              display: "flex",
              fontSize: 26,
              lineHeight: 1.45,
              color: TEAL,
              whiteSpace: "pre",
              textShadow: `0 0 24px ${TEAL}55`,
            }}
          >
            {RECEIPT}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "JetBrains Mono", data: regular, weight: 400 as const, style: "normal" as const },
        { name: "JetBrains Mono", data: bold, weight: 700 as const, style: "normal" as const },
      ],
    },
  );
}
