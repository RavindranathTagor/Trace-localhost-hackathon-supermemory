/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The NLI tier loads a local ONNX model through @xenova/transformers at runtime;
    // keep it external so Next does not try to bundle the wasm/onnx assets.
    serverComponentsExternalPackages: ["@xenova/transformers"],
  },
};

export default nextConfig;
