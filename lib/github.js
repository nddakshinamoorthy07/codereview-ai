/**
 * lib/github.js
 * GitHub REST API helpers for CodeReview.ai
 *
 * Exports:
 *   parseRepoUrl(repoUrl)        → { owner, repo }          (regex only, no I/O)
 *   fetchRepoFiles(repoUrl)      → { owner, repo, stars, files }  (GitHub API)
 */

const GITHUB_API = "https://api.github.com";

/** Code file extensions to include in analysis */
const CODE_EXTENSIONS = new Set([
  // Web
  ".html", ".css", ".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte",
  // Backend
  ".py", ".java", ".go", ".rb", ".php", ".cs", ".c", ".cpp", ".rs", ".swift", ".kt",
  // Config / data
  ".json", ".yaml", ".yml", ".sh",
]);

/** Maximum number of files sent to the LLM */
const MAX_FILES = 12;

/** Maximum characters kept per file (keeps prompt within token limits) */
const MAX_CONTENT_CHARS = 3000;

// ---------------------------------------------------------------------------
// parseRepoUrl — regex extraction only, no network calls
// ---------------------------------------------------------------------------

/**
 * Extracts owner and repo name from any GitHub repository URL.
 * Accepts https, http, and bare github.com/owner/repo forms.
 *
 * @param {string} repoUrl
 * @returns {{ owner: string, repo: string }}
 * @throws if the URL does not match the expected pattern
 */
export function parseRepoUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== "string") {
    throw new Error("A GitHub repository URL is required.");
  }

  const trimmed = repoUrl.trim().replace(/\.git\/?$/, "").replace(/\/$/, "");
  const match = trimmed.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);

  if (!match) {
    throw new Error(
      `Invalid GitHub URL: "${repoUrl}". Expected format: https://github.com/owner/repo`
    );
  }

  return { owner: match[1], repo: match[2] };
}

// ---------------------------------------------------------------------------
// fetchRepoFiles — all GitHub API calls
// ---------------------------------------------------------------------------

/**
 * Fetches repo metadata and code file contents from a public GitHub repository.
 *
 * Steps:
 *   1. Parse owner/repo from URL
 *   2. GET /repos/{owner}/{repo}  → default branch, star count
 *   3. GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1  → file tree
 *   4. Filter to supported code file extensions, cap at MAX_FILES
 *   5. Fetch raw file content for each (truncated to MAX_CONTENT_CHARS)
 *
 * @param {string} repoUrl - Full GitHub repository URL
 * @returns {{ owner: string, repo: string, stars: number, files: Array<{path: string, content: string}> }}
 * @throws descriptive errors for invalid URLs, private/missing repos, or empty results
 */
export async function fetchRepoFiles(repoUrl) {
  const { owner, repo } = parseRepoUrl(repoUrl);

  // ── Step 1: Repo metadata ──────────────────────────────────────────────
  const metaRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: buildHeaders(),
  });

  if (metaRes.status === 404) {
    throw new Error(
      `Repository "${owner}/${repo}" was not found. Make sure it exists and is public.`
    );
  }
  if (metaRes.status === 403 || metaRes.status === 401) {
    throw new Error(
      `Access denied to "${owner}/${repo}". Only public repositories are supported.`
    );
  }
  if (!metaRes.ok) {
    throw new Error(
      `GitHub API error while fetching repo metadata: ${metaRes.status} ${metaRes.statusText}`
    );
  }

  const metaJson = await metaRes.json();
  const defaultBranch = metaJson.default_branch || "main";
  const stars = metaJson.stargazers_count ?? 0;

  // ── Step 2: File tree ──────────────────────────────────────────────────
  const treeRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
    { headers: buildHeaders() }
  );

  if (!treeRes.ok) {
    throw new Error(
      `GitHub API error while fetching file tree: ${treeRes.status} ${treeRes.statusText}`
    );
  }

  const treeJson = await treeRes.json();

  if (treeJson.truncated) {
    // Large repo — tree is truncated by GitHub. Continue with what we have.
    console.warn(`[github] File tree for ${owner}/${repo} was truncated by GitHub (large repo).`);
  }

  // ── Step 3: Filter code files ──────────────────────────────────────────
  const candidates = (treeJson.tree || []).filter((item) => {
    if (item.type !== "blob") return false;
    const dotIndex = item.path.lastIndexOf(".");
    if (dotIndex === -1) return false;
    const ext = item.path.slice(dotIndex).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  });

  if (candidates.length === 0) {
    throw new Error(
      `No analyzable code files found in "${owner}/${repo}". ` +
      `Supported: .html, .css, .js, .ts, .jsx, .tsx, .py, .java, .go, .rb, .php, .cs, .cpp, .rs, .vue, and more.`
    );
  }

  const selected = candidates.slice(0, MAX_FILES);

  // ── Step 4: Fetch raw file contents ────────────────────────────────────
  const fileResults = await Promise.all(
    selected.map(async (item) => {
      const encodedPath = item.path.split('/').map(encodeURIComponent).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${encodedPath}`;
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) return null;
        const text = await res.text();
        return {
          path: item.path,
          content: text.slice(0, MAX_CONTENT_CHARS),
        };
      } catch (err) {
        console.warn(`[github] Could not fetch ${item.path}: ${err.message}`);
        return null;
      }
    })
  );

  const files = fileResults.filter(Boolean);

  if (files.length === 0) {
    throw new Error(
      `Found code files in "${owner}/${repo}" but could not fetch their contents. ` +
        "The repository may be empty or inaccessible."
    );
  }

  return { owner, repo, stars, files };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional: raises rate limit from 60 → 5000 req/hr
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}
