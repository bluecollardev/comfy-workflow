import axios from 'axios';
import { API_BASE } from './pods';
import { core } from './bridge';

// ENV defaults → { source, image, env: [{ key, value }], build_args: [{ key, value }], skipped, build_source }
//   source 'image'      — from the image's config; image is a ref or 'prebuilt'
//   source 'dockerfile' — from the repo's apps/comfy-app/Dockerfile
// Inside Electron the core answers over IPC (images.ts); in a browser the API over HTTP.
const ipc = core && {
  env: ({ source = 'image', image = 'prebuilt' } = {}) => core.invoke('images', 'env', [{ source, image }]),
};

const http = {
  async env({ source = 'image', image = 'prebuilt' } = {}) {
    const { data } = await axios.get(`${API_BASE}/images/env`, { params: { source, image } });
    return data;
  },
};

export const imagesAPI = ipc || http;
