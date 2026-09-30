import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ============ DOM ============
var canvas = document.getElementById("gameCanvas");
var hud = document.getElementById("hud");
var levelLabelEl = document.getElementById("levelLabel");
var muteBtn = document.getElementById("muteBtn");
var retryBtn = document.getElementById("retryBtn");
var hintEl = document.getElementById("hint");
var toastEl = document.getElementById("toast");

var startScreen = document.getElementById("startScreen");
var levelCompleteScreen = document.getElementById("levelCompleteScreen");
var allClearScreen = document.getElementById("allClearScreen");
var startBtn = document.getElementById("startBtn");
var nextLevelBtn = document.getElementById("nextLevelBtn");
var replayBtn = document.getElementById("replayBtn");
var starsRowEl = document.getElementById("starsRow");
var attemptsTextEl = document.getElementById("attemptsText");
var totalStarsRowEl = document.getElementById("totalStarsRow");
var bestStarsEl = document.getElementById("bestStars");

var STARS_KEY = "dahyeParking3dStars";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ============ sound ============
var audioCtx = null;
var MUTE_KEY = "dahyeParking3dMuted";
var muted = localStorage.getItem(MUTE_KEY) === "1";
function updateMuteBtn() { muteBtn.textContent = muted ? "🔇" : "🔊"; }
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* unsupported */ }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function beep(freq, dur, type, vol, delay) {
  if (muted || !audioCtx) return;
  var t0 = audioCtx.currentTime + (delay || 0);
  var osc = audioCtx.createOscillator();
  var gain = audioCtx.createGain();
  osc.type = type || "sine";
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol || 0.15, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
function sfxBlocked() { beep(140, 0.12, "square", 0.15); }
function sfxSuccess() {
  beep(523, 0.1, "sine", 0.15, 0);
  beep(659, 0.1, "sine", 0.15, 0.1);
  beep(784, 0.16, "sine", 0.16, 0.2);
}
function sfxFanfare() {
  beep(523, 0.12, "sine", 0.16, 0);
  beep(659, 0.12, "sine", 0.16, 0.12);
  beep(784, 0.12, "sine", 0.16, 0.24);
  beep(1046, 0.2, "sine", 0.18, 0.36);
}
muteBtn.addEventListener("click", function () {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  updateMuteBtn();
});
updateMuteBtn();

// ============ three.js setup ============
var W = window.innerWidth, H = window.innerHeight;
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2540);
scene.fog = new THREE.Fog(0x2b2540, 25, 100);

var camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 200);

var hemi = new THREE.HemisphereLight(0x9fb3ff, 0x332244, 0.75);
scene.add(hemi);
var sun = new THREE.DirectionalLight(0xfff2df, 1.1);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
scene.add(sun);

function resizeRenderer() {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  if (currentLevel) fitCameraToBounds(currentLevel.bounds);
}
window.addEventListener("resize", resizeRenderer);

function fitCameraToBounds(bounds) {
  var w = bounds.maxX - bounds.minX;
  var d = bounds.maxZ - bounds.minZ;
  var cx = (bounds.minX + bounds.maxX) / 2;
  var cz = (bounds.minZ + bounds.maxZ) / 2;
  var aspect = W / H;
  var vfov = camera.fov * Math.PI / 180;
  var hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  var margin = 1.55;
  var distW = (w * margin / 2) / Math.tan(hfov / 2);
  var distD = (d * margin / 2) / Math.tan(vfov / 2);
  var dist = Math.max(distW, distD);
  var elev = 55 * Math.PI / 180;
  camera.position.set(cx, dist * Math.sin(elev), cz - dist * Math.cos(elev));
  camera.lookAt(cx, 0, cz);
}

// ============ car mesh builder ============
var CAR_HALF_LEN = 1.2, CAR_HALF_WID = 0.95;

