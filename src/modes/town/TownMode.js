import * as THREE from 'three';

// Placeholder while the real mode is built
export default class TownMode {
  constructor(ctx, route) {
    this.ctx = ctx;
    this.route = route;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  }
  enter() {}
  update() {}
  render() {
    this.ctx.engine.renderer.render(this.scene, this.camera);
  }
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  depart() {
    return { cover: 'fade' };
  }
  exit() {}
}
