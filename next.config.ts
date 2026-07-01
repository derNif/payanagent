import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this project. Without this it can infer a
  // parent dir (there are sibling projects); "/" was flat wrong.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
