/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    // Explicitly set the workspace root to silence the multi-lockfile warning.
    // Use import.meta.dirname instead of __dirname (ESM scope).
    root: import.meta.dirname,
  },
};

export default nextConfig;
