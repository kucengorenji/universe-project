import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { pixelResolution } from './pixelConfig.js';

export class PixelRenderer {
  constructor(engine) {
    this.engine = engine;
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, samples: 0 });
    this.target.texture.name = 'Town.pixelScene';
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.target.texture } }, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main(){vec4 c=texture2D(map,vUv);gl_FragColor=c;#include <colorspace_fragment>}`.replace(';#', ';\n#')
    });
    this.quad = new FullScreenQuad(this.material);
    this.resize();
  }

  resize() {
    const { width, height } = this.engine.size;
    this.resolution = pixelResolution(width, height);
    this.target.setSize(this.resolution.width, this.resolution.height);
  }

  render(scene, camera, silhouette) {
    const r = this.engine.renderer, previous = r.getRenderTarget();
    const tone = r.toneMapping, exposure = r.toneMappingExposure;
    try {
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.setRenderTarget(this.target); r.render(scene, camera);
      silhouette?.(r, camera);
      r.setRenderTarget(null); this.quad.render(r);
    } finally {
      r.setRenderTarget(previous); r.toneMapping = tone; r.toneMappingExposure = exposure;
    }
  }

  dispose() { this.target.dispose(); this.material.dispose(); this.quad.dispose(); }
}
