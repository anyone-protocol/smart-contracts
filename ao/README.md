# ATOR Protocol AO Smart Contracts

This repository contains the ATOR Protocol AO smart contracts, written in Lua.

## Install
```bash
$ bun install
```

## Test
See [spec/README.md](./spec/README.md) for the Tier-1 and Tier-2 suites and
[scripts/README.md](./scripts/README.md) for the end-to-end suite.

## Deploy
```bash
$ bun run deploy
```

## Reading the processes

[docs/READING-THE-CONTRACTS.md](./docs/READING-THE-CONTRACTS.md) documents the read surface for
consumers: every view on the three processes, their parameters, and the behaviours that are easy to
get wrong. Reads are plain unauthenticated HTTP and need no SDK.
