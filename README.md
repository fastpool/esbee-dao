# Esbee DAO — website

The public face of `esbee-dao.clar`, the operator seat of the
[sBTC bond pool](../sbtc-pool-bond-staker) held by its members rather than by a
key. It explains the pool, the five powers a vote can spend, and the six gates
every proposal has to clear — and it is a working front end for the contract,
not a brochure.

    pnpm install
    pnpm run dev          # build, then http://localhost:8080
    pnpm run check        # typecheck, build, test
    pnpm run shot         # render every page to shots/*.png
    pnpm run icons        # rasterise esbee.svg to icons/*.png

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
| `src/l1.ts` | the bitcoin side of the L1 route: address decoding, the derived sBTC deposit address, and Emily. Loaded on demand |
| `src/app.ts` | state, the view model, and the fallback fixtures |
| `src/chat.ts` | the discussion panel: its state, view model and rendering |
| `src/nostr.ts` | what the chat runs on -- relays, keys, the two rooms, member verification. Loaded after the page paints |
| `src/stacks-verify.ts` | checking a wallet's signature without stacks.js: c32, the signed-message hash, a principal in, a tuple out |
| `v1/` | the same site again, pointed at the retired `vault-1`: its own `index.html`, its own `src/`, its own bundle. It exists so members can take their money out of the old contract |
| `media-kit.html` | the name, mark, palette and voice |
| `esbee.svg` | the mark — the same artwork the header draws inline, and the favicon |
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

The chat's network layer (`nostr.ts`, about 40 kB gzipped) is split the same
way and fetched once the page is idle, so the first paint is what it was; the
test checks that no relay URL reaches the initial load either.

### Why the markup is left as a template

The page keeps the design's own `sc-for` / `sc-if` / `{{ }}` rather than
expanding them into static HTML, so `index.html` still diffs cleanly against the
canvas it came from. Resolving them costs about a hundred lines, which is less
than a framework and much less than re-marking-up the page by hand each time the
design moves.

Two canvas-only affordances do get translated, because a browser would ignore
them: `style-hover` becomes a real `:hover` rule, and `hint-placeholder-*` is
dropped.

## Deploying (Netlify)

`netlify.toml` has it. From this repo the defaults are right; if it is deployed
from a repo that contains this folder alongside others, set the base directory
to `esbee-dao`.

| | |
| --- | --- |
| build command | `pnpm run build` |
| publish directory | `dist` |
| node version | 22, pinned in `netlify.toml` |
| package manager | pnpm, from `pnpm-lock.yaml` and `packageManager` |

`pnpm run build` assembles the whole site into `dist/` — the two pages, the
stylesheet, the mark, the fonts, the icons and the bundle — so the host
publishes one directory and none of the sources, `node_modules` or tests go
with it.

### The Hiro key stays on the server

An anonymous read shares its rate limit with everyone else reading anonymously,
which on a busy day is a 429 for a visitor who did nothing wrong. A key fixes
that, and a key in the bundle is not a key — so `netlify/functions/hiro.mjs`
holds it instead:

    /api/testnet/v2/info   ->   https://api.testnet.hiro.so/v2/info
                                + x-hiro-api-key

Set `HIRO_API_KEY` under **Site configuration → Environment variables**. Without
it the function still proxies, anonymously, so a preview deploy or a fork is
degraded rather than broken.

Only `/v2/` and `/extended/` are forwarded, only on GET, HEAD and POST, and only
to the two Hiro hosts — a path cannot name a third. The faucets are excluded on
purpose: they are rate-limited per IP, and behind a function every visitor
shares one, so the page calls those directly from the browser where the limit is
the reader's own.

`scripts/build.mjs` points the bundle at `/api` only when `NETLIFY` is set, so a
local build talks to Hiro directly and needs no function running. `API_PROXY=`
in the environment overrides both, for a build deployed somewhere else again.

