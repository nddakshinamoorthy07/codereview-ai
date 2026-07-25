/**
 * pages/api/analyze.js
 * POST /api/analyze
 *
 * Orchestrates the full CodeReview.ai pipeline:
 *   1. fetchRepoFiles  — GitHub REST API → { owner, repo, stars, files }
 *   2. analyzeCode     — Groq LLM       → parsed report JSON
 *   3. saveToFirestore — Firestore write → stored report
 *   4. Return full report as JSON
 *
 * Contains NO business logic — all logic lives in lib/.
 */

import { fetchRepoFiles } from "../../lib/github";
import { analyzeCode } from "../../lib/analyzer";
import { saveToFirestore } from "../../lib/firebase";

export default async function handler(req, res) {
  // ── Method guard ────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Input validation ────────────────────────────────────────────────────
  const { repoUrl } = req.body || {};

  if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
    return res.status(400).json({ error: "repoUrl is required in the request body." });
  }

  try {
    // ── Step 1: Fetch repository files from GitHub ──────────────────────
    const { owner, repo, stars, files } = await fetchRepoFiles(repoUrl.trim());

    // ── Step 2: Run AI analysis via Groq ───────────────────────────────
    const analysis = await analyzeCode(files);

    // ── Step 3: Assemble the full report ───────────────────────────────
    const report = {
      ...analysis,
      repo: `${owner}/${repo}`,
      repoUrl: repoUrl.trim(),
      stars,
      analyzedAt: new Date().toISOString(),
    };

    // ── Step 4: Persist to Firestore (non-blocking on failure) ─────────
    try {
      await saveToFirestore(report);
    } catch (firestoreErr) {
      // Firestore failure should NOT fail the whole request — log and continue
      console.error("[analyze] Firestore save failed:", firestoreErr.message);
    }

    // ── Step 5: Return report ──────────────────────────────────────────
    return res.status(200).json(report);
  } catch (err) {
    console.error("[analyze] Pipeline error:", err.message);

    // Classify error type to return the right HTTP status
    const isClientError =
      err.message.includes("Invalid GitHub URL") ||
      err.message.includes("not found") ||
      err.message.includes("No analyzable code files") ||
      err.message.includes("is required") ||
      err.message.includes("Access denied");

    return res.status(isClientError ? 400 : 500).json({
      error: err.message || "An unexpected error occurred. Please try again.",
    });
  }
}