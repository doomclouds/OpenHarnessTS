# OpenHarness TypeScript

OpenHarness TypeScript is a lightweight agent harness runtime for Node.js. It
provides the core pieces needed to run provider-backed agent loops, register
tools, apply permission checks, discover project context, persist sessions, and
drive a headless CLI print mode.

This repository is an early TypeScript implementation of OpenHarness. It is not
published as an npm package yet.

## Requirements

- Node.js 20 or newer
- npm

## Install

```powershell
npm install
```

## Development

```powershell
npm run typecheck
npm run test
npm run build
```

The built CLI acceptance suite depends on `dist/`, so build first:

```powershell
npm run build
npm run test:cli-built
```

## CLI

After building, the CLI entrypoint is available at:

```powershell
node dist/cli/main.js --help
```

Example dry run:

```powershell
node dist/cli/main.js --dry-run --print "Inspect this project"
```

## License

MIT
