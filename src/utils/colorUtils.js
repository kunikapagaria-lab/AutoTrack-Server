/**
 * Comprehensive car color map.
 * Each entry: h = center hue, hTol = ± hue tolerance (degrees),
 * s = [min, max] saturation, l = [min, max] lightness.
 * Matching uses a penalty score across all three dimensions.
 */
const COLOR_MAP = [
  // ─── Reds (hue ~345-15) ───
  { name: "Red",          h: 0,   hTol: 12, s: [0.50, 1.0], l: [0.25, 0.65] },
  { name: "Dark Red",     h: 358, hTol: 12, s: [0.42, 1.0], l: [0.08, 0.26] },
  { name: "Crimson",      h: 348, hTol: 10, s: [0.55, 1.0], l: [0.20, 0.45] },
  { name: "Maroon",       h: 5,   hTol: 15, s: [0.28, 0.75], l: [0.08, 0.23] },
  { name: "Burgundy",     h: 345, hTol: 12, s: [0.28, 0.70], l: [0.08, 0.22] },
  { name: "Rose",         h: 350, hTol: 12, s: [0.28, 0.80], l: [0.40, 0.72] },
  { name: "Coral",        h: 12,  hTol: 8,  s: [0.55, 1.0], l: [0.55, 0.82] },
  { name: "Pink",         h: 340, hTol: 18, s: [0.22, 1.0], l: [0.58, 0.92] },
  { name: "Hot Pink",     h: 320, hTol: 15, s: [0.60, 1.0], l: [0.38, 0.72] },
  { name: "Wine",         h: 335, hTol: 15, s: [0.28, 0.72], l: [0.10, 0.28] },

  // ─── Oranges (hue ~16-44) ───
  { name: "Rust",         h: 16,  hTol: 8,  s: [0.40, 0.85], l: [0.22, 0.42] },
  { name: "Burnt Orange", h: 20,  hTol: 8,  s: [0.55, 1.0], l: [0.25, 0.45] },
  { name: "Orange",       h: 28,  hTol: 14, s: [0.55, 1.0], l: [0.38, 0.75] },
  { name: "Amber",        h: 38,  hTol: 8,  s: [0.65, 1.0], l: [0.38, 0.65] },
  { name: "Peach",        h: 20,  hTol: 12, s: [0.38, 0.85], l: [0.62, 0.86] },

  // ─── Yellows (hue ~45-72) ───
  { name: "Gold",         h: 45,  hTol: 8,  s: [0.45, 1.0], l: [0.30, 0.55] },
  { name: "Mustard",      h: 50,  hTol: 10, s: [0.38, 0.80], l: [0.28, 0.50] },
  { name: "Yellow",       h: 58,  hTol: 12, s: [0.55, 1.0], l: [0.45, 0.88] },
  { name: "Lemon",        h: 66,  hTol: 8,  s: [0.60, 1.0], l: [0.58, 0.90] },

  // ─── Olive / Khaki (low-mid S, mid-low L) ───
  { name: "Olive",        h: 65,  hTol: 14, s: [0.15, 0.55], l: [0.18, 0.42] },
  { name: "Khaki",        h: 55,  hTol: 12, s: [0.15, 0.48], l: [0.42, 0.68] },
  { name: "Yellow Green", h: 80,  hTol: 12, s: [0.40, 1.0], l: [0.35, 0.75] },

  // ─── Browns / Tans ───
  { name: "Dark Brown",   h: 20,  hTol: 12, s: [0.18, 0.62], l: [0.06, 0.16] },
  { name: "Brown",        h: 25,  hTol: 12, s: [0.20, 0.58], l: [0.12, 0.38] },
  { name: "Caramel",      h: 30,  hTol: 10, s: [0.32, 0.68], l: [0.32, 0.52] },
  { name: "Tan",          h: 35,  hTol: 14, s: [0.18, 0.55], l: [0.45, 0.72] },
  { name: "Beige",        h: 42,  hTol: 16, s: [0.08, 0.30], l: [0.68, 0.90] },
  { name: "Cream",        h: 50,  hTol: 16, s: [0.08, 0.28], l: [0.78, 0.95] },

  // ─── Greens (hue ~80-168) ───
  { name: "Lime Green",   h: 90,  hTol: 12, s: [0.50, 1.0], l: [0.35, 0.78] },
  { name: "Green",        h: 118, hTol: 22, s: [0.28, 1.0], l: [0.18, 0.65] },
  { name: "Dark Green",   h: 120, hTol: 22, s: [0.28, 1.0], l: [0.05, 0.20] },
  { name: "Forest Green", h: 132, hTol: 18, s: [0.22, 0.85], l: [0.08, 0.30] },
  { name: "Sage",         h: 118, hTol: 22, s: [0.08, 0.32], l: [0.38, 0.68] },
  { name: "Mint",         h: 150, hTol: 16, s: [0.25, 0.85], l: [0.58, 0.90] },
  { name: "Teal",         h: 168, hTol: 16, s: [0.28, 1.0], l: [0.15, 0.55] },
  { name: "Dark Teal",    h: 170, hTol: 14, s: [0.28, 1.0], l: [0.05, 0.18] },

  // ─── Cyans / Aquas (hue ~172-205) ───
  { name: "Turquoise",    h: 175, hTol: 14, s: [0.38, 1.0], l: [0.30, 0.70] },
  { name: "Aqua",         h: 182, hTol: 12, s: [0.40, 1.0], l: [0.42, 0.85] },
  { name: "Cyan",         h: 192, hTol: 14, s: [0.40, 1.0], l: [0.35, 0.82] },
  { name: "Sky Blue",     h: 202, hTol: 12, s: [0.28, 1.0], l: [0.52, 0.90] },
  { name: "Ice Blue",     h: 202, hTol: 14, s: [0.12, 0.42], l: [0.62, 0.92] },

  // ─── Blues (hue ~205-252) ───
  { name: "Cerulean",     h: 208, hTol: 10, s: [0.42, 1.0], l: [0.38, 0.68] },
  { name: "Blue",         h: 220, hTol: 16, s: [0.30, 1.0], l: [0.22, 0.62] },
  { name: "Cobalt Blue",  h: 218, hTol: 10, s: [0.50, 1.0], l: [0.22, 0.50] },
  { name: "Royal Blue",   h: 228, hTol: 12, s: [0.48, 1.0], l: [0.18, 0.48] },
  { name: "Steel Blue",   h: 210, hTol: 14, s: [0.18, 0.55], l: [0.28, 0.60] },
  { name: "Denim Blue",   h: 218, hTol: 12, s: [0.22, 0.58], l: [0.32, 0.60] },
  { name: "Dark Blue",    h: 228, hTol: 16, s: [0.35, 1.0], l: [0.05, 0.20] },
  { name: "Navy Blue",    h: 236, hTol: 16, s: [0.35, 1.0], l: [0.05, 0.23] },

  // ─── Purples / Violets (hue ~252-318) ───
  { name: "Indigo",       h: 255, hTol: 14, s: [0.30, 1.0], l: [0.10, 0.35] },
  { name: "Dark Purple",  h: 272, hTol: 16, s: [0.28, 1.0], l: [0.05, 0.18] },
  { name: "Purple",       h: 275, hTol: 18, s: [0.25, 1.0], l: [0.12, 0.62] },
  { name: "Violet",       h: 268, hTol: 14, s: [0.35, 1.0], l: [0.32, 0.75] },
  { name: "Lavender",     h: 270, hTol: 18, s: [0.12, 0.52], l: [0.58, 0.90] },
  { name: "Plum",         h: 290, hTol: 14, s: [0.22, 0.68], l: [0.18, 0.42] },
  { name: "Magenta",      h: 300, hTol: 14, s: [0.42, 1.0], l: [0.28, 0.72] },
  { name: "Fuchsia",      h: 308, hTol: 12, s: [0.55, 1.0], l: [0.32, 0.70] },
  { name: "Mauve",        h: 300, hTol: 18, s: [0.12, 0.48], l: [0.45, 0.72] },
];

