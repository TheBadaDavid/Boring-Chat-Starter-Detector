// =====================================================================================
//  world3d.js  -  the 3D park behind the chat
// =====================================================================================
//  What lives here:
//    - a real 3D scene (three.js): sky dome, sun, moon, stars, clouds, birds, cars, trees,
//      a bench, lamp posts, hedges, far-away buildings and hills
//    - TIME OF DAY: the sun and moon travel across the sky, the sky colours, light, shadows,
//      stars, street lamps and building windows all follow the clock
//    - PASSERS-BY who walk along the path at random (some jog), cars on the far road, birds
//    - TWO 3D CHARACTERS (you and Tolu), built from simple shapes and animated by code:
//      they walk in, stand and gesture while talking, sit on the bench when the chat is
//      lively, and Tolu gets annoyed, stomps off, etc.
//    - HOVER / CLICK interactions: point at anything to get a tooltip and a little reaction
//
//  How it is used (see App.jsx / index.html):
//      const world = createWorld(THREE, hostElement);
//      world.setLook({ you, tolu, meGender, themGender, name });   // new chat: new people walk in
//      world.setMood({ mode: "idle" | "love" | "angry", annoy: 0 | 1 | 2 });
//      world.setTyping(true / false);                               // Tolu is typing a reply
//      world.dispose();                                             // clean up
//
//  `THREE` is passed in (instead of imported) so the same file works in the Vite app
//  (`import * as THREE from "three"`) and in the single-file page (loaded from a CDN).
//
//  Units: 1 unit = 1 metre. The camera looks along -z, so +x is to the RIGHT of the screen
//  and +z is TOWARDS you. Characters face +z (towards the camera) by default.
// =====================================================================================