**`pnpm run icons` and `pnpm run shot` are not part of the build.** Both drive
headless Chrome, which a build image does not have; `icons/` is committed for
exactly that reason. Regenerate them locally when the mark changes.

### Caching

Every file esbuild emits is content-hashed, **including the entry** —
`app-LQCYHYTH.js` rather than `app.js`, with the pages rewritten to match at
build time. That is what makes the cache rules simple and safe: all of
`/*.js` is `immutable`, because a change produces a different name. Left
unhashed, the entry would be the one file that must never be cached hard, and
getting that single rule wrong pins a stale bundle on every returning visitor.

The pages and the stylesheet keep their names and revalidate on each visit.

`dist/` is about 5 MB on disk, but a visitor downloads **~23 kB**: the rest is
lazy wallet chunks and sourcemaps that only devtools asks for.

## Networks

**Testnet is live**, at `STFCGF789WX1B737VQYAQ6BG3QYVMJGPDJN4TJFM` —
`vault-2` for the pool, `esbee-dao-2` for the seat, `bond-bridge-2` for the
bitcoin route. The header carries a testnet/mainnet switch; the choice is
remembered, and switching reloads rather than trying to invalidate every
address, cached read and wallet session in place.

**A deployment is four contracts, not one.** The vault, the DAO that holds its
operator seat, the treasury that holds its principal and the bridge that credits
bitcoin into it all name each other, and testnet's second set is `-2` all the
way through. They move together in `DEPLOYMENTS`: half of one set read against
half of the other would show the wrong DAO's proposals against the right pool's
shares.

### The retired vault

`vault-1` still holds real positions, and no contract call moves a position from
one vault to the other — only the member can, by taking it out of one and
putting it into the other. So the old site stays up at **`/v1/`**, pointed at
the old set, with one job: getting money out.

    v1/index.html     the same design, deposits removed
    v1/src/           its own copy of the sources, pinned to vault-1
    dist/v1/          its own bundle, built by the same script

It is a copy rather than a mode. The two pages are about different contracts
holding different money, and a single page that could be pointed at either would
be one wrong click away from reading the wrong balances — or worse, depositing
into the vault everyone is leaving. What the copy removes is every way in: the
amount field, the STX quote, the faucets, `stake`, and the bridge's first step.
What it adds is the exit, in the four places a position can be sitting —
`withdraw` for the unstaked leg (both halves, one call), `request-exit` for
committed shares, `claim-principal` for what an ended epoch released, and
`claim-rewards` for the honey still owed.

The live page links across to it from **Your position**, and every page names
the contract it is reading in the header, next to the network switch.

**Mainnet needs one line.** Fill in `deployer` for `mainnet` in
`src/config.ts` and the switch starts working — a network with no deployer
falls back to the rehearsal rather than erroring, which is what the switch shows
today.

    ?network=mainnet                     // override the remembered choice
    ?network=testnet&deployer=ST3OTHER…  // point at a throwaway deployment

`pool` defaults to `vault-2` on testnet and `bond-staker` on mainnet — the pool
takes whatever name its pox-5 allowlist grant spells, so it is configuration
rather than a constant. `dao` and `bridge` are overridable the same way.

## The bond countdown

Under the stats, the page answers *how long do I wait* from the contract's own
heights — `get-bound-bond` and `get-live-epoch`, against the chain tip. It has
three states because the contract does:

| | |
| --- | --- |
| nothing bound | what is running, why the pool cannot join it, and when the next chance comes. This is testnet today |
| bound, not staked | when the notice ends, when the stake window opens, when deposits close and the bond starts, when the term ends |
| live | what was staked, and when the principal unlocks |

Every row is a burn height read from chain plus a duration derived from it at
~10 minutes a block. Nothing is inferred from a calendar.

The unbound state reads pox-5 directly rather than the pool, because the pool
has nothing to say yet. `bond-period-to-burn-height` for two indices gives the
whole schedule — the periods are evenly spaced — so both the running index and
the next one fall out of arithmetic instead of walking indices one call at a
time.

