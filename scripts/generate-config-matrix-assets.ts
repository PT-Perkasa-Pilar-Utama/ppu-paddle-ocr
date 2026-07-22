// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

/**
 * Generates the synthetic example images for the README's
 * "Choosing a model and configuration" matrix (assets/config-matrix/).
 * Deterministic apart from platform font rendering; the rendered PNGs are
 * committed so tests and docs reference stable files. Re-run only when a
 * profile changes: `bun run scripts/generate-config-matrix-assets.ts`
 */
import { createCanvas } from "@napi-rs/canvas";
import type { Canvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(import.meta.dir, "..", "assets", "config-matrix");
mkdirSync(OUT_DIR, { recursive: true });

function save(name: string, canvas: Canvas): void {
  const file = path.join(OUT_DIR, name);
  writeFileSync(file, canvas.toBuffer("image/png"));
  console.log(`wrote ${file}`);
}

/** Deterministic PRNG (mulberry32) so noise is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── dark-dense-portrait: dark-theme app screenshot, dense short labels ────────
{
  const c = createCanvas(640, 1024);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, 640, 1024);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText("Daily Report", 240, 48);
  ctx.fillStyle = "#4a9eff";
  ctx.font = "22px sans-serif";
  ctx.fillText("Edit", 580, 48);

  const rows = [
    ["09:15 AM", "Driving", "No location"],
    ["10:40 AM", "On Duty", "2 mi NNW CA Woodland"],
    ["12:05 PM", "Off Duty", "Rest break notification"],
    ["01:30 PM", "Driving", "HOS-WARNING-B657A788"],
    ["03:55 PM", "On Duty", "No location"],
    ["05:20 PM", "Off Duty", "GSEJ-6ZV-WW9"],
  ];
  rows.forEach(([time = "", status = "", detail = ""], i) => {
    const y = 140 + i * 130;
    ctx.strokeStyle = "#1c2128";
    ctx.beginPath();
    ctx.moveTo(0, y - 40);
    ctx.lineTo(640, y - 40);
    ctx.stroke();
    ctx.fillStyle = "#8b949e";
    ctx.font = "19px sans-serif";
    ctx.fillText(time, 16, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(status, 130, y);
    ctx.fillStyle = "#8b949e";
    ctx.font = "18px sans-serif";
    ctx.fillText(detail, 130, y + 32);
    ctx.fillStyle = "#4a9eff";
    ctx.font = "20px sans-serif";
    ctx.fillText("Edit", 575, y);
  });

  ctx.fillStyle = "#1f6feb";
  ctx.fillRect(20, 940, 600, 52);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Certify and Submit", 235, 973);
  save("dark-dense-portrait.png", c);
}

// ── light-sparse-portrait: light form, few isolated labels ────────────────────
{
  const c = createCanvas(640, 1024);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 1024);

  ctx.fillStyle = "#111111";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("Contact Form", 220, 70);

  const fields = ["Name", "Email Address", "Message"];
  fields.forEach((label, i) => {
    const y = 180 + i * 180;
    ctx.fillStyle = "#111111";
    ctx.font = "22px sans-serif";
    ctx.fillText(label, 40, y);
    ctx.strokeStyle = "#cccccc";
    ctx.strokeRect(40, y + 20, 560, 64);
  });

  ctx.fillStyle = "#1f6feb";
  ctx.fillRect(40, 780, 260, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Submit", 130, 815);
  ctx.strokeStyle = "#999999";
  ctx.strokeRect(340, 780, 260, 56);
  ctx.fillStyle = "#333333";
  ctx.fillText("Cancel", 430, 815);
  save("light-sparse-portrait.png", c);
}

// ── light-dense-landscape: dense digital document page ────────────────────────
{
  const c = createCanvas(1280, 720);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1280, 720);

  ctx.fillStyle = "#111111";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText("Quarterly Operations Review", 60, 70);

  const body = [
    "Revenue from the logistics division grew nine percent",
    "quarter over quarter, driven by contract renewals in",
    "the northern corridor and two new distribution hubs.",
    "Fleet utilization held steady at eighty four percent",
    "while maintenance costs declined for a third straight",
    "quarter following the preventive inspection program.",
    "Headcount in warehouse operations rose by forty two",
    "with attrition falling below six percent for the year.",
  ];
  ctx.font = "22px sans-serif";
  body.forEach((line, i) => {
    const col = i < 4 ? 60 : 680;
    const y = 140 + (i % 4) * 44;
    ctx.fillText(line, col, y);
  });

  const body2 = [
    "Customer complaints per thousand shipments dropped",
    "from twelve to seven after route consolidation, and",
    "on-time delivery reached ninety six percent overall.",
    "Capital expenditure remains within the annual plan.",
  ];
  body2.forEach((line, i) => {
    ctx.fillText(line, 60, 360 + i * 44);
  });

  ctx.fillStyle = "#666666";
  ctx.font = "20px sans-serif";
  ctx.fillText("Page 1 of 3", 580, 690);
  save("light-dense-landscape.png", c);
}

// ── low-contrast-photo-landscape: simulated photo, gray on gray, tilted ───────
{
  const c = createCanvas(1280, 720);
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#b6b6b6");
  grad.addColorStop(1, "#a2a2a2");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1280, 720);

  ctx.save();
  ctx.translate(640, 360);
  ctx.rotate((-2 * Math.PI) / 180);
  ctx.fillStyle = "#7a7a7a";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("WAREHOUSE B", -280, -120);
  ctx.font = "bold 52px sans-serif";
  ctx.fillText("GATE 12", -120, -20);
  ctx.font = "34px sans-serif";
  ctx.fillText("AUTHORIZED PERSONNEL ONLY", -300, 90);
  ctx.restore();

  const rand = mulberry32(20260722);
  const img = ctx.getImageData(0, 0, 1280, 720);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 24;
    d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
  }
  ctx.putImageData(img, 0, 0);
  save("low-contrast-photo-landscape.png", c);
}