export function createWorld(THREE, host, options = {}) {
  // ---------------------------------------------------------------------------------
  // 0. Small helpers
  // ---------------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // smoothstep: 0 below e0, 1 above e1, a smooth S-curve in between
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  // damp: move `cur` towards `target` a bit every frame (frame-rate independent easing)
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  // shortest signed difference between two angles (radians)
  const angleDiff = (a, b) => {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  const SRGB = THREE.SRGBColorSpace;
  // People who asked their OS for less motion get a calmer world (no wandering, no time cycle).
  const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------------------------------------------------------------------------
  // 1. Renderer, scene and camera
  // ---------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;               // soft shadows from the sun
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "world-canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe6f5, 35, 175);    // distant things fade into the horizon colour

  const camera = new THREE.PerspectiveCamera(30, 1.5, 0.1, 1000);
  const CAM = { x: 0, y: 1.85, z: 6.3, lookY: 1.2 };   // camera position and the height it looks at
  camera.position.set(CAM.x, CAM.y, CAM.z);

  // The characters are framed inside the TOP part of the canvas (STAGE = 52 % of its height).
  // The chat messages float over the rest, so we show the lawn there. setViewOffset makes the
  // camera frame a "virtual" picture that is only STAGE tall, but renders the full canvas, so
  // the world simply keeps going below the framed area.
  const STAGE = 0.52;
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);                 // false: CSS controls the canvas size
    const stageH = h * STAGE;
    camera.aspect = w / stageH;
    camera.setViewOffset(w, stageH, 0, 0, w, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---------------------------------------------------------------------------------
  // 2. Geometry cache + canvas-texture helpers
  // ---------------------------------------------------------------------------------
  // Shapes are shared between all people/trees so we do not create hundreds of copies.
  const geoCache = new Map();
  const G = (key, make) => { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); };
  const cyl = (rt, rb, h, seg = 14) => G(`cyl${rt}/${rb}/${h}/${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const sph = (r, ws = 16, hs = 12) => G(`sph${r}/${ws}/${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  const box = (w, h, d) => G(`box${w}/${h}/${d}`, () => new THREE.BoxGeometry(w, h, d));

  // Draw something on a 2D canvas and use it as a texture (grass, pavers, windows, emoji...).
  function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (SRGB) t.colorSpace = SRGB;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    return t;
  }

  // ---------------------------------------------------------------------------------
  // 3. Interaction registry: anything hoverable registers an "interactive" here
  // ---------------------------------------------------------------------------------
  // An interactive is: { name, label(): tooltip text, onEnter(), onLeave(), onClick() }.
  // We raycast against invisible "proxy" boxes (cheap) instead of the detailed meshes.
  const hitMeshes = [];
  function addProxy(parent, geometry, x, y, z, it) {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    m.userData.it = it;
    parent.add(m);
    hitMeshes.push(m);
    return m;
  }
  const removeProxies = (root) => root.traverse((o) => { const i = hitMeshes.indexOf(o); if (i >= 0) hitMeshes.splice(i, 1); });

  // ---------------------------------------------------------------------------------
  // 4. SKY, SUN, MOON, STARS and the clock
  // ---------------------------------------------------------------------------------
  // The sky is a huge inside-out sphere with a two-colour gradient (zenith -> horizon).
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float k = pow(clamp(vP.y, 0.0, 1.0), 0.5); gl_FragColor = vec4(mix(bottom, top, k), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  // A round soft glow, drawn once on a canvas and reused for the sun and the moon.
  const glowTex = canvasTexture(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, "rgba(255,255,255,0.95)"); r.addColorStop(0.25, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  function makeBody(radius, color, glowColor, glowSize) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), new THREE.MeshBasicMaterial({ color, fog: false })));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: glowColor, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(glowSize, glowSize, 1);
    g.add(glow);
    scene.add(g);
    return g;
  }
  const sunBody = makeBody(7, 0xfff1b0, 0xffd27a, 70);
  const moonBody = makeBody(5, 0xe9edff, 0x9db4ff, 38);

  // Stars: a few hundred points, only in the part of the sky the camera can see.
  const starPos = [];
  for (let i = 0; i < 420; i++) {
    const az = rand(-0.9, 0.9), el = rand(0.04, 0.6), R = 450;           // radians
    starPos.push(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, -Math.cos(az) * Math.cos(el) * R);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  scene.add(new THREE.Points(starGeo, starMat));

  // Lights: hemisphere (sky above, ground below) + sun + moon.
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x4f6f3f, 1.1);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 120 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  const moonLight = new THREE.DirectionalLight(0x8fa8ff, 0);
  scene.add(moonLight, moonLight.target);

  // Colour ramp indexed by the SUN'S ELEVATION in degrees (negative = below the horizon).
  // This one table gives night, dawn/dusk glow, and day.
  const RAMP = [
    { e: -18, top: "#050816", hor: "#0e1630", hemiI: 0.28 },
    { e: -8,  top: "#101c42", hor: "#2d2c5c", hemiI: 0.4 },
    { e: -2,  top: "#2a3d73", hor: "#e07a5a", hemiI: 0.6 },
    { e: 5,   top: "#4f7bbd", hor: "#f4b57c", hemiI: 0.9 },
    { e: 14,  top: "#3f84cf", hor: "#bddaf0", hemiI: 1.15 },
    { e: 35,  top: "#2f7fdc", hor: "#c4e3f8", hemiI: 1.3 },
    { e: 62,  top: "#2a78d8", hor: "#c9e7fb", hemiI: 1.35 },
  ].map((k) => ({ e: k.e, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), hemiI: k.hemiI }));
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  function rampAt(e) {
    let i = 0;
    while (i < RAMP.length - 2 && e > RAMP[i + 1].e) i++;
    const a = RAMP[i], b = RAMP[i + 1], t = clamp((e - a.e) / (b.e - a.e), 0, 1);
    return {
      top: tmpA.copy(a.top).lerp(b.top, t), hor: tmpB.copy(a.hor).lerp(b.hor, t), hemiI: lerp(a.hemiI, b.hemiI, t),
    };
  }

  // The clock. `hour` is 0-24. By default it starts at your real local time and then runs fast.
  const SPEEDS = [
    { label: "Auto", perSec: 0.1 },    // a full day in 4 minutes
    { label: "Fast", perSec: 0.6 },    // a full day in 40 seconds
    { label: "Paused", perSec: 0 },
  ];
  const clock = {
    hour: options.startHour ?? (new Date().getHours() + new Date().getMinutes() / 60),
    speedIdx: reduced ? 2 : 0,
  };
  // Real sun elevation in degrees for a given hour: 0 at 6:00 and 18:00, highest at noon.
  const sunElevation = (h) => 62 * Math.sin((Math.PI * (h - 6)) / 12);
  // Where to draw a body in the sky. Real noon-sun would be above the top of the picture, so
  // we squash the elevation a lot to keep the sun and moon in view (the light itself is still real).
  function skyPosition(elev, hourFrac, out) {
    const visEl = elev > 0 ? 1.5 + 0.075 * elev : elev * 0.6;
    const az = lerp(-1.25, 1.25, clamp(hourFrac, 0, 1));
    const R = 300, e = (visEl * Math.PI) / 180;
    out.set(Math.sin(az) * Math.cos(e) * R, Math.sin(e) * R, -Math.cos(az) * Math.cos(e) * R);
  }

  // `dayK` (1 = bright day, 0 = night) and `nightK` are used by clouds, lamps and windows.
  const env = { dayK: 1, nightK: 0, elev: 40, hor: new THREE.Color() };

  function updateSky() {
    const h = clock.hour;
    const elev = sunElevation(h);
    const moonElev = -elev;
    const r = rampAt(elev);
    skyMat.uniforms.top.value.copy(r.top);
    skyMat.uniforms.bottom.value.copy(r.hor);
    scene.fog.color.copy(r.hor);
    env.hor.copy(r.hor);
    env.elev = elev;
    env.dayK = smooth(-6, 14, elev);
    env.nightK = 1 - smooth(-8, 6, elev);

    // sun + moon sprites (the moon is on the opposite side of the day)
    const dayFrac = ((h - 6 + 24) % 24) / 12;           // 0..1 across the day, >1 at night
    skyPosition(elev, dayFrac, sunBody.position);
    skyPosition(moonElev, ((h - 18 + 24) % 24) / 12, moonBody.position);
    sunBody.visible = elev > -6;
    moonBody.visible = moonElev > -6;

    // real light directions (not squashed) so shadows swing around during the day
    const dirFrom = (el, frac) => {
      const az = lerp(-1.1, 1.1, clamp(frac, 0, 1)), e = (Math.max(el, 4) * Math.PI) / 180;
      return new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e) * 0.7 + 0.15).normalize();
    };
    sunLight.position.copy(dirFrom(elev, dayFrac).multiplyScalar(45));
    sunLight.intensity = 3.1 * smooth(-3, 14, elev);
    sunLight.color.set(0xff9d5c).lerp(tmpA.set(0xfff4e0), smooth(0, 26, elev));    // orange when low
    moonLight.position.copy(dirFrom(moonElev, ((h - 18 + 24) % 24) / 12).multiplyScalar(45));
    moonLight.intensity = 0.9 * smooth(0, 12, moonElev) * (1 - smooth(-4, 8, elev));

    hemi.intensity = r.hemiI;
    hemi.color.copy(r.top).lerp(tmpA.set(0xffffff), 0.35);
    hemi.groundColor.set(0x4f6f3f).multiplyScalar(0.35 + 0.65 * env.dayK);
    starMat.opacity = env.nightK * (0.75 + 0.25 * Math.sin(performance.now() / 700));  // gentle twinkle
  }

  // ---------------------------------------------------------------------------------
  // 5. GROUND, PATH, HEDGE, ROAD, HILLS, BUILDINGS
  // ---------------------------------------------------------------------------------
  const grassTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#5c9b4b"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {                    // speckles of lighter / darker grass
      g.fillStyle = Math.random() < 0.5 ? "rgba(120,190,90,0.35)" : "rgba(40,100,50,0.3)";
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  }, 60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: grassTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const PATH_Z = -3.7;                                  // the walking path behind the bench
  const paverTex = canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = "#c9c2b4"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(90,80,70,0.5)"; g.lineWidth = 2;
    g.strokeRect(0, 0, w / 2, h / 2); g.strokeRect(w / 2, 0, w / 2, h / 2);
    g.strokeRect(-w / 4, h / 2, w / 2, h / 2); g.strokeRect(w / 4, h / 2, w / 2, h / 2); g.strokeRect(w * 0.75, h / 2, w / 2, h / 2);
  }, 100, 2);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(200, 2.2), new THREE.MeshLambertMaterial({ map: paverTex }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.012, PATH_Z);
  path.receiveShadow = true;
  scene.add(path);

  // A low hedge behind the path (a row of slightly different green boxes).
  const hedgeMat = new THREE.MeshLambertMaterial({ color: 0x2f6b3a, flatShading: true });
  for (let x = -60; x < 60; x += 1.1) {
    const hh = rand(0.8, 1.0);
    const b = new THREE.Mesh(box(1.15, hh, 0.9), hedgeMat);
    b.position.set(x, hh / 2, -5.5);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
  }

  // The far road (cars drive on it).
  const ROAD_Z = -13;
  const roadTex = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = "#3b3e46"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8e2c0"; g.fillRect(0, h / 2 - 2, w * 0.5, 4);       // dashed centre line
  }, 60, 1);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 5), new THREE.MeshLambertMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, ROAD_Z);
  road.receiveShadow = true;
  scene.add(road);

  // Distant hills (big flattened spheres that fade into the fog).
  [[-60, -90, 90, 16], [40, -105, 110, 22], [120, -95, 80, 14]].forEach(([x, z, w, h]) => {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), new THREE.MeshLambertMaterial({ color: 0x5f8f6c, fog: true }));
    hill.scale.set(w, h, 30);
    hill.position.set(x, -h * 0.35, z);
    scene.add(hill);
  });

  // Distant buildings with windows. Two textures per building: the daytime one and a glowing
  // "lit windows" one that fades in at night (emissiveMap).
  function windowTextures() {
    const cols = 6, rows = 14, lit = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lit.push(Math.random() < 0.45);
    const draw = (litOnly) => (g, w, h) => {
      g.fillStyle = litOnly ? "#000" : "#9aa7b8"; g.fillRect(0, 0, w, h);
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const on = lit[r * cols + c];
        g.fillStyle = litOnly ? (on ? "#ffd98a" : "#000") : (on ? "#6f7f93" : "#56667a");
        g.fillRect(c * cw + cw * 0.18, r * ch + ch * 0.2, cw * 0.64, ch * 0.6);
      }
    };
    return { map: canvasTexture(64, 128, draw(false)), glow: canvasTexture(64, 128, draw(true)) };
  }
  const buildingMats = [];
  const wins = [windowTextures(), windowTextures(), windowTextures()];
  for (let i = 0; i < 16; i++) {
    const w = rand(4, 8), h = rand(5, 11), d = rand(4, 7);
    const t = wins[i % 3];
    const mat = new THREE.MeshLambertMaterial({ map: t.map, emissiveMap: t.glow, emissive: 0xffffff, emissiveIntensity: 0, color: pick([0xcdd5df, 0xbfc8d4, 0xd8cfc4, 0xaab6c5]) });
    buildingMats.push(mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.geometry.attributes.uv.array.forEach((_, k, arr) => { if (k % 2 === 1) arr[k] *= h / 8; });   // tile windows with height
    b.position.set(-52 + i * 6.8 + rand(-1, 1), h / 2, rand(-42, -34));
    scene.add(b);
  }

  // ---------------------------------------------------------------------------------
  // 6. TREES, LAMP POSTS and the BENCH
  // ---------------------------------------------------------------------------------
  const trees = [];
  function makeTree(x, z, scale) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    const trunk = new THREE.Mesh(cyl(0.16, 0.24, 2.2, 8), new THREE.MeshLambertMaterial({ color: 0x7a5636 }));
    trunk.position.y = 1.1; trunk.castShadow = true;
    g.add(trunk);
    const leafMat = new THREE.MeshLambertMaterial({ color: pick([0x3f8a4a, 0x4a9a52, 0x377d45]), flatShading: true });
    const crown = new THREE.Group();               // the leafy part (this is what sways)
    crown.position.y = 2.2;
    [[0, 0.9, 0, 1.25], [-0.75, 0.4, 0.2, 0.95], [0.75, 0.35, -0.1, 1.0], [0.1, 1.6, 0.1, 0.85]].forEach(([lx, ly, lz, r]) => {
      const m = new THREE.Mesh(G(`ico${r}`, () => new THREE.IcosahedronGeometry(r, 1)), leafMat);
      m.position.set(lx, ly, lz); m.castShadow = true; m.receiveShadow = true;
      crown.add(m);
    });
    g.add(crown);
    scene.add(g);
    const tree = { g, crown, shake: 0, phase: rand(0, 6), baseScale: scale };
    const it = {
      name: "tree",
      label: () => "Tree 🌳 · shake shake",
      onEnter: () => { tree.shake = 1; spawnLeaves(g.position.x, 3.6 * scale, g.position.z); },
      onClick: () => { tree.shake = 1.5; spawnLeaves(g.position.x, 3.6 * scale, g.position.z, 10); },
    };
    addProxy(g, box(2.2, 4.5, 2.2), 0, 2.4, 0, it);
    trees.push(tree);
    return tree;
  }
  [[-4.6, -1.4, 1.1], [4.9, -1.8, 1.2], [-9, -2.4, 1.5], [10, -2.0, 1.35], [-14, -2.8, 1.4], [15, -2.6, 1.5], [-6.5, -9, 1.5], [7.5, -9.5, 1.4]]
    .forEach(([x, z, s]) => makeTree(x, z, s));

  // Lamp posts: the bulb glows at night. Hover one to switch it on (even by day).
  const lamps = [];
  function makeLamp(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.5, metalness: 0.5 });
    const pole = new THREE.Mesh(cyl(0.05, 0.07, 3.2, 8), metal); pole.position.y = 1.6; pole.castShadow = true;
    const arm = new THREE.Mesh(box(0.5, 0.05, 0.05), metal); arm.position.set(0.2, 3.2, 0);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    const bulb = new THREE.Mesh(sph(0.14), bulbMat); bulb.position.set(0.42, 3.12, 0);
    const light = new THREE.PointLight(0xffd9a0, 0, 11, 1.6);
    light.position.set(0.42, 3.05, 0.2);
    g.add(pole, arm, bulb, light);
    scene.add(g);
    const lamp = { g, bulbMat, light, forced: 0 };
    const it = {
      name: "lamp",
      label: () => "Street lamp 💡",
      onEnter: () => { lamp.forced = 1; },
      onLeave: () => { lamp.forced = 0; },
    };
    addProxy(g, box(0.9, 3.4, 0.9), 0.2, 1.7, 0, it);
    lamps.push(lamp);
  }
  makeLamp(-3.2, -2.5); makeLamp(3.4, -2.5);

  // The bench sits at the origin, back to the path, facing the camera.
  const benchG = new THREE.Group();
  {
    const wood = new THREE.MeshStandardMaterial({ color: 0xa8774a, roughness: 0.75 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.5, metalness: 0.4 });
    const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; benchG.add(m); return m; };
    [-0.17, 0, 0.17].forEach((z) => add(box(2.5, 0.045, 0.14), wood, 0, 0.45, z));                     // seat planks
    [0.62, 0.78, 0.94].forEach((y) => add(box(2.5, 0.12, 0.035), wood, 0, y, -0.3 - (y - 0.45) * 0.12, -0.12)); // back planks
    [-1.1, 1.1].forEach((x) => {
      add(box(0.06, 0.45, 0.06), iron, x, 0.225, 0.2);                                                // front legs
      add(box(0.06, 0.5, 0.06), iron, x, 0.25, -0.22);                                                // back legs
      add(box(0.06, 0.06, 0.5), iron, x, 0.5, -0.02);                                                 // armrests
      add(box(0.06, 0.55, 0.06), iron, x, 0.72, -0.3, -0.12);                                         // back supports
    });
    scene.add(benchG);
    addProxy(benchG, box(2.6, 1.0, 0.7), 0, 0.5, 0, { name: "bench", label: () => "Park bench 🪑" });
  }

  // ---------------------------------------------------------------------------------
  // 7. CLOUDS (they drift with the wind, tint with the time of day, puff up when hovered)
  // ---------------------------------------------------------------------------------
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
  const clouds = [];
  function makeCloud(x) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(rand(0, 3));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(sph(1, 12, 8), cloudMat);
      m.scale.set(rand(5, 8.5), rand(2.4, 4), rand(3.5, 5));
      m.position.set((i - n / 2) * 4.6 + rand(-1, 1), rand(-0.8, 1.6), rand(-1.5, 1.5));
      g.add(m);
    }
    g.position.set(x, rand(15, 29), rand(-135, -95));
    scene.add(g);
    const c = { g, speed: rand(1.2, 3.2), puff: 0, n };
    const it = {
      name: "cloud",
      label: () => "Cloud ☁️ · puff!",
      onEnter: () => { c.puff = 1; },
    };
    addProxy(g, box(n * 4.6 + 8, 9, 9), 0, 0, 0, it);
    clouds.push(c);
  }
  for (let i = 0; i < 9; i++) makeCloud(-105 + i * 24 + rand(-6, 6));

  // ---------------------------------------------------------------------------------
  // 8. BIRDS and CARS (random ambient life)
  // ---------------------------------------------------------------------------------
  const birds = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2b2f3a, side: THREE.DoubleSide });
  function spawnBird() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(sph(0.22, 8, 6), birdMat); body.scale.set(1.6, 0.8, 0.8);
    const wingGeo = G("wing", () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1.1, 0.25); s.lineTo(0.9, -0.2); s.closePath(); return new THREE.ShapeGeometry(s); });
    const wl = new THREE.Group(), wr = new THREE.Group();
    const a = new THREE.Mesh(wingGeo, birdMat); a.rotation.x = Math.PI / 2; wr.add(a);
    const b = new THREE.Mesh(wingGeo, birdMat); b.rotation.x = Math.PI / 2; b.scale.x = -1; wl.add(b);
    g.add(body, wl, wr);
    g.scale.setScalar(rand(1.3, 2));
    const dir = Math.random() < 0.5 ? 1 : -1;
    g.position.set(-dir * 30, rand(5, 12), rand(-50, -22));
    scene.add(g);
    const bird = { g, wl, wr, dir, speed: rand(4, 8), flap: rand(0, 6), boost: 0, y0: g.position.y };
    const it = { name: "bird", label: () => "Bird 🐦", onEnter: () => { bird.boost = 1; } };
    addProxy(g, box(3, 2, 2), 0, 0, 0, it);
    birds.push(bird);
  }

  const cars = [];
  function spawnCar() {
    const g = new THREE.Group();
    const color = pick([0xd1453b, 0x2f6fd0, 0xe2b93b, 0xeeeeee, 0x2b8a5a, 0x3a3f4a]);
    const body = new THREE.Mesh(box(4.2, 0.8, 1.8), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 0.65; body.castShadow = true;
    const cabin = new THREE.Mesh(box(2.2, 0.65, 1.6), new THREE.MeshStandardMaterial({ color: 0x9fb9d0, roughness: 0.2, metalness: 0.5 }));
    cabin.position.set(-0.2, 1.3, 0); cabin.castShadow = true;
    g.add(body, cabin);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15171c });
    [[-1.4, 0.9], [1.4, 0.9], [-1.4, -0.9], [1.4, -0.9]].forEach(([x, z]) => {
      const w = new THREE.Mesh(cyl(0.35, 0.35, 0.25, 12), wheelMat); w.rotation.x = Math.PI / 2; w.position.set(x, 0.35, z); g.add(w);
    });
    const dir = Math.random() < 0.5 ? 1 : -1;
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    [0.6, -0.6].forEach((z) => { const l = new THREE.Mesh(box(0.1, 0.18, 0.3), headMat); l.position.set(2.1 * dir, 0.7, z); g.add(l); });
    g.position.set(-dir * 60, 0, ROAD_Z + (dir > 0 ? 0.9 : -0.9));
    g.rotation.y = dir > 0 ? 0 : Math.PI;
    scene.add(g);
    const car = { g, dir, speed: rand(7, 13), honk: 0 };
    const it = { name: "car", label: () => (car.honk > 0 ? "Car 🚗 · Beep beep!" : "Car 🚗"), onEnter: () => { car.honk = 1.5; } };
    addProxy(g, box(4.4, 2, 2), 0, 1, 0, it);
    cars.push(car);
  }

  // ---------------------------------------------------------------------------------
  // 9. SPRITES: emoji above heads, speech bubbles, hearts, falling leaves
  // ---------------------------------------------------------------------------------
  const emojiCache = new Map();
  function emojiTexture(ch) {
    if (!emojiCache.has(ch)) {
      emojiCache.set(ch, canvasTexture(128, 128, (g, w, h) => {
        g.font = "96px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(ch, w / 2, h / 2 + 6);
      }));
    }
    return emojiCache.get(ch);
  }
  const bubbleTex = canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 4;
    g.beginPath(); g.roundRect(14, 10, w - 28, 90, 40); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 14, 98); g.lineTo(w / 2, 140); g.lineTo(w / 2 + 16, 98); g.closePath(); g.fill();   // little tail
    g.fillStyle = "#8a96a3";
    [w / 2 - 38, w / 2, w / 2 + 38].forEach((x) => { g.beginPath(); g.arc(x, 55, 9, 0, 7); g.fill(); });
  });
  const heartTex = canvasTexture(64, 64, (g) => {
    g.fillStyle = "#ff5d7a"; g.beginPath(); g.moveTo(32, 56);
    g.bezierCurveTo(2, 34, 8, 8, 24, 8); g.bezierCurveTo(30, 8, 32, 14, 32, 18);
    g.bezierCurveTo(32, 14, 34, 8, 40, 8); g.bezierCurveTo(56, 8, 62, 34, 32, 56); g.fill();
  });
  const leafTex = canvasTexture(32, 32, (g) => {
    g.fillStyle = "#58a85a"; g.beginPath(); g.moveTo(16, 2); g.quadraticCurveTo(30, 16, 16, 30); g.quadraticCurveTo(2, 16, 16, 2); g.fill();
  });
  const spriteOf = (tex, w, h, depthTest = true) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false, fog: false }));
    s.scale.set(w, h, 1);
    return s;
  };

  // Hearts rise between the two characters when the chat is lively.
  const hearts = [];
  for (let i = 0; i < 9; i++) { const s = spriteOf(heartTex, 0.3, 0.3); s.visible = false; scene.add(s); hearts.push({ s, t: -1 }); }
  let heartTimer = 0;
  function spawnHeart() {
    const h = hearts.find((x) => x.t < 0);
    if (!h) return;
    h.t = 0; h.x = rand(-0.35, 0.35); h.s.visible = true;
  }
  // Leaves fall from a tree you hover.
  const leaves = [];
  for (let i = 0; i < 16; i++) { const s = spriteOf(leafTex, 0.22, 0.22); s.visible = false; scene.add(s); leaves.push({ s, t: -1 }); }
  function spawnLeaves(x, y, z, count = 6) {
    for (let i = 0; i < count; i++) {
      const l = leaves.find((q) => q.t < 0);
      if (!l) return;
      l.t = 0; l.x = x + rand(-1.4, 1.4); l.y = y + rand(-0.8, 0.8); l.z = z + rand(-0.8, 1); l.vx = rand(-0.2, 0.2); l.ph = rand(0, 6);
      l.s.visible = true; l.s.material.rotation = rand(0, 6);
    }
  }

  // ---------------------------------------------------------------------------------
  // 10. HUMANS: a little stylised 3D person built from cylinders and spheres
  // ---------------------------------------------------------------------------------
  // Body plan (all measured in metres, before the small height scale):
  //
  //   root                      <- stands on the ground, turned by `yaw`
  //    `- hips (pivot)          <- moves up/down (bobbing when walking, lower when sitting)
  //        |- pelvis, legs: hip (pivot) -> thigh -> knee (pivot) -> shin -> shoe
  //        |- skirt (girls)
  //        `- spine (pivot)     <- leans/twists a little
  //            |- chest, shoulders, arms: shoulder (pivot) -> upper arm -> elbow (pivot) -> forearm -> hand
  //            `- neck -> head (pivot): face, hair, hat
  //
  //  "Pivot" = an empty group placed at a joint; rotating it swings everything below it.
  //  Every frame `update()` turns those pivots to make walking, sitting, waving, etc.
  const HIP_Y = 0.95;        // hip height when standing
  const SEAT_HIPS_Y = 0.54;  // hip height when sitting on the bench (seat top is 0.46)

  function buildHuman(o) {
    const female = o.gender === "f";
    const mats = [];                                   // kept so we can dispose / highlight them
    const M = (color, rough = 0.7) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); mats.push(m); return m; };
    const skin = M(o.skin, 0.55), shirt = M(o.top, 0.8), pants = M(o.bottom, 0.85), shoe = M(o.shoes, 0.5);
    const hairM = M(o.hair, 0.45), hatM = M(o.hatColor, 0.8);
    const ink = new THREE.MeshBasicMaterial({ color: 0x1b1412 });        // eyes + brows + mouth lines (unlit, always readable)
    const mouthIn = new THREE.MeshBasicMaterial({ color: 0x5a1a16, side: THREE.DoubleSide });
    const blushM = new THREE.MeshBasicMaterial({ color: 0xff7d92, transparent: true, opacity: 0, depthWrite: false });
    mats.push(ink, mouthIn, blushM);

    // part(): make a mesh, position it, make it cast shadows, add it to a parent.
    const part = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    const root = new THREE.Group();
    root.scale.setScalar(o.height);
    const hips = new THREE.Group();
    hips.position.y = HIP_Y;
    root.add(hips);
    part(sph(0.15), pants, hips, 0, 0.03, 0).scale.set(1.15, 0.8, 0.85);   // pelvis

    // --- legs ---------------------------------------------------------------------
    const legs = {};
    const thighPants = o.pants >= 70 ? 0.45 : o.pants >= 40 ? 0.24 : 0;     // how far down the trousers/shorts reach
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.085, 0, 0);
      hips.add(hip);
      part(cyl(0.07, 0.055, 0.45), skin, hip, 0, -0.225, 0);                // thigh
      if (thighPants > 0) part(cyl(0.079, 0.079 - 0.017 * (thighPants / 0.45), thighPants), pants, hip, 0, -thighPants / 2, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      hip.add(knee);
      part(sph(0.058), thighPants >= 0.45 ? pants : skin, knee);            // knee joint
      part(cyl(0.052, 0.04, 0.43), skin, knee, 0, -0.215, 0);               // shin
      if (thighPants >= 0.45) part(cyl(0.062, 0.05, 0.43), pants, knee, 0, -0.215, 0);   // trouser leg
      part(box(0.1, 0.075, 0.25), shoe, knee, 0, -0.45, 0.05);              // shoe
      legs[side] = { hip, knee };
    }

    // --- skirt / dress (girls) -----------------------------------------------------
    // The skirt hangs from a pivot at the waist. When sitting we swing the pivot forward so
    // the dress drapes over the lap instead of poking through the bench.
    const skirtPivot = new THREE.Group();
    skirtPivot.position.y = 0.06;
    hips.add(skirtPivot);
    if (female) part(cyl(0.17, 0.31, 0.5, 20), shirt, skirtPivot, 0, -0.25, 0);

    // --- upper body ---------------------------------------------------------------
    const spine = new THREE.Group();
    spine.position.y = 0.06;
    hips.add(spine);
    const chest = part(cyl(0.2, 0.16, 0.54, 18), shirt, spine, 0, 0.27, 0);
    chest.scale.set(female ? 1.0 : 1.2, 1, 0.7);
    const sx = female ? 0.2 : 0.235;                                           // shoulder half-width

    const arms = {};
    const sleeveLen = o.sleeve >= 40 ? 0.3 : 0.14;                             // long or short sleeves
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(side * sx, 0.5, 0);
      sh.rotation.order = "YXZ";                                               // lets us swing arms inward for crossing them
      spine.add(sh);
      part(sph(0.058), shirt, sh);                                             // shoulder ball
      part(cyl(0.042, 0.036, 0.3), skin, sh, 0, -0.15, 0);                     // upper arm
      part(cyl(0.054, 0.05, sleeveLen), shirt, sh, 0, -sleeveLen / 2, 0);      // sleeve
      const el = new THREE.Group();
      el.position.y = -0.3;
      sh.add(el);
      part(sph(0.04), o.sleeve >= 40 ? shirt : skin, el);                      // elbow joint
      part(cyl(0.036, 0.03, 0.27), skin, el, 0, -0.135, 0);                    // forearm
      if (o.sleeve >= 40) part(cyl(0.046, 0.04, 0.27), shirt, el, 0, -0.135, 0);
      part(sph(0.046), skin, el, 0, -0.29, 0);                                 // hand
      arms[side] = { sh, el };
    }

    // --- neck, head, face, hair, hat ---------------------------------------------------
    part(cyl(0.05, 0.055, 0.1), skin, spine, 0, 0.58, 0);
    const head = new THREE.Group();
    head.position.y = 0.64;
    spine.add(head);
    part(sph(0.125, 20, 14), skin, head, 0, 0.11, 0).scale.set(0.95, 1.08, 1.0);
    part(sph(0.015), skin, head, 0, 0.098, 0.126).scale.set(1, 1, 1.2);        // nose

    const hairCap = part(G("hairCap", () => new THREE.SphereGeometry(0.134, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56)), hairM, head, 0, 0.115, -0.004);
    hairCap.rotation.x = -0.28;                                                // tilt back so the forehead shows
    if (female) {
      part(sph(0.14), hairM, head, 0, 0.02, -0.05).scale.set(1, 1.55, 0.85);   // long hair behind the head
      part(sph(0.05), hairM, head, 0.115, 0.04, 0.0).scale.set(0.8, 2.1, 1);   // side locks
      part(sph(0.05), hairM, head, -0.115, 0.04, 0.0).scale.set(0.8, 2.1, 1);
    }
    // eyes: a white eyeball with a dark pupil in front (so they stay visible on dark skin too).
    // `eyes` holds the groups so blinking can squash them.
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mats.push(white);
    const eyes = [-1, 1].map((s) => {
      const e = new THREE.Group();
      e.position.set(s * 0.045, 0.125, 0.109);
      const ball = part(sph(0.02, 10, 8), white, e); ball.castShadow = false;
      const pupil = part(sph(0.011, 8, 6), ink, e, 0, 0, 0.014); pupil.castShadow = false;
      head.add(e);
      return e;
    });
    const brows = [-1, 1].map((s) => { const b = part(box(0.042, 0.009, 0.01), ink, head, s * 0.047, 0.158, 0.112); b.castShadow = false; return b; });

    const mouths = {
      smile: part(G("mSmile", () => new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI)), ink, head, 0, 0.083, 0.117),
      frown: part(G("mFrown", () => new THREE.TorusGeometry(0.03, 0.006, 6, 14, Math.PI)), ink, head, 0, 0.055, 0.117),
      flat: part(box(0.05, 0.008, 0.008), ink, head, 0, 0.066, 0.118),
      grin: part(G("mGrin", () => new THREE.CircleGeometry(0.036, 16, Math.PI, Math.PI)), mouthIn, head, 0, 0.082, 0.117),
    };
    mouths.smile.rotation.z = Math.PI;                                          // arc opens upwards = smile
    Object.values(mouths).forEach((m) => { m.castShadow = false; m.visible = false; });
    mouths.smile.visible = true;
    const blush = [-1, 1].map((s) => { const b = new THREE.Mesh(G("blush", () => new THREE.CircleGeometry(0.026, 14)), blushM); b.position.set(s * 0.075, 0.075, 0.108); b.rotation.y = s * 0.55; head.add(b); return b; });

    // hats
    if (o.hat === "cap") {
      const dome = part(G("capDome", () => new THREE.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), hatM, head, 0, 0.128, 0);
      dome.rotation.x = -0.12;
      const brim = part(box(0.2, 0.014, 0.11), hatM, head, 0, 0.14, 0.14);
      brim.rotation.x = 0.12;
    } else if (o.hat === "beanie") {
      part(G("beanie", () => new THREE.SphereGeometry(0.143, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.6)), hatM, head, 0, 0.125, 0);
      part(sph(0.032), hatM, head, 0, 0.27, 0);                                // pom-pom
    }

    // invisible box used for hover/click
    const proxyHolder = new THREE.Group();
    root.add(proxyHolder);

    const human = {
      root, mats, parts: { hips, spine, head, legs, arms, skirtPivot, mouths, brows, eyes, blush },
      proxyHolder,
      // The live pose "state". The controller below changes these; update() turns them into rotations.
      s: {
        t: rand(0, 10),
        sit: 0,                       // 0 standing .. 1 sitting
        walkAmt: 0, phase: 0, stride: 0.6,
        gest: 0, gestSide: 1,         // talking with the hands
        wave: 0,                      // waving hello
        cross: 0, akimbo: 0,          // arms crossed / hands on hips (annoyed)
        tap: 0,                       // foot tapping
        laugh: 0, shake: 0,           // laughing bob / angry head shake
        hop: 0,                       // little jump when clicked
        lookYaw: 0, lookPitch: 0,     // where the head points (relative to the body)
        browTilt: 0, blushAmt: 0,
        blinkT: rand(1, 4),
      },
      mouth: "smile",
      setMouth(name) {
        if (name === this.mouth) return;
        mouths[this.mouth].visible = false;
        mouths[name].visible = true;
        this.mouth = name;
      },
      glow(v) { [skin, shirt, pants, hairM].forEach((m) => m.emissive.setRGB(0.07 * v, 0.07 * v, 0.12 * v)); },

      // Turn the pose state into joint rotations. Called once per frame.
      update(dt) {
        const s = this.s;
        s.t += dt;
        const t = s.t, ph = s.phase, w = s.walkAmt, A = s.stride * w;
        const sit = s.sit;

        // legs: swing opposite to each other while walking; bend the knee while the leg swings forward
        for (const side of [-1, 1]) {
          const lead = side === -1 ? 1 : -1;
          let thigh = -lead * Math.sin(ph) * A;
          let knee = 0.95 * Math.max(0, lead * Math.cos(ph)) * w;
          thigh -= sit * (Math.PI / 2 - 0.05);                       // sitting: thighs point forward...
          knee += sit * (Math.PI / 2 - 0.05);                        // ...and shins point down
          if (side === 1 && s.tap > 0.01) { knee += s.tap * Math.max(0, Math.sin(t * 9)) * 0.55; thigh -= s.tap * 0.04; }   // foot tapping
          legs[side].hip.rotation.x = thigh;
          legs[side].hip.rotation.z = side * sit * 0.05;
          legs[side].knee.rotation.x = knee;
        }
        hips.position.y = lerp(HIP_Y, SEAT_HIPS_Y, sit) - 0.03 * Math.abs(Math.sin(ph)) * w + s.hop;
        hips.position.z = -0.14 * sit;                               // sit back on the seat
        skirtPivot.rotation.x = -sit * 0.8;                          // drape the dress over the lap

        // spine: breathing, walking twist, laughing bounce
        spine.rotation.x = 0.02 * Math.sin(t * 1.7) + sit * 0.04 + s.laugh * Math.sin(t * 14) * 0.07;
        spine.rotation.y = Math.sin(ph) * 0.14 * w;
        spine.scale.y = 1 + 0.012 * Math.sin(t * 1.7);

        // arms
        for (const side of [-1, 1]) {
          const a = arms[side];
          let x = -side * 0.6 * Math.sin(ph) * w;                     // arms swing opposite to the legs
          let y = 0;
          let z = side * 0.07;                                        // hang a little away from the body
          let ex = -0.12 - 0.25 * w;                                  // elbow bend
          let ez = 0;
          // resting hands on the lap while sitting
          x = lerp(x, -0.55, sit); ex = lerp(ex, -1.15, sit); y = lerp(y, -side * 0.25, sit);
          // gesturing while talking (one arm)
          if (side === s.gestSide) {
            x = lerp(x, -(0.6 + 0.3 * Math.sin(t * 2.8)), s.gest);
            ex = lerp(ex, -(1.25 + 0.35 * Math.sin(t * 4.3)), s.gest);
          }
          // hands on hips
          z = lerp(z, side * 0.62, s.akimbo); ez = lerp(ez, -side * 1.9, s.akimbo); x = lerp(x, 0.15, s.akimbo);
          // arms crossed
          x = lerp(x, -0.45, s.cross); y = lerp(y, -side * 0.9, s.cross); z = lerp(z, side * 0.08, s.cross); ex = lerp(ex, -2.2, s.cross);
          // waving hello (right arm up, forearm wiggles)
          if (side === 1) { z = lerp(z, 2.45, s.wave); ez = lerp(ez, 0.5 * Math.sin(t * 11), s.wave); x = lerp(x, 0, s.wave); }
          a.sh.rotation.set(x, y, z);
          a.el.rotation.set(ex, 0, ez);
        }

        // head: look direction + angry shake + nodding while laughing
        head.rotation.y = s.lookYaw + Math.sin(t * 30) * 0.32 * s.shake;
        head.rotation.x = s.lookPitch + s.laugh * Math.sin(t * 14 + 1) * 0.08;
        // eyebrows: tilted in = angry
        brows[0].rotation.z = -s.browTilt;
        brows[1].rotation.z = s.browTilt;
        blushM.opacity = s.blushAmt * 0.6;

        // blinking
        s.blinkT -= dt;
        const closed = s.blinkT < 0.12 && s.blinkT > 0;
        eyes.forEach((e) => { e.scale.y = closed ? 0.12 : 1; });
        if (s.blinkT <= 0) s.blinkT = rand(2, 5.5);
      },

      dispose() {
        removeProxies(root);
        scene.remove(root);
        mats.forEach((m) => m.dispose());
      },
    };
    return human;
  }

  // ---------------------------------------------------------------------------------
  // 11. ACTORS: a human + a position + a goal. The actor walks to its goal, then turns and sits/stands.
  // ---------------------------------------------------------------------------------
  const STAND = { you: { x: -1.1, z: 1.1, yaw: 0.55 }, tolu: { x: 1.1, z: 1.1, yaw: -0.55 } };
  const SIT = { you: { x: -0.55, z: 0.0, yaw: 0.32 }, tolu: { x: 0.55, z: 0.0, yaw: -0.32 } };

  function makeActor(outfit, gender, name, x, z, yaw) {
    const human = buildHuman({ ...outfit, gender });
    scene.add(human.root);
    return { h: human, x, z, yaw, speed: 1.4, goal: { x, z, yaw, sit: 0 }, name, hovered: 0, hoverTarget: 0, snap: false };
  }

  // Move/turn/sit the actor towards its goal. Order matters: stand up -> walk -> turn -> sit.
  function stepActor(a, dt) {
    const s = a.h.s, g = a.goal;
    const dx = g.x - a.x, dz = g.z - a.z, dist = Math.hypot(dx, dz);
    if (a.snap || (reduced && dist < 30)) {                       // reduced motion: just appear at the goal
      a.x = g.x; a.z = g.z; a.yaw = g.yaw; s.sit = g.sit; s.walkAmt = 0; a.snap = false;
    } else if (dist > 0.04) {
      s.sit = damp(s.sit, 0, 7, dt);                              // must be standing to walk
      if (s.sit < 0.12) {
        const want = Math.atan2(dx, dz);                          // direction of the goal as a yaw angle
        const diff = angleDiff(a.yaw, want);
        a.yaw += clamp(diff, -9 * dt, 9 * dt);                    // turn towards where we are going
        if (Math.abs(diff) < 0.6) {
          const step = Math.min(dist, a.speed * dt);
          a.x += (dx / dist) * step; a.z += (dz / dist) * step;
          s.walkAmt = damp(s.walkAmt, 1, 10, dt);
          s.phase += dt * 2 * Math.PI * (0.55 + a.speed * 0.45);   // faster walkers take faster steps
          s.stride = 0.42 + 0.14 * a.speed;
        } else s.walkAmt = damp(s.walkAmt, 0, 10, dt);
      } else s.walkAmt = damp(s.walkAmt, 0, 10, dt);
    } else {
      s.walkAmt = damp(s.walkAmt, 0, 8, dt);
      const diff = angleDiff(a.yaw, g.yaw);
      a.yaw += clamp(diff, -4 * dt, 4 * dt);
      if (Math.abs(diff) < 0.25) s.sit = damp(s.sit, g.sit, 3.2, dt);   // sit down / stand up once we are turned
    }
    a.h.root.position.set(a.x, 0, a.z);
    a.h.root.rotation.y = a.yaw;
  }

  // The two chat characters ----------------------------------------------------------
  let you = null, tolu = null;
  let mood = { mode: "idle", annoy: 0 };
  let typing = false;
  const talk = { turn: "you", timer: 2 };         // whose turn it is to "speak" (drives bubble + gestures)
  let angerT = 0;                                 // seconds since Tolu got angry
  let currentLook = null;

  // Speech bubble + emoji sprites that follow each character's head.
  const bubbles = {};
  const emojis = {};
  ["you", "tolu"].forEach((k) => {
    const b = spriteOf(bubbleTex, 0.62, 0.39, false); b.renderOrder = 20; b.visible = false; scene.add(b); bubbles[k] = b;
    const e = spriteOf(emojiTexture("🙂"), 0.5, 0.5, false); e.renderOrder = 21; e.visible = false; scene.add(e); emojis[k] = { s: e, ch: "", pop: 0 };
  });
  function showEmoji(k, ch) {
    const e = emojis[k];
    if (e.ch === ch) return;
    e.ch = ch;
    if (!ch) { e.s.visible = false; return; }
    e.s.material.map = emojiTexture(ch);
    e.s.material.needsUpdate = true;
    e.pop = 0;
    e.s.visible = true;
  }

  const tip = document.createElement("div");      // tooltip bubble that follows the pointer
  tip.className = "world-tip";
  tip.hidden = true;
  host.appendChild(tip);

  function moodText() {
    if (mood.mode === "love") return "enjoying this 😍";
    if (mood.mode === "angry") return "furious 😡";
    if (mood.annoy === 2) return "losing patience 😤";
    if (mood.annoy === 1) return "getting bored 😒";
    return "chatting 🙂";
  }

  // (Re)build the two characters. Called at the start of every chat: new people walk in.
  function setLook(look) {
    currentLook = look;
    [you, tolu].forEach((a) => a && a.h.dispose());
    you = makeActor(look.you, look.meGender, "You", -9, STAND.you.z, Math.PI / 2);
    tolu = makeActor(look.tolu, look.themGender, look.name, 9, STAND.tolu.z, -Math.PI / 2);
    you.speed = tolu.speed = 2.2;                  // brisk entrance
    angerT = 0;
    talk.turn = "you"; talk.timer = 2;
    [[you, "you"], [tolu, "tolu"]].forEach(([a, key]) => {
      const it = {
        name: key,
        label: () => (key === "you" ? "You 🙋" : `${a.name} · ${moodText()}`),
        onEnter: () => { a.hoverTarget = 1; },
        onLeave: () => { a.hoverTarget = 0; },
        onClick: () => { a.h.s.hop = 0.001; a.hopT = 0; },          // start a little hop
      };
      addProxy(a.h.proxyHolder, box(0.75, 1.9, 0.6), 0, 0.95, 0, it);
    });
    applyGoals();
  }

  // Decide where each character wants to be, and how they look, for the current mood.
  function applyGoals() {
    if (!you || !tolu) return;
    const sitting = mood.mode === "love";
    const spotY = sitting ? SIT.you : STAND.you, spotT = sitting ? SIT.tolu : STAND.tolu;
    you.goal = { ...spotY, sit: sitting ? 1 : 0 };
    if (mood.mode !== "angry") tolu.goal = { ...spotT, sit: sitting ? 1 : 0 };
    tolu.speed = you.speed = 1.3;                                   // relaxed pace once they arrive
    if (you.x < -6 || tolu.x > 6) { you.speed = tolu.speed = 2.2; }   // still entering: keep the brisk pace
  }

  function setMood(m) {
    const prev = mood;
    mood = { mode: m.mode, annoy: m.annoy || 0 };
    if (mood.mode === "angry" && prev.mode !== "angry") angerT = 0;
    applyGoals();
  }
  function setTyping(v) { typing = !!v; }

  // Per-frame behaviour of the two characters: gestures, faces, looking, emoji, bubbles.
  function updateChars(dt) {
    if (!you || !tolu) return;
    const speakerTurn = () => {
      talk.timer -= dt;
      if (talk.timer <= 0) { talk.turn = talk.turn === "you" ? "tolu" : "you"; talk.timer = rand(2.2, 3.6); }
    };
    speakerTurn();
    const speaker = typing ? "tolu" : mood.mode === "angry" ? null : talk.turn;

    [[you, "you", tolu], [tolu, "tolu", you]].forEach(([a, key, other]) => {
      const s = a.h.s;
      // gestures: whoever is "speaking" talks with their hands
      const speaking = speaker === key && s.sit < 0.5 + (mood.mode === "love" ? 1 : 0) && Math.hypot(a.goal.x - a.x, a.goal.z - a.z) < 0.1;
      s.gest = damp(s.gest, speaking ? 1 : 0, 5, dt);
      if (!speaking && s.gest < 0.05) s.gestSide = Math.random() < 0.5 ? -1 : 1;
      // hover: look at the camera, wave, light up
      a.hovered = damp(a.hovered, a.hoverTarget, 8, dt);
      a.h.glow(a.hovered);
      s.wave = damp(s.wave, a.hoverTarget && s.sit < 0.3 && mood.mode !== "angry" ? 1 : 0, 6, dt);
      // click hop
      if (a.hopT !== undefined) {
        a.hopT += dt;
        s.hop = Math.max(0, Math.sin((a.hopT / 0.45) * Math.PI)) * 0.2;
        if (a.hopT > 0.45) { s.hop = 0; a.hopT = undefined; }
      }
      // head direction (relative to the body)
      let yaw = 0.05 * Math.sin(s.t * 0.7), pitch = 0.03 * Math.sin(s.t * 0.9);
      if (a.hoverTarget) { yaw = clamp(-a.yaw, -1, 1) * 0.9; pitch = -0.05; }    // face the camera
      s.lookYaw = damp(s.lookYaw, yaw, 6, dt);
      s.lookPitch = damp(s.lookPitch, pitch, 6, dt);
    });

    // ---- you ----
    you.h.setMouth(mood.mode === "angry" ? "flat" : (mood.mode === "love" && Math.sin(you.h.s.t * 2) > 0.6) ? "grin" : "smile");
    you.h.s.blushAmt = damp(you.h.s.blushAmt, mood.mode === "love" ? 1 : 0, 3, dt);
    you.h.s.laugh = damp(you.h.s.laugh, mood.mode === "love" ? 1 : 0, 3, dt);

    // ---- Tolu ----
    const ts = tolu.h.s;
    let mouth = "smile", brow = 0, cross = 0, akimbo = 0, tap = 0, shake = 0, emoji = "";
    if (mood.mode === "love") {
      mouth = Math.sin(ts.t * 2 + 1) > 0.2 ? "grin" : "smile"; emoji = "😍";
    } else if (mood.mode === "angry") {
      angerT += dt;
      mouth = "frown"; brow = 0.55; emoji = "😡";
      if (angerT < 1.4) shake = 1;                                  // stand there fuming for a moment...
      else { tolu.goal = { x: 11, z: STAND.tolu.z + 0.4, yaw: Math.PI / 2, sit: 0 }; tolu.speed = 2.6; }   // ...then stomp off to the right
    } else if (mood.annoy === 2) {
      mouth = "frown"; brow = 0.35; cross = 1; tap = 1; emoji = "😤";
    } else if (mood.annoy === 1) {
      mouth = "flat"; akimbo = 1; emoji = "😒";
    }
    tolu.h.setMouth(mouth);
    ts.browTilt = damp(ts.browTilt, brow, 8, dt);
    ts.cross = damp(ts.cross, cross, 5, dt);
    ts.akimbo = damp(ts.akimbo, akimbo, 5, dt);
    ts.tap = damp(ts.tap, tap, 6, dt);
    ts.shake = damp(ts.shake, shake, 12, dt);
    ts.blushAmt = damp(ts.blushAmt, mood.mode === "love" ? 1 : 0, 3, dt);
    ts.laugh = damp(ts.laugh, mood.mode === "love" ? 1 : 0, 3, dt);
    if (mood.annoy === 1 && mood.mode === "idle") ts.lookYaw += (0.55 - ts.lookYaw) * Math.min(1, dt * 4);   // looks away, bored
    showEmoji("tolu", emoji);
    if (mood.mode === "angry" && tolu.x > 7) tolu.h.root.visible = false;                              // gone
    else tolu.h.root.visible = true;

    // ---- walking/sitting for both, then bubbles/emojis follow their heads ----
    [you, tolu].forEach((a) => { stepActor(a, dt); a.h.update(dt); });
    if (you.x > -5 && tolu.x < 5 && mood.mode !== "angry") applyGoalsPace();

    const headPos = (a, out) => { out.set(a.x, 0, a.z); out.y = lerp(1.9, 1.45, a.h.s.sit) + a.h.s.hop; return out; };
    [["you", you], ["tolu", tolu]].forEach(([k, a]) => {
      const p = headPos(a, new THREE.Vector3());
      const showBubble = speaker === k && mood.mode !== "angry" && a.h.root.visible && Math.hypot(a.goal.x - a.x, a.goal.z - a.z) < 0.2;
      bubbles[k].visible = showBubble;
      bubbles[k].position.set(p.x + (k === "you" ? 0.35 : -0.35), p.y + 0.42, p.z);
      bubbles[k].material.opacity = damp(bubbles[k].material.opacity, showBubble ? 1 : 0, 10, dt);
      const e = emojis[k];
      e.pop = Math.min(1, e.pop + dt * 3);
      const sc = (e.pop < 1 ? (1 - Math.pow(1 - e.pop, 3)) * 1.25 - Math.sin(e.pop * Math.PI) * 0.0 : 1) * 0.5;
      e.s.scale.set(sc, sc, 1);
      e.s.position.set(p.x, p.y + 0.38 + 0.03 * Math.sin(performance.now() / 250), p.z);
      e.s.visible = !!e.ch && a.h.root.visible;
    });
  }
  // once they have arrived, slow back to the relaxed pace
  function applyGoalsPace() { you.speed = Math.min(you.speed, 1.3); tolu.speed = mood.mode === "angry" ? tolu.speed : Math.min(tolu.speed, 1.3); }

  // ---------------------------------------------------------------------------------
  // 12. PASSERS-BY: random people walking along the path (some jog, some wave back)
  // ---------------------------------------------------------------------------------
  const SKINS = ["#8d5524", "#a0673a", "#6f4120", "#c68642", "#5a3418", "#3e2412", "#e0ac69"];
  const HAIRS = ["#15100d", "#1b1410", "#2b1d14", "#0d0b0a", "#3b2a1c"];
  const npcs = [];
  let npcTimer = 1;
  function spawnNpc() {
    const female = Math.random() < 0.5;
    const jogger = Math.random() < 0.18;
    const outfit = {
      gender: female ? "f" : "m", skin: pick(SKINS), hair: pick(HAIRS),
      top: pick(["#e4572e", "#2a9d8f", "#e9c46a", "#7b6cf6", "#f28482", "#3a86ff", "#ff9f1c", "#06a77d", "#b5179e", "#ef476f"]),
      bottom: pick(["#264653", "#3d405b", "#6d597a", "#2b2d42", "#5f7a61", "#1d3557"]),
      shoes: pick(["#ffffff", "#222831", "#d62828", "#f4a261"]),
      hat: pick(["none", "none", "none", "cap", "beanie"]), hatColor: pick(["#e4572e", "#264653", "#e9c46a", "#3a86ff"]),
      sleeve: pick([16, 54]), pants: female ? pick([0, 76]) : pick([50, 76, 76]), height: rand(0.86, 0.97),
    };
    const dir = Math.random() < 0.5 ? 1 : -1;
    const human = buildHuman(outfit);
    scene.add(human.root);
    const npc = { h: human, dir, x: -dir * 14, z: PATH_Z + rand(-0.6, 0.6), speed: jogger ? rand(2.4, 3.1) : rand(0.9, 1.5), jogger, hover: 0, hoverTarget: 0 };
    human.s.stride = jogger ? 0.8 : 0.5;
    if (jogger) human.s.lean = 0.2;
    const it = {
      name: "npc",
      label: () => (jogger ? "Jogger 🏃 · hi!" : "Passer-by 🚶 · hi!"),
      onEnter: () => { npc.hoverTarget = 1; },
      onLeave: () => { npc.hoverTarget = 0; },
      onClick: () => { npc.hoverTarget = 1; },
    };
    addProxy(human.proxyHolder, box(0.8, 1.9, 0.6), 0, 0.95, 0, it);
    npcs.push(npc);
  }
  function updateNpcs(dt) {
    npcTimer -= dt;
    if (npcTimer <= 0 && npcs.length < 4 && !reduced) { spawnNpc(); npcTimer = rand(2.5, 7); }
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i], s = n.h.s;
      n.x += n.dir * n.speed * dt;
      n.hover = damp(n.hover, n.hoverTarget, 8, dt);
      s.walkAmt = 1;
      s.phase += dt * 2 * Math.PI * (0.55 + n.speed * 0.45);
      s.wave = damp(s.wave, n.hoverTarget ? 1 : 0, 6, dt);
      s.lookYaw = damp(s.lookYaw, n.hoverTarget ? -Math.PI / 2 * n.dir * 0.8 : 0, 6, dt);   // turn the head towards the camera
      n.h.glow(n.hover);
      n.h.root.position.set(n.x, 0, n.z);
      n.h.root.rotation.y = n.dir > 0 ? Math.PI / 2 : -Math.PI / 2;                          // face the way they walk
      n.h.update(dt);
      if (Math.abs(n.x) > 16) { n.h.dispose(); npcs.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------------------------
  // 13. HOVER + CLICK handling (raycasting) and the clock button
  // ---------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ptr = { inside: false, x: 0, y: 0, nx: 0, ny: 0 };   // pixel + normalised pointer position
  let hovered = null;                                      // the interactive under the pointer
  let hudBtn = null;

  function setPointer(e) {
    const r = host.getBoundingClientRect();
    ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top;
    ptr.nx = ptr.x / r.width - 0.5; ptr.ny = ptr.y / r.height - 0.5;
    pointer.set((ptr.x / r.width) * 2 - 1, -(ptr.y / r.height) * 2 + 1);
    ptr.inside = true;
  }
  const onMove = (e) => setPointer(e);
  const onLeave = () => { ptr.inside = false; };
  const onDown = (e) => { setPointer(e); castRay(); hovered && hovered.onClick && hovered.onClick(); };
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("pointerdown", onDown);

  // The sky/sun/moon are not "objects" with proxies; clicking empty sky cycles the time speed.
  function castRay() {
    if (!ptr.inside) { setHover(null); return; }
    // the pointer is in "stage" space but the canvas shows more; the camera already accounts for that
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    setHover(hits.length ? hits[0].object.userData.it : null);
  }
  function setHover(it) {
    if (it === hovered) return;
    if (hovered && hovered.onLeave) hovered.onLeave();
    hovered = it;
    if (hovered && hovered.onEnter) hovered.onEnter();
    host.style.cursor = hovered ? "pointer" : "";
  }
  function updateTip() {
    if (hovered && ptr.inside) {
      tip.hidden = false;
      tip.textContent = hovered.label();
      const w = host.clientWidth;
      const x = ptr.x > w - 190 ? ptr.x - tip.offsetWidth - 14 : ptr.x + 14;
      tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, ptr.y - 34)}px)`;
    } else tip.hidden = true;
  }

  // Little clock button in the corner. Click = change how fast time passes.
  hudBtn = document.createElement("button");
  hudBtn.type = "button";
  hudBtn.className = "world-clock";
  hudBtn.title = "Click to change how fast time passes";
  hudBtn.addEventListener("click", () => { clock.speedIdx = (clock.speedIdx + 1) % SPEEDS.length; updateHud(true); });
  host.appendChild(hudBtn);
  let hudText = "";
  function updateHud(force) {
    const h = clock.hour % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const icon = env.elev > 28 ? "☀️" : env.elev > 6 ? "🌤️" : env.elev > -6 ? "🌇" : "🌙";
    const text = `${icon} ${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"} · ${SPEEDS[clock.speedIdx].label}`;
    if (force || text !== hudText) { hudText = text; hudBtn.textContent = text; }
  }

  // ---------------------------------------------------------------------------------
  // 14. The animation loop
  // ---------------------------------------------------------------------------------
  let raf = 0, last = performance.now(), running = true, camX = 0, camY = 0;
  // frame() = tick() (move/animate everything by `dt` seconds) + render().
  // They are separate so tests (and slow computers) can advance the simulation without drawing.
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(dt);
    renderer.render(scene, camera);
  }
  function tick(dt) {
    // time of day
    clock.hour = (clock.hour + SPEEDS[clock.speedIdx].perSec * dt) % 24;
    updateSky();
    sky.position.copy(camera.position);

    // lamps glow when it is dark (or when hovered)
    lamps.forEach((l) => {
      const on = Math.max(env.nightK, l.forced);
      l.light.intensity = on * 14;
      l.bulbMat.color.setRGB(lerp(0.45, 1, on), lerp(0.43, 0.94, on), lerp(0.36, 0.72, on));
    });
    buildingMats.forEach((m) => { m.emissiveIntensity = env.nightK * 1.1; });

    // clouds drift right with the wind, wrap around at the edges, puff when hovered
    cloudMat.color.set(0x2a3350).lerp(tmpA.set(0xffffff), env.dayK).lerp(tmpB.copy(env.hor), 0.18 * (1 - env.dayK) + 0.1);
    clouds.forEach((c) => {
      if (!reduced) c.g.position.x += c.speed * (1 + c.puff * 2) * dt;
      if (c.g.position.x > 115) c.g.position.x = -115;
      c.puff = Math.max(0, c.puff - dt * 0.7);
      c.g.scale.setScalar(1 + 0.12 * Math.sin(c.puff * Math.PI));
    });

    // trees sway in the breeze; hovering shakes them harder
    trees.forEach((t) => {
      t.shake = Math.max(0, t.shake - dt * 0.8);
      const sway = Math.sin(performance.now() / 1300 + t.phase) * 0.012 + Math.sin(performance.now() / 55) * 0.05 * t.shake * t.shake;
      t.crown.rotation.z = sway; t.crown.rotation.x = sway * 0.6;
    });

    // birds + cars: spawn at random, fly/drive across, then remove
    if (!reduced) {
      if (Math.random() < dt * 0.12 && birds.length < 3) spawnBird();
      if (Math.random() < dt * 0.22 && cars.length < 3) spawnCar();
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.boost = Math.max(0, b.boost - dt);
      b.flap += dt * (12 + b.boost * 14);
      b.g.position.x += b.dir * b.speed * (1 + b.boost) * dt;
      b.g.position.y = b.y0 + Math.sin(b.flap * 0.25) * 0.4 + b.boost * 1.5;
      b.g.rotation.y = b.dir > 0 ? 0 : Math.PI;
      const f = Math.sin(b.flap) * 0.7;
      b.wr.rotation.z = f; b.wl.rotation.z = -f;
      if (Math.abs(b.g.position.x) > 40) { removeProxies(b.g); scene.remove(b.g); birds.splice(i, 1); }
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.honk = Math.max(0, c.honk - dt);
      c.g.position.x += c.dir * c.speed * dt;
      if (Math.abs(c.g.position.x) > 62) { removeProxies(c.g); scene.remove(c.g); cars.splice(i, 1); }
    }

    updateNpcs(dt);
    updateChars(dt);

    // hearts rise while the chat is lively
    if (mood.mode === "love" && !reduced) { heartTimer -= dt; if (heartTimer <= 0) { spawnHeart(); heartTimer = rand(0.35, 0.7); } }
    hearts.forEach((h) => {
      if (h.t < 0) return;
      h.t += dt;
      const k = h.t / 2.6;
      h.s.position.set(h.x + Math.sin(h.t * 3) * 0.08, 1.9 + k * 1.3, 0.35);
      h.s.material.opacity = Math.sin(clamp(k, 0, 1) * Math.PI);
      h.s.scale.setScalar(0.2 + 0.18 * Math.min(1, k * 3));
      if (k >= 1) { h.t = -1; h.s.visible = false; }
    });
    leaves.forEach((l) => {
      if (l.t < 0) return;
      l.t += dt;
      l.y -= dt * 1.1;
      l.x += (l.vx + Math.sin(l.t * 3 + l.ph) * 0.35) * dt;
      l.s.position.set(l.x, l.y, l.z);
      l.s.material.rotation += dt * 2;
      l.s.material.opacity = 1 - smooth(1.8, 2.8, l.t);
      if (l.y < 0.05 || l.t > 3) { l.t = -1; l.s.visible = false; }
    });

    // hover test + tooltip + a gentle camera sway that follows the pointer (parallax = depth feel)
    castRay();
    updateTip();
    if (!reduced) {
      camX = damp(camX, ptr.inside ? ptr.nx * 1.1 : 0, 2, dt);
      camY = damp(camY, ptr.inside ? -ptr.ny * 0.25 : 0, 2, dt);
    }
    camera.position.set(CAM.x + camX + Math.sin(performance.now() / 6000) * (reduced ? 0 : 0.12), CAM.y + camY, CAM.z);
    camera.lookAt(camX * 0.25, CAM.lookY, 0);

    updateHud(false);
  }

  // Start. Build a default pair so there is something to see before the first chat starts.
  resize();
  updateSky();
  updateHud(true);
  raf = requestAnimationFrame(frame);

  return {
    setLook, setMood, setTyping,
    setHour(h) { clock.hour = h; updateSky(); },
    pause() { running = false; cancelAnimationFrame(raf); },          // stop the loop (used by tests / screenshots)
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
      [you, tolu].forEach((a) => a && a.h.dispose());
      npcs.forEach((n) => n.h.dispose());
      geoCache.forEach((g) => g.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      tip.remove();
      hudBtn.remove();
    },
    // handy for tests/debugging in the browser console
    debug: { tick, render: () => renderer.render(scene, camera), scene, camera, renderer, actors: () => ({ you, tolu }), clock, npcs, clouds, hitMeshes },
  };
}