**A running bond is closed to new members**, and the card says so rather than
implying a queue. pox-5 writes a bond's allowlist once, inside `setup-bond`, so
a staker that was not approved before the bond opened cannot be added to it
however much room is left. What the pool can act on is the *next* period, and
the card reports whether that one has been set up with the pool allowlisted —
the actual gate, and invisible if it only showed a countdown.

**With a deployer set**, every number on the page is read from chain
(`get-proposal-count`, `get-proposal`, `get-status`, `get-vote`, `get-weight`,
`get-quorum`, `current-epoch`, plus the pool's `get-pool` / `get-live-epoch` /
`get-config`), and voting is a real `vote` transaction through the wallet.

**Without one**, the page falls back to the design's fixtures so it still
explains itself, and says so in the FAQ. The fixtures are not invented
governance: every proposal shown is one of the contract's five kinds, and the
copy describes what that call actually does.

## The discussion

Under the "Discuss" button, bottom right, is a chat about the proposals -- on
the page that shows them, open to anyone the moment the page loads, no sign-up.
Every proposal card has a Discuss button that opens it on that proposal; a
message sent from there carries the proposal, and shows as a chip that jumps
back to it.

It runs on Nostr, and a reader never has to know that. An identity is made in
the browser on the first visit and kept in `localStorage`; messages are signed
with it and handed to a few public relays, and every other copy of this page
picks them up from the same relays. There is no server of ours in the path.
The name defaults to `bee-` and the key's first four characters; a display name
can be set from the identity chip, and is published so other readers see it.

**Bring your own key.** The identity sheet offers three ways in for a reader
who already has a Nostr identity -- a browser extension (NIP-07), a remote
signer such as Amber or nsec.app (NIP-46, either a `bunker://` URL pasted in
or a `nostrconnect://` link the signer opens), or an `nsec` pasted in. The
generated key can be backed up as an `nsec` for the same reason. A key an
extension or a signer holds never enters the page; one that is pasted lives in
`localStorage` like the generated one does.

**Two rooms.** Public is a NIP-28 channel: kind 42 messages rooted at a kind
40 channel event published once per network and pinned in `nostr.ts`, so the
room is a room in any client that speaks NIP-28 and every message has a page
on njump -- the `↗` beside a message opens it there, and "open elsewhere" in
the header opens the room. The channels were created with a throwaway key
that was then discarded, so nobody can rename them out from under the page;
changing the name or picture means publishing a new channel and pinning it.
Members is kind 4242 and sealed: the text is encrypted under a fresh
random key, and that key is wrapped (NIP-44) to every verified member the
sender's browser knows of, the sender included. A relay sees who was addressed
and how long it was. A member verified later cannot read what was sent before
-- that is the right property, and the only one a design without a server can
have; it is also why the room count in the footer says "sealed to N".

**Emoji and reactions.** The `☺` by the composer opens a small grid -- a
hive's worth first, then the usual -- and `:bee:`, `:honey:`, `:+1:` and the
like become emoji when a message is sent. Hovering a message offers `☺+`:
eight quick reactions, or the grid. In public a reaction is NIP-25 (kind 7,
the room as its first `e` tag so it can be asked for by room, the message as
the last) and taken back with a NIP-09 deletion, so other clients see both.
In the members room a reaction travels in the same sealed envelope as a
message, with which message it is about inside it, where a relay cannot see.

**Who is here.** Every open page says so now and then -- an ephemeral event
(kind 24242, never stored) every 45 seconds while the tab is in front -- and
a key heard from in the last two minutes shows a green dot beside its name.
Any name opens a profile: the chat key (`npub`, with a link to njump) and, if
a wallet has signed for it, the Stacks address with a link to the explorer
and whether the pool counts it a member. The members room has "who is here":
every key a wallet has signed for, members first, online first, with address
and key. The list is public information already -- the bindings are on the
relays -- but it is offered inside the room, where it is useful.

