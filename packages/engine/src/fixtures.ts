import type { DesignDocument } from "@adengine/core";

/*
 * Built-in sample designs. They exist so the design model, renderer and the
 * later engines can be exercised without a Figma file. Their artwork is simple
 * SVG drawn here; nothing is fetched from elsewhere.
 */

export interface Fixture {
  name: string;
  title: string;
  description: string;
  /** Asset file name → SVG source. Referenced from the document as `{{asset:<file>}}`. */
  assets: Record<string, string>;
  document: DesignDocument;
}

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const SHOE = svg(
  320,
  200,
  `<defs><linearGradient id="u" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a3d"/><stop offset="1" stop-color="#e2452b"/></linearGradient></defs>
  <ellipse cx="160" cy="182" rx="140" ry="10" fill="#000" opacity=".25"/>
  <path d="M28 150c0-8 4-18 14-22l52-20 38-58c6-9 18-11 26-4l14 12c6 5 8 13 12 20 12 20 38 30 74 36 24 4 36 16 36 30v6H28z" fill="url(#u)"/>
  <path d="M28 150h266v8c0 8-6 14-14 14H42c-8 0-14-6-14-14z" fill="#f4f1ea"/>
  <path d="M52 172l-6 10h22l4-10zm46 0l-6 10h22l4-10zm46 0l-6 10h22l4-10zm46 0l-6 10h22l4-10zm46 0l-6 10h22l4-10z" fill="#1c2b26"/>
  <path d="M132 62l40 34M118 82l44 28M104 100l46 22" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M196 116c20 10 46 16 78 18" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".55"/>`,
);

const PEAK_LOGO = svg(
  156,
  28,
  `<path d="M2 24L14 4l7 11 4-6 9 15z" fill="#f4f1ea"/>
  <text x="42" y="20" font-family="Inter, Helvetica, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.5" fill="#f4f1ea">NORTHPEAK</text>`,
);

const MOUNTAINS = svg(
  300,
  250,
  `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16382f"/><stop offset="1" stop-color="#0c1f1a"/></linearGradient></defs>
  <rect width="300" height="250" fill="url(#s)"/>
  <circle cx="236" cy="58" r="26" fill="#ffb347" opacity=".9"/>
  <path d="M0 190l56-70 38 44 46-78 62 92 40-40 58 62v50H0z" fill="#1f4a3e"/>
  <path d="M0 220l70-52 54 40 62-58 114 84v16H0z" fill="#12302a"/>`,
);

const CUP = svg(
  90,
  90,
  `<circle cx="45" cy="45" r="43" fill="#f3e3cf"/>
  <path d="M24 38h36v18a16 16 0 0 1-16 16h-4a16 16 0 0 1-16-16z" fill="#5a2f1a"/>
  <path d="M60 42h5a8 8 0 0 1 0 16h-5" fill="none" stroke="#5a2f1a" stroke-width="5"/>
  <path d="M34 30c-3-5 3-7 0-12M44 30c-3-5 3-7 0-12M54 30c-3-5 3-7 0-12" fill="none" stroke="#b9805a" stroke-width="3" stroke-linecap="round"/>`,
);

const ROAST_LOGO = svg(
  96,
  24,
  `<circle cx="12" cy="12" r="10" fill="#5a2f1a"/><path d="M8 6c8 3 0 9 8 12" stroke="#f8efe4" stroke-width="2" fill="none"/>
  <text x="28" y="17" font-family="Inter, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#5a2f1a">Daybreak</text>`,
);

