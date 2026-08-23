# Soroscan

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A Stellar block explorer with a modern, contract-first UI.

> **Status: pre-alpha.** The project is under active development and application code lands incrementally. Star or watch the repo to follow along.

## Features

- **Human-readable transactions** - decoded contract invocations, typed arguments, and events instead of raw XDR
- **Failed transaction diagnostics** - result codes mapped to the failing operation, explained in plain language
- **First-class contract pages** - interface, metadata, build verification signals, live events, and read-only invocation
- **Live network view** - streaming ledgers and transactions as they close
- **Honest data boundaries** - the UI always tells you how far history goes and where the data comes from

## Roadmap

| Phase | Scope                                                                      | Status      |
| ----- | -------------------------------------------------------------------------- | ----------- |
| 1     | Stateless SPA querying Horizon and Stellar RPC directly, mainnet + testnet | In progress |
| 2     | Indexer for full history, token holders, search, and a realtime API        | Planned     |

## Tech stack

- Frontend: React, TypeScript, Vite
- Data: Stellar RPC and Horizon, with provider failover
- Backend (phase 2): Go, built on the Stellar Composable Data Platform

## Repository layout

- `frontend/` - the React SPA (phase 1)
- `indexer/` - the Go indexer (phase 2, not started)

## Development

```bash
cd frontend
npm install
npm run dev
```

Other scripts: `build`, `preview`, `lint`, `typecheck`, `format`, `test`. CI runs format check, lint, typecheck, tests, and build on every pull request.

## Contributing

Contributions are welcome:

- **Bug reports and feature requests** - open an issue using the forms; anyone can report
- **Code** - read [CONTRIBUTING.md](CONTRIBUTING.md) first, then open an issue before starting non-trivial work
- **Security issues** - use [private vulnerability reporting](https://github.com/fxjrin/soroscan/security/advisories/new), never a public issue

## License

Released under the [MIT License](LICENSE).