/**
 * Converts RGB to HSL.
 * Returns [hue (0-360), saturation (0-1), lightness (0-1)].
 */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), s, l];
}

/**
 * Maps an RGB pixel to a named car color.
 * Scoring: hue overshoot (degrees) + saturation miss (scaled) + lightness miss (scaled).
 * Always returns { name, isBackgroundProne }.
 */
export function getColorName(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);

  // ── Neutrals ──
  // Very dark pixels are black regardless of slight hue (indoor ambient reflections on a
  // black car read as h≈240-270, s≈0.08-0.16, l≈0.12-0.22 — still Black).
  if (l <= 0.14) return { name: "Black", isBackgroundProne: false };
  if (l <= 0.24 && s < 0.20) return { name: "Black", isBackgroundProne: false };

  if (l >= 0.90 && s < 0.12) return { name: "White", isBackgroundProne: false };

  // Expand neutral band: s < 0.12 covers lightly-tinted grays/silvers
  if (s < 0.12) {
    if (l > 0.62) return { name: "Silver",    isBackgroundProne: false };
    if (l > 0.35) return { name: "Gray",      isBackgroundProne: false };
    return           { name: "Dark Gray", isBackgroundProne: false };
  }

  // ── Chromatic: score every entry, pick best match ──
  let bestScore = Infinity;
  let bestColor = "Gray";

  for (const color of COLOR_MAP) {
    // Circular hue distance minus the entry's tolerance → excess degrees
    let hDiff = Math.abs(h - color.h);
    if (hDiff > 180) hDiff = 360 - hDiff;
    const hPenalty = Math.max(0, hDiff - color.hTol);

    // How far outside the expected saturation range (scaled to degree-equivalent)
    const sPenalty = (s < color.s[0] ? color.s[0] - s
                    : s > color.s[1] ? s - color.s[1] : 0) * 80;

    // How far outside the expected lightness range (scaled to degree-equivalent)
    const lPenalty = (l < color.l[0] ? color.l[0] - l
                    : l > color.l[1] ? l - color.l[1] : 0) * 60;

    // Hue gets 1.5× weight — it's the primary perceptual dimension for colour name
    const score = hPenalty * 1.5 + sPenalty + lPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestColor = color.name;
    }
  }

  // Light, desaturated sky-tones are often workshop background walls, not car paint
  const bgProne = ['Cyan', 'Aqua', 'Sky Blue', 'Ice Blue'].includes(bestColor)
               && l > 0.65 && s < 0.30;

  return { name: bestColor, isBackgroundProne: bgProne };
}