function makeDecalTexture() {
  var c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  var g = c.getContext("2d");
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = "#ffffff";
  g.font = "bold 30px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("상민", 128, 95);
  g.fillStyle = "#ffd1dc";
  g.font = "bold 46px sans-serif";
  g.fillText("♥", 128, 140);
  g.fillStyle = "#ffffff";
  g.font = "bold 30px sans-serif";
  g.fillText("다혜", 128, 190);
  var tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createCarMesh(bodyColor, withDecal) {
  var group = new THREE.Group();

  var bodyGeo = new THREE.BoxGeometry(CAR_HALF_WID * 2, 0.55, CAR_HALF_LEN * 2);
  var bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.25 });
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  var cabinGeo = new THREE.BoxGeometry(CAR_HALF_WID * 1.5, 0.4, CAR_HALF_LEN * 1.15);
  var cabinMat = new THREE.MeshStandardMaterial({ color: 0x232333, roughness: 0.3, metalness: 0.4 });
  var cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 0.9, -0.05);
  cabin.castShadow = true;
  group.add(cabin);

  var wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.24, 16);
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  var wheelPositions = [
    [CAR_HALF_WID - 0.05, 0.28, CAR_HALF_LEN - 0.5],
    [-(CAR_HALF_WID - 0.05), 0.28, CAR_HALF_LEN - 0.5],
    [CAR_HALF_WID - 0.05, 0.28, -(CAR_HALF_LEN - 0.5)],
    [-(CAR_HALF_WID - 0.05), 0.28, -(CAR_HALF_LEN - 0.5)]
  ];
  wheelPositions.forEach(function (p) {
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(p[0], p[1], p[2]);
    wheel.castShadow = true;
    group.add(wheel);
  });

  var lightGeo = new THREE.SphereGeometry(0.09, 8, 8);
  var lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  [-0.6, 0.6].forEach(function (lx) {
    var lamp = new THREE.Mesh(lightGeo, lightMat);
    lamp.position.set(lx, 0.45, CAR_HALF_LEN - 0.05);
    group.add(lamp);
  });

  if (withDecal) {
    var decalTex = makeDecalTexture();
    var decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true });
    var decalGeo = new THREE.PlaneGeometry(CAR_HALF_WID * 1.3, CAR_HALF_LEN * 1.0);
    var decal = new THREE.Mesh(decalGeo, decalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(0, 1.115, -0.05);
    group.add(decal);
  }

  return group;
}