export const FIXTURES: Fixture[] = [
  {
    name: "trail-shoe-300x250",
    title: "Trail shoe · 300×250",
    description: "Medium rectangle with a background scene, logo, headline, subheadline, product and CTA button.",
    assets: { "mountains.svg": MOUNTAINS, "shoe.svg": SHOE, "logo.svg": PEAK_LOGO },
    document: {
      schemaVersion: 1,
      width: 300,
      height: 250,
      background: { type: "solid", color: "#0c1f1a" },
      layers: [
        { id: "background", type: "image", name: "Background scene", role: "background", x: 0, y: 0, width: 300, height: 250, rotation: 0, opacity: 1, visible: true, assetKey: "{{asset:mountains.svg}}", fit: "cover", focus: { x: 0.5, y: 0.6 }, cornerRadius: 0 },
        { id: "logo", type: "image", name: "Logo", role: "logo", x: 16, y: 14, width: 134, height: 24, rotation: 0, opacity: 1, visible: true, assetKey: "{{asset:logo.svg}}", fit: "contain", cornerRadius: 0 },
        { id: "headline", type: "text", name: "Headline", role: "headline", x: 16, y: 52, width: 190, height: 62, rotation: 0, opacity: 1, visible: true, text: "Grip every\ntrail.", style: { fontFamily: "Inter", fontWeight: 800, fontSize: 28, lineHeight: 1.08, letterSpacing: -0.5, color: "#f4f1ea", align: "left", verticalAlign: "top", italic: false, transform: "none" } },
        { id: "subheadline", type: "text", name: "Subheadline", role: "subheadline", x: 16, y: 118, width: 150, height: 34, rotation: 0, opacity: 1, visible: true, text: "The new Ridge 2, built for wet rock and loose ground.", style: { fontFamily: "Inter", fontWeight: 400, fontSize: 11, lineHeight: 1.4, letterSpacing: 0, color: "#c9d6cf", align: "left", verticalAlign: "top", italic: false, transform: "none" } },
        { id: "product", type: "image", name: "Product", role: "product", x: 128, y: 128, width: 172, height: 108, rotation: 0, opacity: 1, visible: true, assetKey: "{{asset:shoe.svg}}", fit: "contain", cornerRadius: 0 },
        {
          id: "cta", type: "group", name: "CTA", role: "cta", x: 16, y: 198, width: 104, height: 34, rotation: 0, opacity: 1, visible: true, clip: false, cornerRadius: 0,
          children: [
            { id: "cta-background", type: "shape", name: "CTA background", shape: "rectangle", x: 0, y: 0, width: 104, height: 34, rotation: 0, opacity: 1, visible: true, fill: { type: "solid", color: "#ff7a3d" }, cornerRadius: 17 },
            { id: "cta-label", type: "text", name: "CTA label", x: 0, y: 0, width: 104, height: 34, rotation: 0, opacity: 1, visible: true, text: "Shop now", style: { fontFamily: "Inter", fontWeight: 700, fontSize: 13, letterSpacing: 0, color: "#0c1f1a", align: "center", verticalAlign: "middle", italic: false, transform: "none" } },
          ],
        },
      ],
    },
  },
  {
    name: "coffee-728x90",
    title: "Coffee subscription · 728×90",
    description: "Leaderboard with a gradient background, logo, product badge, headline, offer and CTA.",
    assets: { "cup.svg": CUP, "logo.svg": ROAST_LOGO },
    document: {
      schemaVersion: 1,
      width: 728,
      height: 90,
      background: { type: "linear-gradient", angle: 90, stops: [{ offset: 0, color: "#f8efe4" }, { offset: 1, color: "#ecd8bf" }] },
      layers: [
        { id: "product", type: "image", name: "Product", role: "product", x: 14, y: 8, width: 74, height: 74, rotation: 0, opacity: 1, visible: true, assetKey: "{{asset:cup.svg}}", fit: "contain", cornerRadius: 0 },
        { id: "logo", type: "image", name: "Logo", role: "logo", x: 104, y: 14, width: 88, height: 22, rotation: 0, opacity: 1, visible: true, assetKey: "{{asset:logo.svg}}", fit: "contain", cornerRadius: 0 },
        { id: "headline", type: "text", name: "Headline", role: "headline", x: 104, y: 40, width: 344, height: 36, rotation: 0, opacity: 1, visible: true, text: "Fresh coffee, roasted the day it ships.", style: { fontFamily: "Inter", fontWeight: 700, fontSize: 19, lineHeight: 1.15, letterSpacing: -0.2, color: "#3b1f12", align: "left", verticalAlign: "middle", italic: false, transform: "none" } },
        {
          id: "offer", type: "group", name: "Offer", role: "offer", x: 452, y: 22, width: 116, height: 46, rotation: 0, opacity: 1, visible: true, clip: false, cornerRadius: 8, fill: { type: "solid", color: "#5a2f1a" },
          children: [
            { id: "offer-value", type: "text", name: "Offer value", x: 0, y: 5, width: 116, height: 22, rotation: 0, opacity: 1, visible: true, text: "50% off", style: { fontFamily: "Inter", fontWeight: 800, fontSize: 18, letterSpacing: 0, color: "#f8efe4", align: "center", verticalAlign: "middle", italic: false, transform: "none" } },
            { id: "offer-detail", type: "text", name: "Offer detail", x: 0, y: 27, width: 116, height: 14, rotation: 0, opacity: 1, visible: true, text: "your first box", style: { fontFamily: "Inter", fontWeight: 500, fontSize: 10, letterSpacing: 0.3, color: "#e8cfb3", align: "center", verticalAlign: "middle", italic: false, transform: "uppercase" } },
          ],
        },
        {
          id: "cta", type: "group", name: "CTA", role: "cta", x: 590, y: 26, width: 122, height: 38, rotation: 0, opacity: 1, visible: true, clip: false, cornerRadius: 0,
          children: [
            { id: "cta-background", type: "shape", name: "CTA background", shape: "rectangle", x: 0, y: 0, width: 122, height: 38, rotation: 0, opacity: 1, visible: true, fill: { type: "solid", color: "#d9541e" }, cornerRadius: 6 },
            { id: "cta-label", type: "text", name: "CTA label", x: 0, y: 0, width: 122, height: 38, rotation: 0, opacity: 1, visible: true, text: "Start my box", style: { fontFamily: "Inter", fontWeight: 700, fontSize: 14, letterSpacing: 0, color: "#ffffff", align: "center", verticalAlign: "middle", italic: false, transform: "none" } },
          ],
        },
      ],
    },
  },
];