/**
 * K-Means clustering on sampled ROI pixels.
 * Returns the dominant car body color name.
 */
export function getDominantColors(imageData, k = 6, maxIterations = 15) {
  const data = imageData.data;
  const pixels = [];

  // Keep mid-range pixels; exclude deep shadows, blown highlights, and
  // very dark + low-saturation pixels (ambient reflections on black/dark cars).
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [, s, l] = rgbToHsl(r, g, b);
    const isDarkAmbient = l <= 0.24 && s < 0.20; // same gate as getColorName "Black"
    if (!isDarkAmbient && l > 0.14 && l < 0.92 && (s > 0.08 || (l > 0.30 && l < 0.82))) {
      pixels.push([r, g, b]);
    }
  }

  // Fallback: if filtering was too aggressive, use all non-extreme pixels
  const finalPixels = pixels.length >= 20 ? pixels : (() => {
    const fallback = [];
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (avg > 35 && avg < 225) fallback.push([data[i], data[i + 1], data[i + 2]]);
    }
    return fallback;
  })();

  if (finalPixels.length === 0) return ["Gray"];

  // ── K-Means++ inspired initialisation — spread initial centroids ──
  const centroids = [finalPixels[Math.floor(Math.random() * finalPixels.length)]];
  while (centroids.length < k) {
    // Pick a pixel with probability proportional to its min distance² to existing centroids
    const dists = finalPixels.map(p => {
      let minD = Infinity;
      for (const c of centroids) {
        const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let chosen = finalPixels[finalPixels.length - 1];
    for (let i = 0; i < finalPixels.length; i++) {
      rand -= dists[i];
      if (rand <= 0) { chosen = finalPixels[i]; break; }
    }
    centroids.push([...chosen]);
  }

  // ── K-Means iterations ──
  const assignments = new Array(finalPixels.length).fill(0);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < finalPixels.length; i++) {
      let minDist = Infinity, best = 0;
      for (let c = 0; c < k; c++) {
        const d = (finalPixels[i][0] - centroids[c][0]) ** 2
                + (finalPixels[i][1] - centroids[c][1]) ** 2
                + (finalPixels[i][2] - centroids[c][2]) ** 2;
        if (d < minDist) { minDist = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    if (!changed) break;

    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < finalPixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += finalPixels[i][0];
      sums[c][1] += finalPixels[i][1];
      sums[c][2] += finalPixels[i][2];
      sums[c][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [
          Math.round(sums[c][0] / sums[c][3]),
          Math.round(sums[c][1] / sums[c][3]),
          Math.round(sums[c][2] / sums[c][3]),
        ];
      }
    }
  }

  // ── Score clusters ──
  const minDensity = finalPixels.length * 0.02; // at least 2% of pixels
  const clusters = centroids
    .map((rgb, idx) => {
      const [, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const count = assignments.filter(a => a === idx).length;
      const { name, isBackgroundProne } = getColorName(rgb[0], rgb[1], rgb[2]);
      const isChromatic = !['Silver', 'Gray', 'Dark Gray', 'Black', 'White'].includes(name);

      // Weight: cluster size × mild saturation boost (max 3×) — no per-color bias
      const weight = count
        * (isChromatic ? 1 + s * 2 : 0.3)
        * (isBackgroundProne ? 0.1 : 1.0);

      return { name, count, weight, isChromatic };
    })
    .filter(c => c.count >= minDensity)
    .sort((a, b) => b.weight - a.weight);

  if (clusters.length === 0) return ["Gray"];

  // Return the top chromatic colour; fall back to the top neutral
  const topChromatic = clusters.find(c => c.isChromatic);
  return [topChromatic ? topChromatic.name : clusters[0].name];
}
