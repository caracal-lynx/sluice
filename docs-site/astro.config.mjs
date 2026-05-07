// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://caracal-lynx.github.io',
	base: '/sluice/',
	integrations: [
		starlight({
			title: 'Sluice',
			description:
				'Config-driven ETL toolkit that validates your data before it reaches its destination — not after. Clean data flows through.',
			logo: {
				src: './public/sluice-logo.png',
				alt: 'Sluice',
				// The logo image already shows the wordmark "SLUICE" inside it,
				// so let it stand in for the site title in the header. Without
				// this Starlight renders the logo + a duplicate "Sluice" text.
				replacesTitle: true,
			},
			favicon: '/favicon.svg',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/caracal-lynx/sluice',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/caracal-lynx/sluice/edit/master/docs-site/',
			},
			lastUpdated: true,
			pagination: true,
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quickstart', slug: 'getting-started/quickstart' },
						{ label: 'Core Concepts', slug: 'getting-started/core-concepts' },
					],
				},
				{
					label: 'Pipeline Reference',
					items: [
						{ label: 'Pipeline YAML Schema', slug: 'reference/pipeline-yaml' },
						{ label: 'Source Adapters', slug: 'reference/source-adapters' },
						{ label: 'Target Adapters', slug: 'reference/target-adapters' },
						{ label: 'Data Quality Rules', slug: 'reference/dq-rules' },
						{ label: 'Transforms', slug: 'reference/transforms' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Writing a Pipeline YAML', slug: 'guides/writing-pipelines' },
						{ label: 'Data Migration Patterns', slug: 'guides/data-migration-patterns' },
						{ label: 'Plugin System', slug: 'guides/plugin-system' },
						{ label: 'CI/CD Integration', slug: 'guides/ci-cd' },
					],
				},
				{
					label: 'Architecture',
					items: [
						{ label: 'How It Works', slug: 'architecture/how-it-works' },
						{ label: 'Extension Points', slug: 'architecture/extension-points' },
					],
				},
				{
					label: 'About',
					items: [
						{ label: 'Use Cases', slug: 'use-cases' },
						{ label: 'Commercial Support', slug: 'commercial-support' },
						{ label: 'Changelog', slug: 'changelog' },
					],
				},
			],
		}),
	],
});
