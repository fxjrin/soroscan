# Soroscan

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A Stellar block explorer for Mainnet, Testnet, and Futurenet, live at [soroscan.io](https://soroscan.io).

> **Status: early and moving fast.** The explorer is live across Mainnet, Testnet, and Futurenet, with its indexer running on mainnet; features land incrementally. Star or watch the repo to follow along.

## Features

- **Human-readable transactions** - decoded contract invocations, typed arguments, and events instead of raw XDR
- **Failed transaction diagnostics** - result codes mapped to the failing operation, explained in plain language
- **First-class contract pages** - interface, metadata, storage, and every direct invocation across a contract's entire history, filterable by function and date
- **Live network view** - streaming ledgers and transactions as they close
- **Built-in AI assistant** - answers questions about on-chain data, grounded in the same live Horizon, RPC, and index data the explorer shows
- **Honest data boundaries** - the UI always tells you how far history goes and where the data comes from

## Roadmap

| Phase | Scope                                                                      | Status  |
| ----- | -------------------------------------------------------------------------- | ------- |
| 1     | Stateless SPA querying Horizon and Stellar RPC directly, mainnet, testnet, and futurenet | Live    |
| 2     | Indexer serving full contract invocation history with filters              | Live    |
| 3     | Token holders, richer search, invocation outcomes, and a realtime API      | Planned |

## Tech stack

- Frontend: React, TypeScript, Vite
- Data: Stellar RPC and Horizon with provider failover, plus Soroscan's own indexer
- Indexer: Go and TimescaleDB, reading ledgers from the public Stellar ledger archive

## Repository layout

- `frontend/` - the React SPA
- `indexer/` - the Go services that index contract invocations and serve the read API

## Development

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Other scripts: `build`, `preview`, `lint`, `typecheck`, `format`, `test`.

Indexer:

```bash
cd indexer
go build ./...
go test ./...
```

The services read `DATABASE_URL` for a PostgreSQL database with the TimescaleDB extension. Storage tests need `TEST_DATABASE_URL` pointing at a disposable database and skip without it.

CI runs the frontend format check, lint, typecheck, tests, and build, plus the Go suite against TimescaleDB, on every pull request.

## Contributing

Contributions are welcome:

- **Bug reports and feature requests** - open an issue using the forms; anyone can report
- **Code** - read [CONTRIBUTING.md](CONTRIBUTING.md) first, then open an issue before starting non-trivial work
- **Security issues** - use [private vulnerability reporting](https://github.com/soroscan-io/soroscan/security/advisories/new), never a public issue

## License

Released under the [MIT License](LICENSE).
