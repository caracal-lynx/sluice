// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  site: "https://caracal-lynx.github.io",
  base: "/sluice/",
  integrations: [
    // MUST stay before starlight(). Both process markdown, and mermaid has to claim
    // the ```mermaid blocks before Expressive Code (Starlight's highlighter) does.
    // Ordered after it, Expressive Code wins and renders the diagram source as a
    // syntax-highlighted code block — which is exactly the bug this fixes, and had
    // been the site's behaviour since the diagrams were first written.
    //
    // Client-side rendering, deliberately, over build-time SVG (rehype-mermaid):
    // that route needs Playwright at build time, an allowBuilds entry, and a heavier
    // docs job, and it bakes ONE theme's colours into static SVG. Starlight has a
    // light/dark toggle, so a static SVG would be wrong in one of them. autoTheme
    // re-renders on the data-theme attribute instead.
    //
    // No @mermaid-js/layout-elk. It is an optional peer, it only affects flowcharts
    // (the sequence diagram cannot use it at all), and the four flowcharts here are
    // small and linear — dagre handles them. Choosing a layout engine before anyone
    // has seen a single rendered diagram would be tuning output nobody has looked at.
    // Add it later, per-diagram, if one of them actually renders badly.
    mermaid({
      autoTheme: true,
      // Default is true, which console.logs on every page load of a public site.
      enableLog: false,
      mermaidConfig: {
        // Mermaid otherwise sets max-width:100% and SCALES a diagram down to the
        // column. Measured on the built site: the system-context flowchart has a
        // 2374px viewBox in a 720px column, so it drew at 0.29x and its 16px labels
        // landed at 4.6px; the sequence diagram at 0.27x / 4.3px. Both rendered and
        // neither could be read. Natural size + overflow-x on the container (see
        // custom.css) trades a horizontal scrollbar for legible text.
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
      },
    }),
    starlight({
      title: "Sluice",
      description:
        "Config-driven ETL toolkit that validates your data before it reaches its destination — not after. Clean data flows through.",
      logo: {
        src: "./public/sluice-logo.png",
        alt: "Sluice",
        // The logo image already shows the wordmark "SLUICE" inside it,
        // so let it stand in for the site title in the header. Without
        // this Starlight renders the logo + a duplicate "Sluice" text.
        replacesTitle: true,
      },
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/caracal-lynx/sluice",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/caracal-lynx/sluice/edit/master/docs-site/",
      },
      lastUpdated: true,
      pagination: true,
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "Core Concepts", slug: "getting-started/core-concepts" },
          ],
        },
        {
          label: "Pipeline Reference",
          items: [
            { label: "Pipeline YAML Schema", slug: "reference/pipeline-yaml" },
            { label: "Source Adapters", slug: "reference/source-adapters" },
            { label: "Target Adapters", slug: "reference/target-adapters" },
            { label: "Data Quality Rules", slug: "reference/dq-rules" },
            { label: "Prep & Enrich Phases", slug: "reference/prep-and-enrich" },
            { label: "Transforms", slug: "reference/transforms" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Writing a Pipeline YAML", slug: "guides/writing-pipelines" },
            { label: "Data Migration Patterns", slug: "guides/data-migration-patterns" },
            { label: "Plugin System", slug: "guides/plugin-system" },
            { label: "CI/CD Integration", slug: "guides/ci-cd" },
          ],
        },
        {
          label: "Architecture",
          items: [
            { label: "How It Works", slug: "architecture/how-it-works" },
            { label: "Extension Points", slug: "architecture/extension-points" },
          ],
        },
        {
          label: "About",
          items: [
            { label: "Use Cases", slug: "use-cases" },
            { label: "Commercial Support", slug: "commercial-support" },
            { label: "Changelog", slug: "changelog" },
          ],
        },
      ],
    }),
  ],
});