// ============ ground / obstacle helpers ============
function makeAsphaltTexture() {
  var c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  var g = c.getContext("2d");
  g.fillStyle = "#4b4560";
  g.fillRect(0, 0, 128, 128);
  for (var i = 0; i < 400; i++) {
    g.fillStyle = "rgba(255,255,255," + (Math.random() * 0.03) + ")";
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  var tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
var asphaltTex = makeAsphaltTexture();

function aabbFromBox(x, z, w, d) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}
function aabbToPoly(box) {
  return [
    { x: box.minX, z: box.minZ },
    { x: box.maxX, z: box.minZ },
    { x: box.maxX, z: box.maxZ },
    { x: box.minX, z: box.maxZ }
  ];
}

// ---- SAT collision (car OBB vs axis-aligned obstacle) ----
function carCorners(x, z, heading) {
  var hl = CAR_HALF_LEN, hw = CAR_HALF_WID;
  var ch = Math.cos(heading), sh = Math.sin(heading);
  var local = [[hw, hl], [-hw, hl], [-hw, -hl], [hw, -hl]];
  return local.map(function (p) {
    var lx = p[0], lz = p[1];
    return { x: x + lx * ch + lz * sh, z: z - lx * sh + lz * ch };
  });
}
function normalize(v) { var len = Math.hypot(v.x, v.z) || 1; return { x: v.x / len, z: v.z / len }; }
function polyAxes(poly) {
  var axes = [];
  for (var i = 0; i < poly.length; i++) {
    var p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    axes.push(normalize({ x: -(p2.z - p1.z), z: (p2.x - p1.x) }));
  }
  return axes;
}
function projectPoly(poly, axis) {
  var min = Infinity, max = -Infinity;
  for (var i = 0; i < poly.length; i++) {
    var d = poly[i].x * axis.x + poly[i].z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}
function polysOverlap(polyA, polyB) {
  var axes = polyAxes(polyA).concat(polyAxes(polyB));
  for (var i = 0; i < axes.length; i++) {
    var a = projectPoly(polyA, axes[i]);
    var b = projectPoly(polyB, axes[i]);
    if (a[1] < b[0] || b[1] < a[0]) return false;
  }
  return true;
}
function carCollides(x, z, heading, obstacles) {
  var carPoly = carCorners(x, z, heading);
  for (var i = 0; i < obstacles.length; i++) {
    if (polysOverlap(carPoly, aabbToPoly(obstacles[i]))) return true;
  }
  return false;
}

// ============ levels ============
var WALL_T = 0.4;
var LEVELS = [
  {
    name: "쉬운 정면 주차",
    bounds: { minX: -5, maxX: 5, minZ: -6, maxZ: 6 },
    carStart: { x: -3, z: -4, heading: 0 },
    obstacles: [],
    target: { x: 3, z: 3, w: 2.6, d: 3.2, angle: 0 }
  },
  {
    name: "두 차 사이 주차",
    bounds: { minX: -5, maxX: 5, minZ: -6, maxZ: 6 },
    carStart: { x: -3, z: -4.2, heading: 0 },
    obstacles: [
      { x: -1.6, z: 2, w: 1.0, d: 2.6, kind: "car" },
      { x: 1.6, z: 2, w: 1.0, d: 2.6, kind: "car" }
    ],
    target: { x: 0, z: 2, w: 2.0, d: 2.8, angle: 0 }
  },
  {
    name: "코너 주차",
    bounds: { minX: -5, maxX: 5, minZ: -7, maxZ: 7 },
    carStart: { x: -3.5, z: -5.3, heading: 0 },
    obstacles: [
      { x: -2, z: -1, w: 6, d: 0.6, kind: "wall" }
    ],
    target: { x: -3, z: 5, w: 2.4, d: 3.0, angle: 0 }
  },
  {
    name: "칼각 평행주차",
    bounds: { minX: -6, maxX: 6, minZ: -4, maxZ: 4 },
    carStart: { x: -4.3, z: 0, heading: Math.PI / 2 },
    obstacles: [
      { x: -3.3, z: 2.2, w: 2.6, d: 1.0, kind: "car" },
      { x: 3.3, z: 2.2, w: 2.6, d: 1.0, kind: "car" }
    ],
    target: { x: 0, z: 2.2, w: 3.0, d: 1.9, angle: Math.PI / 2 }
  }
];

// ============ game state ============
var currentLevelIndex = 0;
var currentLevel = null;
var levelGroup = new THREE.Group();
scene.add(levelGroup);
var collisionObstacles = [];

var playerCar = createCarMesh(0xff6b5b, true);
scene.add(playerCar);

var carState = { x: 0, z: 0, heading: 0, animating: false };
var path = []; // {x,z}
var pathBlocked = false;
var pathLine = null;
var attempts = 0;

var state = "start"; // start | playing | levelComplete | allClear
var drawing = false;

var raycaster = new THREE.Raycaster();
var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function screenToGround(clientX, clientY) {
  var ndc = new THREE.Vector2((clientX / W) * 2 - 1, -(clientY / H) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  var hit = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, hit);
  return hit;
}

function disposeGroup(group) {
  while (group.children.length) {
    var child = group.children.pop();
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(function (m) { m.dispose(); });
      else child.material.dispose();
    }
  }
}

function addGroundPlane(bounds) {
  var w = bounds.maxX - bounds.minX, d = bounds.maxZ - bounds.minZ;
  var geo = new THREE.PlaneGeometry(w + 4, d + 4);
  var tex = asphaltTex.clone();
  tex.repeat.set((w + 4) / 3, (d + 4) / 3);
  tex.needsUpdate = true;
  var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  mesh.receiveShadow = true;
  levelGroup.add(mesh);
}

function addBoxObstacle(x, z, w, d, kind) {
  var height = kind === "car" ? 1.3 : (kind === "wall" ? 0.6 : 0.35);
  var color = kind === "car" ? 0xd8dbe6 : 0xb0633a;
  var geo = new THREE.BoxGeometry(w, height, d);
  var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6 });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  levelGroup.add(mesh);

  if (kind === "car") {
    var roofGeo = new THREE.BoxGeometry(w * 0.75, height * 0.55, d * 0.55);
    var roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0b5, roughness: 0.5 }));
    roof.position.set(x, height + (height * 0.55) / 2, z);
    roof.castShadow = true;
    levelGroup.add(roof);
  }
}

