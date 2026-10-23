const config = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['@emurgo/cardano-serialization-lib-nodejs', '@emurgo/cardano-message-signing-nodejs', '@midnight-ntwrk/ledger-v8'],
  experimental: { cpus: 2 },
  async redirects() { return [{source:'/',destination:'/learn/blockscholar',permanent:false},{source:'/learn',destination:'/learn/blockscholar',permanent:false},{source:'/home',destination:'/learn/blockscholar',permanent:false}]; },
  async headers() { return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'}]}]; },
};
export default config;
