# Anime4K reader implementation — 2026-10-02

The reader now uses Anime4K's small 2× CNN, with an optional second pass for 4×.
The default is 2× plus three-page lookahead. This changes the algorithm from the
earlier Real-ESRGAN feasibility study after the user identified their fast Magpie
preset as Anime4K. Neither the quality nor the performance of the two networks
should be treated as interchangeable.

## Why Magpie can exceed 100 FPS

[Magpie's effect documentation](https://github.com/Blinue/Magpie/blob/dev/docs/Built-in%20effects.md)
lists multiple algorithms, including Anime4K, FSR, NIS and CuNNy.
[Its Anime4K_Upscale_S shader](https://github.com/Blinue/Magpie/blob/dev/src/Effects/Anime4K/Anime4K_Upscale_S.hlsl)
ports the same [small upstream network](https://github.com/bloc97/Anime4K/blob/28535a4aff3deb55707a36c2f2d05009e0cb7fb3/glsl/Upscale/Anime4K_Upscale_CNN_x2_S.glsl)
bundled here. The weights are compiled directly into GPU shaders. This is much
less computation than the Real-ESRGAN model used in the original study.

Hentdows runs the five passes through WebGL2 in a persistent OffscreenCanvas
worker. On the tested machine, Chromium selected ANGLE's Direct3D11 backend on
the RTX 5070 Ti. Feature textures use FP16 storage; arithmetic uses highp float.
Magpie uses its own HLSL host and supports FP16 shader variants, so matching the
algorithm does not promise identical speed or pixels for every Magpie preset.
The user's exact Anime4K size/restoration chain was not specified.

100 FPS gives a 10 ms frame budget. The measured 2× GPU work fits comfortably
inside that budget, but page preparation also involves decoded image transfer,
texture allocation, GPU synchronization and creation of a reusable bitmap.
Those costs must not be reported as shader FPS, or confused with drive reads.

## Local synthetic measurement

Only generated geometric patterns and fresh temporary profiles were used.
No existing library images, manifests or databases were read for this feature.
The earlier study's real-library access was not reused.

Representative validated run: `artifacts/upscale-smoke-aNKmbY/measurements.json`.
Input: 1280 × 1810 synthetic PNG; RTX 5070 Ti; Electron 44.4.5.

| Measurement | 2× → 2560 × 3620 | 4× → 5120 × 7240 |
| --- | ---: | ---: |
| First page's worker elapsed time | 88.4 ms | 170.1 ms |
| Subsequent retained pages' worker elapsed time | 35.1–45.9 ms | 136.2–137.6 ms |
| GPU timer span for those subsequent pages | 1.28–1.83 ms | 16.6–23.9 ms |
| Cached enhanced page memory | 35.4 MiB each | 141.4 MiB each |

Elapsed time starts inside the worker after receiving the input bitmap and ends
after the GPU fence signals. It excludes source read/decode, main-thread bitmap
creation, final display painting, and queue delay. The GPU timer covers the
scaling/output command span, not initial source upload. The 4× span includes
strip composition overhead and varied across runs. These are small-sample smoke
measurements, not sustained throughput or a visual-quality assessment. Different
inputs, GPU load, drivers and power state change the results.

Chromium reduced a 5120 × 7240 WebGL drawing buffer on this device even though
the dimensions fit MAX_TEXTURE_SIZE. The worker detects this and composes
2048-row strips into a full-size output; tests assert the exact dimensions.

## Reader behavior and limits

- Compile the network at application renderer startup, and keep it loaded
  through reader/book closures. A GPU/worker failure falls back to originals
  for the rest of that app session.
- Display and decode the original through the existing no-flash reader path.
  Allow an original paint, then replace it with the prepared enhancement.
  Cached enhancements follow the same original-first sequence.
- Keep current pages first in the queue, then the next three images (including
  in vertical and two-page reading). Rapid navigation removes obsolete queued
  work; an already-running GPU operation finishes and its stale result is freed.
- Retain decoded originals so a prefetched page needs no new source read.
  The GPU receives an ImageBitmap from that decoded image, not a library path.
- Bound original cache to 64 MiB and enhanced cache to 512 MiB. At the measured
  4× size, current + two next pages fit; the third next enhancement is discarded.
  It is retried when it becomes current. Display canvases and GPU temporary
  textures are outside these cache budgets, so process memory can be higher.
- Upscale images with longest side below 2048 and output at most 40 megapixels.
  Unsupported size, GPU failure or page failure leaves the original available.
- Preserve crop/rotation/color-filter behavior. Cropping samples the original
  to maintain framing. The existing 4096-side limit on cropped/rotated canvases
  remains in effect.
- Close page bitmaps when evicted or the reader closes. No enhanced files are
  written to either library location. Prefetch never marks a page read.

## Validation

`npm test` includes queue ordering, stale result disposal, model lifetime,
cache budget, retry after memory eviction, and unavailable-GPU behavior.
`npm run smoke:upscale` exercises real hardware with generated fixtures:
CPU/GPU parity (maximum channel difference 1/255 on a tiny pattern), image
orientation, original-first painting, three-page lookahead, no additional drive
read for a cached original, no false reading progress, rapid paging, exact 4×
dimensions, memory bounds, vertical page jumps, and model residency after close.
Existing reader and transition smoke tests cover software-GPU fallback, delayed
decode, failed-page Retry, spread transitions, crop, rotation and navigation.
All 64 unit tests passed. The hardware upscaling and transition smoke tests also
passed against `dist/0.9.0/Hentdows-win32-x64/resources/app.asar`, using fresh
synthetic profiles.

The vendor file retains the complete MIT license and attribution. No Magpie
application code was copied. No native executable, model download at runtime,
external service, or Python installation is needed by the packaged app.