function addTargetZone(target) {
  var geo = new THREE.PlaneGeometry(target.w, target.d);
  var mat = new THREE.MeshBasicMaterial({ color: 0x7dffb3, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -target.angle;
  mesh.position.set(target.x, 0.03, target.z);
  levelGroup.add(mesh);

  var hw = target.w / 2, hd = target.d / 2;
  var pts = [
    new THREE.Vector3(-hw, 0.04, -hd), new THREE.Vector3(hw, 0.04, -hd),
    new THREE.Vector3(hw, 0.04, hd), new THREE.Vector3(-hw, 0.04, hd),
    new THREE.Vector3(-hw, 0.04, -hd)
  ];
  var lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  var line = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.rotation.y = -target.angle;
  line.position.set(target.x, 0, target.z);
  levelGroup.add(line);

  return mesh;
}

var targetMesh = null;
var targetPulseT = 0;

function loadLevel(idx) {
  currentLevelIndex = idx;
  currentLevel = LEVELS[idx];
  disposeGroup(levelGroup);
  collisionObstacles = [];

  addGroundPlane(currentLevel.bounds);

  var b = currentLevel.bounds;
  var perim = [
    { x: (b.minX + b.maxX) / 2, z: b.minZ - WALL_T / 2, w: (b.maxX - b.minX) + WALL_T * 2, d: WALL_T },
    { x: (b.minX + b.maxX) / 2, z: b.maxZ + WALL_T / 2, w: (b.maxX - b.minX) + WALL_T * 2, d: WALL_T },
    { x: b.minX - WALL_T / 2, z: (b.minZ + b.maxZ) / 2, w: WALL_T, d: (b.maxZ - b.minZ) + WALL_T * 2 },
    { x: b.maxX + WALL_T / 2, z: (b.minZ + b.maxZ) / 2, w: WALL_T, d: (b.maxZ - b.minZ) + WALL_T * 2 }
  ];
  perim.forEach(function (p) {
    addBoxObstacle(p.x, p.z, p.w, p.d, "curb");
    collisionObstacles.push(aabbFromBox(p.x, p.z, p.w, p.d));
  });

  currentLevel.obstacles.forEach(function (ob) {
    addBoxObstacle(ob.x, ob.z, ob.w, ob.d, ob.kind);
    collisionObstacles.push(aabbFromBox(ob.x, ob.z, ob.w, ob.d));
  });

  targetMesh = addTargetZone(currentLevel.target);

  carState.x = currentLevel.carStart.x;
  carState.z = currentLevel.carStart.z;
  carState.heading = currentLevel.carStart.heading;
  carState.animating = false;
  playerCar.position.set(carState.x, 0, carState.z);
  playerCar.rotation.y = carState.heading;

  path = [];
  pathBlocked = false;
  clearPathLine();
  attempts = 0;

  fitCameraToBounds(currentLevel.bounds);
  levelLabelEl.textContent = "LEVEL " + (idx + 1) + "/" + LEVELS.length;
  hintEl.textContent = "차 앞에서부터 손가락으로 길을 그려보세요";
}

// ============ path drawing ============
function clearPathLine() {
  if (pathLine) {
    scene.remove(pathLine);
    pathLine.geometry.dispose();
    pathLine.material.dispose();
    pathLine = null;
  }
}
function updatePathLine() {
  clearPathLine();
  if (path.length < 2) return;
  var pts = path.map(function (p) { return new THREE.Vector3(p.x, 0.08, p.z); });
  var geo = new THREE.BufferGeometry().setFromPoints(pts);
  var mat = new THREE.LineBasicMaterial({ color: pathBlocked ? 0xff4d4d : 0x7dffb3, linewidth: 3 });
  pathLine = new THREE.Line(geo, mat);
  scene.add(pathLine);
}

function headingAt(arr, idx) {
  var a = arr[Math.max(0, idx - 1)], b = arr[idx];
  var dx = b.x - a.x, dz = b.z - a.z;
  if (Math.hypot(dx, dz) < 1e-6) return null;
  return Math.atan2(dx, dz);
}

function tryExtendPath(x, z) {
  var last = path[path.length - 1];
  var dist = Math.hypot(x - last.x, z - last.z);
  if (dist < 0.22) return;
  var steps = Math.max(1, Math.floor(dist / 0.18));
  for (var i = 1; i <= steps; i++) {
    var t = i / steps;
    var px = last.x + (x - last.x) * t;
    var pz = last.z + (z - last.z) * t;
    var heading = Math.atan2(px - last.x, pz - last.z) || carState.heading;
    if (carCollides(px, pz, heading, collisionObstacles)) {
      pathBlocked = true;
      updatePathLine();
      sfxBlocked();
      hintEl.textContent = "거기는 막혔어요! 손을 떼고 다시 그려보세요";
      return;
    }
    path.push({ x: px, z: pz });
  }
  updatePathLine();
}

function pointerDown(e) {
  if (state !== "playing" || carState.animating) return;
  ensureAudio();
  drawing = true;
  path = [{ x: carState.x, z: carState.z }];
  pathBlocked = false;
  clearPathLine();
  hintEl.textContent = "손가락을 움직여 길을 그리는 중...";
}
function pointerMove(e) {
  if (!drawing || pathBlocked) return;
  var clientX = e.touches ? e.touches[0].clientX : e.clientX;
  var clientY = e.touches ? e.touches[0].clientY : e.clientY;
  var g = screenToGround(clientX, clientY);
  if (g) tryExtendPath(g.x, g.z);
}
function pointerUp() {
  if (!drawing) return;
  drawing = false;
  if (pathBlocked || path.length < 6) {
    path = [];
    clearPathLine();
    if (!pathBlocked) hintEl.textContent = "조금 더 길게 그려보세요";
    else hintEl.textContent = "손가락을 떼고 다시 그려보세요";
    return;
  }
  startCarAnimation();
}

canvas.addEventListener("pointerdown", pointerDown);
canvas.addEventListener("pointermove", pointerMove);
window.addEventListener("pointerup", pointerUp);
window.addEventListener("pointercancel", pointerUp);

// ============ car animation along path ============
var pathCum = [];
var pathTotalLen = 0;
var animDist = 0;
var CAR_SPEED = 3.0;
var carBank = 0;

function startCarAnimation() {
  pathCum = [0];
  for (var i = 1; i < path.length; i++) {
    var d = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    pathCum.push(pathCum[i - 1] + d);
  }
  pathTotalLen = pathCum[pathCum.length - 1];
  animDist = 0;
  carState.animating = true;
  hintEl.textContent = "";
}

function samplePath(dist) {
  if (dist <= 0) return { x: path[0].x, z: path[0].z, heading: carState.heading };
  if (dist >= pathTotalLen) {
    var lastIdx = path.length - 1;
    var h = headingAt(path, lastIdx);
    return { x: path[lastIdx].x, z: path[lastIdx].z, heading: h === null ? carState.heading : h };
  }
  for (var i = 1; i < pathCum.length; i++) {
    if (pathCum[i] >= dist) {
      var segLen = pathCum[i] - pathCum[i - 1];
      var t = segLen > 0 ? (dist - pathCum[i - 1]) / segLen : 0;
      var a = path[i - 1], b = path[i];
      var x = a.x + (b.x - a.x) * t;
      var z = a.z + (b.z - a.z) * t;
      var heading = headingAt(path, i);
      if (heading === null) heading = carState.heading;
      return { x: x, z: z, heading: heading };
    }
  }
  return { x: path[path.length - 1].x, z: path[path.length - 1].z, heading: carState.heading };
}

function checkTargetSuccess() {
  var t = currentLevel.target;
  var dx = carState.x - t.x, dz = carState.z - t.z;
  var cosA = Math.cos(-t.angle), sinA = Math.sin(-t.angle);
  var localX = dx * cosA + dz * sinA;
  var localZ = -dx * sinA + dz * cosA;
  return Math.abs(localX) <= t.w / 2 + 0.15 && Math.abs(localZ) <= t.d / 2 + 0.15;
}

function updateCarAnimation(dt) {
  if (!carState.animating) return;
  var prevHeading = carState.heading;
  animDist += CAR_SPEED * dt;
  var s = samplePath(animDist);
  carState.x = s.x; carState.z = s.z;
  var dh = s.heading - prevHeading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  carState.heading = prevHeading + dh;

  var targetBank = clamp(dh * 6, -0.18, 0.18);
  carBank += (targetBank - carBank) * 0.2;

  playerCar.position.set(carState.x, 0, carState.z);
  playerCar.rotation.y = carState.heading;
  playerCar.rotation.z = carBank;

  if (animDist >= pathTotalLen) {
    carState.animating = false;
    playerCar.rotation.z = 0;
    onAnimationEnd();
  }
}

function onAnimationEnd() {
  if (checkTargetSuccess()) {
    var t = currentLevel.target;
    var startX = carState.x, startZ = carState.z, startH = carState.heading;
    var dur = 260, t0 = performance.now();
    (function snap() {
      var p = clamp((performance.now() - t0) / dur, 0, 1);
      carState.x = startX + (t.x - startX) * p;
      carState.z = startZ + (t.z - startZ) * p;
      var dh = t.angle - startH;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      carState.heading = startH + dh * p;
      playerCar.position.set(carState.x, 0, carState.z);
      playerCar.rotation.y = carState.heading;
      if (p < 1) requestAnimationFrame(snap);
      else onParkSuccess();
    })();
  } else {
    attempts++;
    path = [];
    clearPathLine();
    var hints = ["조금만 더!", "거의 다 왔어요!", "다시 도전해볼까요?"];
    hintEl.textContent = hints[Math.floor(Math.random() * hints.length)];
  }
}

// ============ confetti ============
var confetti = [];
var confettiColors = [0xffb3c6, 0xffe08a, 0x8ad0ff, 0xb3ffcf, 0xffffff];
function spawnConfetti(x, z) {
  for (var i = 0; i < 26; i++) {
    var geo = Math.random() > 0.5
      ? new THREE.BoxGeometry(0.14, 0.14, 0.14)
      : new THREE.SphereGeometry(0.09, 6, 6);
    var mat = new THREE.MeshBasicMaterial({ color: confettiColors[i % confettiColors.length] });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.0, z);
    scene.add(mesh);
    confetti.push({
      mesh: mesh,
      vx: (Math.random() - 0.5) * 3.5,
      vy: Math.random() * 3.5 + 2,
      vz: (Math.random() - 0.5) * 3.5,
      life: 1200 + Math.random() * 400
    });
  }
}
function updateConfetti(dt) {
  for (var i = confetti.length - 1; i >= 0; i--) {
    var c = confetti[i];
    c.vy -= 6 * dt;
    c.mesh.position.x += c.vx * dt;
    c.mesh.position.y += c.vy * dt;
    c.mesh.position.z += c.vz * dt;
    c.mesh.rotation.x += dt * 4;
    c.mesh.rotation.y += dt * 3;
    c.life -= dt * 1000;
    if (c.life <= 0 || c.mesh.position.y < -2) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
      confetti.splice(i, 1);
    }
  }
}

