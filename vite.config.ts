import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
	plugins: [
		sveltekit(),
		viteStaticCopy({
			targets: [
				{
					src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

					dest: 'wasm'
				}
			]
		})
	],
	define: {
		APP_VERSION: JSON.stringify(process.env.npm_package_version),
		APP_BUILD_HASH: JSON.stringify(process.env.APP_BUILD_HASH || 'dev-build')
	},
	// Dev server (npm run dev) — proxy every backend path to axi's front door,
	// so `vite dev` gives HMR against the REAL running stack.
	//
	// Requires WEBUI_BASE_URL to be same-origin in dev too (src/lib/constants.ts);
	// the upstream default points straight at localhost:8080, which the federated
	// stack no longer publishes — open-webui sits behind the gateway now.
	//
	// Proxying to :3000 rather than to each service keeps dev identical to prod:
	// same auth, same headers, same /gw route. Log in once at localhost:5173 and
	// the session is the dev server's own.
	server: {
		proxy: Object.fromEntries(
			['/api', '/ollama', '/openai', '/gw', '/static', '/cache', '/ws'].map((p) => [
				p,
				{ target: 'http://localhost:3000', changeOrigin: true, ws: p === '/ws' }
			])
		)
	},
	build: {
		sourcemap: true
	},
	worker: {
		format: 'es'
	},
	esbuild: {
		pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
	}
});
