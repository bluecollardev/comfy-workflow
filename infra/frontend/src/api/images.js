import axios from 'axios';
import { API_BASE } from './pods';

export const imagesAPI = {
  // ENV defaults → { source, image, env: [{ key, value }] }
  //   source 'image'      — from the image's registry config; image is a ref or 'prebuilt'
  //   source 'dockerfile' — from the repo's infra/docker/Dockerfile
  async env({ source = 'image', image = 'prebuilt' } = {}) {
    const { data } = await axios.get(`${API_BASE}/images/env`, { params: { source, image } });
    return data;
  },
};
