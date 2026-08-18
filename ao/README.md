# ATOR Protocol AO Smart Contracts

This repository contains the ATOR Protocol AO smart contracts, written in Lua.

## Install
```bash
$ npm i
```

## Test
```bash
$ npm run test
```

## Build
```bash
$ npm run build
```

## Deploy
```bash
$ npm run deploy
```

## Reading the processes

[docs/READING-THE-CONTRACTS.md](./docs/READING-THE-CONTRACTS.md) documents the read surface for
consumers: every view on the three processes, their parameters, and the behaviours that are easy to
get wrong. Reads are plain unauthenticated HTTP and need no SDK.
