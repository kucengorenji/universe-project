import * as THREE from 'three';
import { PixelCamera } from './pixelCamera.js';
import { PixelRenderer } from './pixelRenderer.js';
import { PixelVegetation, surfacePixels } from './pixelAssets.js';
import { PIXEL_YAW } from './pixelConfig.js';
import { pixelBridgeDecks } from './pixelBridge.js';
import { pixelBuildingOccluded } from './pixelOcclusion.js';

export class TownPixelStyle {
  constructor(mode) {
    this.mode = mode;
    const { width, height } = mode.ctx.engine.size;
    this.rig = new PixelCamera(width, height, mode.layout.cityR);
    this.renderer = new PixelRenderer(mode.ctx.engine);
    this.uniforms = {
      uPixelFocus: { value: new THREE.Vector2(-1000, -1000) }, uPixelFocusDepth: { value: 0 },
      uPixelFocusRadius: { value: 18 }, uPixelActor: { value: 0 }, uPixelNight: { value: 0 }
    };
    this.vegetation = new PixelVegetation(mode, this.uniforms);
    mode.scene.add(this.vegetation.group); this.vegetation.group.visible = false;
    this.bridges = pixelBridgeDecks(mode.builder);
    mode.scene.add(this.bridges.group); this.bridges.group.visible = false;
    const pixels = surfacePixels();
    this.surfaces = new THREE.DataArrayTexture(pixels.data, pixels.width, pixels.height, pixels.depth);
    this.surfaces.magFilter = this.surfaces.minFilter = THREE.NearestFilter;
    this.surfaces.wrapS = this.surfaces.wrapT = THREE.RepeatWrapping;
    this.surfaces.generateMipmaps = false; this.surfaces.needsUpdate = true;
    this.materials = new Map(); this.bindings = []; this.textures = [];
    mode.scene.traverse(mesh => {
      if (!mesh.isMesh || mesh.parent === this.vegetation.group || mesh === mode.builder.water) return;
      if (!mesh.material || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => m.isShaderMaterial)) return;
      const original = mesh.material;
      const styled = Array.isArray(original) ? original.map(m => this.material(m)) : this.material(original);
      this.bindings.push({ mesh, original, styled });
    });
    this.waterOriginal = mode.builder.water?.material;
    if (this.waterOriginal) {
      this.waterStyled = this.waterOriginal.clone();
      // Water keeps its analytical shore/depth masks; quantized ripples belong to this style only.
      this.waterStyled.fragmentShader = this.waterStyled.fragmentShader
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb=floor(gl_FragColor.rgb*24.+.5)/24.;\n#include <tonemapping_fragment>');
      for (const [key, uniform] of Object.entries(this.waterOriginal.uniforms)) this.waterStyled.uniforms[key] = uniform;
    }
    this.silhouette = new THREE.MeshBasicMaterial({ color: '#ffdc86', depthFunc: THREE.GreaterDepth, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.focus = new THREE.Vector3(); this.projected = new THREE.Vector3(); this.viewPoint = new THREE.Vector3();
    this.occluded = false;
    this.blockers = [...new Set([...mode.cameraBlockers.map.values()].flat())];
  }

  material(source) {
    if (this.materials.has(source)) return this.materials.get(source);
    const material = source.clone();
    material.defaultAttributeValues = { ...source.defaultAttributeValues, surface: [0, 0, 0] };
    if (source.map) {
      const texture = source.map.clone(); texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestMipmapNearestFilter; texture.needsUpdate = true;
      material.map = texture; this.textures.push(texture);
    }
    material.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile?.(shader, renderer);
      if (source === this.mode.builder.terrainMaterial) {
        shader.fragmentShader = shader.fragmentShader.replace(
          'float g = texture2D(uDetail, vGround.xz * 0.11).r * 0.6 + texture2D(uDetail, vGround.xz * 0.023).r * 0.4;',
          'float g = texture2D(uDetail, floor(vGround.xz * 1.5) / 1.5 * .04).r;'
        );
        if (this.mode.planet.type === 'terran') shader.fragmentShader = shader.fragmentShader.replace(
          'diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb * (0.94 + g * 0.1), paint.a);',
          `if(paint.a<.05&&diffuseColor.g>diffuseColor.r*1.04&&diffuseColor.g>diffuseColor.b*1.1)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.17,.44,.28),.3);
           diffuseColor.rgb = mix(diffuseColor.rgb, paint.rgb * (0.94 + g * 0.1), paint.a);`
        );
      }
      shader.uniforms.uPixelSurfaces = { value: this.surfaces };
      const declared = shader.vertexShader.includes('attribute vec3 surface;') ? '' : 'attribute vec3 surface;';
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        ${declared} varying vec3 vPixelWorld; varying vec3 vPixelNormal; varying float vPixelSemantic;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 pixelWorld=vec4(transformed,1.);
          #ifdef USE_INSTANCING
            pixelWorld=instanceMatrix*pixelWorld;
          #endif
          vPixelWorld=(modelMatrix*pixelWorld).xyz;
          vPixelNormal=normalize(mat3(modelMatrix)*normal);
          vPixelSemantic=surface.z;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform highp sampler2DArray uPixelSurfaces;
        varying vec3 vPixelWorld; varying vec3 vPixelNormal; varying float vPixelSemantic;`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          vec3 pixelNormal=abs(normalize(vPixelNormal));
          vec2 pixelPlane=pixelNormal.y>pixelNormal.x&&pixelNormal.y>pixelNormal.z?vPixelWorld.xz:pixelNormal.x>pixelNormal.z?vPixelWorld.zy:vPixelWorld.xy;
          float pixelSemantic=vPixelSemantic>.5?clamp(floor(vPixelSemantic+.5),0.,15.):(pixelNormal.y>.7?12.:1.);
          vec3 pixelPigment=texture(uPixelSurfaces,vec3(pixelPlane*.32,pixelSemantic)).rgb;
          diffuseColor.rgb*=mix(vec3(1.),pixelPigment/.80,.7);`)
        .replace('#include <dithering_fragment>', 'gl_FragColor.rgb=floor(clamp(gl_FragColor.rgb,0.,1.)*31.+.5)/31.;\n#include <dithering_fragment>');
    };
    material.customProgramCacheKey = () => `${source.customProgramCacheKey()}:town-pixel-surface-v1`;
    this.materials.set(source, material); return material;
  }

  setActive(active) {
    this.active = active;
    for (const { mesh, original, styled } of this.bindings) mesh.material = active ? styled : original;
    if (this.waterOriginal) this.mode.builder.water.material = active ? this.waterStyled : this.waterOriginal;
    this.vegetation.group.visible = active;
    this.bridges.group.visible = active;
    this.mode.builder.lodView = null;
    if (!active) {
      for (const chunk of this.mode.builder.chunks) for (const set of chunk.sets) set.level.fill(-1);
    }
  }

  setView(view) { this.rig.setView(view); }
  setZoom(level) { return this.rig.setZoom(level); }

  update(dt, snap = false) {
    const m = this.mode, actor = m.view === 'drive' && m.drive ? m.drive.car : m.player;
    if (m.view === 'diorama') this.focus.copy(m.orbit.target);
    else this.focus.set(actor.x, actor.y + (m.view === 'drive' ? 1 : 1.1) + (actor.jump || 0), actor.z);
    this.rig.update(this.focus, dt, snap);
    const camera = this.rig.camera;
    if (m.view === 'walk') m.follow.yaw = PIXEL_YAW;
    this.uniforms.uPixelActor.value = m.view === 'diorama' ? 0 : 1;
    this.uniforms.uPixelNight.value = m.night || 0;
    this.projected.copy(this.focus).project(camera);
    const resolution = this.renderer.resolution;
    this.uniforms.uPixelFocus.value.set((this.projected.x * .5 + .5) * resolution.width, (this.projected.y * .5 + .5) * resolution.height);
    this.viewPoint.copy(this.focus).applyMatrix4(camera.matrixWorldInverse);
    this.uniforms.uPixelFocusDepth.value = -this.viewPoint.z;
    this.uniforms.uPixelFocusRadius.value = Math.max(12, resolution.height / this.rig.span * (m.view === 'drive' ? 3.7 : 1.9));
    this.occluded = m.view !== 'diorama' && pixelBuildingOccluded(this.focus, camera.position, this.blockers);
    // The builder sorts LOD visibility every frame; suppress only the species replaced by pixel cards.
    const flora = m.builder.look.flora;
    if (!['dry', 'none'].includes(flora)) for (const chunk of m.builder.chunks) for (const set of chunk.sets) for (const lod of set.lods) for (const mesh of lod.meshes) {
      if (/t_oak|t_birch|t_pine|t_spruce|t_cypress|t_fruit|tree_round|tree_pine|b_bush|bush|g_tuft|grass_tuft|b_flowers/.test(mesh.userData.townAsset || '')) mesh.visible = false;
    }
  }

  drawSilhouette(renderer, camera) {
    const m = this.mode;
    const root = m.view === 'drive' ? m.drive?.obj : m.avatar?.root;
    if (!this.occluded || !root?.visible) return;
    const mask = camera.layers.mask, clear = renderer.autoClear, override = m.scene.overrideMaterial, background = m.scene.background;
    const layers = [];
    try {
      root.traverse(mesh => { if (mesh.isMesh) { layers.push([mesh, mesh.layers.mask]); mesh.layers.enable(30); } });
      camera.layers.set(30); renderer.autoClear = false; m.scene.overrideMaterial = this.silhouette; m.scene.background = null;
      renderer.render(m.scene, camera);
    } finally {
      layers.forEach(([mesh, layer]) => mesh.layers.mask = layer);
      camera.layers.mask = mask; renderer.autoClear = clear; m.scene.overrideMaterial = override; m.scene.background = background;
    }
  }

  render() { this.renderer.render(this.mode.scene, this.rig.camera, (renderer, camera) => this.drawSilhouette(renderer, camera)); }
  resize(width, height) { this.renderer.resize(); this.rig.resize(width, height); }
  dispose() {
    this.setActive(false); this.mode.scene.remove(this.vegetation.group);
    this.mode.scene.remove(this.bridges.group); this.bridges.dispose();
    this.vegetation.dispose(); this.renderer.dispose(); this.surfaces.dispose();
    this.materials.forEach(material => material.dispose()); this.textures.forEach(texture => texture.dispose());
    this.waterStyled?.dispose(); this.silhouette.dispose();
  }
}
