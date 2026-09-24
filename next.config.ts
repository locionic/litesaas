import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // optimizePackageImports for fast icon tree-shaking
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