// ============ stars / persistence ============
function getStars() {
  try { return JSON.parse(localStorage.getItem(STARS_KEY) || "[]"); } catch (e) { return []; }
}
function setStars(arr) { localStorage.setItem(STARS_KEY, JSON.stringify(arr)); }
function starsForAttempts(n) {
  if (n <= 1) return 3;
  if (n <= 3) return 2;
  return 1;
}
function renderStars(el, count) {
  var s = "";
  for (var i = 0; i < 3; i++) s += (i < count ? "★" : "☆");
  el.textContent = s;
}

function onParkSuccess() {
  sfxSuccess();
  spawnConfetti(currentLevel.target.x, currentLevel.target.z);
  var earned = starsForAttempts(attempts);
  var stars = getStars();
  stars[currentLevelIndex] = Math.max(stars[currentLevelIndex] || 0, earned);
  setStars(stars);

  if (currentLevelIndex >= LEVELS.length - 1) {
    state = "allClear";
    sfxFanfare();
    hud.classList.add("hidden");
    var total = 0;
    for (var i = 0; i < LEVELS.length; i++) total += (stars[i] || 0);
    renderStars(totalStarsRowEl, Math.round(total / LEVELS.length));
    allClearScreen.classList.remove("hidden");
  } else {
    state = "levelComplete";
    hud.classList.add("hidden");
    renderStars(starsRowEl, earned);
    attemptsTextEl.textContent = "시도 횟수: " + attempts + "번";
    levelCompleteScreen.classList.remove("hidden");
  }
}

