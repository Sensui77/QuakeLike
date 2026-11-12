/// <reference types="vite/client" />
import * as THREE from 'three';

// All palettized textures are inlined by the bundler.
const mods = import.meta.glob('../assets/tex/*.png', { eager: true, import: 'default' }) as Record<string, string>;

export const images: Record<string, HTMLImageElement> = {};
export const textures: Record<string, THREE.Texture> = {};

export function loadTextures(): Promise<void[]> {
  return Promise.all(
    Object.entries(mods).map(
      ([path, url]) =>
        new Promise<void>((res, rej) => {
          const name = path.split('/').pop()!.replace('.png', '');
          const img = new Image();
          img.onload = () => {
            images[name] = img;
            const t = new THREE.Texture(img);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.magFilter = THREE.NearestFilter;
            t.minFilter = THREE.NearestMipmapLinearFilter;
            t.colorSpace = THREE.NoColorSpace;
            t.needsUpdate = true;
            textures[name] = t;
            res();
          };
          img.onerror = () => rej(new Error('texture failed: ' + name));
          img.src = url;
        }),
    ),
  );
}
export const T = (n: string): THREE.Texture => textures[n];
export const texSize = (n: string): number => (images[n] ? images[n].width : 128);
