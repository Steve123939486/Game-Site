import { gameCatalog } from "./employee information/game-catalog.js";

const allowedGames = new Set(gameCatalog);
const MAX_BODY_BYTES = 4096;
const MAX_SCORE = 1_000_000_000;
const MAX_SUBMISSIONS_PER_HOUR = 5;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function hashAddress(address) {
  const bytes = new TextEncoder().encode(address || "unknown-client");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const MAX_IMAGE_STORAGE_BYTES = 8_000_000_000;

function validImageSignature(bytes, mimeType) {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
      bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

async function handleSubmission(request, env, url) {
  if (request.method !== "POST") {
    return json({ error: "Use POST to submit a score." }, 405);
  }

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) return json({ error: "Submission origin was not allowed." }, 403);
    } catch {
      return json({ error: "Submission origin was not allowed." }, 403);
    }
  }

  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "Send the score using the upload form." }, 415);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return json({ error: "The image must be 5 MB or smaller." }, 413);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read. Please choose the image again." }, 400);
  }

  // Hidden honeypot field used to reject many automated submissions.
  if (String(form.get("website") || "").trim()) return json({ ok: true });

  const rawName = form.get("name");
  const rawGame = form.get("game");
  const rawScore = form.get("score");
  const name = typeof rawName === "string" ? rawName.normalize("NFC").trim() : "";
  const game = typeof rawGame === "string" ? rawGame : "";
  const score = typeof rawScore === "string" && rawScore.trim() ? Number(rawScore) : NaN;
  const image = form.get("image");

  if (!name || name.length > 32 || !/^[\p{L}\p{M}\p{N} ._'\-]+$/u.test(name)) {
    return json({ error: "Enter a name or nickname using letters, numbers, spaces, or basic punctuation (32 characters max)." }, 400);
  }
  if (!allowedGames.has(game)) return json({ error: "Choose a game from the list." }, 400);
  if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
    return json({ error: "Enter a whole-number score from 0 to 1,000,000,000." }, 400);
  }
  if (!image || typeof image === "string" || typeof image.arrayBuffer !== "function" || image.size < 1) {
    return json({ error: "Choose a screenshot image to upload." }, 400);
  }
  if (image.size > MAX_IMAGE_BYTES) return json({ error: "The image must be 5 MB or smaller." }, 413);
  if (!env.DB || !env.SCORE_IMAGES) {
    return json({ error: "Score uploads are not available right now." }, 503);
  }

  const mimeType = String(image.type || "").toLowerCase();
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const extension = extensions[mimeType];
  if (!extension) return json({ error: "Upload a PNG, JPG, or WebP image." }, 415);

  let imageBytes;
  try {
    imageBytes = new Uint8Array(await image.arrayBuffer());
  } catch {
    return json({ error: "The image could not be read. Please choose it again." }, 400);
  }
  if (!validImageSignature(imageBytes, mimeType)) {
    return json({ error: "The selected file does not appear to be a valid PNG, JPG, or WebP image." }, 415);
  }

  let imageKey;
  let reservationMade = false;
  let objectStored = false;
  try {
    // Only a one-way hash of the visitor IP is retained for basic abuse throttling.
    const ipHash = await hashAddress(request.headers.get("CF-Connecting-IP"));
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const rate = await env.DB.prepare(`
      INSERT INTO score_submission_limits (ip_hash, hour_bucket, attempts)
      VALUES (?, ?, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        attempts = CASE WHEN score_submission_limits.hour_bucket = excluded.hour_bucket
          THEN score_submission_limits.attempts + 1 ELSE 1 END,
        hour_bucket = excluded.hour_bucket
      RETURNING attempts
    `).bind(ipHash, hourBucket).first();
    if (!rate || rate.attempts > MAX_SUBMISSIONS_PER_HOUR) {
      return json({ error: "Too many submissions. Please try again in about an hour." }, 429);
    }

    // Reserve first, so simultaneous uploads cannot exceed the hard application cap.
    const reservation = await env.DB.prepare(`
      UPDATE score_image_storage
      SET reserved_bytes = reserved_bytes + ?
      WHERE id = 1 AND used_bytes + reserved_bytes + ? <= ?
      RETURNING used_bytes, reserved_bytes
    `).bind(imageBytes.byteLength, imageBytes.byteLength, MAX_IMAGE_STORAGE_BYTES).first();
    if (!reservation) {
      return json({ error: "Screenshot storage is full (8 GB limit). New image uploads are paused." }, 507);
    }
    reservationMade = true;

    imageKey = `score-proof/${crypto.randomUUID()}.${extension}`;
    const submittedAt = new Date().toISOString();
    await env.SCORE_IMAGES.put(imageKey, imageBytes, {
      httpMetadata: { contentType: mimeType, cacheControl: "private, no-store" }
    });
    objectStored = true;

    // Store the score and convert the reserved size to used size in one D1 batch.
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO score_submissions (game, player_name, score, submitted_at, status, image_key, image_bytes)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).bind(game, name, score, submittedAt, imageKey, imageBytes.byteLength),
      env.DB.prepare(`
        UPDATE score_image_storage
        SET reserved_bytes = reserved_bytes - ?, used_bytes = used_bytes + ?
        WHERE id = 1 AND reserved_bytes >= ?
      `).bind(imageBytes.byteLength, imageBytes.byteLength, imageBytes.byteLength)
    ]);
    reservationMade = false;
    return json({ ok: true }, 201);
  } catch (error) {
    if (objectStored && imageKey) {
      try { await env.SCORE_IMAGES.delete(imageKey); } catch (cleanupError) {
        console.error("Could not remove orphaned score image", cleanupError);
      }
    }
    if (reservationMade) {
      try {
        await env.DB.prepare(`
          UPDATE score_image_storage SET reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = 1
        `).bind(imageBytes.byteLength).run();
      } catch (cleanupError) {
        console.error("Could not release score image reservation", cleanupError);
      }
    }
    console.error("Score submission storage failed", error);
    return json({ error: "We could not save your score right now. Please try again later." }, 503);
  }
}

async function handleLeaderboard(request, env) {
  if (request.method !== "GET") {
    return json({ error: "Use GET to read approved leaderboard scores." }, 405);
  }
  if (!env.DB) return json({ error: "Leaderboard scores are not available right now." }, 503);

  try {
    const result = await env.DB.prepare(`
      SELECT game, player_name AS name, score
      FROM score_submissions
      WHERE status = 'approved'
      ORDER BY game ASC, score DESC, submitted_at ASC, id ASC
    `).all();
    const scores = (result.results || [])
      .filter(row => allowedGames.has(row.game) && typeof row.name === "string" && Number.isSafeInteger(Number(row.score)))
      .map(row => ({ game: row.game, name: row.name, score: Number(row.score) }));
    return json({ scores });
  } catch (error) {
    console.error("Could not read approved leaderboard scores", error);
    return json({ error: "Leaderboard scores could not be loaded." }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/leaderboard") {
      return handleLeaderboard(request, env);
    }
    if (url.pathname === "/api/score-submissions") {
      return handleSubmission(request, env, url);
    }
    return env.ASSETS.fetch(request);
  }
};
