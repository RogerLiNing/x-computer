import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isolatedApiPort = process.env.X_COMPUTER_DEV_API_PORT;
if (isolatedApiPort && (!/^\d+$/.test(isolatedApiPort) || Number(isolatedApiPort) < 1024 || Number(isolatedApiPort) > 65535)) throw new Error('开发 API 端口无效');
const apiTarget = isolatedApiPort ? `http://127.0.0.1:${isolatedApiPort}` : 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), {
    name:'scoped-preview-preflight',
    configureServer(server){
      // Only delegated preview capabilities accept opaque-origin requests; account APIs keep Vite's CORS policy.
      server.middlewares.use((req,res,next)=>{
        if(req.method==='OPTIONS'&&req.headers.origin==='null'&&/^\/api\/apps\/preview\/[\w-]{1,128}\/[\w-]{43}\/__runtime(?:\?|$)/.test(req.url??'')){
          res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers','Content-Type');res.statusCode=204;res.end();return;
        }
        next();
      });
    },
  }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (upstream, request, response) => {
            if (!/^\/api\/fs\/read-office(?:\?|$)/.test(request.url ?? '')) return;
            // A finished GET request can still have a cancelled preview response.
            response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
          });
        },
      },
      '/ws': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNRESET') return;
            console.error('[vite] ws proxy error:', err.message);
          });
        },
      },
    },
  },
});
