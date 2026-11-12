import * as THREE from 'three';

// Shared dynamic-light uniforms (muzzle flashes, rockets, explosions, torch flicker).
export const MAX_DL = 8;
export const dlPos = { value: Array.from({ length: MAX_DL }, () => new THREE.Vector4(0, 0, 0, 1)) };
export const dlCol = { value: Array.from({ length: MAX_DL }, () => new THREE.Vector3()) };
const noPos = { value: Array.from({ length: MAX_DL }, () => new THREE.Vector4(0, 0, 0, 1)) };
const noCol = { value: Array.from({ length: MAX_DL }, () => new THREE.Vector3()) };
export const uTime = { value: 0 };
export const uPointScale = { value: 300 };

const DL = `
uniform vec4 dlPos[8]; uniform vec3 dlCol[8];
vec3 dynLight(vec3 wp){ vec3 l=vec3(0.); for(int i=0;i<8;i++){ float a=max(0.,1.-distance(wp,dlPos[i].xyz)/dlPos[i].w); l+=dlCol[i]*a; } return l; }
// banded, overbright lighting like an 8-bit colormap
vec3 shade(vec3 t, vec3 l){ l=min(l,vec3(1.3)); l=floor(l*40.+.5)/40.; return t*l*2.; }
`;

export function worldMat(tex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, dlPos, dlCol },
    vertexShader: `attribute vec3 aLight; varying vec3 vLight; varying vec2 vUv; varying vec3 vW;
      void main(){ vUv=uv; vLight=aLight; vec4 wp=modelMatrix*vec4(position,1.); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vLight; varying vec2 vUv; varying vec3 vW; ${DL}
      void main(){ vec3 t=texture2D(map,vUv).rgb; gl_FragColor=vec4(shade(t,vLight+dynLight(vW)),1.); }`,
  });
}

export function modelMat(tex: THREE.Texture, light: { value: THREE.Vector3 }, tint = 0xffffff, full = 0, view = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex }, uLight: light, uTint: { value: new THREE.Color(tint) }, uFull: { value: full },
      dlPos: view ? noPos : dlPos, dlCol: view ? noCol : dlCol,
    },
    vertexShader: `varying vec2 vUv; varying vec3 vW; varying float vSh;
      void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.); vW=wp.xyz;
        vec3 n=normalize(mat3(modelMatrix)*normal); vSh=0.74+0.3*dot(n,normalize(vec3(0.35,0.85,0.4)));
        gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uLight; uniform vec3 uTint; uniform float uFull; varying vec2 vUv; varying vec3 vW; varying float vSh; ${DL}
      void main(){ vec3 t=texture2D(map,vUv).rgb*uTint; vec3 c=shade(t,(uLight+dynLight(vW))*vSh); gl_FragColor=vec4(mix(c,t,uFull),1.); }`,
  });
}

/** Warping liquid / portal surface (classic sine turbulence). */
export function liquidMat(tex: THREE.Texture, alpha = 1, speed = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime, uAlpha: { value: alpha }, uSpeed: { value: speed } },
    transparent: alpha < 1, side: THREE.DoubleSide, depthWrite: alpha >= 1,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D map; uniform float uTime; uniform float uAlpha; uniform float uSpeed; varying vec2 vUv;
      void main(){ float t=uTime*1.4*uSpeed; vec2 uv=vUv+vec2(sin(vUv.y*12.566+t),sin(vUv.x*12.566+t))*0.06+vec2(uTime*0.012,0.);
        gl_FragColor=vec4(texture2D(map,uv).rgb,uAlpha); }`,
  });
}

/** Two-layer scrolling cloud dome projected from the view direction. */
export function skyMat(tex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uTime },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp=modelMatrix*vec4(position,1.); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D map; uniform float uTime; varying vec3 vW;
      void main(){ vec3 d=vW-cameraPosition; d.y*=3.; d=normalize(d);
        vec2 uv=d.xz*1.5;
        vec3 back=texture2D(map,uv+uTime*0.02).rgb*0.5;
        vec3 front=texture2D(map,uv*1.9+vec2(uTime*0.06,uTime*0.045)+.37).rgb;
        float a=step(0.3,max(front.r,front.b));
        gl_FragColor=vec4(mix(back,front*0.95,a),1.); }`,
  });
}

/** Chunky square software-renderer style particles. */
export function particleMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: uPointScale },
    vertexShader: `attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vC;
      void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=max(1.,aSize*uScale/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ gl_FragColor=vec4(vC,1.); }`,
  });
}
