# RTX 5070 Ti upscaling study — 2026-10-02

**2× AI upscaling is a practical candidate for background prefetching on this
machine. GPU work did not materially slow reads from either registered library
location. Starting a separate upscaler process for every page would introduce
roughly 1.2–1.4 seconds of delay and should be avoided.**

This is a performance study, not an upscaling implementation or a visual-quality
review. The user explicitly authorized random library samples for this study,
without viewing the images. That limited authorization superseded the ordinary
`AGENTS.md` library-access restriction for these measurements only. No images
were displayed, uploaded, or included in this report. The main app was not
launched against the real profile. Source files were read-only; anonymous working
copies were removed after measurement. The normal repository restrictions remain.

Hardware: NVIDIA GeForce RTX 5070 Ti, 16,303 MiB VRAM, driver 610.62; Intel
Core i7-12700K; 31.8 GiB system RAM. Ordinary desktop applications remained open.
Baseline GPU activity was approximately 13% with 4.4 GiB VRAM already allocated,
so this was a normal desktop session rather than an exclusive GPU laboratory run.

| Library location | Device identified by Windows |
| --- | --- |
| `G:\HentdowsLibrary` | Great Wall GW3500 1TB, NVMe |
| `E:\MyFiles\.Hentoid` | Generic STORAGE DEVICE, USB; underlying medium not identified |

The primary model was `realesr-animevideov3`, using the official portable
Real-ESRGAN ncnn Vulkan Windows build dated 20220424. It supports native 2× and
4× variants. GPU 0 was explicitly selected and reported as the RTX 5070 Ti with
FP16 support. The larger `realesrgan-x4plus-anime` model was also timed on three
samples to illustrate how strongly model choice affects performance.
[Backend and options](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan),
[model documentation and release](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/anime_video_model.md).

The downloaded archive's SHA-256 was
`abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d`.
This records the measured artifact; it is not a claim of publisher signature
verification. This older portable backend is a reproducible candidate, not a
claim about the best achievable CUDA/TensorRT or newer ncnn performance.

Twenty-four random pages were selected, one from each of 24 distinct book
folders, with 12 per location. Selection was randomized through source/book
folders, not uniform over every page in the entire library. Eligibility was
portrait, width at least 500, and **800 ≤ height < 2048 pixels**. “Under 2K” thus
means the long edge here. Book titles, JSON manifests and book records were not
needed; the profile database was queried only for registered root paths.

| Sample group | Formats | Width range | Height range | Median input size | Median pixels |
| --- | --- | ---: | ---: | ---: | ---: |
| G: — 12 pages | 12 WebP | 1280 | 1791–1820 | 286 KiB | 2.31 MP |
| E: — 12 pages | 6 JPEG, 6 WebP | 780–1280 | 1067–1866 | 202 KiB | 1.25 MP |

For GPU comparisons, the decoded samples were normalized to anonymous RGB PNGs
in a temporary directory on **D: (Samsung 980 PRO)**. Upscaled JPEGs also went to
that temporary directory, and their dimensions were checked without viewing.
This separates GPU/model measurements from source-drive and source-codec
differences. No output files or benchmark caches were written to E: or G:.

| Measured operation | G: sample group | E: sample group |
| --- | ---: | ---: |
| 2×, sustained batch output interval | **128 ms/image** | **79 ms/image** |
| 4×, sustained batch output interval | **154 ms/image** | **101 ms/image** |
| 2×, separate process per image, median elapsed | 1.321 s | 1.197 s |
| 4×, separate process per image, median elapsed | 1.392 s | 1.367 s |
| Original image CPU decode, Pillow, median | 41.7 ms | 13.2 ms |

The faster AI numbers for the E: group are due to its smaller images, **not a
faster drive**. The comparable larger-page group is around 1280×1810 input:
2× produces roughly 2560×3620, and 4× roughly 5120×7240.

Batch figures are the median of three 12-image runs per group and scale. Each
run's interval is `(last completion − first completion) / 11`. Load, inference,
and save run as a pipeline with `-j 1:1:1`, automatic tiling, no TTA, and GPU 0.
The 2× repeated intervals were 127.4–129.3 ms for G: and 78.2–79.5 ms for E:;
4× intervals were 152.1–156.3 and 100.3–100.7 ms respectively.

These are **sustained throughput measurements**, including pipelined decoding,
GPU work, JPEG encoding and temporary output writes. They are not pure GPU
inference timings, nor a measured single-page, already-initialized
click-to-display latency. First batch output took approximately 0.97–1.12 s,
including model/device setup. Separate-process timings also include teardown.
An integrated, persistent worker that returns pixels instead of saving JPEGs
must still be measured before promising a reader latency target.

On three samples, the larger `realesrgan-x4plus-anime` model took
**2.33–2.90 s per image at 4×**, including process startup and file output. The
fast model's numbers must not be generalized to every AI upscaler. Visual
quality, text preservation and restoration artifacts were not assessed.

The drive test used read-only Windows `FILE_FLAG_NO_BUFFERING` reads with an
aligned buffer, including file open/read/close time. This bypasses the Windows
file cache without flushing the machine's caches; device/controller caching
and cached filesystem metadata may remain. A matched follow-up measured the
same 24 samples twice, before and during a 4× GPU batch. Explicitly warmed
ordinary reads were measured separately after one unmeasured warm-up read.

| Source read measurement, median | G: before GPU | G: during GPU | E: before GPU | E: during GPU |
| --- | ---: | ---: | ---: | ---: |
| OS-cache-bypassed read | **0.90 ms** | **0.88 ms** | **17.11 ms** | **17.01 ms** |
| Explicitly warmed cached read | 0.115 ms | 0.110 ms | 0.176 ms | 0.244 ms |

There was no material source-read slowdown in this workload. USB reads were
more variable: the matched test's maximum was about 86–87 ms, versus 3–4 ms on
G:. These are small-image reads, not a sequential drive bandwidth benchmark.
The study did not test writing an upscale cache to E: or G:, thermal soak,
heavy gaming alongside upscaling, or the entire library's worst case.

For Hentdows, the recommended design is an optional **2× mode with one
persistent GPU worker**, prefetching the next one or two pages. Show the original
immediately, then replace it when the upscale is ready, retaining the existing
no-black-flash behavior. Cancel obsolete work after rapid navigation, prioritize
the current page, and bound the cache. This should hide much of the additional
processing during ordinary reading, but that is an architectural inference
from the throughput measurements, not a tested product behavior.

4× should be optional, primarily for deep zoom. A decoded RGBA page at a
1280×1810 input size occupies about **35.4 MiB at 2×** and **141.4 MiB at 4×**,
before extra copies or GPU buffers. The 4× pipeline was only moderately slower
for this compact model, but its output holds four times as many pixels as 2×.
Ordinary display scaling remains the lowest-cost option when AI restoration
is unnecessary; the CPU Lanczos comparison was about 90 ms at 2× and 304 ms at
4× across these samples and is not an Electron GPU-scaling benchmark.

Anonymized numerical measurements and the one-off benchmark scripts remain
locally under `artifacts/upscale-study/`. That directory is ignored by Git.
The scripts are study artifacts, not automated tests, and must not be rerun
against a real library without fresh authorization. No upscaling feature or
application settings were changed in this study.