**Who is a member is the pool's call, not ours.** A chat key is tied to a
Stacks address by one message the wallet signs -- the address, the chat key,
the network, in plain words the wallet shows -- published as NIP-78
application data (kind 30078, `d` = `esbee-dao:member:<network>`). Every
reader checks that signature and asks `get-settled-member` whether the address
holds committed shares or a queued deposit. Both checks happen in
`stacks-verify.ts` and `nostr.ts`, without stacks.js, because a reader of the
public room should not pay 1.4 MB to see who is badged `member`. The smoke test
holds `stacks-verify.ts` against stacks.js itself on random keys, including the
leading-zero-byte address c32 has to spell out.

Membership can lapse -- a withdrawal, an exit -- so the pool is asked again
every ten minutes. The members room hides messages from a sender the pool has
since said no to.

**Verifying** needs the wallet connected on the network the page is on: one
`stx_signMessage`, checked locally before it is published. A wallet that
signed something else, or for another address, is refused at that point rather
than published and ignored.

    ?relays=wss://a,wss://b      // point the chat at other relays, for a test

The relays are in `nostr.ts`; the default set is four public ones. The chat
does not need the Hiro proxy, and the function does not forward to relays --
sockets go straight from the browser, as the transaction watcher's does.

## Joining the pool

The "Two ways in" cards are working forms, not illustrations.

**With sBTC** — an amount in sats, the STX leg quoted live from the bound bond
(`get-required-ustx`, debounced as you type), and one `deposit` call that moves
both. The button only appears while a bond is bound and its start height is
still ahead; otherwise the card says why not.

**With L1 bitcoin** — bridge v2's five steps. What changed from v1 is what is
committed to: v1 committed to the *transaction*, whose txid does not exist until
it has been built and signed, so a member had to drive their wallet in two
halves and any wallet that cannot hand back a signed-but-unbroadcast transaction
was shut out. **v2 commits to the address the bitcoin will come from** — one the
member already has — so both Stacks calls happen before anything is built.

    1  commit-btc-address    a salted hash of the address, plus the amount.
                             Takes the STX leg.
    2  reveal-btc-address    the address itself, one burn block later.
                             First reveal takes it.
    3  deposit               bitcoin, to a derived sBTC deposit address
    4  wait                  the signers sweep it
    5  complete-btc-deposit  the transaction and its parents, as proof

The card asks for the amount and the address up front, prefills the address from
the connected wallet's bitcoin account, and checks the shape against the
bridge's own `get-address-script` before committing anything — an address the
bridge cannot turn into a scriptPubKey is a sentence here rather than a reverted
reveal after the STX leg has been paid. The digest is `get-address-digest`, so a
client cannot disagree with the contract about what was committed to. The salt
is generated in the browser and kept in `localStorage` against the address.

