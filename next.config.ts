import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/politique-confidentialite",
        destination: "/privacy-policy",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
