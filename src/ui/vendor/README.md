# Anime4K model

`Anime4K_Upscale_CNN_x2_S.glsl` is the unmodified **Anime4K-v3.2 Upscale CNN
x2 S** network by bloc97, distributed under the MIT license printed at its top.

- [Pinned upstream source](https://github.com/bloc97/Anime4K/blob/28535a4aff3deb55707a36c2f2d05009e0cb7fb3/glsl/Upscale/Anime4K_Upscale_CNN_x2_S.glsl)
- Original downloaded file SHA-256 (LF line endings):
  `4c53ec2e287908f7ee7bcb266b0170421626d663576468b7d7dafc62962649a4`

`../anime4k-worker.js` supplies mpv's texture-coordinate macros and wraps each
hook as a GLSL ES 3.0 fragment program. Arithmetic and embedded network weights
are unchanged. Intermediate feature maps use RGBA16F; shader arithmetic uses
highp floats. Each 2× operation has four convolution passes and one depth-to-space
pass. 4× runs the same network twice. This is the small upscaling network, not
Anime4K's separate restoration, denoising, or GAN pipelines.

Magpie's `Anime4K_Upscale_S` also ports this upstream network. No Magpie host code
is included. Hentdows uses Chromium's WebGL2/ANGLE implementation, rather than
Magpie's native HLSL compute-shader host.