**Step 3 is a real deposit, not an instruction.** `get-deposit-address` names a
*principal* — an sBTC deposit credits a Stacks account, it does not pay a
bitcoin address the treasury owns. So the page derives the deposit address
itself, in `src/l1.ts`: a one-off taproot output whose script tree holds the
treasury principal, the signers' current aggregate key (read from the sBTC
registry, because it rotates) and a reclaim path belonging to the member (built
from the wallet's own bitcoin public key). The wallet then sends to it, and the
deposit is registered with Emily — which is what makes the signers sweep it.

Step 5 fetches the deposit transaction and the transaction behind each of its
inputs from the bitcoin API and hands both to `complete-btc-deposit`: the chain
of txids is what proves on chain that the bitcoin came from the revealed
address. At most eight inputs, which is the bridge's own limit.

### Faucets

Testnet only, and one per leg, because a reader who holds none of the three
cannot work either route through to the end:

| | |
| --- | --- |
| STX, sBTC | on the **With sBTC** card, paid to the connected Stacks account |
| BTC | on the **With L1 bitcoin** card, paid to the bitcoin address in the field above it |

The bitcoin one asks for `&xlarge=true`. The ordinary drip is a few thousand
sats, which is under anything a bond will take — a faucet run that cannot fund
a deposit is a wasted wait. It pays the address the card is about rather than
anything of the wallet's choosing, because the bitcoin has to be *spent from*
the address the commitment names.

**It has to be an address of this chain's** — Hiro's faucet pays testnet, and a
`bc1…` handed to it is a request that can only fail. So the field is prompted
with `tb1q…` on testnet and `bc1q…` on mainnet, the address prefilled from the
wallet is the one on the chain the page is about, and an address belonging to
another chain is refused with a sentence rather than posted. `config.ts` owns
that test (`onConfiguredChain`), next to the chain it is testing against;
`l1.ts` does the real decoding before anything is committed.

All three go straight to Hiro rather than through the site's proxy, which
excludes them on purpose: they are rate-limited per IP, and behind a function
every visitor would share one limit.

### The bitcoin side is configuration

Three values per network, in `NETWORKS`: which bitcoin the pool's sBTC is on,
an esplora-compatible API to read a transaction back from, and the Emily the
signers poll. They belong to the sBTC deployment rather than to this pool, and
`?btcChain=`, `?btcApi=` and `?emily=` override them for a visit.

**Testnet's are deliberately blank.** This pool's sBTC deployment
(`SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1`) is not the public sBTC testnet:
its swept deposits are in no public Emily, and its bitcoin transactions are on
no public mempool. Pointing them at the public endpoints would take a member's
bitcoin and never have it swept — a deposit nobody registers sits at its derived
address until the reclaim path opens ~950 blocks later. So the card refuses to
send while they are empty and says exactly what is missing; commit and reveal
are Stacks calls and work regardless. Filling in the three is all it takes.

`src/l1.ts` is behind its own dynamic `import()`, like the chain layer:
`@scure/btc-signer` and the sBTC deposit builder are ~210 kB and only a member
working this card ever needs them.

**Your position**, once a wallet is connected: queued, committed, released and
unclaimed honey, with Withdraw / Claim buttons that appear only when there is
something to act on.

### Leaving before the term is up

`vault-2`'s one new power, and the card under **Your position** is mostly about
what it costs, because the call itself is one line and the price of it is not.
Every number in it is `get-early-unstake-preview`, so the page never reproduces
the split in JavaScript:

| | |
| --- | --- |
| committed | the most an early exit can take. Partial amounts are allowed |
| STX at the roll | pox-5 frees a staker's locked STX on the bond's own unlock cycle. No call here hands it over sooner |
| honey banked | already accrued to the member; leaving does not touch it |
| honey at risk | reward sBTC the pool holds but has not split yet. The member's shares leave the epoch when the call returns, so it would go to whoever stays |

The at-risk row comes with a **Sync rewards first** button when it is non-zero.
`sync-rewards` is permissionless and banks everything that has actually
arrived, which is the difference between forfeiting that sBTC and keeping it.

What comes back arrives as **released principal**, not in the wallet:
`claim-principal` is the second call, and the card says so rather than implying
the sats have already moved. The card is not shown at all without a live epoch
and a committed position, and an exit already queued blocks the call — the
contract refuses while one is set, so the card says that and offers
`cancel-exit` instead.

The card is on the live page only. `v1/` is about a contract that does not have
the function. A member who still holds a position in `vault-1` is pointed
at `/v1/` from here — that is the whole of the migration, because there is no
call that moves one.

### Post-conditions

Calls where the member *sends* carry explicit post-conditions in deny mode —
`deposit` names exactly the sBTC and the STX it moves, so the wallet refuses
anything else. Calls that only move assets the other way (`withdraw`, the two
claims) have nothing for the member to over-send and use allow mode rather than
enumerating the contract's own outgoing transfers.

The inputs are uncontrolled and read when a button is pressed: a re-render
replaces the field being typed into, and the caret would go with it. The live
quote writes straight into the DOM for the same reason.

### What the page can send

| | |
| --- | --- |
| `vote(id, support)` | the vote floor's for/against buttons |
| `propose-trust-signer` / `-distrust-signer` / `-signer-change` / `-operator-change` / `-sweep` | wired in `chain.ts`, ready for a compose form |
| `execute-trust-signer` / `-distrust-signer` / `-operator-change` / `-sweep` | permissionless: the mandate is the vote, not the executor |
| `deposit` / `deposit-stx` / `withdraw` / `claim-principal` / `claim-rewards` | the join card and **Your position** |
| `unstake-sbtc-early(manager, sats)` | leaving mid-term. `manager` is the principal `get-config` reports, never one typed on the page — the same rule `stake` follows |
| `commit-btc-address` / `reveal-btc-address` / `complete-btc-deposit` | the L1 route, bridge v2 |
| `cancel-btc-commitment` / `cancel-btc-deposit` | taking the STX leg back from a commitment or an announcement the bitcoin never followed |
| `sync-rewards` | permissionless, offered beside the early exit so its at-risk honey is banked first |

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
- the entry chunk stays small and free of the wallet SDK and the relays
- `esbee.svg` and the header draw the same cell, so the mark cannot drift
- the name is never spelled as initials

- the chat's own template resolves, keeps a draft across a render, and links
  a URL in a message
- `stacks-verify.ts` agrees with stacks.js on the signed-message hash,
  signature recovery, both address versions and the principal encoding
- the relays and the curve library are not in the initial load

`pnpm run typecheck` is `tsc --noEmit` under `strict`. The port caught one real
bug on its own: `render.ts` used the global `Node.ELEMENT_NODE`, which exists in
a browser but not in the DOM the tests render through.

## Seeing it, and rasterising it

Both are the same tool: headless Chrome, from Playwright's cache
(`pnpm exec playwright install chromium` if it is not there — it needs no
system packages beyond that download). Set `CHROME=` to point at another.

`pnpm run shot` serves the site and screenshots it. Worth doing after any change
to the mark or the renderer: the test suite proves the markup resolves, but it
cannot see. Three bugs got through it and were obvious the moment something
drew them —

- a missing `viewBox`, so every mark rendered at user-space size and clipped;
- `patternUnits` dropped, so the honeycomb backgrounds did not tile;
- a `--` inside an XML comment in `esbee.svg`, which is a parse error rather
  than a comment, so the favicon did not render **at all**.

The last one is why `smoke-test.ts` now checks the mark's comments: an invalid
favicon fails silently and looks like a caching problem.

`pnpm run chat:e2e` is the discussion, end to end, in the same Chrome: a relay
of its own on localhost (`scripts/chat-relay.mjs`), the built site pointed at it
with `?relays=`, and a few browser profiles talking to each other. The pool's
membership read is answered by the script, so two profiles can be given
bindings signed by fresh Stacks keys and walked into the members room while a
third is left out; afterwards the relay is checked to hold nothing but
ciphertext, wrapped to exactly the two. Reactions, shortcodes, the picker,
presence, the members list and a profile are walked through the same way. It touches no public relay. Screenshots
land in `shots/chat-*.png`. It is not part of `pnpm run check` because it needs
the browser.

`pnpm run icons` rasterises the mark to `icons/icon-{32,180,512}.png`, linked as
the fallback for browsers that will not take an SVG favicon. They are the
light-theme mark — a PNG cannot follow the reader's theme, which is what the SVG
is for. A browser is the right rasteriser here precisely because it agrees with
what a browser will draw: librsvg and resvg each support a different subset of
the CSS this mark uses.

## Provenance

The markup, the CSS and the two typefaces are extracted from the Esbee DAO
design canvas; the copy is the designer's. `media-kit.html` is the exception —
it is assembled from the project's brand guide, using the same tokens, because
the Esbee Media Kit design file was not available. Replace it when it is.
