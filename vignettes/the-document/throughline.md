# Vignette throughline — *The Document*

The locked concrete values for the architectural vignette. Where greedy-meshing's throughline was numeric (seed, coordinates, byte triples), this one is narrative — the cast, the timings, the literal strings that move through the DOM.

## Repository

- `github.com/webspace-sdk/webspace-engine`, branch `master`, snapshot dated **2026-05-24**.
- Files touched: `src/systems/dom-serialize-system.js`, `src/utils/atom-access-manager.js`, `src/utils/dom-utils.js`, `src/utils/atom-metadata.js`, `src/utils/world-importer.js`, plus a brief sighting of `src/writeback/github-writeback.js` and `src/init.js`.
- License: MPL-2.0.

## The cast

- **Alice** — a writer with `OWNER` permissions and an open GitHub writeback session on her workspace's repository.
- **Bob** — a reader who will open the same world tomorrow in a fresh browser, no live presence connection to Alice.
- **The duck** — `<model id="abc1234" src="assets/duck.glb">`, a direct child of `<body>` in Alice's webspace HTML document.

## The drag

- **Initial style**: `style="transform: translate3d(0, 50cm, 0) rotate3d(0, 1, 0, 0rad) scale3d(1, 1, 1);"`
- **Final style after drag**: `style="transform: translate3d(220cm, 100cm, -50cm) rotate3d(0, 1, 0, 0rad) scale3d(1, 1, 1);"`
- The drag is a 2.2 m translation east, 50 cm up; no rotation, no scale change.
- The change is the new `transform: translate3d(...)` substring; the rest of the `style` attribute is unchanged.

## The timings

- `FLUSH_DELAY = 250` ms — the dom-serialize-system's debounce on entity → DOM writes. (`dom-serialize-system.js:36`)
- `MAX_WRITE_RATE_MS = 10000` ms — the atom-access-manager's debounce on DOM → GitHub commit writes. (`atom-access-manager.js`)
- Net path: Alice drag ends at `t = 0`. DOM is mutated at `t ≈ 250ms`. GitHub commit fires at `t ≈ 10,250ms`. Bob's load tomorrow sees the new commit.

## The observer

- `AtomAccessManager.mutationObserver` — instantiated at `atom-access-manager.js:170`, observed on `document.documentElement` at line 226.
- Options: `{ subtree: true, childList: true, attributes: true, characterData: true }`.
- Filters out: `<style data-styled>` removals from styled-components.
- Reacts by: setting `documentIsDirty = true`, dispatching `document-dirty-state-changed`, scheduling `setTimeout(write, MAX_WRITE_RATE_MS)`.

## The write

- `write()` serializes `document.documentElement.outerHTML`, base64-encodes it, makes three GitHub REST calls in sequence:
  1. `POST /repos/:o/:r/git/blobs` — upload the new HTML as a blob
  2. `POST /repos/:o/:r/git/trees` — create a tree referencing the blob in place of `index.html`
  3. `POST /repos/:o/:r/git/commits` — commit the tree
  4. `PATCH /repos/:o/:r/git/refs/heads/:branch` — move the branch to the new commit
- Asset uploads happen alongside for any new files added since the last commit.

## Bob's side (symmetric load)

- Browser fetches `index.html`. Parses it. Webspace bundle runs.
- `WorldImporter.importHtmlToCurrentWorld(html)` (`world-importer.js:38`) parses the doc, iterates `<body>`'s children.
- For `<model id="abc1234">`, reads `style.transform`, calls `parseTransformIntoThree(transform, pos, quat, scale)` — converts the CSS string back to a `Vector3`.
- The A-Frame entity spawns at `(2.2, 1.0, -0.5)` in world coordinates.

## The climax line

`atom-access-manager.js`, inside the MutationObserver callback (around line 204):

```js
this.documentIsDirty = true;
this.dispatchEvent(new CustomEvent("document-dirty-state-changed"));
this.writeTimeout = setTimeout(write, MAX_WRITE_RATE_MS);
```

These three lines, plus the `observe(document.documentElement, …)` call sixty lines later, are the entirety of webspace-engine's save subsystem. The rest is GitHub bookkeeping.

## The honest-caveat scene

This architecture is *selective*. The vignette MUST acknowledge:

- Realtime peer-to-peer position sync uses NAF (Networked A-Frame), not DOM mutation. Bob watching Alice drag in real time sees the drag via WebRTC, not via DOM observer.
- The "DOM-as-source-of-truth" applies to **persistence** (surviving a reload) and **hub-level metadata** (sky color, spawn point, permissions).
- Hub-level *remote* updates DO route through DOM mutation: `update_hub_meta` data-channel handler in `init.js:161` calls `pushHubMetaUpdateIntoDOM(hub)` (`dom-utils.js:369`), which mutates `<head>`, which fires the *second* MutationObserver in `atom-metadata.js:75`, which dispatches `hub_meta_refresh`, which fans out to atmosphere/sky/spawn subscribers.

## The two observers, named

1. `AtomAccessManager.mutationObserver` on `document.documentElement` — persistence.
2. `LocalDOMHubMetadataSource.mutationObserver` on `document.head` — hub-metadata fan-out.

That is it. Four MutationObservers in the whole codebase (the other two are scoped helpers: `pauseAllPlayableElements` on `<body>` for media auto-pause, and `CursorTargettingSystem` on `<a-scene>` for raycast cache invalidation). The architectural cleverness is concentrated in these two persistence-and-metadata observers, not in an engine-wide event bus.

## What we deliberately do not trace

- The NAF position-sync protocol (different layer, different vignette).
- The full GitHub API dance (three REST calls; one sentence in the prose).
- The asset-upload side path.
- The styled-components filter (mentioned in passing).
- Anything about the navigation tree (`tree-sync.js` is a parallel persistence story for a separate HTML file; we focus on the world HTML).
- The other two MutationObservers (media-pause, cursor-cache) — we name them in a footnote.

## Pull-quote candidates for the climax

In descending order of preference:

1. *"There is no save function. There is only the document, and a ten-second timer."*
2. *"The save file is not a representation of the world; it is the world."*
3. *"The runtime model and the file on disk are not two representations of the same state kept in sync. They are the same bytes."*

V1 uses #1 — naming the absence and what is there instead, in the same rhythm as vignette 01's climax-key.
