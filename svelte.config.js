import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// SvelteKit's built-in CSRF origin check is disabled here because the gateway
		// surface (/v1, /openai) must accept multipart/form-data uploads (e.g. audio
		// transcription) from server-to-server API clients that send no Origin header —
		// the built-in guard rejects those as "Cross-site ... form submissions are
		// forbidden". Those routes are Bearer-authenticated and not CSRF-vulnerable.
		// Same-origin protection for the cookie-authenticated dashboard form actions is
		// re-applied in src/hooks.server.ts (handleCsrf). trustedOrigins:['*'] is the
		// non-deprecated way to turn the built-in check off (see kit write_server.js).
		csrf: { trustedOrigins: ['*'] },
		typescript: {
			config: (config) => ({
				...config,
				include: [...config.include, '../drizzle.config.ts']
			})
		}
	}
};

export default config;
