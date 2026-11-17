# Aether Project

A lightweight, procedural-first creation studio for 2D, 2.5D and 3D work.

Aether prioritizes deterministic generation, reusable rules, low memory use and a mobile-aware preview. It starts with a small 2D procedural playground before adding heavier rendering capabilities.

## Principles

- Procedural-first: generate from rules, parameters and seeds.
- Mobile-aware: adaptive quality, bounded workloads and no unnecessary per-frame work.
- Small core: avoid runtime dependencies until a measured need exists.
- Reproducible: the same graph, parameters and seed produce the same output.
- Incremental: only recompute graph nodes affected by a change.
- Progressive rendering: preview cheaply; spend more work only for final output.

## Current status

**Phase 0 — Foundation:** repository initialized; architecture and first 2D prototype are being prepared.

## Development

Requirements: Node.js 20+

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Research reference

Aether studies the techniques used by [Abyssal Garden](https://github.com/Noniv/abyssal-garden), but does not copy its implementation wholesale. See [the technical study](docs/research/abyssal-garden.md) for the design decisions and proposed improvements.

## License

MIT
