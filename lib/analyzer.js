/**
 * lib/analyzer.js
 * Groq LLM integration for CodeReview.ai
 *
 * Exports:
 *   analyzeCode(files) → parsed JSON report object
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// analyzeCode
// ---------------------------------------------------------------------------

/**
 * Sends code files to Groq (Llama 3.3 70B) and returns a structured
 * code health report.
 *
 * @param {Array<{path: string, content: string}>} files - Code files to review
 * @returns {Promise<{
 *   overall_score: number,
 *   grade: string,
 *   summary: string,
 *   top_issues: Array<{file, severity, category, issue, suggestion}>,
 *   strengths: string[],
 *   file_scores: Array<{file, score}>
 * }>}
 * @throws if the Groq API call fails or the response is not valid JSON
 */
export async function analyzeCode(files) {
  if (!files || files.length === 0) {
    throw new Error("No files provided for analysis.");
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not set.");
  }

  const prompt = buildPrompt(files);

  // ── Call Groq API ────────────────────────────────────────────────────────
  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0.2, // Low temp = more deterministic, fewer hallucinations
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (networkErr) {
    throw new Error(`Network error contacting Groq API: ${networkErr.message}`);
  }

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch (_) {}
    throw new Error(
      `Groq API returned ${res.status} ${res.statusText}${body ? ": " + body.slice(0, 200) : ""}`
    );
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error(
      "Groq returned an empty response. The model may have refused the request. Please try again."
    );
  }

  // ── Parse JSON safely ─────────────────────────────────────────────────────
  // Strip any markdown fences the model may add despite the strict instruction
  const clean = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let report;
  try {
    report = JSON.parse(clean);
  } catch (parseErr) {
    throw new Error(
      `Failed to parse LLM response as JSON.\n` +
        `Parse error: ${parseErr.message}\n` +
        `Response preview: ${clean.slice(0, 300)}`
    );
  }

  // ── Validate required keys ────────────────────────────────────────────────
  const required = ["overall_score", "grade", "summary", "top_issues", "strengths", "file_scores"];
  const missing = required.filter((k) => !(k in report));
  if (missing.length > 0) {
    throw new Error(
      `LLM response is missing required fields: ${missing.join(", ")}. ` +
        `Response preview: ${clean.slice(0, 300)}`
    );
  }

  return report;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the analysis prompt from the provided code files.
 * @param {Array<{path: string, content: string}>} files
 * @returns {string}
 */
function buildPrompt(files) {
  const codeBlock = files
    .map((f) => `### File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  return `You are a senior software engineer performing a rigorous code health review.

Analyze the source files below and respond with ONLY a single valid JSON object.
Do NOT include markdown fences (no \`\`\`json), do NOT include explanations — return the raw JSON object only.

The JSON must follow this exact structure (no extra keys, no missing keys):
{
  "overall_score": <integer 0–100>,
  "grade": <one of: "A+","A","A-","B+","B","B-","C+","C","C-","D","F">,
  "summary": "<2–3 sentence overview of overall code quality>",
  "top_issues": [
    {
      "file": "<filename only, e.g. app.py>",
      "severity": <"high" | "medium" | "low">,
      "category": <"security" | "bug" | "performance" | "code-quality" | "maintainability">,
      "issue": "<clear description of the specific problem found>",
      "suggestion": "<specific, actionable fix or improvement>"
    }
  ],
  "strengths": ["<strength 1>", "<strength 2>"],
  "file_scores": [
    { "file": "<filename>", "score": <integer 0–100> }
  ]
}

Constraints:
- top_issues: between 3 and 6 items, ordered by severity descending (high → medium → low)
- strengths: between 2 and 4 items
- file_scores: exactly one entry per analyzed file
- overall_score is a weighted average reflecting all files
- grade corresponds to overall_score: 97+=A+, 93+=A, 90+=A-, 87+=B+, 83+=B, 80+=B-, 77+=C+, 73+=C, 70+=C-, 60+=D, below 60=F
- Be honest — do not artificially inflate scores

Source files:
${codeBlock}`;
}