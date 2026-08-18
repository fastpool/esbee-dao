# Esbee DAO — website

The public face of `esbee-dao.clar`, the operator seat of the
[sBTC bond pool](../sbtc-pool-bond-staker) held by its members rather than by a
key. It explains the pool, the five powers a vote can spend, and the six gates
every proposal has to clear — and it is a working front end for the contract,
not a brochure.

    pnpm install
    pnpm run dev          # build, then http://localhost:8080
    pnpm run check        # typecheck, build, test

TypeScript, bundled with esbuild. `pnpm run build` writes `dist/`; everything
else on the page is a plain static file.

## What is here

| | |
| --- | --- |
| `index.html` | the design, verbatim, inside a `<template>` |
| `src/render.ts` | ~150 lines that resolve `sc-for`, `sc-if`, `{{ }}` and `style-hover` |
| `src/config.ts` | where the contracts are — dependency-free, deliberately |
| `src/plain.ts` | unwrapping decoded Clarity values |
| `src/chain.ts` | stacks.js: wallet, read-only calls, and every call the DAO has |
| `src/app.ts` | state, the view model, and the fallback fixtures |
| `media-kit.html` | the name, mark, palette and voice |
| `styles.css`, `fonts/` | the design system's tokens and its two typefaces |

### The wallet SDK is not in the initial load

`@stacks/connect` and `@stacks/transactions` come to about **1.4 MB** bundled,
and most readers never connect a wallet. So `chain.ts` is behind a dynamic
`import()`, taken only when a deployment is configured — which is why
`config.ts` has no dependencies of its own: that decision has to be made
*before* the chain layer loads.

    initial load   17 kB
    on connect     the rest, once

`pnpm test` asserts both halves of that, so making the import static again fails
the build rather than quietly costing every visitor a megabyte.

### Why the markup is left as a template

The page keeps the design's own `sc-for` / `sc-if` / `{{ }}` rather than
expanding them into static HTML, so `index.html` still diffs cleanly against the
canvas it came from. Resolving them costs about a hundred lines, which is less
than a framework and much less than re-marking-up the page by hand each time the
design moves.

Two canvas-only affordances do get translated, because a browser would ignore
them: `style-hover` becomes a real `:hover` rule, and `hint-placeholder-*` is
dropped.

## Pointing it at a deployment

The contracts have no fixed address yet, so the page takes one. Either fill in
`DEPLOYMENTS` in `src/config.ts`, or pass it per visit:

    ?network=testnet&deployer=ST3YOUR…DEPLOYER
    ?network=testnet&deployer=ST3YOUR…DEPLOYER&pool=vault-1

`pool` defaults to `vault-1` on testnet and `bond-staker` on mainnet — the pool
takes whatever name its pox-5 allowlist grant spells, so it is configuration
rather than a constant.

**With a deployer set**, every number on the page is read from chain
(`get-proposal-count`, `get-proposal`, `get-status`, `get-vote`, `get-weight`,
`get-quorum`, `current-epoch`, plus the pool's `get-pool` / `get-live-epoch` /
`get-config`), and voting is a real `vote` transaction through the wallet.

**Without one**, the page falls back to the design's fixtures so it still
explains itself, and says so in the FAQ. The fixtures are not invented
governance: every proposal shown is one of the contract's five kinds, and the
copy describes what that call actually does.

### What the page can send

| | |
| --- | --- |
| `vote(id, support)` | the vote floor's for/against buttons |
| `propose-trust-signer` / `-distrust-signer` / `-signer-change` / `-operator-change` / `-sweep` | wired in `chain.ts`, ready for a compose form |
| `execute-trust-signer` / `-distrust-signer` / `-operator-change` / `-sweep` | permissionless: the mandate is the vote, not the executor |

`execute-signer-change` is the exception. It takes both managers as trait
references rather than principals, so it cannot be driven from a proposal id
alone; the page says so instead of pretending otherwise.

`chain.ts` types what the contract stores — `StoredProposal` mirrors the
`proposals` map and `ProposalStatus` mirrors what `get-status` computes — so a
field renamed in Clarity shows up here as a type error rather than as
`undefined` on the page.

## Testing

`pnpm test` renders `index.html` through `src/render.ts` against a real DOM
(linkedom) and checks the things that fail silently otherwise:

- every `{{ name }}` the design uses is supplied by the view model — a missing
  one renders as empty string and looks like a styling bug
- no unresolved directives or mustaches survive into the output
- SVG icons land in the right namespace, hover states become real CSS
- no dead local links
- `chain.ts` names every public and read-only function the contract has
- the entry chunk stays small and free of the wallet SDK

`pnpm run typecheck` is `tsc --noEmit` under `strict`. The port caught one real
bug on its own: `render.ts` used the global `Node.ELEMENT_NODE`, which exists in
a browser but not in the DOM the tests render through.

## Provenance

The markup, the CSS and the two typefaces are extracted from the Esbee DAO
design canvas; the copy is the designer's. `media-kit.html` is the exception —
it is assembled from the project's brand guide, using the same tokens, because
the Esbee Media Kit design file was not available. Replace it when it is.