// ============ UI wiring ============
function showHud() {
  hud.classList.remove("hidden");
}
startBtn.addEventListener("click", function () {
  ensureAudio();
  state = "playing";
  startScreen.classList.add("hidden");
  loadLevel(0);
  showHud();
});
nextLevelBtn.addEventListener("click", function () {
  levelCompleteScreen.classList.add("hidden");
  state = "playing";
  loadLevel(Math.min(currentLevelIndex + 1, LEVELS.length - 1));
  showHud();
});
replayBtn.addEventListener("click", function () {
  allClearScreen.classList.add("hidden");
  state = "playing";
  loadLevel(0);
  showHud();
});
retryBtn.addEventListener("click", function () {
  if (state !== "playing") return;
  loadLevel(currentLevelIndex);
});

(function initBestStars() {
  var stars = getStars();
  var total = 0, count = 0;
  for (var i = 0; i < LEVELS.length; i++) { if (stars[i]) { total += stars[i]; count++; } }
  bestStarsEl.textContent = count > 0 ? ("이전 최고: " + total + " / " + (LEVELS.length * 3) + "개 별" ) : "";
})();

// ============ main loop ============
var lastTime = performance.now();
function loop(now) {
  var dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state === "playing") {
    updateCarAnimation(dt);
  }
  updateConfetti(dt);

  if (targetMesh) {
    targetPulseT += dt;
    targetMesh.material.opacity = 0.4 + Math.sin(targetPulseT * 3) * 0.15;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

resizeRenderer();
loadLevel(0);
requestAnimationFrame(loop);
