import * as THREE from 'three';
import { PIXEL_YAW, PIXEL_ELEVATION, pixelViewSpan, pixelResolution } from './pixelConfig.js';

export class PixelCamera {
  constructor(width, height, cityRadius) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 6000);
    this.camera.name = 'Town.pixelCamera';
    this.target = new THREE.Vector3();
    this.direction = new THREE.Vector3(Math.sin(PIXEL_YAW) * Math.cos(PIXEL_ELEVATION), Math.sin(PIXEL_ELEVATION), Math.cos(PIXEL_YAW) * Math.cos(PIXEL_ELEVATION));
    this.cityRadius = cityRadius;
    this.levels = { diorama: 1, walk: 1, drive: 1 };
    this.view = 'diorama';
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width; this.height = height;
    const span = pixelViewSpan(this.view, this.levels[this.view], this.cityRadius);
    this.span = span;
    this.camera.top = span / 2; this.camera.bottom = -span / 2;
    this.camera.right = span * width / Math.max(1, height) / 2; this.camera.left = -this.camera.right;
    this.camera.updateProjectionMatrix();
  }

  setView(view) {
    this.view = ['walk', 'drive'].includes(view) ? view : 'diorama';
    this.resize(this.width, this.height);
  }

  setZoom(level) {
    this.levels[this.view] = THREE.MathUtils.clamp(level, 0, 2);
    this.resize(this.width, this.height);
    return this.levels[this.view];
  }

  update(target, dt = 0, snap = false) {
    this.target.lerp(target, snap ? 1 : 1 - Math.exp(-dt * 10));
    const point = this.target.clone();
    const resolution = pixelResolution(this.width, this.height);
    const unit = this.span / resolution.height;
    const right = new THREE.Vector3(Math.cos(PIXEL_YAW), 0, -Math.sin(PIXEL_YAW));
    const up = new THREE.Vector3().crossVectors(this.direction, right).normalize();
    // Snap in camera space: ground-plane rounding alone still crawls diagonally.
    point.addScaledVector(right, Math.round(point.dot(right) / unit) * unit - point.dot(right));
    point.addScaledVector(up, Math.round(point.dot(up) / unit) * unit - point.dot(up));
    this.camera.position.copy(point).addScaledVector(this.direction, 420);
    this.camera.lookAt(point);
    this.camera.updateMatrixWorld();
  }
}
