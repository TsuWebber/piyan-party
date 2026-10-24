// 3D 娃娃屋視角：牆壁切半高度，從上方可以看到每個房間和每個人
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeLabel } from './labels.js';
import { bounds, outlineSegments, roomCenter } from './store.js';

const WALL_H = 1.4;
const WALL_T = 0.08;

export function createHouse(container, { onRoomClick }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9edf2');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3;
  controls.maxDistance = 60;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9384, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#dfe4d6' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  scene.add(group);
  let floors = [];
  let fitted = false;
  let running = false;

  function clear() {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    group.clear();
    floors = [];
  }

  function rebuild(state, { names = true } = {}) {
    clear();
    const wallMat = new THREE.MeshStandardMaterial({ color: '#fbfaf8' });
    for (const r of state.rooms) {
      const floorMat = new THREE.MeshStandardMaterial({ color: r.color });
      for (const q of r.rects) {
        const floor = new THREE.Mesh(new THREE.BoxGeometry(q.w, 0.06, q.h), floorMat);
        floor.position.set(q.x + q.w / 2, 0.03, q.y + q.h / 2);
        floor.receiveShadow = true;
        floor.userData.roomId = r.id;
        group.add(floor);
        floors.push(floor);
      }
      // 牆沿著房間外框（L 型也正確）
      for (const sg of outlineSegments(r)) {
        const horiz = sg.y1 === sg.y2;
        const len = horiz ? sg.x2 - sg.x1 : sg.y2 - sg.y1;
        const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len + WALL_T : WALL_T, WALL_H, horiz ? WALL_T : len + WALL_T), wallMat);
        m.position.set((sg.x1 + sg.x2) / 2, WALL_H / 2, (sg.y1 + sg.y2) / 2);
        m.castShadow = m.receiveShadow = true;
        group.add(m);
      }
      if (names) {
        const c = roomCenter(r);
        const label = makeLabel(r.name, { bg: 'rgba(255,255,255,.88)' });
        label.scale.set(label.userData.aspect * 0.42, 0.42, 1);
        label.position.set(c.x, WALL_H + 0.45, c.y);
        group.add(label);
      }
    }

    const b = bounds(state.rooms);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 4);
    sun.position.set(cx + span * 0.6, span * 1.5, cz + span * 0.4);
    sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    if (!fitted) {
      fitted = true;
      controls.target.set(cx, 0, cz);
      camera.position.set(cx + span * 0.15, span * 0.95, cz + span * 0.9);
      controls.update();
    }
  }

  // 點地板 → 進入那個房間的全景
  const ray = new THREE.Raycaster();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(floors)[0];
    if (hit) onRoomClick(hit.object.userData.roomId);
  });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    rebuild,
    start() { if (running) return; running = true; resize(); loop(); },
    stop() { running = false; },
  };
}
