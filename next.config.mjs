function normaliseBasePath(raw) {
  if (!raw) return "";
  let p = String(raw).trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/\/+$/, "");
}

const BASE_PATH = normaliseBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.BASE_PATH ?? ""
);

// Mirror BASE_PATH into NEXT_PUBLIC_BASE_PATH so `process.env.NEXT_PUBLIC_BASE_PATH`
// is baked into the client bundle by Next at build time. Without this, `apiPath()`
// in the browser sees an empty value and skips the prefix.
if (BASE_PATH && !process.env.NEXT_PUBLIC_BASE_PATH) {
  process.env.NEXT_PUBLIC_BASE_PATH = BASE_PATH;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  ...(BASE_PATH ? { basePath: BASE_PATH, assetPrefix: BASE_PATH } : {}),
  images: {
    unoptimized: true
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  webpack: (config, { isServer }) => {
    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Stop watching logs directory to prevent HMR during streaming
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next)[\\/]/ };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
