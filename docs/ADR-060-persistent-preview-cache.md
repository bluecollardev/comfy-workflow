# ADR-060: The preview pictures survive a refresh and a restart

Status: accepted, 2026-11-25. Lucas: "on app refresh why do we have to reload all the previews, add a cache for this that survives restart."

## What was cached before, and why it was lost

- The first-frame DPX previews (`utils/thumbs.js`, ADR-045) were already in IndexedDB, as data URLs.
- Everything the pod makes (the per-frame JPEGs and thumbs of Frame Previews, video posters, image thumbnails) was a plain `<img src="…/view?…">`, held only by the browser's own HTTP cache, which a pod proxy, a `podfile://` address or an app restart does not keep.
- A video's first frame captured in the page (`utils/videothumb.js`) was held in a module `Map`: gone on refresh.

## Decision

`utils/imgcache.js` keeps the small picture bytes in IndexedDB (`pod-manager-images-v1`), and `components/CachedImg.vue` is an `<img>` that asks it first.

- **Key**: the picture's address without its host (path + query: filename, subfolder, type, preview size), so the same file through a pod proxy, `podfile://` or a stopped pod's record is one entry; an `s3file://` address is kept whole. Captured video frames use `frame|<key>`.
- **Stamp**: an optional file size/time. A different stamp is a miss and the record is dropped. A finished Frame Previews job with Skip Existing off forgets the pictures of its folders (`forget`).
- **Cap**: 300 MB in total, least recently used evicted first (a hit refreshes the time). The oldest are found from a small `idx` store, so no picture is read to evict.
- **Version**: in the database name (`-v1`); a new version starts clean.
- **Served**: from the cache as an object URL made on demand and revoked when the picture changes or the tile unmounts. A miss is fetched once (six at a time, one fetch per address however many tiles ask), kept, and shown. If the page cannot fetch it, the app's own reader is tried (as for DPX); if that fails too, the `<img>` loads the address itself, as before.
- **Storage blocked** (private window, no IndexedDB): every access is guarded; the cache falls back to memory for the session and nothing breaks.
- **Clear**: the existing Clear Preview Cache button in the Outputs window now clears this cache too.

## What is not cached

Full DPX frames, ever. Only `image/*` answers of at most 1 MB are kept (a preview JPEG is a few KB to about 30 KB); anything else is shown but not stored. Not cached either: the DPX viewer's frames, videos, data files.

## Tests

`src/utils/imgcache.test.mjs` (key, stamp, cap and LRU, throwing backend); `e2e/preview-cache.spec.js` (reload shows the previews from the cache with no `/view` request, a changed stamp is fetched again, Clear forgets, storage blocked still renders).
