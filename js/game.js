import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

// ---- v3.2 shared state: declared before any zone is built ----
// ---- Player settings: volumes, mouse sensitivity and difficulty persist between visits. ----
const SETTINGS_KEY = 'epistassi-settings-v2';
const SETTINGS = Object.assign({ master: .9, music: .85, sfx: 1, sens: 1, difficulty: 1 }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; } })());
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (_) {} }
// Difficulty 0 = no enemies and no lethal traps. 1 = standard: the pursuers frighten but rarely kill.
// 2 = hard: contact is fatal. 3 = nightmare: faster pursuers, fear rises quicker.
const DIFFICULTY_INFO = [
  { name: '0 · PASTORALE', text: 'No enemies. Nothing can kill you. Only the story.' },
  { name: '1 · ASCOLTO', text: 'He appears and follows slowly. Contact frightens, it does not end the game.' },
  { name: '2 · MESSA', text: 'He follows faster. Contact ends the recording.' },
  { name: '3 · IL BIANCO', text: 'Fast pursuit, faster fear, darkness can kill.' }
];
function noEnemies() { return SETTINGS.difficulty === 0; }
function lethalContact() { return SETTINGS.difficulty >= 2; }
function enemySpeed() { return [0, .55, .95, 1.35][SETTINGS.difficulty] || .55; }
const TEST_MODE = new URLSearchParams(location.search).has('test');
const lowFx = new URLSearchParams(location.search).has('lowfx');
const candles = [], rituals = [], tools = new Set(), seenMissions = new Set(), chapterCardsShown = new Set();
let HEAD_TEX = null, JUMP_URL = null, PAINT_TEX = {}, atmo = { zone: null, nodes: [], timers: [], gain: null }, zoomPulse2 = 0;
const CHOICE_EFFECTS = {
  ines:['good:map','bad:jumpscare'],
  'father remo':['bad:closer','good:health'],
  'don remo':['bad:closer','good:health'],
  'the widow':['bad:trip','good:key'],
  'la vedova':['bad:trip','good:key'],
  ottavio: ['bad:trip', 'good:health'],
  sergio: ['good:key', 'bad:closer'],
  dario: ['good:health', 'bad:jumpscare'],
  anna: ['good:map', 'bad:closer']
};
const camDir2 = new THREE.Vector3();
let bokeh = null, zoomPulse = 0, presence = 0, presenceWarned = false, nearFlag = false, beatTimer = 0;
let stalker = null, stalkerZone = null, digEntry = null, digProgress = 0, digDone = false, candlesLit = 0;
let narrationTimer = null, rightMouse = false;
let darkroomHunt={active:false,elapsed:0,reappear:0,lastFlash:0,warning:0};
const relics = new Set(), eggs = [];
const storyRef = {}, rigs = [], emitters = [];
let storyScene = null, pendingCar = false, chaseState = null, industryT = 0, SOFT_TEX = null;
const RELIC_COUNT = 9;
// Bacon-style grade: umber shadows, desaturation, radial smear and vignette.
const BaconShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grade: { value: 0.6 }, smear: { value: 0.05 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time; uniform float grade; uniform float smear;
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 uv = vUv + c * smear * r * r;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 umber = mix(vec3(l), col, 0.45) * vec3(1.06, 0.9, 0.74);
      vec3 shadow = vec3(0.20, 0.03, 0.03);
      col = mix(col, umber, grade * 0.65);
      col = mix(col, shadow, (1.0 - l) * grade * 0.30);
      float vig = smoothstep(0.92, 0.22, r);
      col *= mix(1.0, vig, grade * 0.48);
      col *= 0.985 + 0.015 * sin(time * 23.0);
      gl_FragColor = vec4(col, 1.0);
    }`
};

// -----------------------------------------------------------------------------
// EPISTASSI — a self-contained, procedural first-person investigation.
// All environments, textures, props, characters and sound are generated locally.
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const clock = new THREE.Clock();
const collected = new Set();
const journal = [];
const clueCount = 8;
let currentZone = 'road';
let activeTarget = null;
let dialogueOpen = false;
let journalOpen = false;
let settingsOpen = false;
let gameStarted = false;
let gameEnded = false;
let doorTransitioning = false;
let listeningPending = false;
let flashlightOn = true;
let audio = null;
let muted = false;
let elapsed = 0;
let footstepDistance = 0, footstepSide = 0;
let dread = 0.12;
let glitchPulse = 0;
let toastTimer = null;
let fear = 0.12;
let eventClock = 0, scenePlayed = false, hiddenBreath = false;
// The thirteen are not background decoration: every one has a scripted fate.
const cultRoster = [];
const cultFateQueue = [];
let cultFateActive = null;
let cultFateClock = 0;
let cultFateCooldown = 0;
const storyFlags = new Set();
const windTrees = [];
const cropPlants = [];
const leafSpecks = [];
let dayNightBlend = 0;
let lastDayAnnouncement = '';

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  const fatal = $('fatal');
  fatal.textContent = `WEBGL IS UNAVAILABLE.\nOpen the game in an up-to-date desktop browser with hardware acceleration enabled.\nDetails: ${error.message}`;
  fatal.classList.remove('hidden');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowFx ? 1 : 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7b9b4);
scene.fog = new THREE.FogExp2(0xaeb2af, 0.018);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 190);
camera.position.set(0, 1.63, 0);
// Pointer lock is a convenience for mouse-look, never a prerequisite for movement.
// Keep the player transform separate from the camera so cinematic camera offsets
// cannot move the actual player or interfere with collision detection.
const playerAnchor = new THREE.Group();
playerAnchor.name = 'PLAYER_POSITION';
scene.add(playerAnchor);
playerAnchor.add(camera);
camera.rotation.order = 'YXZ';
const controls = new PointerLockControls(camera, canvas);
// Mouse look is handled here instead of inside PointerLockControls: raw deltas are clamped against
// browser spikes, scaled by the sensitivity setting and eased in over a few milliseconds.
controls.pointerSpeed = 0;
const look = { yaw: 0, pitch: 0 };
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const clamp = (v) => Math.max(-180, Math.min(180, v || 0));
  look.yaw += clamp(e.movementX) * .0021 * SETTINGS.sens;
  look.pitch += clamp(e.movementY) * .0021 * SETTINGS.sens;
});
function applyLook(dt) {
  const k = 1 - Math.exp(-dt * 38);
  const dy = look.yaw * k, dp = look.pitch * k;
  look.yaw -= dy; look.pitch -= dp;
  if (Math.abs(dy) + Math.abs(dp) < 1e-6) return;
  camera.rotation.order = 'YXZ';
  camera.rotation.y -= dy;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dp, -Math.PI / 2 + .05, Math.PI / 2 - .05);
}
function resetLook() { look.yaw = 0; look.pitch = 0; }

const zones = {};
let zone = null;
const forward = new THREE.Vector3();
const cameraWorld = new THREE.Vector3();
const targetVec = new THREE.Vector3();
const moveVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const wishVec = new THREE.Vector3();
const velocity = new THREE.Vector3();
const keys = new Set();

// A subtle custom post-process: analogue grain, RGB drift and horizontal tearing.
const GlitchShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, strength: { value: 0.12 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time; uniform float strength;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv=vUv;
      float row=floor(uv.y*190.0);
      float tear=step(0.992,hash(vec2(row,floor(time*7.0))))*strength;
      uv.x += (hash(vec2(row,time))-0.5)*tear*0.13;
      float chroma=(hash(vec2(floor(uv.y*90.0),floor(time*3.0)))-0.5)*0.003*strength;
      vec4 r=texture2D(tDiffuse,uv+vec2(chroma,0.0));
      vec4 g=texture2D(tDiffuse,uv);
      vec4 b=texture2D(tDiffuse,uv-vec2(chroma,0.0));
      vec3 col=vec3(r.r,g.g,b.b);
      float grain=(hash(uv*vec2(900.0,650.0)+time*13.0)-0.5)*0.075*strength;
      col += grain;
      float scan=sin(uv.y*920.0)*0.012*strength;
      col -= scan;
      gl_FragColor=vec4(col,1.0);
    }`
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
if (!lowFx) { bokeh = new BokehPass(scene, camera, { focus: 4.5, aperture: 0.00016, maxblur: 0.0045 }); composer.addPass(bokeh); }
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.62, 0.78);
composer.addPass(bloom);
const glitchPass = new ShaderPass(GlitchShader);
composer.addPass(glitchPass);
const baconPass = new ShaderPass(BaconShader);
composer.addPass(baconPass);

// -----------------------------------------------------------------------------
// Procedural materials and geometry
// -----------------------------------------------------------------------------
function noiseTexture(kind = 'plaster', seed = 1, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const base = kind === 'concrete' ? [93, 96, 91] : kind === 'wood' ? [69, 52, 38] : kind === 'rust' ? [82, 49, 37] : [112, 112, 103];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (rand() - 0.5) * (kind === 'wood' ? 52 : 72);
      const streak = kind === 'wood' ? Math.sin(y * 0.11 + rand() * 3) * 12 : 0;
      const stain = (rand() > 0.992 ? -40 : 0) + (rand() > 0.997 ? 34 : 0);
      img.data[i] = Math.max(0, Math.min(255, base[0] + n + streak + stain));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] + n + streak * 0.75 + stain));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] + n + streak * 0.5 + stain));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Layered damp blooms, mineral tide marks and soot: deliberately irregular, never clean tiling.
  for(let k=0;k<95;k++){const x=rand()*size,y=rand()*size,r=2+rand()*30;ctx.beginPath();ctx.fillStyle=`rgba(${kind==='rust'?68:24},${kind==='rust'?34:29},${kind==='rust'?20:24},${.025+rand()*.075})`;ctx.ellipse(x,y,r,r*(.25+rand()),rand()*3.14,0,Math.PI*2);ctx.fill();}
  for(let k=0;k<700;k++){const x=rand()*size,y=rand()*size;ctx.fillStyle=rand()>.5?'rgba(8,9,8,.16)':'rgba(205,198,177,.08)';ctx.fillRect(x,y,1+rand()*2,1+rand()*2);}
  // Fine cracks, plaster scars and wood grain are baked into the albedo.
  if (kind !== 'wood') {
    ctx.globalAlpha = 0.23; ctx.strokeStyle = '#151513'; ctx.lineWidth = 1;
    for (let n = 0; n < 22; n++) {
      let x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rand() - 0.5) * 26; y += 5 + rand() * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#d2b48d';
    for (let i = 0; i < 35; i++) { const y = rand() * size; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(size * .3, y - 8, size * .6, y + 12, size, y + rand() * 6); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function brickTexture(seed = 211, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  x.fillStyle = '#292824'; x.fillRect(0, 0, size, size);
  const brickW = 92, brickH = 37, mortar = 6;
  for (let row = 0; row < Math.ceil(size / (brickH + mortar)); row++) {
    const offset = row % 2 ? -brickW / 2 : 0;
    for (let col = -1; col < Math.ceil(size / brickW) + 1; col++) {
      const xx = col * brickW + offset + mortar / 2, yy = row * (brickH + mortar) + mortar / 2;
      const tone = Math.floor(55 + rand() * 42);
      x.fillStyle = `rgb(${tone+27},${tone+7},${tone-3})`;
      x.fillRect(xx, yy, brickW - mortar, brickH - mortar);
      x.fillStyle = 'rgba(7,8,7,.26)'; x.fillRect(xx, yy + brickH - mortar - 3, brickW - mortar, 3);
      x.fillStyle = 'rgba(202,174,143,.10)'; x.fillRect(xx + 4, yy + 3, brickW - mortar - 8, 2);
      for (let n=0;n<9;n++) { x.fillStyle = rand()>.5?'rgba(8,8,7,.15)':'rgba(220,190,150,.07)'; x.fillRect(xx+rand()*(brickW-mortar),yy+rand()*(brickH-mortar),1+rand()*5,1+rand()*2); }
    }
  }
  for (let i=0;i<600;i++) { x.fillStyle=rand()>.5?'rgba(0,0,0,.12)':'rgba(200,190,170,.06)'; x.fillRect(rand()*size,rand()*size,1+rand()*3,1+rand()*2); }
  const t = new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; t.repeat.set(2.4,1.1); return t;
}
// Photographic PBR sets (CC0, Poly Haven / ambientCG — see ASSET_CREDITS.md). Boxes get world-scaled
// UVs (see addBox), so one repeat of these textures covers roughly 2.2 metres everywhere.
const PBR = (name, rep = 1, color = true) => photoTexture(`assets/textures/${name}.jpg`, rep, color);
const TEX = {
  concrete: noiseTexture('concrete', 17), plaster: photoTexture('assets/textures/plaster-wall.jpg', 1), wood: photoTexture('assets/textures/wood-planks.jpg', 1),
  rust: PBR('rust-diff'), road: noiseTexture('concrete', 107), brick: PBR('brick-diff', 1.4), grass: grassTexture(), metal: metalTexture(),
  plasterN: PBR('plaster03-nor', 1, false), brickN: PBR('brick-nor', 1.4, false), rustN: PBR('rust-nor', 1, false),
  planks: PBR('planks-diff'), planksN: PBR('planks-nor', 1, false), darkwood: PBR('darkwood-diff'), darkwoodN: PBR('darkwood-nor', 1, false),
  stone: PBR('stone-diff', 1.6), stoneN: PBR('stone-nor', 1.6, false), cobble: PBR('cobble-diff', 1.3), cobbleN: PBR('cobble-nor', 1.3, false),
  bronze: PBR('bronze-diff'), bronzeN: PBR('bronze-nor', 1, false), marble: PBR('marble-diff'),
  ruinWall: PBR('bricksplaster-diff'), ruinWallN: PBR('bricksplaster-nor', 1, false), oldPlaster: PBR('plaster03-diff')
};

// Archival photo fragments: Wikimedia Commons files marked public domain / PD-Art.
// The browser loads these at runtime; the images are not copied into the repository.
const PHOTO_ARCHIVE = {
  oldman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/17/Old_man_sitting_portrait.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Old_man_sitting_portrait.jpg',
    credit: 'Charles R. Savage / Harold B. Lee Library collection; public-domain photograph (photographer died 1909).',
    face: [.415,.205,.205,.185], mode: 'dark'
  },
  woman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Portrait_of_a_woman_seated%2C_ca_1900_%28BOYD%2BBRAAS_152%29.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Portrait_of_a_woman_seated,_ca_1900_(BOYD+BRAAS_152).jpg',
    credit: 'George H. Braas, ca. 1900; public domain (photographer died 1914).',
    face: [.365,.105,.285,.205], mode: 'light'
  },
  elder: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Photograph_of_an_unknown_elderly_woman_seated_in_a_chair%2C_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Photograph_of_an_unknown_elderly_woman_seated_in_a_chair,_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    credit: 'Unknown photographer, 8 July 1915; DPLA / Wikimedia Commons, public domain in the United States.',
    face: [.385,.285,.235,.155], mode: 'light'
  },
  roomwoman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Charles_Henry_Currier_01945v.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Charles_Henry_Currier_01945v.jpg',
    credit: 'Charles Henry Currier, ca. 1890–1900; Library of Congress source, public-domain photograph.',
    face: [.495,.385,.095,.155], mode: 'light'
  },
  man: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    credit: 'Library of Congress, LCCN 2006689630; 19th-century portrait, public domain / no known publication restrictions.',
    face: [.415,.265,.185,.16], mode: 'light'
  }
};
const PHOTO_IMAGES = {};
const photoNPCs = [];
const evidenceRefreshers = [];
function makeFaceCanvas(image, spec) {
  const c=document.createElement('canvas'); c.width=256; c.height=320; const ctx=c.getContext('2d');
  const [x,y,w,h]=spec.face; ctx.save(); ctx.filter='grayscale(100%) contrast(1.28) brightness(.86) sepia(12%)';
  ctx.drawImage(image,x*image.width,y*image.height,w*image.width,h*image.height,0,0,256,320); ctx.restore();
  const d=ctx.getImageData(0,0,256,320);
  for(let i=0;i<d.data.length;i+=4){ const l=(d.data[i]+d.data[i+1]+d.data[i+2])/3; const v=Math.max(0,Math.min(1,(l-18)/220)); d.data[i]=Math.min(255,d.data[i]*.88+20); d.data[i+1]=Math.min(255,d.data[i+1]*.83+13); d.data[i+2]=Math.min(255,d.data[i+2]*.78+7); d.data[i+3]=Math.round(255*Math.min(1,v*1.7)); }
  ctx.putImageData(d,0,0); ctx.globalCompositeOperation='destination-in'; ctx.beginPath(); ctx.ellipse(128,160,119,153,0,0,Math.PI*2); ctx.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
}
function refreshPhotoNPC(npc){const key=npc.photoKey,image=PHOTO_IMAGES[key];if(!image)return;const spec=PHOTO_ARCHIVE[key];try{const face=makeFaceCanvas(image,spec);npc.photoFace.material.map?.dispose?.();npc.photoFace.material.map=face;npc.photoFace.material.needsUpdate=true;npc.photoFace.visible=!npc.isFirst;}catch(err){npc.photoFace.visible=false;console.warn('Could not crop archival face:',key,err);}}

function profileForNPC(name,variant){
 const n=(name||'').toLowerCase();
 if(['ines','anna','marta','vanda','ada','mirella','teresa','livia','woman by the canal','the widow'].some(v=>n.includes(v)))return 'woman';
 if(n.includes('father remo')||n.includes('don remo')||n.includes('the first')||n.includes('the first')||n.includes('dario')||n.includes('sergio')||n.includes('pino')||n.includes('franco')||n.includes('walter')||n.includes('gabri')||n.includes('elio'))return 'man';
 if(n.includes('ottavio')||n.includes('the coat')||n.includes('the coat'))return 'oldman';
 return variant===0?'woman':'oldman';
}

Object.entries(PHOTO_ARCHIVE).forEach(([key,spec])=>{
  const img=new Image(); img.crossOrigin='anonymous'; img.decoding='async';
  img.onload=()=>{PHOTO_IMAGES[key]=img; photoNPCs.filter(n=>n.photoKey===key).forEach(refreshPhotoNPC); evidenceRefreshers.forEach(fn=>fn());};
  img.onerror=()=>console.warn('Archival photo could not be loaded:', key, spec.url);
  img.src=spec.url;
} );
function mat(color, rough = .92, options = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: options.metalness ?? 0.02, map: options.map || null,
    normalMap: options.normalMap || null, bumpMap: options.normalMap ? null : (options.map || null), bumpScale: options.bumpScale ?? 0.075,
    emissive: options.emissive || 0x000000, emissiveIntensity: options.emissiveIntensity || 0, side: options.side || THREE.FrontSide });
  if (options.normalMap) m.normalScale.set(options.normalScale ?? .9, options.normalScale ?? .9);
  return m;
}
const M = {
  grass: mat(0x6b7a44, 1, { map: TEX.grass }), ground: mat(0x777b73, 1, { map: TEX.concrete }), asphalt: mat(0x343a38, 1, { map: TEX.road }), wall: mat(0x8a877b, 1, { map: TEX.plaster, normalMap: TEX.plasterN, normalScale: .7 }),
  darkWall: mat(0x66665f, 1, { map: TEX.plaster, normalMap: TEX.plasterN, normalScale: .8 }), wood: mat(0x806650, .9, { map: TEX.wood }), darkWood: mat(0x5a4636, .82, { map: TEX.darkwood, normalMap: TEX.darkwoodN, normalScale: .6 }),
  rust: mat(0x9a7a68, .9, { map: TEX.rust, normalMap: TEX.rustN, metalness: .25 }), brick: mat(0xa08878, 1, { map: TEX.brick, normalMap: TEX.brickN }), black: mat(0x101210, 1), metal: mat(0x4a4e4c, .62, { metalness: .5, map: TEX.metal }),
  floor: mat(0x8c7660, .86, { map: TEX.planks, normalMap: TEX.planksN, normalScale: .8 }), stone: mat(0xb2ada0, .96, { map: TEX.stone, normalMap: TEX.stoneN }),
  cobble: mat(0x9c978c, .95, { map: TEX.cobble, normalMap: TEX.cobbleN }), marble: mat(0xd8d2c4, .38, { map: TEX.marble }),
  bronze: mat(0xb19a78, .42, { map: TEX.bronze, normalMap: TEX.bronzeN, metalness: .85 }), iron: mat(0x1b1c1b, .55, { metalness: .7 }),
  ruinWall: mat(0x8f877a, 1, { map: TEX.ruinWall, normalMap: TEX.ruinWallN, normalScale: 1.1 }), oldPlaster: mat(0x8a8475, 1, { map: TEX.oldPlaster, normalMap: TEX.plasterN }),
  skin: mat(0x655b51, 1, { map: TEX.plaster, bumpScale: .035 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9aa4a0, roughness: .22, metalness: .15, transparent: true, opacity: .23 }),
  blood: mat(0x3b090b, .5, { emissive: 0x250000, emissiveIntensity: .24 }),
  gold: mat(0x8c7148, .5, { metalness: .62 }),
  warmLight: mat(0x332112, .35, { emissive: 0xffb65c, emissiveIntensity: 2.4 }),
  clue: mat(0x9e8152, .65, { emissive: 0x6e4c27, emissiveIntensity: .48 })
};
const CLUE_TEXTURE = new THREE.TextureLoader().load('./assets/clue.png', texture => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
}, undefined, error => console.warn('Could not load clue artwork:', error));
// Box UVs are rescaled to world size so photographic textures keep a constant density
// instead of stretching one image across a 30-metre wall or squeezing it into a 5 cm plank.
const UV_METRES = 2.2;
function worldBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / UV_METRES, uv.getY(i) * dims[f][1] / UV_METRES); }
  return g;
}
function addBox(group, x, y, z, w, h, d, material, options = {}) {
  const mesh = new THREE.Mesh(worldBox(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = options.castShadow !== false; mesh.receiveShadow = options.receiveShadow !== false;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.name) mesh.name = options.name;
  group.add(mesh); return mesh;
}
function addPlane(group, x, y, z, w, h, material, rotation = [-Math.PI / 2, 0, 0]) {
  const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / UV_METRES, uv.getY(i) * h / UV_METRES);
  const mesh = new THREE.Mesh(geo, material); mesh.position.set(x, y, z); mesh.rotation.set(...rotation); mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function addLight(group, color, intensity, distance, x, y, z, options = {}) {
  const light = new THREE.PointLight(color, intensity, distance, options.decay || 2);
  light.position.set(x, y, z); light.castShadow = !!options.shadow && !lowFx;
  if (light.castShadow) { light.shadow.mapSize.set(options.shadowSize || 512, options.shadowSize || 512); light.shadow.bias = -.002; light.shadow.normalBias = .03; light.shadow.radius = 4; light.shadow.camera.near = .1; light.shadow.camera.far = distance || 20; }
  group.add(light); return light;
}
// A lamp that actually exists in the world: bracket, glass, bulb and a warm (or cold) light that casts shadows.
const lampFlickers = [];
function addLamp(group, x, y, z, { color = 0xffb46a, intensity = 6, distance = 14, shadow = false, style = 'lantern', rotY = 0, flicker = .05, spot = null } = {}) {
  const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = rotY; group.add(root);
  const iron = M.iron || mat(0x1b1c1b, .55, { metalness: .7 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: color, emissiveIntensity: 2.6, roughness: .4 });
  if (style === 'lantern') {
    // Wall lantern: arm from the wall, a four-sided cage with glass, a little roof.
    tubeBetween(root, [0, 0, 0], [0, .05, .42], .022, iron, 6);
    const cage = new THREE.Group(); cage.position.set(0, -.16, .42); root.add(cage);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.025, .38, .025), iron); bar.position.set(sx * .11, 0, sz * .11); cage.add(bar); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(.2, .16, 4), iron); roof.rotation.y = Math.PI / 4; roof.position.y = .27; cage.add(roof);
    const base = new THREE.Mesh(new THREE.BoxGeometry(.25, .04, .25), iron); base.position.y = -.2; cage.add(base);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(.2, .34, .2), new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: color, emissiveIntensity: .35, transparent: true, opacity: .35, roughness: .15 })); cage.add(glass);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), bulbMat); bulb.position.y = -.02; cage.add(bulb);
    root.userData.lightPos = new THREE.Vector3(0, -.18, .42);
  } else if (style === 'post') {
    // Old street lamp: cast-iron pole with a swan-neck arm and an enamel shade.
    tubeBetween(root, [0, -y, 0], [0, 0, 0], .07, iron, 10);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, .5, 10), iron); collar.position.y = -y + .25; root.add(collar);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.1, 0), new THREE.Vector3(0, .25, .15), new THREE.Vector3(0, .25, .62), new THREE.Vector3(0, .12, .82)]), 16, .035, 7), iron); root.add(arm);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(.3, .2, 16, 1, true), mat(0x2b2f2c, .5, { metalness: .5, side: THREE.DoubleSide })); shade.position.set(0, .04, .82); root.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), bulbMat); bulb.position.set(0, -.04, .82); root.add(bulb);
    root.userData.lightPos = new THREE.Vector3(0, -.12, .82);
  } else if (style === 'pendant') {
    tubeBetween(root, [0, .9, 0], [0, .12, 0], .008, M.black, 4);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(.24, .18, 18, 1, true), mat(0x3a3d34, .6, { metalness: .4, side: THREE.DoubleSide })); shade.position.y = .05; root.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 8), bulbMat); bulb.position.y = -.02; root.add(bulb);
    root.userData.lightPos = new THREE.Vector3(0, -.08, 0);
  } else { root.userData.lightPos = new THREE.Vector3(); }
  const lp = root.userData.lightPos; intensity *= 2.6;
  let light;
  if (spot) {
    light = new THREE.SpotLight(color, intensity, distance, spot.angle ?? .7, .55, 1.6); light.position.copy(lp); root.add(light);
    light.target.position.set(...(spot.target || [0, -5, 1])); root.add(light.target);
  } else { light = new THREE.PointLight(color, intensity, distance, 1.7); light.position.copy(lp); root.add(light); }
  light.castShadow = shadow && !lowFx;
  if (light.castShadow) { light.shadow.mapSize.set(spot ? 1024 : 512, spot ? 1024 : 512); light.shadow.bias = -.0015; light.shadow.normalBias = .035; light.shadow.radius = 3; light.shadow.camera.near = .2; light.shadow.camera.far = distance; }
  lampFlickers.push({ light, base: intensity, flicker, bulb: bulbMat, phase: Math.random() * 10 });
  return { root, light };
}
function updateLamps(t) {
  for (const l of lampFlickers) {
    if (!l.flicker) continue;
    const n = Math.sin(t * .0021 + l.phase) * .5 + Math.sin(t * .0137 + l.phase * 3) * .3 + (Math.random() < .004 ? -2.2 : 0);
    const k = Math.max(.15, 1 + n * l.flicker);
    l.light.intensity = l.base * k; l.bulb.emissiveIntensity = 2.6 * k;
  }
}
function addFog(group, count, span, color = 0xd6d9d6, seed = 10) {
  const fogGroup = new THREE.Group(); group.add(fogGroup);
  const texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 128;
  const ctx = texCanvas.getContext('2d'); const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,.82)'); grad.addColorStop(.48, 'rgba(255,255,255,.24)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const fogTex = new THREE.CanvasTexture(texCanvas);
  const fogMaterial = new THREE.SpriteMaterial({ map: fogTex, color, transparent: true, opacity: .10, depthWrite: false });
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(fogMaterial);
    sprite.position.set((rand() - .5) * span, .4 + rand() * 4.2, (rand() - .5) * span);
    const sc = 9 + rand() * 24; sprite.scale.set(sc * (1.2 + rand()), sc * .58, 1); sprite.userData.phase = rand() * 6.28; fogGroup.add(sprite);
  }
  return fogGroup;
}
function makeLabelTexture(text, width = 512, height = 128) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; const x = c.getContext('2d');
  x.fillStyle = '#d2c8b3'; x.fillRect(0, 0, width, height); x.fillStyle = 'rgba(35,31,25,.16)';
  for (let i = 0; i < 2500; i++) { x.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 3, 1); }
  x.fillStyle = '#282722'; x.font = '22px monospace'; x.textAlign = 'center'; x.fillText(text, width / 2, height / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeEvidenceCanvas(title, id, imageKey='oldman') {
  const c=document.createElement('canvas'); c.width=512; c.height=352; const ctx=c.getContext('2d');
  const draw=()=>{
    ctx.fillStyle='#b6a98e';ctx.fillRect(0,0,512,352);ctx.fillStyle='#27241e';ctx.fillRect(10,10,492,332);
    ctx.fillStyle='#c9bda2';ctx.fillRect(17,17,478,318);ctx.fillStyle='#24231f';ctx.font='bold 19px monospace';ctx.fillText('ARCHIVIO 14-B   /   ' + id.toUpperCase(),30,45);
    ctx.fillStyle='#39352e';ctx.font='16px serif';ctx.fillText(title.toUpperCase(),30,72);
    const img=PHOTO_IMAGES[imageKey];
    if(img){const ar=img.width/img.height;let sw=img.width,sh=img.height;if(ar>1.55){sw=img.height*1.55; }else if(ar<.64){sh=img.width/.64;} const sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.save();ctx.filter='grayscale(100%) sepia(18%) contrast(1.2)';ctx.drawImage(img,sx,sy,sw,sh,30,88,205,190);ctx.restore();}
    else {ctx.fillStyle='#655b4b';ctx.fillRect(30,88,205,190);ctx.strokeStyle='#27241e';ctx.lineWidth=2;for(let i=0;i<7;i++){ctx.beginPath();ctx.moveTo(34,100+i*25);ctx.lineTo(230,96+i*25);ctx.stroke();}}
    ctx.fillStyle='#3d392f';ctx.font='14px monospace';ctx.fillText('UNDEVELOPED NEGATIVE',256,113);ctx.fillText('TIME: 03:17',256,143);ctx.fillText('DAMAGED EMULSION',256,173);
    ctx.strokeStyle='#29251f';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(256,200+i*12);ctx.lineTo(470-(i%3)*25,200+i*12);ctx.stroke();}
    ctx.fillStyle='rgba(50,35,25,.45)';ctx.font='italic 18px serif';ctx.fillText('do not look for too long',30,312);
    for(let i=0;i<1400;i++){ctx.fillStyle=Math.random()>.5?'rgba(25,20,12,.09)':'rgba(255,255,255,.10)';ctx.fillRect(Math.random()*512,Math.random()*352,1+Math.random()*2,1);}
  };draw();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  evidenceRefreshers.push(()=>{draw();t.needsUpdate=true;});return t;
}
function addClueMesh(group, pos, title, description, id, kind = 'paper', options = {}) {
  // pos is the point on the supporting surface (table top, floor, lectern); the object rests on it.
  const root = new THREE.Group(); root.position.copy(pos); group.add(root); let object;
  if (kind === 'paper') {
    object = new THREE.Mesh(new THREE.PlaneGeometry(.30, .21), new THREE.MeshStandardMaterial({ map: CLUE_TEXTURE, side: THREE.DoubleSide, roughness: .96, polygonOffset: true, polygonOffsetFactor: -2 }));
    object.rotation.x = -Math.PI / 2; object.rotation.z = -.12 + (id.length % 5) * .05; object.position.y = .004; object.receiveShadow = true;
  } else if (kind === 'fork') {
    object = new THREE.Group(); const steel = mat(0xb9b6ad, .25, { metalness: .9 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .07, 10), steel); stem.rotation.z = Math.PI / 2; stem.position.set(-.06, .006, 0); object.add(stem);
    const u = new THREE.Mesh(new THREE.TorusGeometry(.012, .0045, 6, 14, Math.PI), steel); u.rotation.set(-Math.PI / 2, 0, Math.PI / 2); u.position.set(-.025, .006, 0); object.add(u);
    for (const sz of [-1, 1]) { const tine = new THREE.Mesh(new THREE.BoxGeometry(.09, .006, .006), steel); tine.position.set(.02, .006, sz * .012); object.add(tine); }
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.26, .16), mat(0x5c1f1c, 1)); cloth.rotation.x = -Math.PI / 2; cloth.position.y = .002; root.add(cloth);
    object.rotation.y = .3;
  } else if (kind === 'book') {
    object = new THREE.Group();
    const cover = roundedHousing(.24, .32, .035, .01, mat(0x3a2418, .85, { map: TEX.wood }), .006); cover.rotation.x = -Math.PI / 2; cover.position.y = .018; object.add(cover);
    const page = new THREE.Mesh(new THREE.PlaneGeometry(.21, .29), new THREE.MeshStandardMaterial({ map: CLUE_TEXTURE, roughness: .95 })); page.rotation.x = -Math.PI / 2; page.position.y = .037; object.add(page);
  } else if (kind === 'machine') {
    object = new THREE.Group();
    const body = roundedHousing(.26, .07, .19, .02, mat(0x2c2b28, .55), .008); body.rotation.x = -Math.PI / 2; body.position.y = .035; object.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(.12, .006, .08), mat(0x6d6a60, .3, { metalness: .4 })); lid.position.set(-.04, .073, 0); object.add(lid);
    const led = new THREE.Mesh(new THREE.SphereGeometry(.008, 8, 6), glow(0xff3b20, 2.2)); led.position.set(.09, .073, .06); object.add(led); root.userData.led = led;
    const cassette = new THREE.Mesh(new THREE.BoxGeometry(.05, .004, .032), mat(0x161616, .5)); cassette.position.set(-.04, .078, 0); object.add(cassette);
  } else {
    object = new THREE.Mesh(worldBox(1.1, .16, .18), M.darkWood); object.position.y = .08; object.rotation.y = .4;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(.9, .14), new THREE.MeshStandardMaterial({ map: CLUE_TEXTURE, roughness: .9 })); plate.rotation.set(-Math.PI / 2, 0, -.4); plate.position.y = .162; root.add(plate);
  }
  root.add(object);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // A faint glint so the trace can be found in the dark; the light sits just above the surface.
  const glint = new THREE.PointLight(0xd5b27b, .3, 1.6, 2); glint.position.y = .22; root.add(glint);
  const entry = { id, type: 'clue', object: root, point: root.position, radius: 3.0, prompt: `[ E ] COLLECT — ${title.toUpperCase()}`, title, description, kind, ...options };
  group.userData.interactables.push(entry); return root;
}
function makeNPC(group,x,z,name,coatColor=0x272725,variant=0){
 const root=new THREE.Group();root.position.set(x,0,z);group.add(root);
 const lower=(name||'').toLowerCase(),profile=profileForNPC(name,variant);
 const female=profile==='woman',elder=profile==='oldman'||profile==='elder',first=lower==='the first'||lower==='the first',isFirst=first;
 const skin=mat([0x88735f,0x9b826d,0x716052,0x8d7a68,0x6b5c51][(name||'').length%5],.96,{map:TEX.plaster,bumpScale:.022});
 const cloth=mat(coatColor,1,{map:TEX.wood,bumpScale:.045}),trim=mat(first?0x1d1b18:(variant===0?0x39352e:0x292b28),1,{map:TEX.wood});
 const hairColor=elder?0x77736b:(female?0x211c19:0x26221e),hair=mat(hairColor,1,{map:TEX.wood,bumpScale:.02});
 const boot=mat(0x211f1b,.95,{map:TEX.wood}),faceShadow=mat(0x211b18,.96);
 const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.285,.66,7,14),cloth);torso.position.set(first?.045:0,1.02,0);torso.scale.set(first?1.12:1,1,.76);torso.rotation.z=first?-.075:0;torso.castShadow=true;root.add(torso);
 const chest=new THREE.Mesh(new THREE.SphereGeometry(.285,14,10),cloth);chest.position.set(first?.05:0,1.40,0);chest.scale.set(1.12,.56,.8);root.add(chest);
 const waist=new THREE.Mesh(new THREE.CylinderGeometry(.19,.235,.38,12),cloth);waist.position.y=.70;root.add(waist);
 const neck=new THREE.Mesh(new THREE.CylinderGeometry(.073,.087,.23,10),skin);neck.position.y=1.64;root.add(neck);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.205,20,16),skin);head.position.set(first?-.055:0,1.91,.012);head.scale.set(first?.76:.84,1.04,.88);head.rotation.z=first?-.16:(Math.random()-.5)*.045;root.add(head);
 const jaw=new THREE.Mesh(new THREE.SphereGeometry(.14,14,10),skin);jaw.position.set(first?-.055:0,1.79,.085);jaw.scale.set(.82,.57,.88);root.add(jaw);
 const nose=new THREE.Mesh(new THREE.ConeGeometry(.042,.10,7),skin);nose.rotation.x=Math.PI/2;nose.position.set(first?-.055:0,1.88,.194);root.add(nose);
 const mouth=new THREE.Mesh(new THREE.BoxGeometry(.075,.012,.012),faceShadow);mouth.position.set(first?-.055:0,1.81,.205);root.add(mouth);
 const eyeMat=mat(0xbab0a0,.74),pupilMat=mat(0x171513,.45),eyes=[],lids=[];
 for(const side of [-1,1]){
  const ex=(first?-.055:0)+side*.073;
  const eye=new THREE.Mesh(new THREE.SphereGeometry(.022,10,8),eyeMat);eye.position.set(ex,1.935,.174);root.add(eye);
  const pupil=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),pupilMat);pupil.position.set(ex,1.934,.193);root.add(pupil);
  const brow=new THREE.Mesh(new THREE.CapsuleGeometry(.012,.065,3,5),hair);brow.position.set(ex,1.972,.174);brow.rotation.z=side*.1;root.add(brow);
  const lid=new THREE.Mesh(new THREE.SphereGeometry(.033,9,7),hair);lid.scale.set(1,.08,.28);lid.position.set(ex,1.955,.178);root.add(lid);eyes.push(eye,pupil);lids.push(lid);
  const ear=new THREE.Mesh(new THREE.SphereGeometry(.052,8,7),skin);ear.scale.set(.48,1,.54);ear.position.set((first?-.055:0)+side*.19,1.90,.005);root.add(ear);
 }
 const cap=new THREE.Mesh(new THREE.SphereGeometry(.205,16,10),hair);cap.position.set(first?-.065:0,2.035,-.018);cap.scale.set(.92,.51,.98);root.add(cap);
 if(female){
  const back=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.40,5,8),hair);back.position.set(0,1.69,-.105);back.scale.set(1.08,1.15,.58);root.add(back);
  for(const side of [-1,1]){const lock=new THREE.Mesh(new THREE.CapsuleGeometry(.043,.34,4,7),hair);lock.position.set(side*.15,1.72,.005);lock.rotation.z=side*.10;root.add(lock);const fringe=new THREE.Mesh(new THREE.SphereGeometry(.09,10,7),hair);fringe.position.set(side*.075,2.00,.12);fringe.scale.set(1,.46,.64);root.add(fringe);}
 }else{
  for(const side of [-1,1]){const sideburn=new THREE.Mesh(new THREE.CapsuleGeometry(.032,.13,3,6),hair);sideburn.position.set(side*.17,1.93,.04);root.add(sideburn);}
  if(elder){const grey=new THREE.Mesh(new THREE.SphereGeometry(.105,9,7),mat(0xaaa397,.98));grey.scale.set(1,.34,.7);grey.position.set(.11,2.04,-.015);root.add(grey);}
 }
 const photoMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.84,side:THREE.DoubleSide,depthWrite:false});
 const photoKey=profile==='woman'?'woman':profile==='oldman'?'oldman':'man';
 const photoFace=new THREE.Mesh(new THREE.PlaneGeometry(.23,.285),photoMat);photoFace.position.set(first?-.055:0,1.91,.205);photoFace.visible=false;root.add(photoFace);
 const mask=new THREE.Mesh(new THREE.BoxGeometry(.25,.06,.025),trim);mask.position.set(first?-.055:0,1.91,.205);mask.visible=false;root.add(mask);
 const leftArm=new THREE.Group();leftArm.position.set(first?-.39:-.31,1.43,0);root.add(leftArm);
 const rightArm=new THREE.Group();rightArm.position.set(first?.42:.31,1.43,0);root.add(rightArm);
 function makeArm(pivot,side){
  const upper=new THREE.Mesh(new THREE.CapsuleGeometry(.074,.34,5,9),cloth);upper.position.y=-.20;upper.rotation.z=side*-.035;pivot.add(upper);
  const elbow=new THREE.Mesh(new THREE.SphereGeometry(.071,8,7),skin);elbow.position.y=-.40;pivot.add(elbow);
  const forearm=new THREE.Group();forearm.position.y=-.40;pivot.add(forearm);
  const sleeve=new THREE.Mesh(new THREE.CapsuleGeometry(.063,.29,5,8),cloth);sleeve.position.y=-.18;forearm.add(sleeve);
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.066,.066,.06,8),trim);cuff.position.y=-.35;forearm.add(cuff);
  const palm=new THREE.Mesh(new THREE.SphereGeometry(.061,9,7),skin);palm.scale.set(.82,1.1,.72);palm.position.set(0,-.405,.025);forearm.add(palm);
  for(let i=0;i<4;i++){const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.012,.07,3,5),skin);finger.position.set((i-1.5)*.025,-.48,.062);finger.rotation.z=(i-1.5)*.10;forearm.add(finger);}
  const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.014,.06,3,5),skin);thumb.position.set(side*.07,-.43,.04);thumb.rotation.z=side*-.55;forearm.add(thumb);return forearm;
 }
 const leftForearm=makeArm(leftArm,-1),rightForearm=makeArm(rightArm,1);
 const legs=[],lowerLegs=[],shoes=[];
 for(const side of [-1,1]){
  const hip=new THREE.Group();hip.position.set(side*.14,.68,0);root.add(hip);
  const thigh=new THREE.Mesh(new THREE.CapsuleGeometry(.093,.34,5,9),trim);thigh.position.y=-.20;hip.add(thigh);
  const knee=new THREE.Mesh(new THREE.SphereGeometry(.07,8,7),trim);knee.position.y=-.40;hip.add(knee);
  const calf=new THREE.Group();calf.position.y=-.40;hip.add(calf);
  const shin=new THREE.Mesh(new THREE.CapsuleGeometry(.066,.31,5,8),trim);shin.position.y=-.19;calf.add(shin);
  const shoe=new THREE.Mesh(new THREE.BoxGeometry(.18,.095,.31),boot);shoe.position.set(0,-.39,.075);calf.add(shoe);
  const sole=new THREE.Mesh(new THREE.BoxGeometry(.19,.025,.32),M.black);sole.position.set(0,-.44,.075);calf.add(sole);
  legs.push(hip);lowerLegs.push(calf);shoes.push(shoe);
 }
 const collar=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.31,3,6),trim);collar.position.set(0,1.56,.025);collar.rotation.z=Math.PI/2;root.add(collar);
 for(let i=0;i<4;i++){const button=new THREE.Mesh(new THREE.SphereGeometry(.017,6,5),M.gold);button.position.set(.035,1.34-i*.19,.235);root.add(button);}
 if(female){const shawl=new THREE.Mesh(new THREE.BoxGeometry(.45,.16,.07),mat(0x5a5146,.98));shawl.position.set(0,1.35,.20);shawl.rotation.z=-.07;root.add(shawl);if(lower.includes('anna')||lower.includes('mirella')){const apron=new THREE.Mesh(new THREE.BoxGeometry(.32,.48,.04),mat(0x4d3830,.99));apron.position.set(0,.94,.225);root.add(apron);}}
 else{const vest=new THREE.Mesh(new THREE.BoxGeometry(.20,.38,.045),trim);vest.position.set(0,1.37,.20);root.add(vest);if(elder){const glasses=mat(0x28251f,.52,{metalness:.35});for(const side of [-1,1]){const lens=new THREE.Mesh(new THREE.TorusGeometry(.048,.008,5,14),glasses);lens.position.set(side*.073,1.94,.192);root.add(lens);}const bridge=new THREE.Mesh(new THREE.BoxGeometry(.07,.01,.01),glasses);bridge.position.set(0,1.94,.19);root.add(bridge);}}
 if(first){
  leftArm.position.y+=.11;leftArm.rotation.z=-.24;rightArm.position.y-=.045;rightArm.rotation.z=.14;rightForearm.rotation.z=-.28;leftForearm.rotation.z=.10;
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.20,10,8),trim);shoulder.position.set(-.35,1.49,.015);shoulder.scale.set(1.15,.58,.78);root.add(shoulder);
  const lapel=new THREE.Mesh(new THREE.BoxGeometry(.11,.65,.06),M.darkWood);lapel.position.set(-.16,1.25,.235);lapel.rotation.z=.32;root.add(lapel);
  const seam=new THREE.Mesh(new THREE.CylinderGeometry(.012,.02,.52,5),M.rust);seam.position.set(.25,.72,.19);seam.rotation.z=-.18;root.add(seam);
  root.rotation.z=-.025;root.scale.set(1.04,1.08,.94);
 }
 const displayName=name==='The First'?'Il Professore':name;
 const npc={head,id:'npc_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),type:'npc',object:root,point:root.position,radius:3.4,prompt:'[ E ] SPEAK — '+displayName.toUpperCase(),name,displayName,phase:Math.random()*7,coat:cloth,leftArm,rightArm,photoFace,photoKey,leftForearm,rightForearm,legs,lowerLegs,shoes,eyes,lids,blinkTimer:1.8+Math.random()*4,blinkAmount:0,walking:false,cultist:false,fate:'present',profile,isFirst};
 root.traverse(o=>{if(o.isMesh&&o!==photoFace){o.castShadow=true;o.receiveShadow=true;}});
 photoNPCs.push(npc);refreshPhotoNPC(npc);group.userData.interactables.push(npc);return npc;
}

function registerCultist(npc, dialogue=null) {
  npc.cultist=true; npc.fate='present'; npc.object.userData.cultist=true;
  if(dialogue) npc.dialogue=dialogue;
  cultRoster.push(npc); return npc;
}
function addCultist(zone, x, z, name, coat=0x34332f, variant=0, line='We are not here to listen. We are here to make room.', choices=['What are you waiting for?','Who called you here?'], replies=['The moment someone stops having a name.','The room was already full before we arrived.']) {
  const npc=makeNPC(zone.group,x,z,name,coat,variant);
  npc.dialogue={line,choices,replies}; return registerCultist(npc);
}
function isProgressCriticalCultist(npc){const name=(npc?.name||'').toLowerCase();return ['ines','ottavio','pino'].includes(name);}
function queueCultFate(source='a trace', preferred=null, mode=null) {
  const npc=preferred || [...cultRoster].reverse().find(n=>n.fate==='present');
  if(!npc || npc.fate!=='present') return null;
  npc.fate='queued';cultFateQueue.push({npc,source,mode:mode||(cultFateQueue.length%3===1?'collapse':'vanish')});
  return npc;
}
function removeQueuedCultist(npc) {
  for(let i=cultFateQueue.length-1;i>=0;i--) if(cultFateQueue[i].npc===npc) cultFateQueue.splice(i,1);
}
function transferCultist(npc, targetZone, x, z) {
  if(!npc || !targetZone) return;
  const oldParent=npc.object.parent; if(oldParent) oldParent.remove(npc.object);
  npc.object.position.set(x,0,z);npc.point=npc.object.position;targetZone.group.add(npc.object);
  const old=Object.values(zones).find(v=>v.interactables.includes(npc)); if(old) old.interactables.splice(old.interactables.indexOf(npc),1);
  npc.object.visible=true;
}
function startCultFate(entry) {
  if(!entry || cultFateActive) return;
  const npc=entry.npc; npc.fate='in-progress';npc.object.visible=true;
  const oldZone=Object.values(zones).find(v=>v.interactables.includes(npc));if(oldZone){const index=oldZone.interactables.indexOf(npc);if(index>=0)oldZone.interactables.splice(index,1);}
  const playerAt=currentPosition().clone();
  controls.getDirection(forward);forward.y=0;forward.normalize();
  const side=new THREE.Vector3(-forward.z,0,forward.x).multiplyScalar((cultRoster.indexOf(npc)%3-1)*.72);
  // Every fate is staged in the player's forward field of view, even when
  // the cultist already belongs to the current room. This avoids off-screen
  // removals when a clue is collected near one of the thirteen.
  const sx=THREE.MathUtils.clamp(playerAt.x+forward.x*5.3+side.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  const sz=THREE.MathUtils.clamp(playerAt.z+forward.z*5.3+side.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  if(npc.object.parent!==zone.group) transferCultist(npc,zone,sx,sz);
  else npc.object.position.set(sx,0,sz);
  npc.point=npc.object.position;
  npc.object.lookAt(playerAt.x,0,playerAt.z);
  const approach=playerAt.clone().addScaledVector(forward,1.45).addScaledVector(side,.18);
  approach.x=THREE.MathUtils.clamp(approach.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  approach.z=THREE.MathUtils.clamp(approach.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  cultFateActive={...entry,phase:0,start:npc.object.position.clone(),target:approach,elapsed:0};
  showToast(entry.mode==='collapse'?`${npc.name.toUpperCase()} HAS STOPPED HOLDING THEMSELVES UP.`:`${npc.name.toUpperCase()} HAS LEFT THEIR PLACE.`);
  if(entry.mode==='collapse') speakVoice(`${npc.name}. There is nothing left to fill.`,npc.name);
  else speakVoice(`${npc.name}: do not remember my face.`,npc.name);
  glitchPulse=Math.max(glitchPulse,.85);audio?.killingAudio();
}
function updateCultSequence(dt,t) {
  if(cultFateActive){
    const a=cultFateActive,n=a.npc;a.elapsed+=dt;
    if(a.mode==='collapse'){
      const k=THREE.MathUtils.clamp(a.elapsed/1.55,0,1);n.object.rotation.x=THREE.MathUtils.lerp(0,1.43,k);n.object.rotation.z=Math.sin(k*2)*.18;n.object.position.y=-.18*k;
      n.object.position.x=a.start.x+Math.sin(k*4)*.08;
      if(k>=1&&a.elapsed>2.4){
        const stain=new THREE.Mesh(new THREE.CircleGeometry(.42,24),new THREE.MeshBasicMaterial({color:0x21090a,transparent:true,opacity:.55}));stain.rotation.x=-Math.PI/2;stain.position.set(n.object.position.x,.012,n.object.position.z);zone.group.add(stain);
        n.object.visible=false;n.fate='dead';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;
         const fallen=(n.name||'').toLowerCase();
         if(fallen==='ines'||(fallen==='ottavio'&&!collected.has('fork'))){
           triggerDeath(fallen==='ines'?'INES HAS BEEN KILLED':'OTTAVIO HAS BEEN KILLED',fallen==='ines'?'The Seating List can no longer be read. The house closes around the missing name. This is the end of the recording.':'The tuning fork can no longer be recovered. The sequence is broken, and the recording ends here.');
           return;
         }
      }
    }else{
      const k=THREE.MathUtils.clamp(a.elapsed/2.9,0,1);n.object.position.lerpVectors(a.start,a.target,k);n.walking=true;
      if(!n.object.userData.fadeMaterialsCloned){n.object.traverse(o=>{if(o.isMesh&&o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});n.object.userData.fadeMaterialsCloned=true;}
      n.object.traverse(o=>{if(o.isMesh&&o.material){const list=Array.isArray(o.material)?o.material:[o.material];list.forEach(m=>{if('opacity'in m){m.transparent=true;m.opacity=1-k*.98;}});}});
      if(k>=1){n.object.visible=false;n.walking=false;n.fate='gone';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;}
    }
  }
  cultFateCooldown=Math.max(0,cultFateCooldown-dt);
  if(!cultFateActive&&cultFateQueue.length&&cultFateCooldown<=0){
    const index=0;
    if(index<cultFateQueue.length){const [next]=cultFateQueue.splice(index,1);startCultFate(next);cultFateCooldown=listeningPending ? 0.48 : 3.8;}
  }
}
function scheduleCultSceneFates(count,source,mode='collapse') {
  const candidates=cultRoster.filter(n=>n.fate==='present'&&!isProgressCriticalCultist(n));
  for(let i=0;i<count&&i<candidates.length;i++) queueCultFate(source,candidates[i],(i%2===0)?mode:'vanish');
}
function addDoor(group,x,z,label,destination,spawn,locked=false,options={}){
  const root=new THREE.Group();root.position.set(x,0,z);root.rotation.y=options.rotationY??0;group.add(root);
  const roman=options.style==='roman',frame=roman?M.wall:M.darkWood,leafMat=locked?M.rust:M.wood;
  addBox(root,0,1.28,-.12,1.48,2.5,.11,M.black,{castShadow:false});
  addBox(root,-.72,1.28,.02,.20,2.56,.40,frame);addBox(root,.72,1.28,.02,.20,2.56,.40,frame);
  addBox(root,0,2.53,.02,1.72,.22,.42,frame);addBox(root,0,.12,.17,1.78,.22,.72,M.wall);
  const pivot=new THREE.Group();pivot.position.set(-.57,0,.12);root.add(pivot);
  const leaf=new THREE.Group();leaf.position.x=.57;pivot.add(leaf);
  const slab=addBox(leaf,0,1.15,.12,1.10,2.16,.095,leafMat);
  for(let i=0;i<6;i++)addBox(leaf,-.46+i*.184,1.15,.177,.168,2.10,.018,i%3===0?M.darkWood:leafMat,{castShadow:false});
  for(const yy of [.43,1.83]){
    addBox(leaf,0,yy,.205,1.06,.11,.045,M.darkWood);
    for(const side of [-1,1]){const rivet=new THREE.Mesh(new THREE.SphereGeometry(.032,8,6),M.rust);rivet.position.set(side*.46,yy,.235);leaf.add(rivet);}
  }
  addBox(leaf,-.02,1.14,.208,.075,1.35,.05,M.darkWood,{rotation:[0,0,-.20]});
  for(const yy of [.52,1.86])addBox(root,-.68,yy,.245,.22,.09,.07,M.rust);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.024,.024,.14,8),M.rust);stem.rotation.x=Math.PI/2;stem.position.set(.42,1.08,.25);leaf.add(stem);
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.052,10,8),M.gold);knob.position.set(.42,1.08,.31);leaf.add(knob);
  if(roman){
    const stone=mat(0x89877d,.98,{map:TEX.concrete,bumpScale:.14});
    for(const s of [-1,1]){
      const col=new THREE.Mesh(new THREE.CylinderGeometry(.115,.17,2.75,12),stone);col.position.set(s*.99,1.42,.18);root.add(col);
      addBox(root,s*.99,.12,.18,.42,.22,.48,stone);addBox(root,s*.99,2.8,.18,.46,.24,.50,stone);
      addBox(root,s*.99,2.96,.18,.60,.11,.58,stone);
      const collar=new THREE.Mesh(new THREE.TorusGeometry(.14,.026,6,18),stone);collar.position.set(s*.99,2.65,.18);root.add(collar);
    }
    for(const r of [.82,1.02,1.21]){const arch=new THREE.Mesh(new THREE.TorusGeometry(r,.065,8,36,Math.PI),stone);arch.position.set(0,2.52,.22);root.add(arch);}
    const tymp=new THREE.Mesh(new THREE.CircleGeometry(.73,32,0,Math.PI),stone);tymp.position.set(0,2.52,.15);root.add(tymp);
    for(const s of [-1,1]){const curl=new THREE.Mesh(new THREE.TorusGeometry(.19,.035,6,18,Math.PI*1.45),M.rust);curl.position.set(s*.38,2.64,.20);curl.rotation.z=s*.42;root.add(curl);}
    const rose=new THREE.Mesh(new THREE.TorusGeometry(.12,.035,7,18),M.rust);rose.position.set(0,2.78,.23);root.add(rose);
  }else{
    addBox(root,-.88,1.26,.10,.08,2.52,.28,M.wood);addBox(root,.88,1.26,.10,.08,2.52,.28,M.wood);
    addBox(root,0,2.68,.12,2.05,.18,.66,M.darkWood,{rotation:[-.035,0,0]});
  }
  const entry={id:`door_${destination}`,type:'door',object:root,point:root.position,radius:options.radius??3.3,
    prompt:locked?'[ E ] THRESHOLD LOCKED':`[ E ] ENTER — ${label.toUpperCase()}`, 
    label,destination,spawn,locked,slab,doorPivot:pivot,openAngle:options.openAngle??-1.08};
  group.userData.interactables.push(entry);return entry;
}

function addHouseExterior(group,x,z,w,d,h,seed=1,color=0x85877f,frontDoor=true){
  const g=new THREE.Group();g.position.set(x,0,z);group.add(g);
  const wall=mat(color,1,{map:TEX.plaster,bumpScale:.11}),wood=mat(seed%2?0x514538:0x625342,1,{map:TEX.wood,bumpScale:.13}),roof=mat(seed===5?0x202321:0x292b28,1,{map:TEX.concrete,bumpScale:.1});
  const fz=d/2,dw=frontDoor?1.92:0;
  addBox(g,0,.23,-d/2,w+.3,.46,.60,M.darkWall);addBox(g,-w/2,.23,0,.60,.46,d+.25,M.darkWall);addBox(g,w/2,.23,0,.60,.46,d+.25,M.darkWall);addBox(g,0,.23,d/2,w+.3,.46,.60,M.darkWall);
  addBox(g,0,h/2,-d/2,w,h,.42,wall);addBox(g,-w/2,h/2,0,.42,h,d,wall);addBox(g,w/2,h/2,0,.42,h,d,wall);
  if(frontDoor){
    addWindowedWall(g,'x',fz,-w/2,-dw/2,h,.42,wall,[{at:-w*.30,w:Math.min(1.45,w*.24),h:1.18,y:1.52}]);
    addWindowedWall(g,'x',fz,dw/2,w/2,h,.42,wall,[{at:w*.30,w:Math.min(1.45,w*.24),h:1.18,y:1.52}]);
    addBox(g,0,2.52+(h-2.52)/2,fz,dw,h-2.52,.42,wall);
  }else addBox(g,0,h/2,fz,w,h,.42,wall);
  for(let row=0;row<Math.floor(h/.34);row++){
    const y=.5+row*.34;
    if(y<1.34||y>2.82)addBox(g,0,y,fz+.225,w-.12,.038,.05,wood,{castShadow:false});
    else if(frontDoor){addBox(g,-w*.30,y,fz+.225,w*.38,.038,.05,wood,{castShadow:false});addBox(g,w*.30,y,fz+.225,w*.38,.038,.05,wood,{castShadow:false});}
  }
  for(const s of [-1,1])for(let row=0;row<Math.floor(h/.4);row++)addBox(g,s*(w/2+.225),.54+row*.4,0,.05,.045,d-.26,wood,{castShadow:false});
  for(const wx of [-w*.30,w*.30]){
    const wy=2.1,ww=Math.min(1.45,w*.24),wh=1.18;
    addBox(g,wx,wy,fz+.22,.035,wh-.12,ww-.12,M.glass,{castShadow:false});
    addBox(g,wx-ww/2-.065,wy,fz+.30,.12,wh+.22,.12,wood);addBox(g,wx+ww/2+.065,wy,fz+.30,.12,wh+.22,.12,wood);
    addBox(g,wx,wy-wh/2-.065,fz+.30,ww+.25,.12,.12,wood);addBox(g,wx,wy+wh/2+.065,fz+.30,ww+.25,.12,.12,wood);
    addBox(g,wx,wy,fz+.36,.045,wh-.04,.045,M.darkWood);addBox(g,wx,wy,fz+.36,.045,.045,ww-.05,M.darkWood);
    if(seed%2===0)addBox(g,wx-ww*.52,wy,fz+.4,.10,wh+.03,.07,M.darkWood,{rotation:[0,0,.08],castShadow:false});
  }
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(0,1.42);shape.lineTo(w/2,0);shape.closePath();
  const gable=new THREE.Mesh(new THREE.ShapeGeometry(shape),wall);gable.position.set(0,h,fz+.22);g.add(gable);
  addBox(g,-w*.245,h+.62,0,w*.60,.24,d+.9,roof,{rotation:[0,0,.42]});addBox(g,w*.245,h+.62,0,w*.60,.24,d+.9,roof,{rotation:[0,0,-.42]});
  const ridge=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,d+.95,8),M.darkWood);ridge.rotation.x=Math.PI/2;ridge.position.set(0,h+1.37,0);g.add(ridge);
  for(const s of [-1,1])for(let i=0;i<7;i++){const batten=addBox(g,s*(.58+i*.60),h+.76,0,.045,.045,d+.62,M.darkWood,{castShadow:false});batten.rotation.z=s===-1?.42:-.42;if(seed===4&&i===5)batten.position.y-=.18;}
  if(seed===2){
    const dz=fz+.58;addBox(g,-.55,h+.88,dz,1.65,1.38,.28,wall);
    const ds=new THREE.Shape();ds.moveTo(-.84,0);ds.lineTo(0,.86);ds.lineTo(.84,0);ds.closePath();
    const df=new THREE.Mesh(new THREE.ShapeGeometry(ds),wall);df.position.set(-.55,h+1.55,dz+.16);g.add(df);
    addBox(g,-.55,h+1.25,dz+.26,.76,.90,.05,M.black,{castShadow:false});addBox(g,-.55,h+1.25,dz+.32,.88,1.03,.08,wood);
    addBox(g,-.55,h+1.25,dz+.37,.04,.90,.04,M.darkWood);addBox(g,-.55,h+1.25,dz+.37,.74,.04,.04,M.darkWood);
    for(const s of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.07,.095,2.55,8),wood);post.position.set(s*1.22,1.28,fz+.73);g.add(post);}
    addBox(g,0,2.60,fz+.74,2.88,.18,.24,M.darkWood);addBox(g,0,2.75,fz+.84,3.3,.14,1.22,roof,{rotation:[-.05,0,0]});
    addBox(g,0,.20,fz+.68,2.78,.34,1.2,M.wall);addBox(g,0,.47,fz+.96,2.45,.18,.66,M.darkWall);
  }else if(seed===4){
    addBox(g,-w*.20,1.42,fz+.30,.10,2.65,.12,M.rust,{rotation:[0,0,-.1]});addBox(g,w*.23,2.18,fz+.30,.09,1.42,.12,wood,{rotation:[0,0,.08]});
    addBox(g,-w/2-.28,2.05,-d*.08,.54,3.35,d*.46,wall,{rotation:[0,0,.075]});addBox(g,-w/2-.58,.13,-d*.08,1.02,.26,d*.48,M.darkWall,{rotation:[0,0,.075]});
  }else if(seed===3){
    addBox(g,w/2+.30,1.65,-d*.18,.72,3,d*.58,wall);addBox(g,w/2+.30,3.15,-d*.18,.95,.18,d*.60,roof);
  }else if(seed===5){
    for(let i=0;i<5;i++)addBox(g,-1.12+i*.56,1.95,fz+.30,.075,2.2,.09,M.darkWood,{rotation:[0,0,(i%2?1:-1)*.02]});
    addBox(g,0,3.05,fz+.36,3.1,.12,.12,M.rust);for(const s of [-1,1])addBox(g,s*1.2,1.42,fz+.35,.09,2.25,.10,M.rust);
  }
  const chimney=addBox(g,seed===4?-w*.31:w*.29,h+1.36,-d*.22,.66,2.3,.68,M.brick);chimney.rotation.y=.09;
  for(let i=0;i<4;i++){const slate=addBox(g,(i-1.5)*.58,h+.30,-d*.05+i*.16,.48,.05,.18,M.darkWall,{rotation:[0,0,(i%2?1:-1)*.08]});if(seed===4&&i===2)slate.position.y-=.18;}
  if(seed!==5){addBox(g,w/2+.23,h+.12,.15,.08,.08,d*.78,M.rust);addBox(g,w/2+.31,.45,d*.35,.055,.8,.055,M.rust,{rotation:[0,0,-.08]});}
  return g;
}
function addRomanesqueChurchExterior(group,x,z,w=12,d=15,h=6.8){
  const g=new THREE.Group();g.position.set(x,0,z);group.add(g);
  const stone=mat(0x85847b,.99,{map:TEX.concrete,bumpScale:.18}),pale=mat(0x99968a,.98,{map:TEX.concrete,bumpScale:.12}),roof=mat(0x292b28,1,{map:TEX.concrete}),front=d/2;
  addBox(g,0,h/2,-d/2,w,h,.6,stone);addBox(g,-w/2,h/2,0,.6,h,d,stone);addBox(g,w/2,h/2,0,.6,h,d,stone);
  addWindowedWall(g,'x',front,-w/2,-1.15,h,.6,stone,[{at:-3.7,w:.56,h:1.34,y:3.45}]);
  addWindowedWall(g,'x',front,1.15,w/2,h,.6,stone,[{at:3.7,w:.56,h:1.34,y:3.45}]);addBox(g,0,2.95+(h-2.95)/2,front,2.30,h-2.95,.6,stone);
  addBox(g,-2.65,h+.48,-.1,6.7,.30,d+.5,roof,{rotation:[0,0,.41]});addBox(g,2.65,h+.48,-.1,6.7,.30,d+.5,roof,{rotation:[0,0,-.41]});
  addBox(g,-4.65,4.15,-.1,2.25,.20,d+.35,roof,{rotation:[0,0,.08]});addBox(g,4.65,4.15,-.1,2.25,.20,d+.35,roof,{rotation:[0,0,-.08]});
  const ridge=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,d+.6,8),M.darkWall);ridge.rotation.x=Math.PI/2;ridge.position.set(0,h+1.12,-.1);g.add(ridge);
  const gs=new THREE.Shape();gs.moveTo(-w/2,0);gs.lineTo(0,1.6);gs.lineTo(w/2,0);gs.closePath();const gf=new THREE.Mesh(new THREE.ShapeGeometry(gs),stone);gf.position.set(0,h,front+.3);g.add(gf);
  for(let i=-1;i<=1;i++){
    const apse=new THREE.Mesh(new THREE.CylinderGeometry(1.95,2.18,5.4,20,1,true,0,Math.PI),stone);apse.position.set(i*3.05,2.72,-d/2-.72);g.add(apse);
    const dome=new THREE.Mesh(new THREE.SphereGeometry(2.02,20,10,0,Math.PI*2,0,Math.PI/2),pale);dome.position.set(i*3.05,5.4,-d/2-.72);dome.scale.y=.58;g.add(dome);
    addBox(g,i*3.05,3.1,-d/2-2.82,.12,1.2,.1,M.black,{castShadow:false});
    for(let j=-1;j<=1;j++){const a=(j+1)*Math.PI/3,px=i*3.05+Math.sin(a)*1.92,pz=-d/2-.72-Math.cos(a)*1.92;addBox(g,px,3.1,pz,.11,2,.13,pale);if(j<1){const arc=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,6,16,Math.PI),pale);arc.position.set(px,5.62,pz);arc.rotation.y=a;g.add(arc);}}
  }
  for(const side of [-1,1])for(let i=0;i<10;i++){const xx=side*(w/2-.28),zz=-d/2+1+i*1.42;const arc=new THREE.Mesh(new THREE.TorusGeometry(.34,.055,7,18,Math.PI),pale);arc.position.set(xx,6.25,zz);arc.rotation.y=side*Math.PI/2;g.add(arc);addBox(g,xx,5.88,zz,.12,.62,.12,pale);addBox(g,xx,6.62,zz,.18,.10,.18,pale);}
  addBox(g,-4.25,4.55,5,2.55,9.1,2.65,stone);addBox(g,-4.25,9.3,5,2.9,.4,3,pale);
  for(const s of [-1,1]){addBox(g,-4.25+s*.88,10.18,3.66,.78,1.42,.18,M.black,{castShadow:false});addBox(g,-4.25+s*.88,10.18,6.34,.78,1.42,.18,M.black,{castShadow:false});}
  const cap=new THREE.Mesh(new THREE.ConeGeometry(2,1.7,4),roof);cap.rotation.y=Math.PI/4;cap.position.set(-4.25,11.35,5);g.add(cap);
  addBox(g,-4.25,12.35,5,.07,.72,.07,M.rust);addBox(g,-4.25,12.46,5,.46,.065,.07,M.rust);
  for(let row=0;row<9;row++)for(let col=0;col<8;col++)addBox(g,-w/2+.78+col*1.48+(row%2)*.38,.45+row*.66,front+.315,1.3,.045,.045,row%3===0?pale:stone,{castShadow:false});
}

const TREE_MATERIALS = [mat(0x28352b, 1), mat(0x34402f, 1), mat(0x444434, 1)];
function branchBetween(parent, a, b, radius, material) {
  const A=new THREE.Vector3(...a), B=new THREE.Vector3(...b), d=new THREE.Vector3().subVectors(B,A);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.46,radius,d.length(),7),material);
  mesh.position.copy(A).add(B).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  mesh.castShadow=true; parent.add(mesh); return mesh;
}
function addTree(group, x, z, h = 8, seed = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .38, h * .67, 9), M.darkWood);
  trunk.position.y = h * .335; trunk.castShadow = true; root.add(trunk);
  const crown=new THREE.Group(); crown.position.y=h*.43; root.add(crown);
  const sway=[];
  for(let i=0;i<5;i++){
    const a=i*2.399+seed*.17, len=h*(.18+(i%3)*.035);
    const base=[Math.cos(a)*.08,0,Math.sin(a)*.08];
    const tip=[Math.cos(a)*len*.65,h*(.18+(i%2)*.06),Math.sin(a)*len*.65];
    const limb=branchBetween(crown,base,tip,.09+(i%3)*.018,M.darkWood); sway.push(limb);
    const leafGroup=new THREE.Group();leafGroup.position.set(...tip);crown.add(leafGroup);
    for(let j=0;j<3;j++){
      const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.55+(j%2)*.16,0),TREE_MATERIALS[(i+j)%TREE_MATERIALS.length]);
      leaf.position.set((Math.random()-.5)*1.25,(Math.random()-.5)*.75,(Math.random()-.5)*1.25);
      leaf.scale.set(.9,1.25,.8);leaf.castShadow=false;leafGroup.add(leaf);
    }
    sway.push(leafGroup);
  }
  root.userData.windPhase=seed*.73;root.userData.swayParts=sway;windTrees.push(root);
  return root;
}
function addCropRows(group, cx, cz, rows, length, spacing, kind='maize', seed=1) {
  let state=(seed*2654435761)>>>0; const rand=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  for(let r=0;r<rows;r++){
    for(let i=0;i<length;i++){
      const x=cx+(r-(rows-1)/2)*spacing+(rand()-.5)*.18;
      const z=cz+(i-(length-1)/2)*.72+(rand()-.5)*.22;
      const plant=new THREE.Group();plant.position.set(x,0,z);group.add(plant);
      const h=kind==='maize'?1.85+rand()*.8:.62+rand()*.26;
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(.025,.045,h,5),mat(kind==='maize'?0x555c35:0x55583a,1));stem.position.y=h/2;plant.add(stem);
      const leaves=[];
      const n=kind==='maize'?6:4;
      for(let j=0;j<n;j++){
        const leaf=new THREE.Mesh(new THREE.ConeGeometry(kind==='maize'?.10:.045,kind==='maize'?.92:.48,5),mat(kind==='maize'?(j%2?0x616b3b:0x465333):(j%2?0x77744b:0x5e6540),1));
        const side=j%2?1:-1;leaf.position.set(side*(.16+(j%3)*.045),h*(.32+(j%3)*.13),0);leaf.rotation.z=side*(.66+(j%2)*.15);leaf.rotation.x=(rand()-.5)*.35;plant.add(leaf);leaves.push(leaf);
      }
      if(kind==='maize'&&rand()>.30){const cob=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.36,7),mat(0x9d874b,1));cob.position.set(.08,h*.55,.03);cob.rotation.z=.48;plant.add(cob);}
      plant.userData.windPhase=rand()*6.28;plant.userData.leaves=leaves;plant.userData.windBase=kind==='maize'?.08:.14;
      cropPlants.push(plant);
    }
  }
}

function roundedHousing(w,h,d,r,material,bevel=.025){
  const sh=new THREE.Shape(),x=-w/2,y=-h/2;
  sh.moveTo(x+r,y);sh.lineTo(x+w-r,y);sh.quadraticCurveTo(x+w,y,x+w,y+r);
  sh.lineTo(x+w,y+h-r);sh.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  sh.lineTo(x+r,y+h);sh.quadraticCurveTo(x,y+h,x,y+h-r);
  sh.lineTo(x,y+r);sh.quadraticCurveTo(x,y,x+r,y);
  const geo=new THREE.ExtrudeGeometry(sh,{depth:d,steps:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:8});
  geo.translate(0,0,-d/2);geo.computeVertexNormals();return new THREE.Mesh(geo,material);
}
function tubeBetween(group,a,b,radius,material,segments=8){
  const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),delta=B.clone().sub(A),length=delta.length();
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.86,radius,length,segments),material);
  mesh.position.copy(A).add(B).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());group.add(mesh);return mesh;
}
function buildGasHeater(group,x,y,z,scale=1){
  const root=new THREE.Group();root.position.set(x,y,z);root.scale.setScalar(scale);group.add(root);
  const enamel=mat(0x3b3932,.68,{metalness:.36,map:TEX.metal,bumpScale:.035}),silver=mat(0x85847a,.46,{metalness:.72}),black=mat(0x141614,.8),ceramic=mat(0x5b3828,.82,{emissive:0x481b0c,emissiveIntensity:.3});
  const shell=roundedHousing(1.18,1.42,.48,.14,enamel,.045);shell.position.y=.92;root.add(shell);
  const hood=roundedHousing(1.12,.42,.51,.12,silver,.035);hood.position.set(0,1.70,0);root.add(hood);
  const base=roundedHousing(1.06,.16,.5,.08,mat(0x282722,.72,{metalness:.55}),.025);base.position.y=.14;root.add(base);
  const topVent=new THREE.Group();topVent.position.set(0,1.48,.255);root.add(topVent);
  for(let i=0;i<8;i++){const slat=roundedHousing(.92,.025,.025,.012,black,.006);slat.position.set(0,i*.034,0);topVent.add(slat);}
  for(let p=0;p<3;p++){
    const panel=new THREE.Mesh(new THREE.CylinderGeometry(.14,.18,.69,10),ceramic);panel.rotation.z=Math.PI/2;panel.scale.set(1,.55,1);panel.position.set((p-1)*.29,.77,.02);root.add(panel);
    const face=new THREE.Mesh(new THREE.PlaneGeometry(.22,.58),new THREE.MeshBasicMaterial({color:p===1?0x713d23:0x44261b,transparent:true,opacity:.18,side:THREE.DoubleSide}));face.position.set((p-1)*.29,.77,.246);root.add(face);
  }
  const guard=new THREE.Group();guard.position.set(0,.72,.29);root.add(guard);
  for(let i=0;i<7;i++){const rail=new THREE.Mesh(new THREE.TorusGeometry(.63,.018,5,28,Math.PI),silver);rail.rotation.z=Math.PI/2;rail.rotation.y=Math.PI/2;rail.scale.set(.55,.6,1);rail.position.y=(i-3)*.105;guard.add(rail);}
  for(const side of [-1,1])tubeBetween(root,[side*.49,.39,.29],[side*.49,1.11,.29],.018,silver,7);
  const dial=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.055,18),silver);dial.rotation.x=Math.PI/2;dial.position.set(.39,.29,.28);root.add(dial);
  const dialMark=new THREE.Mesh(new THREE.BoxGeometry(.012,.055,.012),M.black);dialMark.position.set(.39,.29,.316);dialMark.rotation.z=-.42;root.add(dialMark);
  const pilot=new THREE.Mesh(new THREE.SphereGeometry(.025,8,6),glow(0xe66a26,.35));pilot.position.set(-.39,.32,.29);root.add(pilot);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.38,.09),new THREE.MeshBasicMaterial({map:makeLabelTexture('RADIANT / LPG',512,128),transparent:true,side:THREE.DoubleSide}));label.position.set(0,1.19,.252);root.add(label);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.19,8),silver);leg.position.set(sx*.43,.06,sz*.17);root.add(leg);
    const wheel=new THREE.Mesh(new THREE.TorusGeometry(.055,.018,6,14),black);wheel.rotation.y=Math.PI/2;wheel.position.set(sx*.43,.045,sz*.17);root.add(wheel);
  }
  const hoseCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.48,.28,-.15),new THREE.Vector3(.69,.2,-.28),new THREE.Vector3(.72,.08,-.55),new THREE.Vector3(.88,.06,-.68)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve,18,.025,7,false),mat(0x27251f,.9,{metalness:.15})));
  const coupling=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.12,10),silver);coupling.rotation.x=Math.PI/2;coupling.position.set(.88,.06,-.67);root.add(coupling);
  root.userData.pilot=pilot;return root;
}
function buildEarplugCase(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const brass=mat(0x8a7048,.42,{metalness:.72}),inside=mat(0x2b2924,.8),wax=mat(0xb77770,.92);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.19,24),brass);body.position.y=.105;root.add(body);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.105,.012,6,24),mat(0xc5a36e,.35,{metalness:.82}));rim.position.y=.20;root.add(rim);
  const lid=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.045,24),brass);lid.position.set(.22,.22,0);lid.rotation.z=-.18;root.add(lid);
  const lip=new THREE.Mesh(new THREE.TorusGeometry(.10,.009,5,24),inside);lip.position.set(.22,.244,0);root.add(lip);
  const chainCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.09,.22,0),new THREE.Vector3(.16,.3,.03),new THREE.Vector3(.24,.25,.02),new THREE.Vector3(.22,.18,0)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(chainCurve,18,.008,5,false),brass));
  for(let i=0;i<2;i++){const plug=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.095,4,8),wax);plug.scale.set(.8,1,.8);plug.position.set((i?-.05:.05),.31+i*.018,.02);plug.rotation.z=(i?-.22:.22);root.add(plug);}
  return root;
}
function buildReelRecorder(group,x,y,z,scale=1){
  const root=new THREE.Group();root.position.set(x,y,z);root.scale.setScalar(scale);group.add(root);
  const cabinet=mat(0x38352e,.62,{map:TEX.wood,bumpScale:.03}),panel=mat(0x6e716d,.38,{metalness:.58}),black=mat(0x171916,.66),steel=mat(0xaaa79b,.32,{metalness:.78}),red=glow(0xc13a28,.75);
  const body=roundedHousing(2.52,.92,.82,.12,cabinet,.04);body.position.y=.53;root.add(body);
  const face=roundedHousing(2.34,.57,.045,.065,panel,.025);face.position.set(0,.65,.432);root.add(face);
  const top=roundedHousing(2.30,.12,.72,.055,cabinet,.025);top.position.set(0,1.03,0);root.add(top);
  const meters=[];
  for(const side of [-1,1]){
    const housing=new THREE.Mesh(new THREE.BoxGeometry(.55,.27,.055),black);housing.position.set(side*.79,.78,.475);root.add(housing);
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.46,.19),new THREE.MeshBasicMaterial({map:makeLabelTexture('VU  -20  -10  0  +3',512,128),color:0xb7b59f,side:THREE.DoubleSide}));screen.position.set(side*.79,.79,.507);root.add(screen);
    const pivot=new THREE.Group();pivot.position.set(side*.79,.72,.519);root.add(pivot);
    const needle=new THREE.Mesh(new THREE.BoxGeometry(.008,.115,.008),mat(0xc65b43,.45,{metalness:.3}));needle.position.y=.05;needle.rotation.z=.08;pivot.add(needle);meters.push(pivot);
  }
  const reels=[];
  for(const side of [-1,1]){
    const spool=new THREE.Group();spool.position.set(side*.69,1.48,.43);root.add(spool);
    const flange=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.075,48),steel);flange.rotation.x=Math.PI/2;spool.add(flange);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.365,.026,7,40),mat(0x464640,.4,{metalness:.75}));spool.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.10,.10,.12,24),black);hub.rotation.x=Math.PI/2;spool.add(hub);
    for(let i=0;i<6;i++){
      const spoke=new THREE.Mesh(new THREE.BoxGeometry(.045,.55,.025),panel);spoke.position.z=.045;spoke.rotation.z=i*Math.PI/3;spool.add(spoke);
      const a=i*Math.PI/3,aperture=new THREE.Mesh(new THREE.CircleGeometry(.035,10),black);aperture.position.set(Math.cos(a)*.245,Math.sin(a)*.245,.065);spool.add(aperture);
    }
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.13,16),steel);cap.rotation.x=Math.PI/2;cap.position.z=.09;spool.add(cap);
    reels.push(spool);rotatingMachines.push({mesh:spool,speed:side<0?.34:-.29});
  }
  for(const px of [-.30,.30]){const guide=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.28,10),steel);guide.position.set(px,1.13,.42);guide.rotation.z=.18;root.add(guide);}
  const headBlock=roundedHousing(.40,.16,.13,.035,black,.012);headBlock.position.set(0,1.17,.42);root.add(headBlock);
  [['STOP',-.82,0x5d5b54],['PLAY',-.42,0x4d5949],['REC',0,0x8b3026],['REW',.42,0x6b6757],['FWD',.82,0x6b6757]].forEach(([label,bx,col])=>{
    const btn=new THREE.Mesh(new THREE.CylinderGeometry(.07,.075,.07,14),mat(col,.4,{metalness:.42}));btn.position.set(bx,.22,.45);root.add(btn);
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.045,.05,.018,14),steel);cap.position.set(bx,.265,.45);root.add(cap);
  });
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(.026,8,6),red);lamp.position.set(-.99,.49,.48);root.add(lamp);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.72,.09),new THREE.MeshBasicMaterial({map:makeLabelTexture('STEREO / 19 CM-SEC',512,128),side:THREE.DoubleSide,transparent:true}));label.position.set(0,.48,.478);root.add(label);
  const path=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-.29,1.48,.44),new THREE.Vector3(-.16,1.26,.45),new THREE.Vector3(0,1.25,.45),new THREE.Vector3(.16,1.26,.45),new THREE.Vector3(.29,1.48,.44)]),20,.012,5,false),steel);root.add(path);
  root.userData.reels=reels;root.userData.meters=meters;root.userData.recordLamp=lamp;return root;
}
function buildPaperback(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);root.rotation.set(-.06,.15,-.035);group.add(root);
  const pages=roundedHousing(.36,.48,.055,.025,mat(0xbeb39a,.98),.012);pages.position.z=-.008;root.add(pages);
  const cover=roundedHousing(.38,.50,.018,.028,mat(0x45372c,.92,{map:TEX.wood}),.012);cover.position.z=.04;root.add(cover);
  const spine=roundedHousing(.055,.49,.07,.025,mat(0x29231e,.96),.012);spine.position.x=-.17;root.add(spine);
  for(let i=0;i<15;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(.28,.002,.001),mat(i%4===0?0x91866f:0x776f60,.99));line.position.set(.015,.19-i*.025,.078);root.add(line);}
  const title=new THREE.Mesh(new THREE.PlaneGeometry(.31,.17),new THREE.MeshBasicMaterial({map:makeLabelTexture('NIETZSCHE / ASCETIC IDEAL',512,256),transparent:true,side:THREE.DoubleSide}));title.position.set(.015,.055,.081);root.add(title);
  const corner=new THREE.Mesh(new THREE.TorusGeometry(.032,.006,4,12),M.gold);corner.position.set(.13,-.20,.085);root.add(corner);return root;
}
function buildThermos(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const enamel=mat(0x6c3328,.38,{metalness:.48}),steel=mat(0x9b988a,.32,{metalness:.82}),dark=mat(0x2a2823,.8);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.12,.14,.60,24),enamel);body.position.y=.34;root.add(body);
  const shoulder=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.12,24),enamel);shoulder.position.y=.70;root.add(shoulder);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,.08,20),steel);neck.position.y=.80;root.add(neck);
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.105,.09,.14,20,1,true),steel);cup.position.y=.91;root.add(cup);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.098,.009,6,22),steel);rim.position.y=.98;root.add(rim);
  const band=new THREE.Mesh(new THREE.TorusGeometry(.126,.012,6,24),dark);band.position.y=.21;root.add(band);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.10,.018,7,18,Math.PI),steel);handle.position.set(.15,.56,0);handle.rotation.z=Math.PI/2;root.add(handle);
  const maker=new THREE.Mesh(new THREE.PlaneGeometry(.12,.10),new THREE.MeshBasicMaterial({map:makeLabelTexture('I / 13',256,128),transparent:true,side:THREE.DoubleSide}));maker.position.set(0,.39,.142);root.add(maker);return root;
}
function buildCombineHarvester(group,x,z,scale=1){
  const root=new THREE.Group();root.position.set(x,0,z);root.scale.setScalar(scale);group.add(root);
  const bodyMat=mat(0x594332,.76,{map:TEX.rust,bumpScale:.07}),trim=mat(0x302e27,.72,{metalness:.34}),glass=new THREE.MeshStandardMaterial({color:0x202b2b,roughness:.18,metalness:.08,transparent:true,opacity:.48,side:THREE.DoubleSide}),steel=mat(0x8d897d,.42,{metalness:.7});
  const chassis=roundedHousing(2.05,.78,3.15,.22,bodyMat,.06);chassis.position.y=.9;root.add(chassis);
  const engineHood=roundedHousing(1.7,.56,1.05,.20,bodyMat,.05);engineHood.position.set(0,1.42,-.91);root.add(engineHood);
  const cab=roundedHousing(1.45,1.03,1.23,.16,glass,.04);cab.position.set(0,1.78,.34);root.add(cab);
  const roof=roundedHousing(1.62,.13,1.43,.08,bodyMat,.03);roof.position.set(0,2.34,.34);root.add(roof);
  const exhaust=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.72,10),trim);exhaust.position.set(.62,2.12,-.82);root.add(exhaust);
  const exhaustCap=new THREE.Mesh(new THREE.TorusGeometry(.05,.012,5,16),steel);exhaustCap.position.set(.62,2.48,-.82);exhaustCap.rotation.x=Math.PI/2;root.add(exhaustCap);
  for(const side of [-1,1]){
    const mirrorArm=new THREE.CylinderGeometry(.014,.018,.42,6);const arm=new THREE.Mesh(mirrorArm,steel);arm.position.set(side*.91,1.82,.55);arm.rotation.z=side*.24;root.add(arm);
    const mirror=new THREE.Mesh(new THREE.BoxGeometry(.16,.22,.045),trim);mirror.position.set(side*1.02,1.99,.58);root.add(mirror);
    for(const zz of [-1.12,1.05]){
      const wheel=new THREE.Group();wheel.position.set(side*.99,.53,zz);root.add(wheel);
      const tyre=new THREE.Mesh(new THREE.CylinderGeometry( .37,.37,.24,20),M.black);tyre.rotation.z=Math.PI/2;wheel.add(tyre);
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.26,.035,7,24),steel);rim.rotation.y=Math.PI/2;wheel.add(rim);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.26,16),trim);hub.rotation.z=Math.PI/2;wheel.add(hub);
      for(let i=0;i<8;i++){const lug=new THREE.Mesh(new THREE.SphereGeometry(.018,6,5),steel);const a=i*Math.PI/4;lug.position.set(0,Math.cos(a)*.18,Math.sin(a)*.18);wheel.add(lug);}
      (root.userData.wheels||(root.userData.wheels=[])).push(wheel);
    }
  }
  // Header cutter, rotating reel and crop dividers.
  const header=new THREE.Group();header.position.set(0,.52,2.02);root.add(header);root.userData.headerReel=header;
  const beam=roundedHousing(2.75,.22,.25,.07,trim,.02);beam.position.set(0,0,.05);header.add(beam);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,2.55,18),steel);shaft.rotation.z=Math.PI/2;shaft.position.set(0,.34,-.02);header.add(shaft);
  for(let side of [-1,1]){
    const dividerCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*1.18,0,.18),new THREE.Vector3(side*1.38,.34,.48),new THREE.Vector3(side*1.35,.72,.8)]);
    header.add(new THREE.Mesh(new THREE.TubeGeometry(dividerCurve,14,.028,6,false),steel));
  }
  const reel=new THREE.Group();reel.position.set(0,.36,-.02);header.add(reel);root.userData.reel=reel;
  for(let side of [-1,1]){
    const hoop=new THREE.Mesh(new THREE.TorusGeometry(.43,.022,6,32),steel);hoop.position.x=side*1.05;reel.add(hoop);
    for(let i=0;i<10;i++){const a=i*Math.PI/5,bar=tubeBetween(reel,[side*1.05,Math.cos(a)*.39,Math.sin(a)*.39],[side*1.05,Math.cos(a+Math.PI/5)*.39,Math.sin(a+Math.PI/5)*.39],.018,trim,6);bar.rotation.x=0;}
  }
  const cutter=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,2.85,8),steel);cutter.rotation.z=Math.PI/2;cutter.position.set(0,-.14,.19);header.add(cutter);
  for(let i=0;i<25;i++){const tooth=new THREE.Mesh(new THREE.ConeGeometry(.035,.18,5),steel);tooth.position.set(-1.3+i*.108,-.25,.2);tooth.rotation.x=Math.PI;header.add(tooth);}
  for(let side of [-1,1]){
    const light=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),glow(0xb56c31,.55));light.position.set(side*.72,1.1,-1.54);root.add(light);
  }
  root.userData.body=chassis;return root;
}
function buildTrowel(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const bladeShape=new THREE.Shape();bladeShape.moveTo(0,0);bladeShape.lineTo(.16,.30);bladeShape.quadraticCurveTo(.20,.39,.15,.46);bladeShape.lineTo(-.15,.46);bladeShape.quadraticCurveTo(-.20,.39,-.16,.30);bladeShape.closePath();
  const bladeGeo=new THREE.ExtrudeGeometry(bladeShape,{depth:.025,bevelEnabled:true,bevelThickness:.012,bevelSize:.01,bevelSegments:2,steps:1});bladeGeo.computeVertexNormals();
  const blade=new THREE.Mesh(bladeGeo,mat(0x73766f,.42,{metalness:.68}));blade.position.y=.13;root.add(blade);
  const tang=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.22,8),mat(0x85877f,.42,{metalness:.68}));tang.position.y=.56;root.add(tang);
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.055,.045,.34,10),mat(0x553b28,.94,{map:TEX.wood}));handle.position.y=.82;root.add(handle);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),M.darkWood);cap.position.y=1.0;root.add(cap);return root;
}
function buildCRT(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const caseMat=mat(0x292720,.72,{map:TEX.wood,bumpScale:.025}),bezelMat=mat(0x5a5142,.65,{metalness:.22});
  const housing=roundedHousing(1.72,1.27,.72,.17,caseMat,.06);housing.position.y=.68;root.add(housing);
  const bezel=roundedHousing(1.37,1.02,.08,.19,bezelMat,.035);bezel.position.set(-.02,.70,.37);root.add(bezel);
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.20,.84),new THREE.MeshBasicMaterial({map:makeLabelTexture('THE ROOM IS STILL HERE',512,320),color:0x9ba096,side:THREE.DoubleSide}));screen.position.set(-.02,.70,.423);root.add(screen);
  for(const side of [-1,1]){const dial=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.06,16),bezelMat);dial.rotation.x=Math.PI/2;dial.position.set(side*.64,.22,.38);root.add(dial);}
  for(const side of [-1,1]){const foot=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,.16,8),mat(0x191815,.9));foot.position.set(side*.55,.02,0);root.add(foot);}
  const aerial=new THREE.Group();aerial.position.set(.48,1.34,-.22);root.add(aerial);
  tubeBetween(aerial,[0,0,0],[.24,.52,0],.012,bezelMat,6);tubeBetween(aerial,[0,0,0],[-.2,.42,0],.012,bezelMat,6);
  return root;
}
function addWoodTable(group,x,z,w=2.6,d=1.25,h=.82,seed=1){
  const root=new THREE.Group();root.position.set(x,0,z);group.add(root);
  const top=roundedHousing(w,h*.09,d,.07,seed%2?M.wood:M.darkWood,.025);top.position.y=h;root.add(top);
  const grain=mat(0x6b523a,.98,{map:TEX.wood});
  const n=Math.max(3,Math.round(d/.28));
  for(let i=1;i<n;i++){const zz=-d/2+i*d/n;const path=new THREE.LineCurve3(new THREE.Vector3(-w*.43,h+.047,zz),new THREE.Vector3(w*.43,h+.047,zz));root.add(new THREE.Mesh(new THREE.TubeGeometry(path,1,.004,4,false),grain));}
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.07,.105,h-.06,10),M.darkWood);leg.position.set(sx*(w/2-.16),(h-.06)/2,sz*(d/2-.15));root.add(leg);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(.075,.012,5,12),M.rust);collar.position.set(sx*(w/2-.16),.14,sz*(d/2-.15));root.add(collar);
  }
  for(const side of [-1,1]){
    const apron=roundedHousing(w-.22,.14,.09,.04,M.darkWood,.018);apron.position.set(0,h-.13,side*(d/2-.105));root.add(apron);
    const sideApron=roundedHousing(.10,.14,d-.22,.04,M.darkWood,.018);sideApron.position.set(side*(w/2-.105),h-.13,0);root.add(sideApron);
  }
  root.userData.seed=seed;return root;
}
function addWoodChair(group,x,z,rot=0,scale=1){
  const root=new THREE.Group();root.position.set(x,0,z);root.rotation.y=rot;root.scale.setScalar(scale);group.add(root);
  const seat=roundedHousing(.62,.085,.58,.065,M.wood,.022);seat.position.y=.49;root.add(seat);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.037,.065,.48,9),M.darkWood);leg.position.set(sx*.245,.24,sz*.22);root.add(leg);
    const foot=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),M.darkWood);foot.scale.set(1,.48,1);foot.position.set(sx*.245,.025,sz*.22);root.add(foot);
  }
  for(const sx of [-1,1]){
    tubeBetween(root,[sx*.245,.54,-.235],[sx*.245,1.16,-.235],.04,M.darkWood,8);
    const peg=new THREE.Mesh(new THREE.SphereGeometry(.052,8,6),M.gold);peg.position.set(sx*.245,1.16,-.235);root.add(peg);
  }
  const backCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.29,.82,-.24),new THREE.Vector3(-.31,1.04,-.26),new THREE.Vector3(-.22,1.17,-.26),new THREE.Vector3(0,1.20,-.26),new THREE.Vector3(.22,1.17,-.26),new THREE.Vector3(.31,1.04,-.26),new THREE.Vector3(.29,.82,-.24)]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(backCurve,22,.045,8,false),M.darkWood));
  for(let i=-1;i<=1;i++){const slat=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.28,7),M.wood);slat.position.set(i*.13,.93,-.25);root.add(slat);}
  const brace=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.50,7),M.darkWood);brace.rotation.z=Math.PI/2;brace.position.set(0,.22,0);root.add(brace);
  return root;
}
function addBench(group,x,z,rot=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rot;group.add(g);
  const seat=roundedHousing(1.78,.10,.50,.07,M.wood,.025);seat.position.y=.49;g.add(seat);
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.05,.08,.48,9),M.darkWood);leg.position.set(side*.64,.24,0);g.add(leg);
    tubeBetween(g,[side*.72,.52,-.18],[side*.72,1.25,-.18],.045,M.darkWood,8);
  }
  const railCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.82,.86,-.18),new THREE.Vector3(-.88,1.17,-.18),new THREE.Vector3(-.72,1.27,-.18),new THREE.Vector3(.72,1.27,-.18),new THREE.Vector3(.88,1.17,-.18),new THREE.Vector3(.82,.86,-.18)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(railCurve,20,.055,8,false),M.darkWood));
  const brace=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,.78,8),M.darkWood);brace.rotation.z=Math.PI/2;brace.position.y=.22;g.add(brace);return g;
}

// -----------------------------------------------------------------------------
// World construction — six spaces, connected by thresholds.
// -----------------------------------------------------------------------------
function newZone(name, fogColor, density, bounds, spawn) {
  const group = new THREE.Group(); group.name = name; group.visible = false; scene.add(group);
  const ambient = new THREE.HemisphereLight(0x9ba4a0, 0x2d3028, .30); group.add(ambient);
  const moon = new THREE.DirectionalLight(0xc5c9c2, .38); moon.position.set(-18, 28, 14); group.add(moon); group.add(moon.target);
  // Outdoor spaces get a real shadow-casting sky light that follows the player (see updateShadowRig).
  const outdoor = ['road', 'forest'].includes(name);
  moon.castShadow = outdoor && !lowFx;
  if (moon.castShadow) {
    moon.shadow.mapSize.set(2048, 2048); const c = moon.shadow.camera; c.left = c.bottom = -30; c.right = c.top = 30; c.near = 1; c.far = 120;
    moon.shadow.bias = -.0006; moon.shadow.normalBias = .045; moon.shadow.radius = 3;
  }
  moon.userData.offset = new THREE.Vector3(-18, 32, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 160, bounds.maxZ - bounds.minZ + 160), ['road', 'forest'].includes(name) ? M.grass : M.ground); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.position.set((bounds.minX + bounds.maxX) / 2, -.025, (bounds.minZ + bounds.maxZ) / 2); group.add(floor);
  const z = { name, group, bounds, spawn: new THREE.Vector3(...spawn), interactables: [], solids: [], fogColor, density, fog: null, mist: null, decor: [], ambient, moon };
  group.userData.interactables = z.interactables;
  zones[name] = z; return z;
}
function solid(z, x, zpos, w, d) { z.solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: zpos - d / 2, maxZ: zpos + d / 2 }); }
// The cult's departures, the Primo and the slaughterhouse carry the threat.
function triggerKillScene() {
  if(scenePlayed || !zones.church) return;
  scenePlayed=true;
  const z=zones.church;
  // Never create replacement extras: Walter and Dario are two of the thirteen.
  const victim=cultRoster.find(n=>n.name==='Dario'&&['present','queued'].includes(n.fate));
  const executioner=cultRoster.find(n=>n.name==='Walter'&&['present','queued'].includes(n.fate));
  if(!victim || !executioner){
    storyFlags.add('empty-choir');
    audio?.mechanicalEvent('bell');
    showToast('THE NAVE IS FULL OF NOTHING BUT THE RECORDING.');
    return;
  }
  removeQueuedCultist(victim);removeQueuedCultist(executioner);
  victim.fate='present';executioner.fate='present';
  transferCultist(victim,z,0,-1.9);transferCultist(executioner,z,2.7,-2.1);
  victim.object.scale.set(1.0,.9,1.0);victim.prompt='';executioner.object.scale.set(1.12,1.1,1.12);executioner.prompt='';
  for(const npc of [victim,executioner]){const ix=z.interactables.findIndex(v=>v.id===npc.id);if(ix>=0)z.interactables.splice(ix,1);}
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.85,32),new THREE.MeshBasicMaterial({color:0x270708,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(0,.015,-1.8);z.group.add(stain);
  const event={id:'cantore_scene',type:'event',object:victim.object,point:victim.object.position,radius:4.8,prompt:'[ E ] KEEP HOLDING THE ROPE',done:false,run:()=>{
    if(event.done)return;event.done=true;controls.unlock();dialogueOpen=true;
    $('speaker').textContent='RECORDING / 03:17';
    $('subtitle').textContent='Your hand remains closed around the rope. Dario does not resist. Walter stands behind him with both hands open. The bell keeps moving while Dario looks toward the altar.';
    speakVoice('Your hand remains closed around the rope. Dario does not resist. Walter stands behind him with both hands open.','RECORDING');
    $('subtitle-wrap').classList.add('visible');$('dialogue-options').innerHTML='<button class="dialogue-option" id="event-continue"><b>[↵]</b>Open your hand.</button>';
    $('event-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      stain.material.opacity=.82;victim.object.rotation.x=1.42;victim.object.position.y=-.45;victim.fate='dead';victim.object.visible=true;
      executioner.object.position.set(3.8,0,-3.7);executioner.object.rotation.y=Math.PI;executioner.fate='present';
      storyFlags.add('dario-bell-death');storyFlags.add('bell-released');if(storyRef.churchBell)storyRef.churchBell.userData.ringing=false;
      journal.push({id:'bell-rope',title:'The Rope in Your Hand',description:'You held the bell rope while Walter stood behind Dario. You did not choose the order, but you kept the bell moving. Your hand was steady. The sound reached the nave after Dario had fallen.',kind:'witness account',zone:'church'});updateJournalCount();
      flashFragment('collapse',175);setTimeout(()=>{audio?.mechanicalNoise(.24,620,.9,.13,0);audio?.mechanicalTone(93,36,1.1,'sawtooth',.075,0);},1080);
      queueCultFate('the nave',executioner,'vanish');scheduleCultSceneFates(1,'the bell','collapse');
      fear=Math.min(1,fear+.28);glitchPulse=1.2;requestMouseLock();showToast('THE BELL CONTINUES AFTER YOUR HAND OPENS.');
    };
  }};
  z.interactables.push(event);
}
function triggerAnnaScene(z, annaMarker) {
  const anna=cultRoster.find(n=>n.name==='Anna');
  if(!anna || !annaMarker)return;
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.62,28),new THREE.MeshBasicMaterial({color:0x260607,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(-5.2,.018,1.2);z.group.add(stain);
  const ev={id:'anna_scene',type:'event',object:annaMarker,point:annaMarker.position,radius:3.4,prompt:'[ E ] LOOK AT THE EMPTY CHAIR',done:false,run:()=>{
    if(ev.done)return;ev.done=true;controls.unlock();dialogueOpen=true;
    const annaStillPresent=['present','queued'].includes(anna.fate);
    $('speaker').textContent='ANNA / KITCHEN';
    $('subtitle').textContent=annaStillPresent?'Anna sets the plate before an empty place. “He only eats when nobody is looking.” The kitchen light goes out.':'The plate is still warm. The chair was empty before you entered. Someone continues to chew inside the wall.';
    speakVoice($('subtitle').textContent,'Anna');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='<button class="dialogue-option" id="anna-continue"><b>[↵]</b>Remain still.</button>';
    $('anna-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      if(annaStillPresent){
        removeQueuedCultist(anna);if(anna.object.parent!==z.group)transferCultist(anna,z,-5.2,1.2);
        anna.object.position.set(-5.2,-.35,1.2);anna.object.rotation.x=1.35;anna.object.visible=true;anna.fate='dead';
        stain.material.opacity=.72;z.group.children.filter(c=>c.isPointLight).forEach(l=>l.intensity*=.22);
        fear=Math.min(1,fear+.22);glitchPulse=1;audio?.killSting();scheduleCultSceneFates(1,'the place at the table','vanish');
        showToast('THE PLACE AT THE TABLE HAS BEEN OCCUPIED.');
      }else{
        storyFlags.add('anna-empty-place');stain.material.opacity=.42;audio?.mechanicalEvent('drawer');glitchPulse=1.1;
        showToast('THE CHAIR WAS EMPTY BEFORE YOU MADE YOUR CHOICE.');
      }
      requestMouseLock();
    };
  }};
  z.interactables.push(ev);
}

const rotatingMachines=[];
function addRoadSurfaceDetails(group) {
  // Leaf litter and flattened weeds are instanced to keep the open landscape light.
  const leafShape=new THREE.Shape();leafShape.moveTo(0,.14);leafShape.quadraticCurveTo(.14,.06,.07,-.13);leafShape.quadraticCurveTo(0,-.19,-.07,-.13);leafShape.quadraticCurveTo(-.14,.06,0,.14);
  const leafGeo=new THREE.ShapeGeometry(leafShape);const leafMat=new THREE.MeshStandardMaterial({color:0x655139,roughness:1,side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(leafGeo,leafMat,420);const dummy=new THREE.Object3D();
  for(let i=0;i<420;i++){let x=(Math.random()-.5)*120,z=(Math.random()-.5)*115;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-8:8);dummy.position.set(x,.022+Math.random()*.006,z);dummy.rotation.set(-Math.PI/2,0,Math.random()*Math.PI*2);const sc=.35+Math.random()*1.5;dummy.scale.set(sc,sc,.6);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new THREE.Color().setHSL(.08+Math.random()*.08,.22,.18+Math.random()*.15));}group.add(leaves);
  const grassGeo=new THREE.PlaneGeometry(.085,.68,1,2);const grassMat=new THREE.MeshStandardMaterial({color:0x66714a,roughness:1,side:THREE.DoubleSide});const grass=new THREE.InstancedMesh(grassGeo,grassMat,780);
  for(let i=0;i<780;i++){let x=(Math.random()-.5)*125,z=(Math.random()-.5)*120;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-10:10);dummy.position.set(x,.30,z);dummy.rotation.set((Math.random()-.5)*.18,Math.random()*Math.PI,(Math.random()-.5)*.5);dummy.scale.set(.45+Math.random(),.45+Math.random()*1.5,1);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);grass.setColorAt(i,new THREE.Color().setHSL(.20+Math.random()*.08,.17,.18+Math.random()*.15));}group.add(grass);
  // Broken concrete flags and patched road shoulders.
  const paverMat=mat(0x65645d,1,{map:TEX.concrete});const pavers=new THREE.InstancedMesh(new THREE.BoxGeometry(1.15,.09,.72),paverMat,85);
  for(let i=0;i<85;i++){const side=i%2?-1:1,zz=-52+Math.random()*100;dummy.position.set(side*(7.5+Math.random()*1.6),.015,zz);dummy.rotation.set(0,(Math.random()-.5)*.16,0);dummy.scale.set(.65+Math.random()*.7,1,.7+Math.random()*.6);dummy.updateMatrix();pavers.setMatrixAt(i,dummy.matrix);}group.add(pavers);
  // Puddles catch the wrong reflection, not the sky.
  const puddleMat=new THREE.MeshStandardMaterial({color:0x263332,roughness:.18,metalness:.28,transparent:true,opacity:.46,side:THREE.DoubleSide});
  for(let i=0;i<24;i++){const w=.4+Math.random()*2.4,h=.25+Math.random()*1.3;const puddle=new THREE.Mesh(new THREE.CircleGeometry(1,24),puddleMat);puddle.rotation.x=-Math.PI/2;puddle.scale.set(w,h,1);puddle.position.set((Math.random()-.5)*16,.022,(Math.random()-.5)*110);group.add(puddle);}
}

function addWoodPavement(group,x,zStart,length=18,width=3.1){
  const boards=[
    mat(0x594332,1,{map:TEX.wood,bumpScale:.12}),
    mat(0x44382c,1,{map:TEX.wood,bumpScale:.15}),
    mat(0x6a5239,1,{map:TEX.wood,bumpScale:.10})
  ];
  const count=Math.floor(length/.48);
  addBox(group,x,.0,zStart+length/2,width+.22,.14,length+.18,M.darkWood,{castShadow:false});
  for(let i=0;i<count;i++){
    const z=zStart+i*.48;
    const board=addBox(group,x,.095,z,width,.12,.445,boards[i%boards.length],{rotation:[0,(i%5-2)*.004,(i%7-3)*.003]});
    board.castShadow=true;board.receiveShadow=true;
    for(const side of [-1,1]){
      const nail=new THREE.Mesh(new THREE.SphereGeometry(.022,7,6),M.metal);
      nail.position.set(x+side*(width*.42),.163,z+(i%2?-.13:.13));group.add(nail);
    }
    if(i%6===2){const split=new THREE.Mesh(new THREE.BoxGeometry(width*.18,.012,.018),M.darkWood);split.position.set(x+(i%2?-.28:.24),.16,z+.05);split.rotation.y=.15;group.add(split);}
  }
  // The boards are slick and dark at the centre, as if the water has been rising through them.
  const wet=new THREE.Mesh(new THREE.PlaneGeometry(width*.72,length*.7),new THREE.MeshStandardMaterial({color:0x202c2b,roughness:.18,metalness:.25,transparent:true,opacity:.22}));
  wet.rotation.x=-Math.PI/2;wet.position.set(x,.17,zStart+length*.56);group.add(wet);
}

function addMachineComplex(group) {
  const g=new THREE.Group();g.position.set(23.3,0,4.3);group.add(g);
  addBox(g,0,.3,0,5.1,.55,3.2,M.darkWall);
  // Belt-driven motor with two visible flywheels and a trembling connecting shaft.
  for(const x of [-1.35,1.15]){
    const wheel=new THREE.Group();wheel.position.set(x,1.45,.25);g.add(wheel);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.88,.095,9,40),M.rust);wheel.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.25,18),M.metal);hub.rotation.x=Math.PI/2;wheel.add(hub);
    for(let j=0;j<8;j++){const spoke=addBox(wheel,0,0,0,.07,.78,.07,M.metal,{castShadow:true});spoke.rotation.z=j*Math.PI/4;}
    rotatingMachines.push({mesh:wheel,speed:x<0?1.1:-.78});
  }
  const crank=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,2.7,12),M.metal);crank.rotation.z=Math.PI/2;crank.position.set(-.1,1.45,.25);g.add(crank);
  const piston=new THREE.Group();piston.position.set(0,.75,-.95);g.add(piston);
  const tube=new THREE.Mesh(new THREE.CylinderGeometry(.19,.24,1.55,12),M.rust);tube.position.y=.72;piston.add(tube);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,1.1,10),M.gold);rod.position.y=1.9;piston.add(rod);rotatingMachines.push({mesh:piston,piston:true,speed:1.25});
  for(let i=0;i<5;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.3+Math.random()*1.5,8),M.rust);pipe.position.set(-2+i*.34,1.1,-1.2);pipe.rotation.z=(Math.random()-.5)*.3;g.add(pipe);}
  const tank=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,2.0,18),M.metal);tank.position.set(2.0,1.25,-.65);g.add(tank);
  const tankTop=new THREE.Mesh(new THREE.CylinderGeometry(.74,.74,.12,18),M.rust);tankTop.position.set(2,2.32,-.65);g.add(tankTop);
  for(let i=0;i<12;i++){const bolt=new THREE.Mesh(new THREE.SphereGeometry(.035,7,6),M.gold);const a=i/12*Math.PI*2;bolt.position.set(2+Math.cos(a)*.7,2.33,-.65+Math.sin(a)*.7);g.add(bolt);}
  addLight(g,0x983d25,.7,5,0,2.1,.5);
  /* the floating sign was removed: nothing hangs in the air without a support */
}

function buildRoad() {
  const z = newZone('road', 0xb6b9b5, .017, { minX: -68, maxX: 68, minZ: -65, maxZ: 65 }, [0, 0, 29]);
  // Road, drainage ditches, canal and the flat Po Valley horizon.
  addPlane(z.group, 0, .005, 0, 12, 130, M.asphalt);
  for (let x of [-6.6, 6.6]) addBox(z.group, x, .08, 0, .17, .15, 130, M.darkWood, { castShadow: false });
  const canalMat = new THREE.MeshStandardMaterial({ color: 0x414c4b, roughness: .18, metalness: .38, transparent: true, opacity: .86 });
  addPlane(z.group, -31, -.01, -27, 13, 95, canalMat);
  for (let i = 0; i < 13; i++) { const reed = addBox(z.group, -38 + Math.random() * 14, .62 + Math.random() * .35, -67 + Math.random() * 78, .035, 1.3, .035, M.wood); reed.rotation.z = (Math.random() - .5) * .2; }
  // Bridge over the canal.
  addBox(z.group, -31, .38, -7, 17, .48, 5.8, M.darkWood);
  for (let side of [-1, 1]) addBox(z.group, -31 + side * 7.7, .8, -7, .17, .7, 5.7, M.rust);
  // Power poles and long cables disappear into white.
  for (let i = 0; i < 7; i++) {
    const x = 11 + (i % 2) * 5; const zz = 42 - i * 17;
    addBox(z.group, x, 5.2, zz, .18, 10.4, .18, M.darkWood);
    addBox(z.group, x, 9.7, zz, 3.8, .12, .12, M.rust);
  }
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 17, 5), M.black); wire.position.set(13, 9.0, 33); wire.rotation.x = Math.PI / 2.5; z.group.add(wire);
  // Trees, weeds, fence fragments.
  for (let i = 0; i < 54; i++) {
    const x = (Math.random() - .5) * 125; const zz = (Math.random() - .5) * 115;
    if (Math.abs(x) < 11 && zz > -20 && zz < 38) continue;
    if (Math.abs(x + 31) < 10) continue;
    addTree(z.group, x, zz, 5 + Math.random() * 6, i + 1);
  }
  // Po Valley cultivation: maize rows, winter wheat and a flooded rice plot with narrow banks.
  addCropRows(z.group,48,-7,4,25,.98,'maize',31);
  addCropRows(z.group,-51,24,4,22,.94,'maize',42);
  addCropRows(z.group,-48,-42,3,18,.78,'wheat',57);
  const paddy=new THREE.Mesh(new THREE.PlaneGeometry(20,.01),new THREE.MeshStandardMaterial({color:0x4d5d57,roughness:.16,metalness:.23,transparent:true,opacity:.78}));paddy.rotation.x=-Math.PI/2;paddy.position.set(45,.025,-42);z.group.add(paddy);
  for(let x=35;x<=55;x+=2){addBox(z.group,x,.08,-52,.12,.16,20,M.wood,{castShadow:false});}
  for(let i=0;i<110;i++){
    const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.16+Math.random()*.2,.055+Math.random()*.08),new THREE.MeshStandardMaterial({color:[0x54503a,0x5f563e,0x343a2c][i%3],side:THREE.DoubleSide,roughness:1}));
    leaf.position.set((Math.random()-.5)*110,.04+Math.random()*.05,(Math.random()-.5)*110);leaf.rotation.set(-Math.PI/2,Math.random()*Math.PI,Math.random()*Math.PI);z.group.add(leaf);leafSpecks.push(leaf);
  }
  for (let i = 0; i < 26; i++) {
    const x = -16 + i * 1.3; addBox(z.group, x, .52, -41, .11, 1.0, .11, M.darkWood);
    if (i % 4 === 0) addBox(z.group, x, .76, -41, .11, .1, 1.0, M.darkWood, { rotation: [0, Math.PI / 2, 0] });
  }
  // Weathered timber houses retain different silhouettes; the church is a separate Romanesque stone mass.
  addHouseExterior(z.group,0,-15,15,13,5.4,2,0x87867b,true);
  addRomanesqueChurchExterior(z.group,37,-25,12,15,6.8);
  addHouseExterior(z.group,-36,-14,12,10,4.8,4,0x77766c,true);
  addHouseExterior(z.group,27,22,10,9,4.2,5,0x555a55,true);
  addRoadSurfaceDetails(z.group); addWoodPavement(z.group,27,10.2,18.2,3.3); addMachineComplex(z.group);
  // The farmhouse's false golden window.
  addLight(z.group,0xffb35d,2.1,18,0,2.0,-7,{decay:1.5});
  const firstPrimo=makeNPC(z.group,-2.15,-5.45,'The First',0x4b463d,1);
  firstPrimo.isOpeningPrimo=true;firstPrimo.radius=4.0;firstPrimo.prompt='[ E ] SPEAK — IL PROFESSORE';
  if (firstPrimo.head) firstPrimo.head.material = headMaterial();
  firstPrimo.dialogue={line:'You made it. I am glad. The road is unpleasant once the fog comes down. Come under the porch a moment; you must be cold.',choices:['Thank you. Have you been waiting long?','Do you know why I was called here?','Who are the people inside?'],replies:['Not long. I kept the lamp on because a person should not have to arrive at a dark door. That is all.','Only what the letter told me. You tune pianos, and you notice when a note is almost right. We have a room that needs that kind of attention.','Neighbours, mostly. They have been keeping one another company. It is easier to be here when somebody remembers to leave a place for you.']};
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshBasicMaterial({ color: 0xc08a4a, transparent: true, opacity: .48 })); windowGlow.position.set(3.8, 3.0, -8.35); z.group.add(windowGlow);
  // Small derelict industrial shed to the east.
  storyRef.shedMeshes=[addBox(z.group, 24, 2.2, 5, 16, 4.4, 12, M.darkWall), addBox(z.group, 24, 4.6, 5, 17, .3, 13, M.rust)];
  for (let i = 0; i < 4; i++) addBox(z.group, 17 + i * 4.5, 2.1, -1.12, .55, 4.3, .2, M.black);
  // Distant industrial chimneys.
  for (let i = 0; i < 3; i++) { const chimney = new THREE.Mesh(new THREE.CylinderGeometry(.65, .8, 22 + i * 5, 8), M.rust); chimney.position.set(48 + i * 4, 12 + i * 2.5, 41); z.group.add(chimney); }
  // A fenced cemetery sits between the derelict works and the distant chimneys.
  const cemetery=new THREE.Group();cemetery.position.set(44,0,18);cemetery.name='INDUSTRIAL_CEMETERY';z.group.add(cemetery);storyRef.cemetery=cemetery;
  const cemeteryGround=new THREE.Mesh(new THREE.PlaneGeometry(16,12),M.darkWall);cemeteryGround.rotation.x=-Math.PI/2;cemeteryGround.position.y=.018;cemetery.add(cemeteryGround);
  for(const x of [-8,8]){for(let zz=-6;zz<=6;zz+=1.25){if(x===-8&&Math.abs(zz)<2.2)continue;addBox(cemetery,x,.72,zz,.08,1.35,.08,M.rust,{castShadow:false});}addBox(cemetery,x,.34,0,.09,.08,12,M.rust,{castShadow:false});addBox(cemetery,x,1.08,0,.09,.08,12,M.rust,{castShadow:false});}
  for(const zz of [-6,6]){for(let xx=-8;xx<=8;xx+=1.25)addBox(cemetery,xx,.72,zz,.08,1.35,.08,M.rust,{castShadow:false});addBox(cemetery,0,.34,zz,16,.08,.09,M.rust,{castShadow:false});addBox(cemetery,0,1.08,zz,16,.08,.09,M.rust,{castShadow:false});}
  const graves=[[-4,-3],[-.1,-3],[3.9,-3],[-4,1.6],[-.1,1.6],[3.9,1.6]];
  storyRef.graves=graves;
  const marksman=new THREE.Group();marksman.position.set(31.1,4.78,7.2);marksman.rotation.y=-Math.PI/2;marksman.visible=false;z.group.add(marksman);storyRef.cemeteryShooter=marksman;
  const shooterBody=new THREE.Mesh(new THREE.CapsuleGeometry(.18,.58,4,7),M.black);shooterBody.position.y=.66;marksman.add(shooterBody);
  const shooterHead=new THREE.Mesh(new THREE.SphereGeometry(.14,8,7),M.black);shooterHead.position.set(0,1.22,.02);marksman.add(shooterHead);
  const rifle=new THREE.Mesh(new THREE.CylinderGeometry(.027,.04,.95,6),M.black);rifle.rotation.z=-Math.PI/2;rifle.position.set(.36,.78,.17);marksman.add(rifle);
  const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.035,6,5),M.rust);muzzle.position.set(.84,.78,.17);marksman.add(muzzle);
  // Doors into interiors.
  addDoor(z.group,0,-8.27,'the farmhouse','home',[0,0,6.2]);
  addDoor(z.group,37,-17.28,'the church','church',[0,0,9.4],false,{style:'roman'});
  addDoor(z.group,-36,-8.78,'the empty house','ruin',[0,0,5.8]);
  const abattoirDoor=addDoor(z.group,27,26.72,'the house of beasts','abattoir',[0,0,7.0],true);
  abattoirDoor.radius = 4.8;
  abattoirDoor.requiredClues = 7;
  addLight(z.group, 0xffb35d, 1.25, 7, 27, 2.5, 27.6, { decay: 1.5 });
  // Clue at the roadside mailbox.
  addBox(z.group, -4.5, .63, 20, .55, 1.25, .48, M.rust);
  addBox(z.group, -4.5, 1.32, 20, .7, .09, .58, M.darkWood);
  addClueMesh(z.group,new THREE.Vector3(-4.42,1.366,20),'The 1977 Newspaper','A local clipping reports thirteen people found dead in a country church during the winter of 1977. Beside the bodies, a tape recorder was still running. The newspaper does not name the record.','clipping','paper');
  // A wet-coated figure at the bridge, more like a stain than a person.
  const woman = makeNPC(z.group,-31,-3,'The Woman by the Canal',0x242a28,1);
  woman.prompt = '[ E ] SPEAK — THE WOMAN BY THE CANAL';
  woman.dialogue = {
    line:'The water does not flow toward the sea. It flows toward the day it was poured.',
    choices:['What happened here?','I do not know you.'], 
    replies:['They closed the church but left the recording running.','That is better. Names let air in.']
  };
  // Rusted sign and road debris.
  addBox(z.group, 8.8, 1.3, 25, .1, 2.6, .1, M.rust); addBox(z.group, 9.5, 2.1, 25, 2.2, .65, .12, M.darkWood);
  const signText = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .42), new THREE.MeshBasicMaterial({ map: makeLabelTexture('PO / KM 14', 512, 128), transparent: true })); signText.position.set(9.5, 2.1, 24.91); z.group.add(signText);
  z.mist = addFog(z.group, 95, 125, 0xe1e3df, 49);
  z.fog = new THREE.FogExp2(z.fogColor, z.density);
  solid(z, 0, -15, 15.5, 13.5); solid(z, 37, -25, 12.5, 15.5); solid(z, -36, -14, 12.5, 10.5); solid(z, 24, 5, 16.5, 12.5);
  // Keep a clear approach to the abattoir threshold; the doorway itself is not blocked.
  z.solids.push(
    { minX: 21.7, maxX: 22.3, minZ: 17.25, maxZ: 26.75 },
    { minX: 31.7, maxX: 32.3, minZ: 17.25, maxZ: 26.75 },
    { minX: 22, maxX: 32, minZ: 17.25, maxZ: 17.75 },
    { minX: 22, maxX: 25.9, minZ: 26.25, maxZ: 26.75 },
    { minX: 28.1, maxX: 32, minZ: 26.25, maxZ: 26.75 }
  );
  return z;
}
function buildHome() {
  const z = newZone('home', 0x393b36, .045, { minX: -10, maxX: 10, minZ: -9, maxZ: 9 }, [0, 0, 6.4]);
  addBox(z.group, 0, -.13, 0, 20, .26, 18, M.floor);
  // Walls, and a real ceiling with heavy beams: Marta carves the house's memories into them.
  addWindowedWall(z.group, 'x', -9, -10, 10, 3.6, .35, M.wall, [{ at: -4.2, w: 1.7, h: 1.5, y: 1.5 }, { at: 4.5, w: 1.4, h: 1.9, y: 1.2 }]); addBox(z.group, -10, 1.8, 0, .35, 3.6, 18, M.wall); addBox(z.group, 10, 1.8, 0, .35, 3.6, 18, M.wall);
  addBox(z.group, -6.0, 1.8, 9, 8, 3.6, .35, M.wall); addBox(z.group, 6.0, 1.8, 9, 8, 3.6, .35, M.wall);
  addBox(z.group, 0, 3.72, 0, 20.4, .22, 18.4, M.darkWall);
  for (let i = 0; i < 7; i++) addBox(z.group, -8.6 + i * 2.85, 3.47, 0, .26, .3, 17.6, M.darkWood);
  for(let i=0;i<14;i++){const drip=new THREE.Mesh(new THREE.BoxGeometry(.018,.18+Math.random()*.5,.018),M.rust);drip.position.set(-8.9+Math.random()*17.8,2.7-Math.random()*.8,-8.77);z.group.add(drip);}
  addBox(z.group, -3.2, 1.45, -1.4, .22, 2.9, 6.8, M.darkWall); addBox(z.group, 4.8, 1.45, -2.1, .22, 2.9, 6.0, M.wall);
  // The dresser in the corner and its weak bulb.
  addBox(z.group, -8.5, 1.15, -3.8, 1.2, 2.3, 1.25, M.darkWood);
  addBox(z.group, -8.5, 2.34, -3.8, 1.32, .12, 1.35, M.black);
  // ---- The dining table: thirteen places and one for the guest, white plastic garden chairs (script, scene 6).
  buildDiningRoom(z);
  // ---- The kitchen corner: the refrigerator that hums a flat B, the silent quiz show, the wrong calendar.
  buildKitchenCorner(z);
  // ---- The harpsichord, a Flemish single-manual instrument at true scale, with its stool and tuning tools.
  buildHarpsichord(z.group, 7.05, -2.45);
  addLamp(z.group, 6.1, 2.65, -1.6, { style: 'pendant', color: 0xffcf96, intensity: 4.5, distance: 8, flicker: .02 });
  addLamp(z.group, 2.2, 2.65, 5.6, { style: 'pendant', color: 0xffc888, intensity: 2.4, distance: 8, flicker: .05 });
  // Lamp behind a painted window; its gold is deliberately false.
  addBox(z.group, 7.9, 2.2, -8.78, 2.0, 1.6, .1, M.warmLight, { castShadow: false });
  addBox(z.group, 7.9, 2.2, -8.66, 2.2, 1.8, .08, M.darkWood, { castShadow: false });
  addLight(z.group, 0xffac53, 2.6, 11, 7.9, 2.1, -7.4, { decay: 1.6 });
  addLook(z.group,7.9,2.0,-8.4,'The painted window','There is no window here: a pane painted with a summer morning, and a lamp behind it. At three in the morning it still says it is dawn.');
  buildCRT(z.group,-1.2,.05,-8.2);
  addLook(z.group,-1.2,1.0,-7.7,'The television','A quiz show, sound off. A woman in sequins points at a question nobody in the house will answer. Ottavio watches it when he is not at the harpsichord.');
  addLook(z.group,-4.2,1.6,-8.1,'North window','Beyond the glass, figures circle a fire in the fog. One hangs from a beam. The wind does not move it. It moves only when the room breathes.');
  addLook(z.group,2.1,2.2,-8.1,'The portrait','A family photograph. Someone has scratched away the man’s face. The grooves are still bright.');
  addDistantRitual(z.group, -4.2, -30);
  addDistantRitual(z.group, 4.5, -34);
  addBox(z.group,2.1,2.25,-8.72,1.0,.75,.08,M.gold);addBox(z.group,2.1,2.25,-8.66,.82,.58,.025,M.darkWall);
  // ---- Characters. Twelve followers live here; Don Remo keeps the church; il Professore enters last.
  const T = storyRef.tableSeats;
  const ines = registerCultist(makeNPC(z.group,-4.45,4.3,'Ines',0x52483d,0),{
    line:'Sit. The fog has closed the roads, so you will eat with us. I was a nurse for thirty years. In this house nobody dies alone.',
    choices:['Who was Gabri?','What is in the thermos?'],
    replies:['The boy by the refrigerator. He sits in its light at night because it is the only light that looks at him. There is blood at your lip. Hold still.','Tea. Bitter, because it has to be. Someone has to make it gentle — that is my whole job here.']
  });
  ines.object.rotation.y = -Math.PI / 2 - .35;
  const ottavio = registerCultist(makeNPC(z.group,8.15,-3.3,'Ottavio',0x373735,1),{
    line:'I played continuo for forty years. Deaf since 2004. They gave the acetate to me because a deaf man cannot be tempted to play it.',
    choices:['Then how do you listen?','Is the harpsichord in tune?'],
    replies:['With my palm on the soundboard. With my jaw against the table. A string tells the wood the truth even when the ears refuse it.','Tune it to four-fifteen. A semitone below the world. Everything in this house is a little lower than it should be.']
  });
  seatNPC(ottavio, 8.15, -3.35, -Math.PI / 2);
  const anna=addCultist(z,0,0,'Anna',0x4a4035,0,'I cook for the dead. My husband has been gone forty years and his bowl is still filled every evening. Eat. It is still warm.',['Will he come back?','Why keep filling his bowl?'],['No. That is why the bowl must be ready.','If I stop, the table will know he is gone. I cannot be the one to tell it.']);
  seatNPC(anna, T.west[2][0], T.west[2][1], Math.PI / 2);
  const dario=addCultist(z,0,0,'Dario',0x302d28,1,'I was a seminarian. I am the only one here who still believes — in The White, in the Mass, in all of it. That is why they look away from me.',['Who leads the rite?','You believe too much.'],['Nobody leads. The Professore only tells each of us where to stand.','That is what he says. I would rather be hated for believing than loved for pretending.']);dario.isLeader=true;
  seatNPC(dario, T.east[0][0], T.east[0][1], -Math.PI / 2);
  const sergio=addCultist(z,0,0,'Sergio',0x4a443a,0,'I stopped believing years ago. I stayed for the company. At my age you do not leave a table where somebody remembers your name.',['Then why not leave?','What happened in 1977?'],['Loneliness is a door that opens inward. You walk through it and you are still in the same room.','Thirteen voices in a frescoed church. A heater in the corner. Nobody heard the record. I was nineteen and I was outside, smoking.']);
  seatNPC(sergio, T.east[2][0], T.east[2][1], -Math.PI / 2);
  const marta=addCultist(z,0,0,'Marta',0x51483d,0,'I am the engraver. I cut everyone’s memories into the beams up there. Mine I have cut so often I no longer know which ones were real.',['Which memory is true?','Carve one of mine.'],['The golden ones are the lies. Remember that, when he gives you yours back.','Give me a grey Sunday. I will give it back to you with sunshine. That is how it works here.']);
  seatNPC(marta, T.west[3][0], T.west[3][1], Math.PI / 2);
  const pino=addCultist(z,1.7,7.2,'Pino',0x3d423d,1,'Twenty years on the long-haul roads. I came for the dinner and the bed. I know how to leave a place — you start before dawn and you do not look back.',['Show me the field path.','Do not go.'],['Past the canal, into the wheat. The combine sleeps there. If it wakes up, do not watch the blades — watch who started it.','You can ask me to stay. You cannot make the road forget me.']);pino.isRunner=true;storyRef.pino=pino;pino.object.rotation.y=Math.PI*.85;
  const gabri=addCultist(z,0,0,'Gabri',0x544b43,1,'I sit here at night because the fridge light is the only light that looks at me. Nineteen years and nobody ever saw me. The album will see me.',['Does Ines look after you?','What do you want from The White?'],['She wipes my nose when it bleeds. Like a blessing. She is kind — that is the part I trust.','An audience. Something that finally notices I am here.']);
  seatNPC(gabri, -6.0, -6.95, Math.PI);
  const walter=addCultist(z,0,0,'Walter',0x343a37,1,'Surveyor. I drive him, I measure, I lay the charges. Give me a task and I can be a person for as long as it takes to finish it.',['Who gives you the tasks?','What happens when they are done?'],['The man with the paperback. He never orders anything. He tells you where to stand.','There is always another task. That is how the house keeps its shape.']);
  seatNPC(walter, T.west[0][0], T.west[0][1], Math.PI / 2);
  const livia=addCultist(z,0,0,'Livia',0x5a4c43,0,'(She does not speak. She sings, very low, an aria in a baroque key — and writes on a napkin:) I sang soprano. Now only the melody is left.',['Sing it for me.','Who took your voice?'],['(She hums four notes, a semitone too low, and stops.)','(She writes:) Nobody took it. I gave it to the room.']);
  seatNPC(livia, T.east[3][0], T.east[3][1], -Math.PI / 2);
  const franco=addCultist(z,0,0,'Franco',0x383b39,1,'Butcher. Thirty years cutting meat and never once for a reason. And Anna makes the coffee wrong — write that down.',['Do you believe in The White?','What does he want from you?'],['I believe in the edge. The rest is a room built around it.','“Become who you are,” he says. For a butcher that is a short sentence.']);
  seatNPC(franco, T.west[1][0], T.west[1][1], Math.PI / 2);
  // Ines's thermos on the table, and Anna's soup over the trowel.
  const thermos=buildThermos(z.group,T.top[0],T.topY,T.top[1]-.6);thermos.scale.setScalar(.55);
  addLook(z.group,T.top[0],T.topY+.3,T.top[1]-.6,'Ines’s thermos','A red enamel thermos, worn smooth at the handle. Scratched into the base: GABRI / PASSENGER SEAT. The cup smells faintly of bitter tea.',1.8);
  const trowel=buildTrowel(z.group,T.west[2][0]+.42,T.topY+.012,T.west[2][1]+.28);trowel.rotation.set(-Math.PI/2,0,.4);trowel.scale.setScalar(.42);
  addLook(z.group,T.west[2][0]+.5,T.topY+.1,T.west[2][1]+.15,'Anna’s place','Her soup, and beside the spoon a mason’s trowel with mortar still drying on the blade. Nobody at the table mentions it.',1.8);
  // The wall Tobia listens through: a crack, a water stain, a glass left on the dresser.
  const crack=new THREE.Mesh(new THREE.PlaneGeometry(.5,1.4),new THREE.MeshBasicMaterial({map:crackTexture(),transparent:true,depthWrite:false}));crack.position.set(-9.81,1.55,-5.1);crack.rotation.y=Math.PI/2;z.group.add(crack);
  const glass=new THREE.Mesh(new THREE.CylinderGeometry(.035,.03,.1,14,1,true),new THREE.MeshStandardMaterial({color:0xcfd8d4,roughness:.1,transparent:true,opacity:.45,side:THREE.DoubleSide}));glass.position.set(-8.2,2.45,-3.6);z.group.add(glass);
  const wallEar=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));wallEar.position.set(-9.55,1.5,-5.1);z.group.add(wallEar);storyRef.wallEar=wallEar;
  z.interactables.push({id:'dario-wall-listen',type:'event',object:wallEar,point:wallEar.position,radius:2.6,prompt:'[ E ] PRESS YOUR EAR TO THE WALL — VOICES',requiresFlags:['talked-ines','talked-ottavio'],blockedHint:'Muffled voices behind the plaster. Speak with Ines and Ottavio first.',run:startDarioEavesdrop});
  // Evidence, each resting on a real surface.
  addClueMesh(z.group,new THREE.Vector3(T.south[0]+.27,T.topY,T.south[1]-.42),'Seating List','Thirteen names in Ines’s hand, one per chair. Beneath them a fourteenth line has been erased so hard it has scored the paper. The fourteenth place is the one set for you.','list','paper',{requiresFlag:'talked-ines',blockedHint:'Speak with Ines before reading her seating list.'});
  addClueMesh(z.group,new THREE.Vector3(8.6,storyRef.sideTableY,-2.12),'Tuning Fork','A tuning fork engraved A=415 — baroque pitch, a semitone under the modern A. The note does not match the one in your head.','fork','fork',{requiresFlag:'talked-ottavio',blockedHint:'Speak with Ottavio before touching his tuning fork.'});
  addClueMesh(z.group,new THREE.Vector3(1.2,0,6.1),'The carved beam','A beam Marta took down to finish. A dog, a summer table, a room with no doors. Several hands, but every carving ends with the same shallow final line.','beam','wood');
  const exit = addDoor(z.group,0,8.95,'the road','road',[0,0,-3.4]);exit.prompt='[ E ] RETURN TO THE ROAD';
  const hatch = addDoor(z.group,8.7,-6.2,'the cellar','cellar',[0,0,4.5],true,{rotationY:Math.PI/2,style:'hatch'});hatch.prompt='[ E ] DESCEND — THE CELLAR';
  const hatchCover = new THREE.Group(); hatchCover.name = 'CELLAR_HATCH_COVER'; z.group.add(hatchCover); z.hatchCover = hatchCover;
  addBox(hatchCover, 8.6, .46, -5.0, 1.4, .9, 1.1, M.darkWall);
  addBox(hatchCover, 7.5, .33, -5.7, .8, .65, .7, M.rust);
  z.mist = addFog(z.group, 18, 23, 0xaeb0a9, 27);
  z.solids.push({ minX: -10, maxX: -9.7, minZ: -9, maxZ: 9 }, { minX: 9.7, maxX: 10, minZ: -9, maxZ: 9 }, { minX: -9, maxX: -4, minZ: 8.7, maxZ: 9 }, { minX: 4, maxX: 9, minZ: 8.7, maxZ: 9 }, { minX: -9, maxX: 9, minZ: -9, maxZ: -8.7 });
  z.solids.push({ minX: -3.5, maxX: -3.0, minZ: -5, maxZ: 2 });
  z.solids.push({ minX: 4.65, maxX: 4.95, minZ: -6, maxZ: -1 });
  z.solids.push({ minX: -9.15, maxX: -7.85, minZ: -4.45, maxZ: -3.15 });
  return z;
}
function buildChurchBell(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const bronze=mat(0x77634a,.28,{metalness:.82}),worn=mat(0x9b8b70,.36,{metalness:.76}),wood=mat(0x34291f,.92,{map:TEX.wood});
  const yoke=roundedHousing(.92,.16,.26,.08,wood,.025);yoke.position.y=1.65;root.add(yoke);
  for(const side of [-1,1]){const pin=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.14,12),worn);pin.rotation.z=Math.PI/2;pin.position.set(side*.43,1.64,0);root.add(pin);}
  const profile=[new THREE.Vector2(.31,0),new THREE.Vector2(.30,.055),new THREE.Vector2(.275,.12),new THREE.Vector2(.235,.22),new THREE.Vector2(.185,.34),new THREE.Vector2(.145,.48),new THREE.Vector2(.115,.60),new THREE.Vector2(.10,.66)];
  const shell=new THREE.Mesh(new THREE.LatheGeometry(profile,32),bronze);shell.position.y=.76;root.add(shell);
  const lip=new THREE.Mesh(new THREE.TorusGeometry(.31,.025,8,36),worn);lip.rotation.x=Math.PI/2;lip.position.y=.76;root.add(lip);
  const shoulder=new THREE.Mesh(new THREE.TorusGeometry(.12,.018,6,20),worn);shoulder.rotation.x=Math.PI/2;shoulder.position.y=1.41;root.add(shoulder);
  const crown=new THREE.Mesh(new THREE.CylinderGeometry(.11,.13,.12,14),bronze);crown.position.y=1.45;root.add(crown);
  const clapper=new THREE.Group();clapper.position.set(0,1.22,0);root.add(clapper);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(.018,.022,.54,8),worn);rod.position.y=-.25;clapper.add(rod);
  const ball=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),worn);ball.position.y=-.54;clapper.add(ball);
  const ropeCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.94,0),new THREE.Vector3(.025,.58,.025),new THREE.Vector3(-.035,.28,.04),new THREE.Vector3(.04,-.12,.055),new THREE.Vector3(.015,-.58,.04),new THREE.Vector3(.06,-1.22,.08)]);
  const rope=new THREE.Mesh(new THREE.TubeGeometry(ropeCurve,28,.024,7,false),mat(0x72583d,.98,{map:TEX.wood}));root.add(rope);
  const knot=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),wood);knot.position.set(.06,-1.22,.08);root.add(knot);
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.19,10),wood);grip.position.set(.06,-1.36,.08);grip.rotation.z=-.08;root.add(grip);
  root.userData={shell,clapper,rope,elapsed:0,ringing:false};return root;
}
function updateChurchBell(dt){
  const rig=storyRef.churchBell;if(!rig?.userData?.ringing)return;
  const u=rig.userData;u.elapsed+=dt;const decay=Math.exp(-u.elapsed*.62);
  u.shell.rotation.z=Math.sin(u.elapsed*8.8)*.115*decay;
  u.clapper.rotation.z=Math.sin(u.elapsed*10.6+.8)*.23*decay;
  if(u.elapsed>5){u.ringing=false;u.shell.rotation.z=0;u.clapper.rotation.z=0;}
}
function buildChurch() {
  const z = newZone('church', 0x222522, .042, { minX: -9, maxX: 9, minZ: -17, maxZ: 12 }, [0, 0, 9.2]);
  addBox(z.group, 0, -.14, -2, 18, .28, 30, M.cobble);
  // Nave walls, broken upper windows and apse.
  const exposedNaveBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.0),M.brick);exposedNaveBrick.position.set(0,1.0,-16.78);z.group.add(exposedNaveBrick);
  addBox(z.group, -9, 3.2, -2, .35, 6.4, 30, M.wall); addBox(z.group, 9, 3.2, -2, .35, 6.4, 30, M.wall);
  addBox(z.group, 0, 3.0, -17, 18, 6, .35, M.darkWall); addBox(z.group, -5.0, 2.2, 12, 8, 4.4, .35, M.wall); addBox(z.group, 5.0, 2.2, 12, 8, 4.4, .35, M.wall);
  addBox(z.group, 0, 6.3, -2, 18, .25, 30, M.darkWall);
  addBox(z.group, 0, .55, -14.4, 3.6, 1.1, 1.1, M.marble);
  addCandle(z.group, -1.2, 1.13, -14.4, false, true);
  addCandle(z.group, 0, 1.13, -14.4, false, true);
  addCandle(z.group, 1.2, 1.13, -14.4, false, true);
  addLook(z.group,0,1.4,-13.5,'The altar','Under the cloth is a butcher’s key. On top of it sits a glass of pump water. Nobody has drunk from it.');
  // A row of broken high windows admits cold vertical light.
  for (let side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x99a5a4, transparent: true, opacity: .13, side: THREE.DoubleSide }));
    win.position.set(side * 8.78, 4.55, -12 + i * 6); win.rotation.y = side * Math.PI / 2; z.group.add(win);
  }
  // Pews, altar, rood beam and an organ that has not been maintained.
  for (let row = 0; row < 5; row++) for (let side of [-1, 1]) {
    const x = side * 3.5, zz = 5 - row * 3.7;
    addBench(z.group, x, zz, 0);
  }
  addBox(z.group, 0, 1.12, -12.0, 4.7, 1.25, 1.6, M.darkWood);
  addBox(z.group, 0, 1.82, -12.0, 5.0, .14, 1.8, M.gold);
  buildChurchInterior(z);
  addBox(z.group, -5.9, 1.5, -13, 3.0, 2.7, 1.4, M.darkWood);
  for (let i = 0; i < 9; i++) addBox(z.group, -7.1 + i * .3, 1.65, -12.25, .055, 2.15, .06, M.gold);
  // Candles and red sanctuary light.
  for (let i = 0; i < 6; i++) addBox(z.group, -2.1 + i * .85, 2.12, -11.3, .055, .58, .055, M.wood);
  addLight(z.group, 0xffa35b, 2.2, 6, 0, 2.55, -11.3);
  addLight(z.group, 0x9d3026, 1.7, 12, 0, 4.1, -14.2);
  const remo=makeNPC(z.group,1.5,-8.2,'Don Remo',0xddd7c9,1);
  storyRef.remo=remo;remo.dialogue={line:'Defrocked, they say. I still celebrate — every word of the liturgy, perfectly. I speak to someone who no longer answers, and I am waiting to be answered by silence.',choices:['If God is dead, why keep the collar?','Did the choir know about the heater?'],replies:['A vocation can outlive the thing it serves. The collar is a habit, the bell is a task, and the altar still needs a hand.','I remember the heater. I remember a window latch. The report says the cause was undetermined. I have never corrected it.']};
  const bellRig=buildChurchBell(z.group,-6.8,2.0,-5.8);storyRef.churchBell=bellRig;
  z.interactables.push({id:'bell_event',type:'event',object:bellRig,point:new THREE.Vector3(-6.74,1.14,-5.72),radius:2.8,prompt:'[ E ] HOLD THE BELL ROPE',requiresFlags:['talked-remo','station-dario'],blockedHint:'Not yet. Speak with Don Remo — and Dario’s Mass has not been celebrated.',run:()=>{storyFlags.add('held-bell-rope');queueStation('remo',true);}});
  addClueMesh(z.group,new THREE.Vector3(storyRef.lectern.x,storyRef.lectern.y,storyRef.lectern.z),'Mass Register','The page lists a sequence of stations. The numbering jumps from the eleventh to the fourteenth. On the reverse: “no funeral.”','mass','book',{requiresFlag:'talked-remo',blockedHint:'Speak with Don Remo before examining the Mass Register.'});
  addDoor(z.group,0,11.9,'the churchyard','road',[0,0,-29],false,{style:'roman'});
  z.mist = addFog(z.group, 38, 36, 0xb7bcb8, 67);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -17, maxZ: 12 }, { minX: 8.7, maxX: 9, minZ: -17, maxZ: 12 }, { minX: -9, maxX: 9, minZ: -17.3, maxZ: -17 }, { minX: -9, maxX: -5, minZ: 11.7, maxZ: 12 }, { minX: 5, maxX: 9, minZ: 11.7, maxZ: 12 });
  return z;
}
function buildRuin() { return buildRuinV6(); }
function addHangingCarcass(group,x,z,phase=0) {
  const rig=new THREE.Group();rig.position.set(x,0,z);group.add(rig);
  const chainMat=mat(0x272a27,.56,{metalness:.62,map:TEX.rust});
  const chain=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,1.35,7),chainMat);chain.position.y=3.03;rig.add(chain);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(.16,.035,7,14,Math.PI*1.35),M.rust);hook.position.y=2.30;hook.rotation.x=Math.PI/2;rig.add(hook);
  const hideMat=new THREE.MeshStandardMaterial({color:0x62544c,roughness:1,metalness:.02,transparent:true,opacity:.92,map:TEX.plaster,bumpMap:TEX.plaster,bumpScale:.045});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.55,.95,8,16),hideMat);
  torso.position.y=1.72;torso.scale.set(1.30,1.02,.68);rig.add(torso);
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.52,12,10),M.blood);shoulder.position.set(0,2.19,0);shoulder.scale.set(1.2,.58,.72);rig.add(shoulder);
  // An unmistakably bovine but partially abstract head: long muzzle, split nose,
  // ears and curved horns keep the suspended forms legible as cattle, not people.
  const skull=new THREE.Mesh(new THREE.SphereGeometry(.29,14,12),hideMat);skull.position.set(0,2.36,.39);skull.scale.set(.88,.82,1.22);rig.add(skull);
  const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.205,12,10),mat(0x4c4038,1,{map:TEX.plaster,bumpScale:.04}));muzzle.position.set(0,2.18,.66);muzzle.scale.set(1.22,.72,.8);rig.add(muzzle);
  for(const side of [-1,1]){
    const nostril=new THREE.Mesh(new THREE.SphereGeometry(.036,8,6),M.black);nostril.position.set(side*.105,2.19,.81);nostril.scale.set(.72,1,.55);rig.add(nostril);
    const ear=new THREE.Mesh(new THREE.ConeGeometry(.13,.48,7),hideMat);ear.position.set(side*.32,2.46,.24);ear.rotation.z=side*-.72;ear.rotation.x=-.18;rig.add(ear);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),M.black);eye.position.set(side*.205,2.39,.61);rig.add(eye);
    const hornCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.19,2.55,.36),new THREE.Vector3(side*.32,2.76,.31),new THREE.Vector3(side*.40,2.82,.20)]);
    const horn=new THREE.Mesh(new THREE.TubeGeometry(hornCurve,10,.045,6,false),mat(0xafa38d,.95));rig.add(horn);
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.12,.17,1.08,9),hideMat);leg.position.set(side*.37,.57,.24);leg.rotation.z=side*.12;rig.add(leg);
    const rearLeg=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,1.0,9),hideMat);rearLeg.position.set(side*.37,.57,-.28);rearLeg.rotation.z=side*.1;rig.add(rearLeg);
    for(const zoff of [.24,-.28]){
      const hoof=new THREE.Mesh(new THREE.CylinderGeometry(.16,.19,.20,8),mat(0x252522,.98));hoof.position.set(side*.37,.035,zoff);hoof.rotation.z=side*.08;rig.add(hoof);
      const cleft=new THREE.Mesh(new THREE.BoxGeometry(.022,.15,.15),M.rust);cleft.position.set(side*.37,.015,zoff);rig.add(cleft);
    }
  }
  const udder=new THREE.Mesh(new THREE.SphereGeometry(.22,10,8),mat(0x51413b,.96,{map:TEX.plaster}));udder.position.set(0,.98,-.40);udder.scale.set(1,.66,1.1);rig.add(udder);
  for(let i=0;i<4;i++){const teat=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.24,7),M.blood);teat.position.set((i-1.5)*.085,.79,-.39);rig.add(teat);}
  const tailCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.05,-.62),new THREE.Vector3(.05,1.7,-.91),new THREE.Vector3(.12,1.28,-1.02)]);
  const tail=new THREE.Mesh(new THREE.TubeGeometry(tailCurve,12,.035,6,false),hideMat);rig.add(tail);
  const tailTuft=new THREE.Mesh(new THREE.ConeGeometry(.09,.25,7),M.darkWood);tailTuft.position.set(.12,1.18,-1.02);tailTuft.rotation.x=-.2;rig.add(tailTuft);
  for(let i=0;i<7;i++){
    const rib=new THREE.Mesh(new THREE.TorusGeometry(.49-i*.012,.025,6,22,Math.PI),mat(i%2?0x54433c:0x7b685c,.92));
    rib.position.set(0,1.42+i*.19,.02);rib.rotation.x=Math.PI/2;rib.rotation.z=Math.PI;rib.scale.set(1.35,1,.62);rig.add(rib);
  }
  for(let i=0;i<3;i++){const strip=new THREE.Mesh(new THREE.PlaneGeometry(.22,.86+Math.random()*.42),new THREE.MeshStandardMaterial({color:[0x513a34,0x755d51,0x302b27][i],transparent:true,opacity:.62,side:THREE.DoubleSide,roughness:1}));strip.position.set((i-1)*.31,1.35,.42);strip.rotation.z=(i-1)*.14;rig.add(strip);}
  rig.userData.hangPhase=phase;rig.userData.hanging=true;return rig;
}
function buildAbattoir() {
  const z=newZone('abattoir',0x282522,.049,{minX:-12,maxX:12,minZ:-10,maxZ:10},[0,0,7.0]);
  const floor=mat(0x403a32,1,{map:TEX.wood,bumpScale:.14});addBox(z.group,0,-.15,0,24,.3,20,floor);
  addBox(z.group,0,2,-10,24,4,.35,M.wall);addBox(z.group,-12,2,0,.35,4,20,M.wall);addWindowedWall(z.group,'z',12,-10,10,4,.35,M.wall,[{at:-3,w:1.8,h:1.0,y:2.5},{at:3.5,w:1.6,h:1.0,y:2.5}]);addBox(z.group,0,2,10,24,4,.35,M.darkWall);
  addBox(z.group,0,4.0,0,24,.35,20,M.darkWood);
  // Brick courses, limescale, mould patches and peeled plaster leave the building legible as old masonry.
  for(let side of [-1,1]){
    const bricks=new THREE.Mesh(new THREE.PlaneGeometry(22,2.2),M.brick);bricks.position.set(side*11.78,1.12,-.2);bricks.rotation.y=side*Math.PI/2;z.group.add(bricks);
    for(let i=0;i<12;i++){const mould=new THREE.Mesh(new THREE.SphereGeometry(.35+Math.random()*.52,7,6),mat(0x29382c,1,{map:TEX.plaster}));mould.scale.set(1.8,.55,.24);mould.position.set(side*(11.55-Math.random()*.03),.8+Math.random()*2.5,-8+Math.random()*16);z.group.add(mould);}
  }
  for(let i=0;i<8;i++){const beam=addBox(z.group,-10+i*2.85,3.73,0,.16,.28,19,M.darkWood);beam.rotation.z=(Math.random()-.5)*.025;}
  addLight(z.group, 0xff3a22, 1.1, 9, -5, 3.3, 3); addLight(z.group, 0xff3a22, .9, 8, 5, 3.2, -3);
  addBox(z.group, -5, 3.45, 3, .14, .2, .14, M.black); addBox(z.group, 5, 3.45, -3, .14, .2, .14, M.black);
  addLook(z.group,11.2,3.0,-3,'East window','Outside: a larger fire, a ring of figures turning slowly, and a body suspended from a post. Someone has written a number on the glass: 13.');
  addDistantRitual(z.group, 30, -3.4);
  addDistantRitual(z.group, 32, 4.5);
  // Meat rails and overhead hoists; carcasses are sculptural, not realistic gore.
  addBox(z.group,0,3.38,-1.6,19,.16,.18,M.rust);addBox(z.group,0,3.05,-1.6,19,.08,.08,M.metal);
  const carcasses=[];[-6.5,-2.2,2.2,6.5].forEach((x,i)=>carcasses.push(addHangingCarcass(z.group,x,-1.4,i*.7)));
  const overhead=addLight(z.group,0xe1d4b4,1.4,13,0,3.8,1.3);overhead.position.y=3.7;
  // The room contains manifestos that contradict each other, by design.
  // The cult leader is hidden at the far end; his face is turned away until spoken to.
  const leader=makeNPC(z.group,0,-7.2,'The First',0x171716,1);leader.object.rotation.y=Math.PI;if(leader.head)leader.head.material=headMaterial();leader.object.visible=false;storyRef.first=leader;leader.dialogue={line:'Man would rather will nothingness than not will. The room was not empty; we were taking up too much space.',choices:['Remove the tape.','Give me your place.'],replies:['There is no tape to remove. The machine turns without a reel.','The place is not mine. It is what remains when you give up your name.']};
  const eventMarker=new THREE.Mesh(new THREE.BoxGeometry(.34,.14,.34),M.clue);eventMarker.position.set(0,.12,1.7);z.group.add(eventMarker);
  z.interactables.push({id:'abattoir_ropes',type:'event',object:eventMarker,point:eventMarker.position,radius:3.0,prompt:'[ E ] CHOOSE WHAT TO DO WITH THE HOOKS',run:()=>{
    controls.unlock();dialogueOpen=true;$('speaker').textContent='THE ROOM / THE FOUR BODIES';$('subtitle').textContent='The chains are under tension. A voice comes from the floor: “If you free them, the room is left without witnesses. If you leave them, you become part of the inventory.” When you look again, one of the bodies has changed position.';speakVoice($('subtitle').textContent,'THE ROOM');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='';
    [['CUT THE CHAINS','release'],['LEAVE EVERYTHING AS IT IS','keep']].forEach(([label,id])=>{const b=document.createElement('button');b.className='dialogue-option';b.textContent=label;b.onclick=()=>{storyFlags.add(id==='release'?'released':'complicit');storyFlags.add('carcasses-decided');if(id==='release'){carcasses[1].rotation.z=.8;carcasses[1].position.y=-.3;audio?.mechanicalEvent('hoist');fear=Math.min(1,fear+.2);scheduleCultSceneFates(2,'the chains','collapse');}else{carcasses[0].rotation.z=.42;storyFlags.add('leader-trust');scheduleCultSceneFates(2,'the silence of the hooks','vanish');}if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;glitchPulse=1.3;$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),220);requestMouseLock();showToast(id==='release'?'THE IRON IS FREE. THE BODIES ARE NOT.':'THE MACHINE KEEPS TURNING.');updateMissions();};$('dialogue-options').appendChild(b);});
  }});
  // A passage that returns the player to the same room from the wrong direction.
  const loopMarker=new THREE.Mesh(new THREE.BoxGeometry(.4,.12,.4),M.gold);loopMarker.position.set(-8,.1,6.8);z.group.add(loopMarker);
  z.interactables.push({id:'impossible_threshold',type:'event',object:loopMarker,point:loopMarker.position,radius:2.6,prompt:'[ E ] CROSS THE SEWN THRESHOLD',run:()=>{playerAnchor.position.set(8.4,0,-6.8);camera.rotation.y+=Math.PI;glitchPulse=1.35;audio?.mechanicalEvent('latch');showToast('YOU ENTERED THROUGH THE SAME DOOR. THE DUST IS ON THE OTHER SIDE.');storyFlags.add('crossed-impossible');}});
  addWoodTable(z.group,-7.6,-7.2,1.3,.7,.8,77);addClueMesh(z.group,new THREE.Vector3(-7.6,.8+.8*.045+.025,-7.2),'Slaughterhouse Ledger','The ledger records no animals purchased. It records thirteen names, each crossed out after a single time: 03:17.','butcher-ledger','book');
  const ledgerEntry = z.interactables.find(item => item.id === 'butcher-ledger');
  if (ledgerEntry) ledgerEntry.radius = 4.2;
  addDoor(z.group,0,9.85,'the road','road',[27,0,29]);
  z.mist=addFog(z.group,32,27,0x8b8177,113);
  z.solids.push({minX:-12,maxX:-11.7,minZ:-10,maxZ:10},{minX:11.7,maxX:12,minZ:-10,maxZ:10},{minX:-12,maxX:12,minZ:-10.2,maxZ:-9.8},{minX:-12,maxX:-4.5,minZ:9.7,maxZ:10},{minX:4.5,maxX:12,minZ:9.7,maxZ:10});
  z.carcasses=carcasses;return z;
}

function buildCellar() {
  const z = newZone('cellar', 0x171713, .062, { minX: -9, maxX: 9, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  addBox(z.group, 0, -.15, 0, 18, .3, 16, M.darkWood);
  addBox(z.group, -9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 0, 1.8, -8, 18, 3.6, .3, M.darkWall); addBox(z.group, -4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall); addBox(z.group, 4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall);
  // Old cellar joists, posts, damp masonry and a long empty table.
  const cellarBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.4),M.brick);cellarBrick.position.set(0,1.2,-7.78);z.group.add(cellarBrick);
  for (let i = 0; i < 8; i++) { addBox(z.group, -8 + i * 2.25, 3.05, 0, .18, .2, 16, M.wood); }
  for (let x of [-7, 0, 7]) for (let zz of [-5, 0, 5]) addBox(z.group, x, 1.7, zz, .22, 3.4, .22, M.darkWood);
  addWoodTable(z.group,0,-1.0,12.8,1.12,.70,71);
  addCandle(z.group, -2, .62, -1, true, false);
  addCandle(z.group, 2, .62, -1, true, false);
  addLook(z.group,0,1.2,-4.2,'The lamp','An iron lamp above the platter. It is warm. It should not be: the power has been cut for three days.');
  // The artificial sun: harsh light in an otherwise unlit room.
  addBox(z.group, 0, 3.15, -4.8, 1.1, .16, .55, M.warmLight);
  addLight(z.group, 0xffb451, 5.8, 15, 0, 2.95, -4.3, { shadow: true, decay: 1.45 });
  // Turntable and the blank acetate. No record audio exists in this game.
  const turntableCabinet=roundedHousing(2.18,.92,1.78,.14,M.darkWood,.05);turntableCabinet.position.set(0,.88,-2.2);z.group.add(turntableCabinet);
  const plinthTop=roundedHousing(2.08,.065,1.66,.09,mat(0x24231f,.62,{metalness:.28}),.025);plinthTop.position.set(0,1.38,-2.2);z.group.add(plinthTop);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(.59, .59, .07, 48), M.metal); platter.position.set(0, 1.49, -2.2); z.group.add(platter);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.51,.51,.018,64),mat(0x111210,.24,{metalness:.45}));disc.position.set(0,1.54,-2.2);z.group.add(disc);
  const voidGrowth=new THREE.Group();voidGrowth.visible=false;voidGrowth.scale.setScalar(.001);z.group.add(voidGrowth);storyRef.voidGrowth=voidGrowth;
  const rootMat=mat(0x313b2d,.98,{map:TEX.wood,bumpScale:.12});
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2;const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(Math.cos(a)*.48,.035,-2.2+Math.sin(a)*.48),new THREE.Vector3(Math.cos(a)*1.35,.045,-2.2+Math.sin(a)*1.2),new THREE.Vector3(Math.cos(a)*3.1,.06,-2.2+Math.sin(a)*2.2),new THREE.Vector3(Math.cos(a)*5.9,.09,-2.2+Math.sin(a)*3.6)]);voidGrowth.add(new THREE.Mesh(new THREE.TubeGeometry(curve,30,.05,6,false),rootMat));}
  for(let i=0;i<34;i++){const a=i*2.399,r=1+(i%7)*.72;const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.22+(i%3)*.07,.075),new THREE.MeshStandardMaterial({color:[0x596246,0x343f2d,0x77704d][i%3],roughness:1,side:THREE.DoubleSide,transparent:true,opacity:.92}));leaf.position.set(Math.cos(a)*r,.10+(i%4)*.05,-2.2+Math.sin(a)*r*.66);leaf.rotation.set(-.4,a,.1);voidGrowth.add(leaf);}
  const label = new THREE.Mesh(new THREE.CircleGeometry(.115, 32), mat(0xd1caba, .9)); label.rotation.x = -Math.PI / 2; label.position.set(0, 1.555, -2.2); z.group.add(label);
  const armBase=new THREE.Mesh(new THREE.CylinderGeometry(.09,.10,.09,18),M.gold);armBase.position.set(.77,1.49,-2.0);z.group.add(armBase);
  const tonearmCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(.77,1.57,-2.0),new THREE.Vector3(.68,1.64,-2.05),new THREE.Vector3(.46,1.64,-2.12),new THREE.Vector3(.27,1.62,-2.25)]);z.group.add(new THREE.Mesh(new THREE.TubeGeometry(tonearmCurve,20,.025,7,false),M.gold));
  const stylus=new THREE.Mesh(new THREE.ConeGeometry(.035,.12,7),M.rust);stylus.position.set(.27,1.57,-2.25);stylus.rotation.z=Math.PI;z.group.add(stylus);
  // The 1970s transport keeps turning with no tape threaded through its guides.
  const reelDeck=buildReelRecorder(z.group,-6.15,0,-2.65,.82);storyRef.cellarReelDeck=reelDeck;
  // Thirteen individually turned chairs. Their empty places are part of the ritual.
  for(let i=0;i<13;i++){const a=i/13*Math.PI*2,x=Math.cos(a)*5.0,zz=Math.sin(a)*4.1+.3;addWoodChair(z.group,x,zz,-a+Math.PI,.92+(i%3)*.025);}

  // A human outline that could be a coat on a hook.
  const hanging=makeNPC(z.group,-7.0,-4.9,'The Coat',0x141614,1);hanging.object.scale.set(.72,1.12,.72);hanging.prompt='[ E ] EXAMINE — THE COAT';
  hanging.dialogue={line:'The sleeves are still warm. There is nobody inside.',choices:['Who left it here?','Do not touch it.'],replies:['The person who borrows other people’s clothes when he is cold.','It has already been touched. From the side you cannot see.']};
  addDoor(z.group, 0, 7.95, 'the stairs', 'home', [7.5, 0, -5.2]);
  const darkDoor=addDoor(z.group,8.25,0,'the dark room','darkroom',[0,0,9.3],true,{rotationY:Math.PI/2,style:'hatch'});darkDoor.requiresFlag='altar-lit';darkDoor.blockedHint='The three altar candles must be lit before the side door will open.';darkDoor.prompt='[ E ] ENTER THE DARK ROOM';
  const turntableEntry = { id: 'listen', type: 'listen', object: disc, point: disc.position, radius: 3.0, prompt: '[ E ] LISTEN TO THE WHITE', title: 'The White', requiresFlag:'darkroom-cleared', blockedHint:'The room has not been searched. Find what the recording contains before you listen.' };
  z.interactables.push(turntableEntry);
  z.mist = addFog(z.group, 18, 22, 0x8d8c7d, 92);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -8, maxZ: 8 }, { minX: 8.7, maxX: 9, minZ: -8, maxZ: 8 }, { minX: -9, maxX: -4.5, minZ: -8.2, maxZ: -8 }, { minX: 4.5, maxX: 9, minZ: -8.2, maxZ: -8 }, { minX: -9, maxX: -4.6, minZ: 7.7, maxZ: 8 }, { minX: 4.6, maxX: 9, minZ: 7.7, maxZ: 8 });
  return z;
}

function buildDarkroom(){
  const z=newZone('darkroom',0x030404,.115,{minX:-10,maxX:10,minZ:-12,maxZ:12},[0,0,9.2]);
  z.ambient.intensity=.055;z.moon.intensity=.035;
  const floorMat=mat(0x171714,.98,{map:TEX.concrete,bumpScale:.16});addBox(z.group,0,-.14,0,20,.28,24,floorMat);
  const wallMat=mat(0x262723,1,{map:TEX.plaster,bumpScale:.17});
  addBox(z.group,-10,2,0,.32,4,24,wallMat);addBox(z.group,10,2,0,.32,4,24,wallMat);
  addBox(z.group,0,2,-12,20,4,.32,wallMat);
  addBox(z.group,-5.9,2,12,8.2,4,.32,wallMat);addBox(z.group,5.9,2,12,8.2,4,.32,wallMat);
  // The room is a furniture maze, not a corridor kit: tables, chairs and papers make the route.
  const partitions=[
    [-5.4,5.2,.24,9.0],[-1.0,1.7,.24,7.8],[4.7,4.0,.24,8.4],
    [0,-3.1,8.8,.24],[-5.9,-7.3,7.8,.24],[5.6,-8.1,8.5,.24],
    [-7.4,-1.7,.24,5.3],[7.5,1.5,.24,5.6]
  ];
  for(const [x,zp,w,d] of partitions){
    const h=3.3,seg=addBox(z.group,x,h/2,zp,w,h,d,wallMat);
    z.solids.push({minX:x-w/2,maxX:x+w/2,minZ:zp-d/2,maxZ:zp+d/2});
    // Small flaked plaster and water marks give the partitions a lived-in, damp surface.
    for(let k=0;k<5;k++){const stain=new THREE.Mesh(new THREE.SphereGeometry(.18+Math.random()*.18,7,6),mat(k%2?0x30342d:0x403c32,1,{map:TEX.plaster}));stain.scale.set(1.4,.55,.10);stain.position.set(x+(Math.random()-.5)*w, .45+Math.random()*2.2, zp+(Math.random()-.5)*d);z.group.add(stain);}
  }
  // The chair backs and table edges hide the next turn until the lamp reaches them.
  const chairSpots=[[-7,8.0,.1],[-3.2,6.3,1.1],[1.8,7.0,-.7],[6.5,7.2,2.3],[-7,1.7,-1.2],[-3.2,-1.1,2.7],[2.2,-.8,-1.5],[7,-3.6,2.2],[-6.2,-8.4,.3],[0,-8.5,2.1],[5.8,-8.4,-1.1],[2.6,3.5,1.1]];
  chairSpots.forEach(([x,zp,r],i)=>{const ch=addWoodChair(z.group,x,zp,r,.88+(i%3)*.05);ch.userData.mazeChair=true;});
  addWoodTable(z.group,-7.1,4.0,2.15,.92,.74,41);
  addWoodTable(z.group,-1.5,-1.8,2.0,1.0,.72,43);
  addWoodTable(z.group,5.8,2.7,2.1,1.0,.74,47);
  addWoodTable(z.group,1.5,-8.7,2.35,1.0,.76,53);
  // A single dying utility lamp is wired to nothing. It does not light the maze.
  const deadLamp=new THREE.Group();deadLamp.position.set(0,3.2,-1);z.group.add(deadLamp);
  const shade=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0,0),new THREE.Vector2(.18,.04),new THREE.Vector2(.31,.18),new THREE.Vector2(.28,.22)],18),M.rust);shade.position.y=.05;deadLamp.add(shade);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.018,.02,.58,8),M.darkWood);stem.position.y=-.28;deadLamp.add(stem);
  const deadBulb=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),mat(0x171614,.9));deadBulb.position.y=-.62;deadLamp.add(deadBulb);
  // Six real objects form the evidence chain. The beam reveals their surfaces; the journal preserves what it reveals.
  const heater=buildGasHeater(z.group,-7.4,0,8.8,.92);
  const heaterPoint=new THREE.Vector3(-7.4,1.15,8.8);
  addLoreProp(z,'dark-heater','The radiant heater','A portable LPG radiant heater: perforated steel hood, ceramic burner panels, a lower guard and four small castors. The gas hose is still attached. A maintenance tag reads: FLUE / AIR INTAKE — BLOCKED. The report never names carbon monoxide. It records a room that was not ventilated, thirteen bodies and a clock stopped at 03:17.','dark-heater',heater,heaterPoint,'[ E ] EXAMINE THE HEATER');
  const plugCase=buildEarplugCase(z.group,6.1,.78,3.1);
  addLoreProp(z,'dark-earplugs','The earplug case','A small brass case contains two soft wax plugs. The lid is engraved with a single initial: C. A note inside says: “Wear them before the first revolution. Stay to watch.” Il Professore watched every collapse and never had to hear one.','dark-earplugs',plugCase,new THREE.Vector3(6.1,1.05,3.1),'[ E ] OPEN THE EARPLUG CASE');
  const book=buildPaperback(z.group,-1.7,.77,-1.8);
  addLoreProp(z,'dark-book','The paperback','A battered Nietzsche paperback. It is almost entirely underlined. The margins contain only durations: 4.2 seconds, 7.1 seconds, 11 seconds. “Man would rather will nothingness than not will.” The sentence is copied as an instruction. No sentence in the book tells anyone to push.','dark-book',book,new THREE.Vector3(-1.7,1.0,-1.8),'[ E ] READ THE PAPERBACK');
  const recorder=buildReelRecorder(z.group,-1.8,0,-8.6);
  addLoreProp(z,'dark-reel','The empty transport','Two reels turn. No tape is threaded through the guides. The red RECORD lamp is on; both VU needles remain below zero. The heads touch nothing. There is no music to recover — only the room tone around a machine that continues to turn.','dark-reel',recorder,new THREE.Vector3(-1.8,1.1,-8.6),'[ E ] EXAMINE THE REEL DECK');
  const reportTable=addWoodTable(z.group,7.1,7.1,2.3,1.05,.76,67);
  const report=new THREE.Group();report.position.set(7.0,.82,7.1);z.group.add(report);
  const folder=roundedHousing(.54,.035,.38,.035,mat(0x6b5942,.98),.01);folder.position.y=.015;report.add(folder);
  const sheet=new THREE.Mesh(new THREE.PlaneGeometry(.48,.32),new THREE.MeshBasicMaterial({map:makeLabelTexture('WINTER 1977\\n13 / 03:17\\nCAUSE: UNDETERMINED',512,320),side:THREE.DoubleSide}));sheet.rotation.x=-Math.PI/2;sheet.position.y=.04;report.add(sheet);
  addLoreProp(z,'dark-report','The coroner’s copy','A carbon copy from the winter of 1977. Thirteen names, a church, a room heater and thirteen times written as 03:17. “Cause undetermined” is stamped twice. A handwritten note adds: “the window latches were sealed from the inside.” It is evidence, not a verdict.','dark-report',report,new THREE.Vector3(7.0,1.0,7.1),'[ E ] READ THE CARBON COPY');
  const glyphWall=new THREE.Group();glyphWall.position.set(9.72,0,-6.0);glyphWall.rotation.y=-Math.PI/2;z.group.add(glyphWall);
  const glyphMat=mat(0x968b70,.95,{emissive:0x17120b,emissiveIntensity:.08});
  const glyphPaths=[
    [[0,0],[0,.55],[.22,.72]],[[0,.1],[.22,.48],[.42,.1]],[[.1,0],[.1,.72],[.38,.72]],
    [[0,0],[.35,.7],[.7,0]],[[0,.2],[.35,.2],[.35,.7]],[[.1,0],[.42,.32],[.1,.7]],
    [[0,0],[.3,.0],[.3,.7],[0,.7]],[[0,.7],[.2,.35],[.42,.7]],[[0,.35],[.42,.35],[.2,0],[.2,.7]],
    [[0,0],[.42,.7]],[[0,.7],[.42,0],[.42,.7]],[[.2,0],[.2,.7],[0,.35],[.42,.35]],
    [[0,.0],[.42,.7],[.42,0]],[[.42,.7],[.1,.35],[.42,0]]
  ];
  glyphPaths.forEach((path,i)=>{const glyph=new THREE.Group();glyph.position.set(-4.9+i*.72,1.0,0);path.slice(1).forEach((p,j)=>tubeBetween(glyph,[path[j][0]-.2,path[j][1]-.35,.018],[p[0]-.2,p[1]-.35,.018],.018,glyphMat,6));glyphWall.add(glyph);});
  for(let i=0;i<13;i++){const dot=new THREE.Mesh(new THREE.SphereGeometry(.026,6,5),M.gold);dot.position.set(-4.9+i*.72,.74,.02);glyphWall.add(dot);}
  const reversed=new THREE.Group();reversed.position.set(5.0,1.0,.025);reversed.scale.x=-1;reversed.add(new THREE.Mesh(new THREE.TorusGeometry(.18,.018,5,16),glyphMat));glyphWall.add(reversed);
  addLoreProp(z,'dark-script','The fourteen marks','Fourteen signs have been scratched into the plaster. They resemble an alphabet but do not match any hand you know. Thirteen face the same way. The last is reversed, like a station turned back toward the person who is meant to occupy it. There is no translation. There is only a place left open.','dark-script',glyphWall,new THREE.Vector3(8.9,1.25,-6.0),'[ E ] STUDY THE FOURTEENTH MARK');
  const returnDoor=addDoor(z.group,0,11.78,'the cellar','cellar',[0,0,5.4],true,{style:'hatch'});returnDoor.requiresFlag='darkroom-cleared';returnDoor.blockedHint='The room is not finished with you. Find all six pieces of evidence first.';
  returnDoor.prompt='[ E ] RETURN TO THE CELLAR';
  z.mist=addFog(z.group,18,26,0x151613,156);z.fog=new THREE.FogExp2(z.fogColor,z.density);
  z.solids.push({minX:-10,maxX:-9.7,minZ:-12,maxZ:12},{minX:9.7,maxX:10,minZ:-12,maxZ:12},{minX:-10,maxX:-1.4,minZ:11.7,maxZ:12},{minX:1.4,maxX:10,minZ:11.7,maxZ:12},{minX:-10,maxX:10,minZ:-12.2,maxZ:-12});
  // Il Professore is a moving absence. The light catches him; the dark lets him move.
  const hunter=makeNPC(z.group,7.7,-9.5,'The First',0x171614,1);
  const idx=z.interactables.findIndex(item=>item===hunter);if(idx>=0)z.interactables.splice(idx,1);
  hunter.object.visible=false;hunter.object.scale.set(.92,1.04,.86);hunter.object.rotation.y=Math.PI;
  hunter.dialogue={line:'You found the room. It was waiting before you were born.',choices:['What is on the tape?','Why are you following me?'],replies:['The same thing that was here before the tape: a room.','I am not following you. I am keeping the distance at which you can still choose.']};
  storyRef.darkroomHunter=hunter;darkroomHunt={active:false,elapsed:0,reappear:0,lastFlash:0};
  return z;
}
buildRoad(); buildHome(); buildChurch(); buildRuin(); buildAbattoir(); buildCellar(); buildDarkroom(); buildStoryExtras();

// The cellar is deliberately inaccessible until all eight traces have been read.
const abattoirEntrance = zones.road.interactables.find(i => i.destination === 'abattoir');
if (abattoirEntrance) abattoirEntrance.requiredClues = 7;
const cellarDoor = zones.home.interactables.find(i => i.destination === 'cellar');
if (cellarDoor) cellarDoor.requiredClues = clueCount;

// All collectibles and progress are per-playthrough. Old clue saves are
// discarded on load; a fresh visit always begins with every clue and relic present.
const EVIDENCE_SAVE_KEY = 'epistassi-evidence-v1';
clearSavedEvidence();

function enterZone(name, spawn) {
  footstepDistance = 0;
  Object.values(zones).forEach(v => { v.group.visible = false; });
  zone = zones[name]; currentZone = name; zone.group.visible = true;
  playerAnchor.position.set(spawn[0], 0, spawn[2]);
  camera.position.set(0, 1.63, 0);
  velocity.set(0, 0, 0);
  scene.fog = zone.fog || new THREE.FogExp2(zone.fogColor, zone.density);
  scene.background.set(zone.fogColor);
  $('location').textContent = ({ road: 'FOG ROAD', home: 'THE HOUSE / THIRTEEN PLACES', church: 'THE DECONSECRATED CHURCH', ruin: 'THE EMPTY HOUSE', cellar: 'THE CELLAR / 14-B', darkroom: 'THE DARK ROOM / 14-B', abattoir: 'THE SLAUGHTERHOUSE / THE VOID ROOM', forest: 'THE CANAL FOREST' })[name];
  glitchPulse = Math.max(glitchPulse, .42); audio?.stinger(.32); audio?.setZone(name); if(name==='abattoir'){fear=Math.min(1,fear+.19);audio?.mechanicalEvent('hoist');} if(name==='church' && collected.size>=2 && !scenePlayed) showToast('THE BELL ROPE IS WET.'); if(name==='cellar'||name==='darkroom'){fear=Math.min(1,fear+.18);} if(name==='darkroom'){darkroomHunt.active=!noEnemies()&&!storyFlags.has('darkroom-cleared');if(noEnemies()&&storyRef.darkroomHunter?.object)storyRef.darkroomHunter.object.visible=false;if(!storyFlags.has('darkroom-entered')){storyFlags.add('darkroom-entered');darkroomHunt.elapsed=0;darkroomHunt.reappear=3.2;startMonologue(['Il Professore: The lamp is not a weapon. It is a question you can only ask in one direction.','Voice: The room is full. You cannot see what it contains.','Il Professore: Find what the tape cannot carry. Do not mistake being watched for being seen.'],13);}}
  showToast(({ road: 'THE ROAD IS NOT WHERE YOU LEFT IT', home: 'NO ONE ASKED YOUR NAME', church: 'THE NAVE IS LONGER FROM THE INSIDE', ruin: 'SOMEONE IS WAITING BY THE TELEPHONE', cellar: 'THE ROOM HAS KEPT ITS HEAT', darkroom: 'THE DARK HAS BEEN ARRANGED BY HAND', forest: 'THE FOREST KEEPS YOUR POSITION', abattoir: 'HERE THE FLESH HAS A LONG MEMORY' })[name]);
  placeStalker(name); showChapterCard(name);
}
function currentPosition() { return playerAnchor.position; }
function playerInputEnabled() { return gameStarted && !gameEnded && !listeningPending && !doorTransitioning && !cultFateActive && !dialogueOpen && !journalOpen && !settingsOpen && (!storyScene || storyScene.type === 'hold'); }

// -----------------------------------------------------------------------------
// Sound: entirely synthesised, layered and intentionally non-musical.
// -----------------------------------------------------------------------------
class AmbientSound {
  constructor() {
    this.ctx = null; this.master = null; this.noiseGain = null; this.droneGain = null;
    this.nodes = []; this.ready = false; this.zoneGain=null; this.pulseGain=null; this.currentZone='road';
    this.musicTracks = {
      mysterious: this.createMusicTrack('mysterious', './assets/mysterious.m4a', .82),
      fort: this.createMusicTrack('fort', './assets/fort.mp3', .78),
      dot: this.createMusicTrack('dot', './assets/dot.mp3', .76),
      zero: this.createMusicTrack('zero', './assets/zero.mp3', .76)
    };
    this.activeMusic = null;
    this.duck = 1; this.samples = {}; this.samplesRequested = false;
  }
  // Music level = the track's own mix level x master x music slider (x a temporary duck during cutscenes).
  musicLevel(track) { return Math.min(1, (track?.targetVolume ?? .8) * SETTINGS.master * SETTINGS.music * this.duck); }
  effectsLevel() { return muted ? 0 : .78 * SETTINGS.master * SETTINGS.sfx; }
  applyVolumes() {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.effectsLevel(), this.ctx.currentTime, .06);
    Object.values(this.musicTracks).forEach(track => { if (track.active) this.fadeMusicTrack(track, this.musicLevel(track), .25, false); });
  }
  setDuck(v, seconds = 1.2) { this.duck = v; this.applyVolumesSoon = true; Object.values(this.musicTracks).forEach(track => { if (track.active) this.fadeMusicTrack(track, this.musicLevel(track), seconds, false); }); }
  createMusicTrack(name, src, targetVolume) {
    const element = new Audio(src);
    element.preload = 'auto';
    element.volume = 0;
    const track = { name, element, targetVolume, active: false, loop: true, fadeAtEnd: false, fadeToken: 0, loopFade: 1.8 };
    element.addEventListener('timeupdate', () => {
      if (!track.active || !track.loop || track.fadeAtEnd || !Number.isFinite(element.duration)) return;
      const remaining = element.duration - element.currentTime;
      const fade = Math.min(track.loopFade, Math.max(.45, element.duration * .065));
      if (remaining <= fade && remaining > .04) {
        track.fadeAtEnd = true;
        this.fadeMusicTrack(track, 0, remaining, false);
      }
    });
    element.addEventListener('ended', () => {
      if (!track.active || !track.loop) return;
      track.fadeAtEnd = false;
      element.currentTime = 0;
      const result = element.play();
      if (result && typeof result.then === 'function') {
        result.then(() => { if (track.active && this.activeMusic === track) this.fadeMusicTrack(track, this.musicLevel(track), 1.25, false); })
          .catch(error => console.warn('Music loop could not restart:', name, error));
      } else this.fadeMusicTrack(track, this.musicLevel(track), 1.25, false);
    });
    element.addEventListener('error', () => console.warn('Music file could not be loaded:', src, element.error));
    return track;
  }
  safeMusicVolume(track, value) {
    if (!track?.element) return;
    const safeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    try {
      track.element.volume = safeValue;
    } catch (error) {
      // A browser or OS audio restriction must never interrupt gameplay.
      console.warn('Could not set music volume:', track.name, error);
      track.active = false;
      track.loop = false;
      track.element.pause();
      if (this.activeMusic === track) this.activeMusic = null;
    }
  }
  fadeMusicTrack(track, target, duration = 1.6, pauseWhenDone = false) {
    if (!track?.element) return;
    const element = track.element;
    const rawFrom = Number(element.volume);
    const from = Number.isFinite(rawFrom) ? Math.min(1, Math.max(0, rawFrom)) : 0;
    const rawTarget = muted ? 0 : Number(target);
    const to = Number.isFinite(rawTarget) ? Math.min(1, Math.max(0, rawTarget)) : 0;
    const rawDuration = Number(duration);
    const seconds = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;
    const token = ++track.fadeToken;
    const started = performance.now();
    if (seconds <= .02) {
      this.safeMusicVolume(track, to);
      if (pauseWhenDone && to === 0) {
        element.pause();
        try { element.currentTime = 0; } catch (_) {}
        track.active = false;
        track.fadeAtEnd = false;
        if (this.activeMusic === track) this.activeMusic = null;
      }
      return;
    }
    const tick = now => {
      if (token !== track.fadeToken || !track.active && !pauseWhenDone) return;
      const stamp = Number.isFinite(now) ? now : performance.now();
      const rawK = (stamp - started) / (seconds * 1000);
      const k = Number.isFinite(rawK) ? Math.min(1, Math.max(0, rawK)) : 1;
      const value = from + (to - from) * k;
      this.safeMusicVolume(track, value);
      if (k < 1 && (track.active || pauseWhenDone)) track.fadeFrame = requestAnimationFrame(tick);
      else if (pauseWhenDone && to === 0) {
        element.pause();
        try { element.currentTime = 0; } catch (_) {}
        track.active = false;
        track.fadeAtEnd = false;
        if (this.activeMusic === track) this.activeMusic = null;
      }
    };
    track.fadeFrame = requestAnimationFrame(tick);
  }
  playMusic(name, { loop = true, fadeIn = 2.0 } = {}) {
    const track = this.musicTracks[name];
    if (!track) return;
    if (this.activeMusic === track && !track.element.paused) return;
    const previous = this.activeMusic;
    if (previous && previous !== track) {
      previous.active = false;
      previous.loop = false;
      previous.fadeAtEnd = false;
      this.fadeMusicTrack(previous, 0, 2.0, true);
    }
    track.active = true;
    track.loop = loop;
    track.fadeAtEnd = false;
    this.activeMusic = track;
    if (track.element.ended || track.element.currentTime >= (Number.isFinite(track.element.duration) ? track.element.duration : Infinity)) {
      track.element.currentTime = 0;
    }
    const result = track.element.play();
    if (result && typeof result.then === 'function') {
      result.then(() => { if (track.active && this.activeMusic === track) this.fadeMusicTrack(track, this.musicLevel(track), fadeIn, false); })
        .catch(() => { /* Browsers may block title autoplay until the first user gesture. */ });
    } else this.fadeMusicTrack(track, this.musicLevel(track), fadeIn, false);
  }
  playTitleMusic() { this.playMusic('mysterious', { loop: true, fadeIn: 2.2 }); }
  stopMusic(name, fadeOut = 1.8) {
    const track = this.musicTracks[name];
    if (!track) return;
    track.active = false;
    track.loop = false;
    track.fadeAtEnd = false;
    if (this.activeMusic === track) this.activeMusic = null;
    this.fadeMusicTrack(track, 0, fadeOut, true);
  }
  async start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master = this.ctx.createGain(); this.master.gain.value = this.effectsLevel();
    const low = this.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 130; low.gain.value = 9;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 3.2; comp.attack.value = .02; comp.release.value = .3;
    this.master.connect(low); low.connect(comp); comp.connect(this.ctx.destination);
    // A shared convolution reverb: the church rings for seconds, the cellar is close and damp, outside is dry.
    this.reverb = this.ctx.createConvolver(); this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = .0;
    this.reverb.buffer = this.makeImpulse(3.4, 2.6); this.reverbSend.connect(this.reverb); this.reverb.connect(this.master);
    // Earplug / muffling filter for the cemetery egg and the 'sound removed' station: every effect passes through it.
    this.muffle = this.ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = .4;
    this.master.disconnect(); this.master.connect(this.muffle); this.muffle.connect(low);
    this.loadSamples();
    // Brown-noise bed with a moving band-pass: wind, room tone, tape hiss.
    const size = this.ctx.sampleRate * 3; const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate); const data = buffer.getChannelData(0); let last = 0;
    for (let i = 0; i < size; i++) { const white = Math.random() * 2 - 1; last = (last + .025 * white) / 1.025; data[i] = last * 3.1; }
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 620;
    const hiss = this.ctx.createGain(); hiss.gain.value = .20; src.connect(filter); filter.connect(hiss); hiss.connect(this.master); src.start();
    this.nodes.push(src, filter, hiss);
    this.noiseGain = hiss;
    // Inharmonic low drone; no melody and no representation of the forbidden record.
    this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = .15; this.droneGain.connect(this.master);
    this.zoneGain=this.ctx.createGain();this.zoneGain.gain.value=.10;this.zoneGain.connect(this.master);
    this.pulseGain=this.ctx.createGain();this.pulseGain.gain.value=.025;this.pulseGain.connect(this.master);
    [55, 58.27, 82.41, 110.8].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.value = [.33, .065, .035, .025][i];
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = .05 + i * .027;
      const lg = this.ctx.createGain(); lg.gain.value = .5 + i * .17; lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(this.droneGain); o.start(); lfo.start(); this.nodes.push(o, g, lfo, lg);
    });
    // A detuned, unstable metallic cluster: bowed iron rather than a conventional score.
    [41.2,43.7,61.7,92.5,117.3].forEach((f,i)=>{const o=this.ctx.createOscillator();o.type=i%2?'sawtooth':'triangle';o.frequency.value=f;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=170+i*115;filter.Q.value=2.4;const g=this.ctx.createGain();g.gain.value=[.012,.009,.006,.004,.003][i];o.connect(filter);filter.connect(g);g.connect(this.zoneGain);o.start();this.nodes.push(o,filter,g);});
    const pulse=this.ctx.createOscillator();pulse.type='square';pulse.frequency.value=.17;const pg=this.ctx.createGain();pg.gain.value=12;pulse.connect(pg);pg.connect(this.pulseGain.gain);pulse.start();this.nodes.push(pulse,pg);
    this.ready = true; this.setZone('road'); this.scheduleKnock(); this.scheduleMechanical();
  }
  scheduleKnock() {
    if (!this.ready || !this.ctx) return;
    const delay = 9000 + Math.random() * 18000;
    setTimeout(() => { if (this.ready && !muted) this.knock(); this.scheduleKnock(); }, delay);
  }
  knock() {
    if (!this.ctx || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(76 + Math.random() * 32, t); o.frequency.exponentialRampToValueAtTime(32, t + .8);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.22, t + .035); g.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.15);
  }
  stinger(intensity = .4) {
    if (!this.ctx || !this.ready || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180 + Math.random() * 110, t); o.frequency.exponentialRampToValueAtTime(42, t + .55);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18 * intensity, t + .025); g.gain.exponentialRampToValueAtTime(.0001, t + .7);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 510; f.Q.value = .8;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + .72);
  }
  setTension(v) { if (this.droneGain && this.ctx) {this.droneGain.gain.setTargetAtTime(.10 + v * .25, this.ctx.currentTime, .7); if(this.pulseGain)this.pulseGain.gain.setTargetAtTime(.018+v*.10,this.ctx.currentTime,.8);} }
  setZone(name){
    if(!this.ready||!this.ctx)return;
    this.currentZone=name;
    const vals={road:.055,forest:.07,home:.11,church:.16,ruin:.20,cellar:.28,darkroom:.30,abattoir:.32};
    this.zoneGain.gain.setTargetAtTime(vals[name]??.1,this.ctx.currentTime,1.8);this.setReverb(name);
    this.noiseGain.gain.setTargetAtTime(({road:.13,forest:.14,home:.2,church:.17,ruin:.26,cellar:.32,darkroom:.34,abattoir:.38})[name]??.18,this.ctx.currentTime,1.5);

    // Music follows the location and the story phase. The cellar gets its own
    // score only on the return after the Professore's tea scene, before the final listen.
    let desiredTrack = null;
    if (!gameEnded && (name === 'road' || name === 'forest')) desiredTrack = 'mysterious';
    else if (!gameEnded && name === 'abattoir') desiredTrack = 'fort';
    else if (!gameEnded && name === 'darkroom') desiredTrack = 'zero';
    else if (!gameEnded && name === 'cellar' && storyFlags.has('first-tea') && !storyFlags.has('listened-to-white')) desiredTrack = 'dot';

    if (desiredTrack) this.playMusic(desiredTrack, {loop:true,fadeIn:2.2});
    else if (this.activeMusic) this.stopMusic(this.activeMusic.name,2.0);
  }
  powerSurge(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(38,t);o.frequency.exponentialRampToValueAtTime(430,t+.35);o.frequency.exponentialRampToValueAtTime(27,t+1.1);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.25,t+.04);g.gain.exponentialRampToValueAtTime(.0001,t+1.3);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+1.35);}
  killSting(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();o.type='sawtooth';o.frequency.setValueAtTime(260,t);o.frequency.exponentialRampToValueAtTime(24,t+2.6);f.type='lowpass';f.frequency.value=500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.38,t+.08);g.gain.exponentialRampToValueAtTime(.0001,t+3);o.connect(f);f.connect(g);g.connect(this.master);o.start(t);o.stop(t+3.1);}
  doorCreak(){if(!this.ctx||!this.ready||muted)return;this.mechanicalNoise(.16,1700,7,.12,(Math.random()-.5)*.25);setTimeout(()=>{if(!muted){this.mechanicalNoise(1.25,430,2.1,.18,.08);this.mechanicalTone(185,48,1.2,'sawtooth',.045,.08);}},75);setTimeout(()=>{if(!muted)this.mechanicalNoise(.14,2300,8,.075,-.08);},610);}
  voidBloom(){if(!this.ctx||!this.ready||muted)return;this.mechanicalNoise(5.8,180,.48,.19,0);this.mechanicalTone(38,14,6.2,'sine',.12,0);this.whisper(4.6,-.18);}
  mechanicalNoise(duration=.7, frequency=700, q=1.2, volume=.14, pan=0) {
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime;
    const length=Math.ceil(this.ctx.sampleRate*duration);const buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate);const data=buffer.getChannelData(0);let last=0;
    for(let i=0;i<length;i++){const white=Math.random()*2-1;last=(last+.07*white)/1.07;data[i]=last*4.2;}
    const src=this.ctx.createBufferSource();src.buffer=buffer;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=q;
    const gain=this.ctx.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+Math.min(.035,duration*.28));gain.gain.setTargetAtTime(volume*.55,t+Math.min(.08,duration*.5),Math.max(.025,duration*.18));gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const stereo=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(stereo.pan)stereo.pan.value=pan;
    src.connect(filter);filter.connect(gain);gain.connect(stereo);stereo.connect(this.master);src.start(t);src.stop(t+duration+.04);
  }
  makeImpulse(seconds = 2, decay = 2.5) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds), buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < rate * .012 ? i / (rate * .012) : 1); }
    return buf;
  }
  setReverb(name) {
    if (!this.reverbSend) return;
    const amount = ({ church: .55, cellar: .32, darkroom: .36, abattoir: .3, home: .16, ruin: .22, road: .05, forest: .08 })[name] ?? .1;
    this.reverbSend.gain.setTargetAtTime(amount, this.ctx.currentTime, .4);
  }
  setMuffle(on, seconds = .6) {
    if (!this.muffle) return; const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t); this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, t);
    this.muffle.frequency.exponentialRampToValueAtTime(on ? 320 : 20000, t + seconds);
    Object.values(this.musicTracks).forEach(tr => { if (tr.active) this.fadeMusicTrack(tr, on ? this.musicLevel(tr) * .18 : this.musicLevel(tr), seconds, false); });
  }
  // CC0 footstep recordings (Kenney "Impact Sounds"), decoded once and varied at playback.
  async loadSamples() {
    if (this.samplesRequested || !this.ctx) return; this.samplesRequested = true;
    const groups = { wood: ['footstep_wood', 5], concrete: ['footstep_concrete', 5], grass: ['footstep_grass', 5], snow: ['footstep_snow', 5], glass: ['impact_glass_light', 3] };
    await Promise.all(Object.entries(groups).map(async ([key, [prefix, n]]) => {
      const list = [];
      for (let i = 0; i < n; i++) {
        try { const r = await fetch(`./assets/sfx/${prefix}_00${i}.mp3`); if (!r.ok) continue; list.push(await this.ctx.decodeAudioData(await r.arrayBuffer())); } catch (_) {}
      }
      if (list.length) this.samples[key] = list;
    }));
  }
  playSample(key, { gain = .6, rate = 1, pan = 0, lowpass = 0, wet = true, when = 0 } = {}) {
    const list = this.samples[key]; if (!list?.length || !this.ctx) return false;
    const t = this.ctx.currentTime + when, src = this.ctx.createBufferSource(); src.buffer = list[Math.floor(Math.random() * list.length)]; src.playbackRate.value = rate;
    let node = src;
    if (lowpass) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
    const g = this.ctx.createGain(); g.gain.value = gain; node.connect(g);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain(); if (p.pan) p.pan.value = pan; g.connect(p);
    p.connect(this.master); if (wet && this.reverbSend) p.connect(this.reverbSend);
    src.start(t); return true;
  }
  footstep(surface='grass', sprinting=false, side=0) {
    if (!this.ctx || !this.ready || muted) return;
    const t=this.ctx.currentTime, pan=side%2===0?-.16:.16, run=sprinting?1.25:1, r=()=>.9+Math.random()*.18;
    // Heel strike: a low body thump gives every surface weight, which the bare recordings lack.
    const thump=(f0,f1,vol,dur)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol*run,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(this.master);if(this.reverbSend)g.connect(this.reverbSend);o.start(t);o.stop(t+dur+.02);};
    let played=false;
    if(surface==='wood'){played=this.playSample('wood',{gain:1.15*run,rate:r()*.92,pan});thump(120,55,.16,.14);if(Math.random()<.13)this.mechanicalTone(310+Math.random()*120,190,.35,'sawtooth',.012,pan);}
    else if(surface==='debris'){played=this.playSample('wood',{gain:1.0*run,rate:r()*.85,pan});thump(110,50,.14,.14);if(Math.random()<.35)this.playSample('glass',{gain:.22,rate:1.3+Math.random()*.4,pan:-pan,when:.03});if(Math.random()<.3)this.mechanicalNoise(.12,2600,3,.05,pan);}
    else if(surface==='stone'){played=this.playSample('concrete',{gain:1.25*run,rate:r()*.88,pan});thump(150,70,.12,.1);}
    else if(surface==='concrete'){played=this.playSample('concrete',{gain:1.1*run,rate:r()*.8,pan,lowpass:3800});thump(130,60,.12,.12);}
    else if(surface==='gravel'){played=this.playSample('snow',{gain:1.05*run,rate:r()*.78,pan});this.playSample('concrete',{gain:.45,rate:r()*.7,pan,when:.012,wet:false});thump(95,45,.1,.12);}
    else if(surface==='leaves'){played=this.playSample('grass',{gain:1.1*run,rate:r()*.85,pan,wet:false});this.playSample('snow',{gain:.35,rate:r()*1.1,pan,lowpass:2600,wet:false});thump(80,40,.08,.12);}
    else {played=this.playSample('grass',{gain:1.15*run,rate:r()*.86,pan,wet:false});if(Math.random()<.5)this.playSample('snow',{gain:.25,rate:r()*.9,pan,lowpass:1800,wet:false});thump(85,42,.08,.12);}
    if(played)return;
    // Fallback (samples still loading): a shaped noise burst.
    const duration=.2, length=Math.ceil(this.ctx.sampleRate*duration), buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate), data=buffer.getChannelData(0);
    for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2.6);
    const src=this.ctx.createBufferSource();src.buffer=buffer;const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=surface==='grass'?1400:900;
    const gain=this.ctx.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.32*run,t+.01);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(filter);filter.connect(gain);gain.connect(this.master);src.start(t);src.stop(t+duration+.02);
  }
  // A church bell built from its real partials (hum, prime, minor-third tierce, quint, nominal...), slightly
  // out of tune with itself so each partial beats. "Ding" and "dong" sit a tritone apart, pitched to A=415.
  bell(strikes = 4, distance = 0) {
    if (!this.ctx || !this.ready || muted) return;
    const ratios = [[.5, 1, 9], [1, .62, 6.5], [1.183, .55, 5], [1.506, .32, 3.6], [2, .45, 3.2], [2.514, .2, 2.2], [3.011, .14, 1.6], [4.07, .08, 1]];
    const near = 1 - distance, out = this.ctx.createGain(); out.gain.value = (.75 * near + .18);
    let dest = out;
    if (distance > 0) { const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400 - distance * 1900; out.connect(lp); dest = lp; }
    dest.connect(this.master); if (this.reverbSend) { const send = this.ctx.createGain(); send.gain.value = 1.1; dest.connect(send); send.connect(this.reverbSend); }
    const base = [207.5, 146.8];
    for (let k = 0; k < strikes; k++) {
      const t = this.ctx.currentTime + .05 + k * 1.55, f = base[k % 2] * (1 - k * .002);
      // Strike: a bright metallic clank.
      this.mechanicalNoise(.09, 3200, 2.2, .22 * near + .05, k % 2 ? .12 : -.12);
      for (const [ratio, amp, decay] of ratios) for (const det of [-1, 1]) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(f * ratio * (1 + det * .0016 * ratio), t);
        if (ratio === 1) o.frequency.exponentialRampToValueAtTime(f * (1 - .012), t + decay); // the prime sags: the bell sounds wrong
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(amp * .16, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + decay * (1.1 - distance * .4));
        o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + .1);
      }
    }
    // A reversed swell that breathes in before the first strike.
    const len = Math.ceil(this.ctx.sampleRate * 1.3), b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(i / len, 3) * .5;
    const sw = this.ctx.createBufferSource(); sw.buffer = b; const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 415; bp.Q.value = 3; const sg = this.ctx.createGain(); sg.gain.value = .5 * near;
    sw.connect(bp); bp.connect(sg); sg.connect(dest); sw.start(this.ctx.currentTime);
  }
  mechanicalTone(start=180,end=65,duration=1.2,type='sine',volume=.075,pan=0){
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(start,t);o.frequency.exponentialRampToValueAtTime(Math.max(15,end),t+duration);f.type='lowpass';f.frequency.value=1500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.06);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const panNode=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(panNode.pan)panNode.pan.value=pan;o.connect(f);f.connect(g);g.connect(panNode);panNode.connect(this.master);o.start(t);o.stop(t+duration+.03);
  }
  mechanicalEvent(kind=null){
    if(!this.ctx||muted)return;const zone=this.currentZone;const pan=(Math.random()-.5)*1.7;
    const pool=kind?[kind]:({road:['chain','pipe','metal','gear','hoist'],home:['hinge','drawer','glass','fridge','utensil','clock'],church:['rope','bench','organ','metal','bellows'],ruin:['telephone','cassette','hinge','pipe','latch'],cellar:['ratchet','valve','scrape','bearing','screwdriver'],abattoir:['hoist','chain','hook','meat-saw','drain','latch','hammer']})[zone]||['metal','scrape'];
    const event=pool[Math.floor(Math.random()*pool.length)];
    if(event==='bell'){this.bell(2,this.currentZone==='church'?0:.55);return;}
    if(event==='hinge'){this.mechanicalNoise(1.45,380,2.8,.18,pan);this.mechanicalTone(210,74,1.35,'sawtooth',.035,pan);}
    else if(event==='drawer'){this.mechanicalNoise(.72,950,1.8,.12,pan);setTimeout(()=>this.knock(),220);}
    else if(event==='glass'){this.mechanicalNoise(.42,1850,8,.095,pan);this.mechanicalTone(620,480,.8,'sine',.025,pan);}
    else if(event==='fridge'){this.mechanicalTone(52,44,3.2,'sine',.095,pan);this.mechanicalNoise(1.7,240,1.1,.07,pan);}
    else if(event==='chain'||event==='rope'){for(let i=0;i<5;i++)setTimeout(()=>{this.mechanicalNoise(.13+Math.random()*.12,1300+Math.random()*1300,5,.08,pan);},i*95);this.mechanicalTone(175,88,1.1,'triangle',.035,pan);}
    else if(event==='gear'||event==='ratchet'){for(let i=0;i<8;i++)setTimeout(()=>{this.mechanicalNoise(.07,750+Math.random()*800,6,.09,pan);this.mechanicalTone(95+Math.random()*80,38,.12,'square',.014,pan);},i*85);}
    else if(event==='pipe'||event==='valve'||event==='bearing'){this.mechanicalNoise(1.8,220,1.7,.16,pan);this.mechanicalTone(95+Math.random()*35,28,2.3,'sawtooth',.07,pan);}
    else if(event==='telephone'){this.mechanicalTone(420,390,.6,'sine',.05,pan);this.mechanicalTone(422,397,.6,'sine',.04,pan);this.mechanicalNoise(.18,2600,7,.075,pan);}
    else if(event==='cassette'){this.mechanicalNoise(2.1,1450,1.4,.095,pan);this.mechanicalTone(68,56,2.2,'sawtooth',.035,pan);}
    else if(event==='organ'){this.mechanicalNoise(.22,900,4,.07,pan);this.mechanicalTone(71,70,2.8,'triangle',.055,pan);}
    else if(event==='bench'){this.mechanicalNoise(.8,320,2.3,.12,pan);this.mechanicalTone(115,58,.75,'sawtooth',.04,pan);}
    else if(event==='utensil'){this.mechanicalNoise(.09,2600,9,.09,pan);setTimeout(()=>this.mechanicalNoise(.12,1750,8,.055,-pan),145);}
    else if(event==='screwdriver'){this.mechanicalNoise(.34,3100,10,.12,pan);this.mechanicalTone(240,95,.48,'square',.025,pan);setTimeout(()=>this.mechanicalNoise(.24,2500,8,.08,pan),260);}
    else if(event==='scrape'){this.mechanicalNoise(2.1,510,1.1,.15,pan);this.mechanicalTone(148,46,1.9,'sawtooth',.035,pan);}
    else if(event==='hoist'||event==='hook'){for(let i=0;i<4;i++)setTimeout(()=>this.mechanicalNoise(.16,1750+Math.random()*500,7,.075,pan),i*180);this.mechanicalTone(82,39,2.8,'sawtooth',.055,pan);}
    else if(event==='meat-saw'){this.mechanicalNoise(2.0,1250,2.1,.12,pan);this.mechanicalTone(120,98,1.7,'square',.025,pan);}
    else if(event==='drain'){this.mechanicalNoise(2.5,350,1.3,.12,pan);this.mechanicalTone(43,28,2.4,'sine',.06,pan);}
    else if(event==='hammer'){for(let i=0;i<3;i++)setTimeout(()=>this.knock(),i*240);}
    else if(event==='clock'){this.mechanicalNoise(.07,2400,10,.06,pan);setTimeout(()=>this.mechanicalNoise(.07,2300,10,.05,-pan),480);this.mechanicalTone(62,60,1.5,'sine',.018,pan);}
    else if(event==='latch'){this.mechanicalNoise(.35,1350,5,.14,pan);this.mechanicalTone(220,76,.6,'triangle',.03,pan);}
    else if(event==='bellows'){this.mechanicalNoise(1.8,420,1.4,.095,pan);this.mechanicalTone(61,55,1.6,'sine',.04,pan);}
    else {this.mechanicalNoise(.95,540+Math.random()*1200,2+Math.random()*4,.13,pan);this.mechanicalTone(135+Math.random()*150,42,.85,'triangle',.04,pan);}
  }
  scheduleMechanical(){if(!this.ready)return;const delay=4300+Math.random()*11700;setTimeout(()=>{if(this.ready&&!muted)this.mechanicalEvent();this.scheduleMechanical();},delay);}
  killingAudio(){
    if(!this.ctx||!this.ready||muted)return;
    const t=this.ctx.currentTime;
    this.mechanicalNoise(2.25,310,.72,.16,(Math.random()-.5)*.7);
    this.mechanicalTone(92,18,2.4,'sawtooth',.10,(Math.random()-.5)*.4);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.11,3200,9,.13,(Math.random()-.5)*1.2);},720);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.065,1450,12,.065,(Math.random()-.5)*1.2);},910);
  }
  setDayNight(night){
    if(!this.ctx||!this.ready||!this.noiseGain)return;
    this.noiseGain.gain.setTargetAtTime(.12+night*.13,this.ctx.currentTime,3.2);
    if(this.droneGain)this.droneGain.gain.setTargetAtTime(.10+night*.12,this.ctx.currentTime,4.0);
  }
  whisper(duration = 1.6, pan = 0) {
    if (!this.ctx || !this.ready || muted) return;
    const t = this.ctx.currentTime, len = Math.ceil(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 900; bp.Q.value = 2.2;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t);
    // Syllable-like breath pulses, kept strictly in time order.
    for (let k = 0; k * .22 + .2 < duration; k++) {
      const s0 = t + k * .22 + Math.random() * .02;
      g.gain.exponentialRampToValueAtTime(.085, s0 + .05);
      g.gain.exponentialRampToValueAtTime(.012, s0 + .16);
    }
    g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    const pn = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain(); if (pn.pan) pn.pan.value = pan;
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(pn); pn.connect(this.master);
    src.start(t); src.stop(t + duration + .05);
  }
  toggle() {
    muted = !muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.effectsLevel(), this.ctx.currentTime, .08);
    Object.values(this.musicTracks).forEach(track => {
      if (muted) this.fadeMusicTrack(track,0,.12,false);
      else if (track.active) this.fadeMusicTrack(track,this.musicLevel(track),.28,false);
    });
    $('sound-button').innerHTML = muted ? 'MUTED <b>[M]</b>' : 'SOUND <b>[M]</b>';
  }
}
audio = new AmbientSound();
audio.playTitleMusic();
const unlockTitleMusic = () => { if (!gameStarted && audio.activeMusic?.name === 'mysterious' && audio.activeMusic.element.paused) audio.playTitleMusic(); };
window.addEventListener('pointerdown', unlockTitleMusic, { passive: true });
window.addEventListener('keydown', unlockTitleMusic);

// -----------------------------------------------------------------------------
// Dialogue, journal, clues and interaction state
// -----------------------------------------------------------------------------
function showToast(text) {
  const el = $('toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}
function addLoreProp(z,id,title,description,flag,object,point,prompt){
  const entry={id,type:'story',object,point:point.clone?point:object.position.clone(),radius:2.8,prompt,title,run:()=>{
    if(storyFlags.has(flag)){showToast('THE OBJECT HAS ALREADY BEEN RECORDED.');return;}
    storyFlags.add(flag);journal.push({id,title,description,kind:'recovered document',zone:z.name});updateJournalCount();
    $('speaker').textContent=title.toUpperCase();$('subtitle').textContent=description;$('subtitle-wrap').classList.add('visible');
    clearTimeout(narrationTimer);narrationTimer=setTimeout(()=>{if(!dialogueOpen)$('subtitle-wrap').classList.remove('visible');},7600);
    flashFragment(flag.replace('dark-',''),140);audio?.mechanicalEvent('scrape');glitchPulse=Math.max(glitchPulse,.8);
    showToast('EVIDENCE RECOVERED // '+title.toUpperCase());updateMissions();completeDarkroomIfReady();
  }};
  z.interactables.push(entry);return entry;
}
function darkroomFindCount(){return ['dark-heater','dark-earplugs','dark-book','dark-reel','dark-report','dark-script'].filter(f=>storyFlags.has(f)).length;}
function completeDarkroomIfReady(){
  if(darkroomFindCount()<6||storyFlags.has('darkroom-cleared'))return;
  storyFlags.add('darkroom-cleared');darkroomHunt.active=false;
  if(storyRef.darkroomHunter)storyRef.darkroomHunter.object.visible=false;
  flashFragment('room-tone',220);audio?.mechanicalTone(67,34,3.2,'sine',.07,0);
  showToast('THE ROOM HAS BEEN RECORDED. THE DOOR IS OPEN.');
  startMonologue([
    'Tobia: The reels moved without tape. The meters did not rise. The room was the recording.',
    'Voice: No one can prove that the room was empty. The dead are not here to correct us.',
    'Tobia: I had been listening for an album. I had only been listening to the place that waited for it.'
  ],17);
  updateMissions();
}
function updateProgress() {
  const n = collected.size; $('evidence-count').textContent = `${n} / ${clueCount} CLUES`;
  $('inventory-count').textContent = String(n);
  $('progress-fill').style.width = `${n / clueCount * 100}%`;
  if (n === 0) $('objective-text').textContent = 'Find the farmhouse. Look for the place where the animals are hung.';
  else if (n < 7) $('objective-text').textContent = 'Collect 7 clues to open the House of Beasts. Follow the boardwalk east.';
  else if (n === 7) $('objective-text').textContent = currentZone === 'abattoir'
    ? '7 / 8 CLUES — Find the slaughterhouse ledger on the north-west side.'
    : '7 / 8 CLUES — The House of Beasts lies east, beyond the boardwalk. The slaughterhouse ledger is the final clue.';
  else $('objective-text').textContent = currentZone === 'cellar'
    ? '8 / 8 CLUES — Approach the black platter and press E to listen to The White.'
    : currentZone === 'home'
      ? '8 / 8 CLUES — The kitchen hatch is uncovered. Descend to the cellar.'
      : '8 / 8 CLUES — Return to the farmhouse and descend through the kitchen hatch.';
  if (abattoirEntrance) {
    const unlocked = n >= (abattoirEntrance.requiredClues || 7);
    abattoirEntrance.locked = !unlocked;
    abattoirEntrance.prompt = unlocked
      ? '[ E ] ENTER — THE HOUSE OF BEASTS'
      : `[ E ] LOCKED — 7 CLUES REQUIRED (${n}/7)`;
    if (abattoirEntrance.slab) abattoirEntrance.slab.material = unlocked ? M.wood : M.rust;
  }
  if (zones.home?.hatchCover) zones.home.hatchCover.visible = n < clueCount;
  if (cellarDoor) {
    cellarDoor.locked = n < clueCount;
    cellarDoor.prompt = n < clueCount ? `[ E ] LOCKED — ${clueCount - n} CLUES MISSING` : '[ E ] DESCEND — THE CELLAR';
    if (cellarDoor.slab) cellarDoor.slab.material = n < clueCount ? M.rust : M.wood;
  }
  $('journal-total').textContent = `${journal.length} ITEMS CATALOGUED`;
}
function updateJournalCount(){ $('journal-total').textContent = `${journal.length} ITEMS CATALOGUED`; $('inventory-count').textContent=String(journal.length); }
function collectClue(item) {
  if (collected.has(item.id)) return;
  if (item.requiresFlag && !storyFlags.has(item.requiresFlag)) { showToast(item.blockedHint || 'Speak with the relevant person first.'); return; }
  collected.add(item.id);
  journal.push({ id: item.id, title: item.title, description: item.description, kind: item.kind || 'documento', zone: currentZone });
  updateJournalCount();
  zone.group.remove(item.object);
  zone.interactables.splice(zone.interactables.indexOf(item), 1);
  dread = Math.min(1, dread + .13); glitchPulse = Math.max(glitchPulse, .85); audio.stinger(.85);
  showToast(`CLUE RECORDED // ${item.title.toUpperCase()}`); updateProgress();
  if (collected.size === clueCount) showToast('THE HOUSE HAS FINISHED COUNTING. THE HATCH IS OPEN.');
  const station=STATION_ORDER_BY_CLUE[collected.size-1];if(station)queueStation(station);
}
function speakVoice(text, npcName = '') {
  // No speech synthesis: the line is whispered. Its length sets the duration, the speaker sets the side.
  if (!text || !audio) return;
  const clean = String(text).replace(/^[^:]*:\s*/, '');
  const dur = Math.min(4.8, .9 + clean.length * .045);
  const seed = (npcName || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const pan = ((seed % 5) - 2) * .35;
  audio.whisper(dur, pan);
  setTimeout(() => audio.whisper(dur * .6, -pan), 280 + (seed % 3) * 90);
  const sub = $('subtitle'); if (sub) { sub.classList.add('distorted'); setTimeout(() => sub.classList.remove('distorted'), dur * 1000); }
  glitchPulse = Math.max(glitchPulse, .3);
}
function openDialogue(npc) {
  if (dialogueOpen) return;
  if (npc.talkedOnce && !npc.isOpeningPrimo && !/primo|the first/i.test(npc.name || '')) { showToast('THEY HAVE NOTHING MORE TO SAY.'); return; }
  dialogueOpen = true; controls.unlock(); $('subtitle-wrap').classList.add('visible');
  $('speaker').textContent = (npc.displayName||npc.name).toUpperCase(); $('subtitle').textContent = npc.dialogue?.line || 'No answer. Only the sound of clothes.'; speakVoice(npc.dialogue?.line || 'No answer.',npc.name);
  const options = $('dialogue-options'); options.innerHTML = '';
  (npc.dialogue?.choices || ['Listen.', 'Go away.']).forEach((choice, i) => {
    const b = document.createElement('button'); b.className = 'dialogue-option'; b.innerHTML = `<b>[${i + 1}]</b>${choice}`;
    b.addEventListener('click', () => chooseDialogue(npc, i)); options.appendChild(b);
  });
  activeTarget = null; $('prompt').classList.remove('visible');
}
function chooseDialogue(npc, index) {
  if(!npc||(npc.talkedOnce&&!npc.isOpeningPrimo&&!/the first/i.test(npc.name||'')))return;
  npc.talkedOnce=true;
  let reply = npc.dialogue?.replies?.[index] || 'The answer comes from a room that does not exist.';
  const lower=(npc.name||'').toLowerCase();
  if(lower==='ines'){storyFlags.add(index===0?'ines-trust':'ines-betrayed');storyFlags.add('talked-ines');}
  if(lower==='sergio'){storyFlags.add(index===0?'sergio-truth':'sergio-silence');}
  if(lower==='dario'){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='the first'&&!npc.isOpeningPrimo){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='father remo'||lower==='don remo'){storyFlags.add('talked-remo');if(index===1)showToast('DON REMO HAS EXPLAINED THE ALTAR. LIGHT ALL THREE CANDLES.');}
  if(lower==='the widow'||lower==='widow')storyFlags.add('talked-widow');
  if(lower==='ottavio'){storyFlags.add('talked-ottavio');if(index===1)storyFlags.add('ottavio-audio');}
  if(lower==='anna')storyFlags.add(index===0?'anna-mercy':'anna-table');
  if(lower==='pino'){storyFlags.add('talked-pino');if(index===0){storyFlags.add('pino-sent');flashFragment('collapse',140);}}
  if(lower==='marta'&&index===1)flashFragment('nosebleed',120);
  if(lower==='gabri'&&index===0)flashFragment('tea',120);
  if(lower==='livia')storyFlags.add('livia-song');
  if(lower==='ottavio')flashFragment('reel',105);
  if(lower==='ines'&&index===0){storyFlags.add('ines-wiped-blood');flashFragment('nosebleed',165);showToast('INES WIPES THE BLOOD WITHOUT ASKING WHAT CAUSED IT.');const left=npc.leftArm?.rotation.z??0,fore=npc.leftForearm?.rotation.z??0;if(npc.leftArm)npc.leftArm.rotation.z=-1.05;if(npc.leftForearm)npc.leftForearm.rotation.z=-.72;setTimeout(()=>{if(npc.leftArm)npc.leftArm.rotation.z=left;if(npc.leftForearm)npc.leftForearm.rotation.z=fore;},1150);}
  if(lower==='ines'&&index===1)flashFragment('tea',180);
  $('subtitle').textContent = reply; speakVoice(reply,npc.name); $('dialogue-options').innerHTML = '<button class="dialogue-option" id="dialogue-end"><b>[↵]</b>Say nothing more.</button>'; 
  $('dialogue-end').addEventListener('click', closeDialogue);
  glitchPulse = Math.max(glitchPulse, .28); audio.stinger(.25);
  applyConsequences(npc, index);
}
function closeDialogue(relock = true) { dialogueOpen = false; $('subtitle-wrap').classList.remove('visible'); if('speechSynthesis' in window)window.speechSynthesis.cancel(); if(relock)requestMouseLock(); }
function openJournal() {
  if (!gameStarted || gameEnded || listeningPending || dialogueOpen) return;
  journalOpen = true; controls.unlock(); $('journal').classList.add('active'); renderJournal();
}
function closeJournal() { journalOpen = false; $('journal').classList.remove('active'); if (gameStarted && !gameEnded) requestMouseLock(); }
function renderJournal() {
  const list = $('journal-list'); list.innerHTML = '';
  if (!journal.length) { list.innerHTML = '<div class="empty-note">No clues recorded.<br><br>The house is not visible yet.</div>'; return; }
  journal.forEach((entry, i) => {
    const b = document.createElement('button'); b.className = `journal-entry${i === 0 ? ' active' : ''}`;
    b.innerHTML = `<small>${String(i + 1).padStart(2, '0')} / ${entry.zone.toUpperCase()}</small><strong>${entry.title}</strong>`;
    b.addEventListener('click', () => {
      list.querySelectorAll('.journal-entry').forEach(x => x.classList.remove('active')); b.classList.add('active');
      $('journal-detail').innerHTML = `<div class="detail-stamp">EPISTASSI / CLUE ${String(i + 1).padStart(2, '0')}</div><h3>${entry.title}</h3><p>${entry.description}</p><div class="detail-foot">FOUND IN: ${entry.zone.toUpperCase()} · KEPT IN THE JOURNAL</div>`;
    });
    list.appendChild(b);
  });
  list.querySelector('.journal-entry')?.click();
}
function inspectTarget(item) {
  if(item.requiresFlag&&!storyFlags.has(item.requiresFlag)){showToast(item.blockedHint||'The way is not open yet.');audio?.stinger(.22);return;}
  if(item.requiresFlags&&!item.requiresFlags.every(flag=>storyFlags.has(flag))){showToast(item.blockedHint||'The way is not open yet.');audio?.stinger(.22);return;}
  if (item.type === 'clue') { collectClue(item); return; }
  if (item.type === 'event') { if(item.used)return;item.used=true;const ix=zone.interactables.indexOf(item);if(ix>=0)zone.interactables.splice(ix,1);item.run?.();return; }
  if (item.type === 'npc') { openDialogue(item); return; }
  if (item.type === 'door') {
    const required = item.requiredClues ?? (item.locked ? clueCount : 0);
    if (collected.size < required) {
      showToast(`${required - collected.size} CLUES MISSING. THE DOOR DOES NOT RECOGNISE YOUR HANDS.`);
      audio.stinger(.22);
      return;
    }
    activateDoor(item); return;
  }
  if (item.type === 'listen') { beginListening(); return; }
  if (item.type === 'look') { showLook(item); return; }
  if (item.type === 'tool') { tools.add(item.tool); const ix = zone.interactables.indexOf(item); if (ix >= 0) zone.interactables.splice(ix, 1); item.object.parent?.remove(item.object); showToast(`TAKEN: ${item.title.toUpperCase()}`); audio.stinger(.4); updateMissions(); return; }
  if (item.type === 'candle') { lightCandle(item.candle); return; }
  if (item.type === 'dig') { return; }
  if (item.type === 'egg') { collectRelic(item); return; }
  if (item.type === 'story') { item.run(); return; }
}
function activateDoor(item){
  if(doorTransitioning||item._opening)return;doorTransitioning=true;item._opening=true;keys.clear();audio?.doorCreak();
  const pivot=item.doorPivot;
  if(!pivot){setTimeout(()=>{doorTransitioning=false;item._opening=false;enterZone(item.destination,item.spawn);},360);return;}
  const from=pivot.rotation.y,to=item.openAngle??-1.08,start=performance.now(),duration=520;
  const swing=()=>{const k=Math.min(1,(performance.now()-start)/duration),ease=1-Math.pow(1-k,3);pivot.rotation.y=from+(to-from)*ease;if(k<1)requestAnimationFrame(swing);else setTimeout(()=>{doorTransitioning=false;item._opening=false;enterZone(item.destination,item.spawn);},110);};swing();
}
function beginListening(){
  if(collected.size<clueCount){showToast('THE PLATTER IS EMPTY. COLLECT ALL EIGHT CLUES.');return;}
  if(!storyFlags.has('altar-lit')){showToast('THE ALTAR IS STILL DARK. LIGHT ALL THREE CANDLES FIRST.');return;}
  if(!storyFlags.has('darkroom-cleared')){showToast('THE DARK ROOM HAS NOT BEEN SEARCHED. FIND THE SIX RECORDS OF WHAT HAPPENED.');return;}
  if(!storyFlags.has('first-tea')){showToast('IL PROFESSORE IS STILL IN THE SLAUGHTERHOUSE. ASK HIM ABOUT THE EARPLUGS.');return;}
  if(!storyFlags.has('carcasses-decided')){showToast('THE BODIES ARE STILL WAITING. DECIDE WHAT TO DO WITH THE HOOKS FIRST.');return;}
  storyFlags.add('listened-to-white');
  audio?.stopMusic('dot', 2.4);
  if (listeningPending || gameEnded) return;
  // Lock the player inside the listening room. Every remaining cultist is brought
  // into view and receives a visible fate before the ending choices are revealed.
  listeningPending=true;controls.unlock();keys.clear();hiddenBreath=false;activeTarget=null;
  camera.position.set(0,1.63,0);camera.rotation.z=0;cameraDirector.active=false;cameraDirector.cooldown=999;playerRig.visible=false;occludeMat.opacity=0;occludeRight.material.opacity=0;
  $('hud').classList.add('hidden-hud');$('prompt').classList.remove('visible');
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(audio.effectsLevel()*.42,audio.ctx.currentTime,1.2);
  flashFragment('room-tone',175);audio?.mechanicalNoise(5.2,225,.7,.075,0);audio?.mechanicalTone(41,41,5.4,'sine',.028,0);
  cultRoster.filter(n=>n.fate==='present').forEach((npc,i)=>queueCultFate('the turn of the record',npc,isProgressCriticalCultist(npc)?'vanish':(i%4===0?'collapse':'vanish')));
  showToast('THIRTEEN NAMES. THE ROOM WANTS TO WATCH THEM LEAVE.');
  speakVoice('Do not lower your eyes. The room must empty before you can choose.','RECORDING 14-B');
  if(!cultFateActive && cultFateQueue.length===0) finishListening();
}
function finishListening(){
  if(!listeningPending)return;listeningPending=false;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');
  $('ending-screen').classList.remove('active');$('ending-choices').classList.remove('visible');$('ending-result').classList.remove('visible');
  $('ending-title').textContent='The White Was Not Heard.';$('ending-copy').textContent='The silence did not remain in the room.';$('ending-small').textContent='THE FOG IS NOT A BORDER.';
  playerAnchor.position.set(0,0,0);camera.position.set(0,1.63,0);camera.rotation.set(0,0,0);
  const growth=storyRef.voidGrowth;if(growth){growth.visible=true;growth.scale.setScalar(.001);}
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(audio.effectsLevel()*.6,audio.ctx.currentTime,1.4);
  storyScene={type:'ending',t:0,dur:22,i:0,switched:false,lines:[
    [.6,'Voice: The room does not become empty. It lends its emptiness to the weather.'],
    [4.8,'Voice: The fog is not a veil. It is what remains when a name stops insisting on its outline.'],
    [9.4,'Il Professore: You see? Nothing has been taken from you. You are only returning what you have been calling yourself.'],
    [14.2,'Voice: The reeds bend toward the hollow. The trees make room without asking what has left.'],
    [19,'Tobia: I heard the room. I cannot tell you whether The White was the room, or what remained inside the machine.']
  ]};audio?.voidBloom();
}
function revealEndingChoices(){
  storyScene=null;$('subtitle-wrap').classList.remove('visible');$('ending-screen').classList.add('active');
  $('ending-title').textContent='The White Was Not Heard.';$('ending-copy').textContent='The turntable is still in the cellar. The forest has made a place the size of a person.';
  $('ending-small').textContent='THE THIRTEEN HAVE LEFT. WHAT YOU LEFT BEHIND REMAINS.';$('ending-choices').classList.add('visible');
  $('ending-testimony').style.display=(storyFlags.has('grave-revealed')&&storyFlags.has('pastorale-complete'))?'':'none';$('ending-result').classList.remove('visible');
}

function resolveEnding(choice) {
  clearSavedEvidence();
  const choices={
    testimony:{title:'The Names Took Root',copy:'You spoke the thirteen names as people call to one another from a window. In the forest, thirteen leaves stopped against the wind. They did not return. But for the first time they were no longer only erased shapes. The fog let the light pass without dissolving them.',small:'ENDING IV / TESTIMONY',voice:'Aurelio. Ines. Dario. Sergio. You are not the record. You were here.'},
    fill:{title:'The Place Learned Your Name',copy:'You let Il Professore call you by name, and you stopped correcting him. The figure in the forest filled its coat with your absence. The house remains lit: someone must open the door for the next arrival.',small:'ENDING I / FILLING',voice:'They did not take you away. They convinced you to leave your place.'},
    expose:{title:'The Room Gave Back Its Breath',copy:'You opened the windows. Air entered from the forest and crossed the house without asking permission. The fog carried the dust outside, but left a dry outline on the floor: the place you occupied. There is no salvation in the void; there is at least room to breathe.',small:'ENDING II / AIR',voice:'The room was saturated. Truth cannot return the dead, but it can return air.'},
    preserve:{title:'The Fog Preserved the Shape',copy:'You touched nothing. The windows remain closed, the trees move out of time, and the platter keeps turning without tape. The figure that resembles you remains among the trunks, intact only because nobody looks at it long enough.',small:'ENDING III / PRESERVATION',voice:'You did not choose. Even the fog knows how to preserve a shape.'}
  };
  const result={...(choices[choice]||choices.preserve)};
  if(choice==='expose' && storyFlags.has('sergio-truth')) result.copy='Sergio left you the report: carbon monoxide, blocked ventilation, thirteen people dead before they could hear the record. You opened the windows. The explanation cannot return them, but it breaks the liturgy. The report remains a theory, not a verdict.';
  if(choice==='fill' && storyFlags.has('accepted-leader')) result.copy='You took Dario’s place. He was not the leader: he was only the first to empty himself. Your name is engraved on the fourteenth chair, beneath the other thirteen.';
  if(choice==='preserve' && storyFlags.has('crossed-impossible')) result.copy='The sewn threshold returned you to the same room, but from the opposite wall. You left the platter turning. When you leave, the door opens inward onto the room you have just left.';
  if(choice==='fill' && storyFlags.has('released')) result.copy += ' You cut the chains but freed nobody: the place was filled by a choice you can no longer withdraw.';
  if(choice==='expose' && storyFlags.has('complicit')) result.copy += ' You left the hooks untouched when you could have acted; the truth arrives, but it is not innocent.';
  if(storyFlags.has('pastorale-complete'))result.copy += ' The Mass did not return. Its grief moved into the water, the grain and the reeds. No funeral was held; the landscape learned the interval instead.';
  if(storyFlags.has('institution-survives'))result.copy += ' Ines remains at the house. The porch lamp is lit again. Someone is walking toward the door, and there is a place waiting for them.';
  $('ending-title').textContent=result.title;$('ending-copy').textContent=result.copy;$('ending-small').textContent=result.small;
  $('ending-choices').classList.remove('visible');$('ending-result').classList.add('visible');
  storyFlags.add(`ending-${choice}`);speakVoice(result.voice,'RECORDING 14-B');
  $('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),420);
  glitchPulse=1.4;audio?.killSting();
  if(choice==='preserve'){fear=1;}
}
// -----------------------------------------------------------------------------
// Weather and an intrusive camera director: the camera sometimes behaves like
// a hidden observer rather than a neutral first-person instrument.
// -----------------------------------------------------------------------------
const rainGeometry=new THREE.BufferGeometry();const rainCount=1150;const rainPositions=new Float32Array(rainCount*3);
for(let i=0;i<rainCount;i++){rainPositions[i*3]=(Math.random()-.5)*32;rainPositions[i*3+1]=Math.random()*16;rainPositions[i*3+2]=(Math.random()-.5)*32;}
rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rainPoints=new THREE.Points(rainGeometry,new THREE.PointsMaterial({color:0x9ba7a5,size:.045,transparent:true,opacity:.23,depthWrite:false,sizeAttenuation:true}));scene.add(rainPoints);
const rainStreakArray=new Float32Array(260*6);const rainStreakGeometry=new THREE.BufferGeometry();rainStreakGeometry.setAttribute('position',new THREE.BufferAttribute(rainStreakArray,3));
const rainStreaks=new THREE.LineSegments(rainStreakGeometry,new THREE.LineBasicMaterial({color:0x9daaa8,transparent:true,opacity:.14}));scene.add(rainStreaks);
const weatherState={lightning:0,nextLightning:36+Math.random()*38,wind:0};
const playerRig=new THREE.Group();playerRig.visible=false;controls.getObject().add(playerRig);
const playerCoat=new THREE.Mesh(new THREE.CapsuleGeometry(.29,.66,5,9),M.darkWood);playerCoat.position.y=.98;playerRig.add(playerCoat);
const playerHead=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),M.black);playerHead.position.y=1.58;playerRig.add(playerHead);
for(const x of [-.34,.34]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.46,4,7),M.darkWood);arm.position.set(x,.97,0);arm.rotation.z=x<0?-.13:.13;playerRig.add(arm);}
const directorOccluder=new THREE.Group();camera.add(directorOccluder);
const occludeMat=new THREE.MeshBasicMaterial({color:0x080907,transparent:true,opacity:.0,depthWrite:false,side:THREE.DoubleSide});
const occludeLeft=new THREE.Mesh(new THREE.PlaneGeometry(.34,2.3),occludeMat);occludeLeft.position.set(-.92,.02,-.64);directorOccluder.add(occludeLeft);
const occludeRight=new THREE.Mesh(new THREE.PlaneGeometry(.24,2.1),occludeMat.clone());occludeRight.material.opacity=0;occludeRight.position.set(.94,.02,-.72);directorOccluder.add(occludeRight);
const cameraDirector={timer:0,cooldown:0,active:false,side:1,phase:0,roll:0};
const ambientNightColor=new THREE.Color(0x202b3d), ambientDayColor=new THREE.Color(0xb8c0b3);
const moonNightColor=new THREE.Color(0x53648c), moonDayColor=new THREE.Color(0xffd7aa);
function updateDayNight(dt,t) {
  const phase=((elapsed/265)+.72)%1;
  const sun=Math.max(0,Math.sin((phase-.20)*Math.PI*2)*.5+.5);
  const night=1-sun;dayNightBlend=night;
  const isOutside=currentZone==='road'||currentZone==='ruin';
  for(const z of Object.values(zones)){
    z.ambient.intensity=z.name==='road'||z.name==='ruin' ? .24+sun*.46 : z.name==='abattoir' ? .14+sun*.05 : z.name==='darkroom' ? .03 : z.name==='pastorale' ? 1.1 : z.name==='home'||z.name==='church' ? .3+sun*.14 : .2+sun*.16;
    if(isOutside)z.ambient.color.lerpColors(ambientNightColor,ambientDayColor,sun);else z.ambient.color.setHex(0x77736a);
    z.moon.intensity=z.name==='road'||z.name==='ruin' ? .14+night*.48 : .22;
    if(isOutside)z.moon.color.lerpColors(moonNightColor,moonDayColor,sun);else z.moon.color.setHex(0xc0b49c);
  }
  if(isOutside){
    const dawn=new THREE.Color(0x777f80),day=new THREE.Color(0xb9beb5),nightCol=new THREE.Color(0x171e2c);
    const sky=new THREE.Color().lerpColors(nightCol,day,sun);
    if(sun<.24)sky.lerp(dawn,Math.sin((.24-sun)/.24*Math.PI)*.24);
    scene.background.copy(sky);if(scene.fog?.color)scene.fog.color.copy(sky);
    if(sun<.22&&lastDayAnnouncement!=='NIGHT'){lastDayAnnouncement='NIGHT';showToast('DAYLIGHT HAS LEFT THE CANAL.');}
    else if(sun>.72&&lastDayAnnouncement!=='DAWN'){lastDayAnnouncement='DAWN';showToast('LIGHT RETURNS WITHOUT THE SUN.');}
  }
  audio?.setDayNight(night);
  const wind=.5+Math.sin(t*.00013)*.5;
  for(const tree of windTrees){if(!tree.parent)continue;const a=Math.sin(t*.0007+tree.userData.windPhase)*(.008+wind*.018);tree.rotation.z=a;tree.rotation.x=Math.cos(t*.00053+tree.userData.windPhase)*.012;}
  for(const plant of cropPlants){if(!plant.parent)continue;const sway=Math.sin(t*.0011+plant.userData.windPhase)*plant.userData.windBase;plant.rotation.z=sway;plant.userData.leaves.forEach((leaf,i)=>{leaf.rotation.z=(i%2?1:-1)*(.5+sway);});}
  for(const leaf of leafSpecks){leaf.position.x+=Math.sin(t*.0003+leaf.position.z)*dt*.09;leaf.position.z+=Math.cos(t*.00025+leaf.position.x)*dt*.06;}
}
function updateWeather(dt,t){
  const p=currentPosition();const outdoors=currentZone==='road';rainPoints.visible=outdoors;rainStreaks.visible=outdoors;
  if(outdoors){rainPoints.position.set(p.x,0,p.z);const a=rainGeometry.attributes.position.array;
    for(let i=0;i<rainCount;i++){const ix=i*3;a[ix+1]-=dt*(9+Math.sin(i)*2);a[ix]-=dt*.6;if(a[ix+1]<.3){a[ix+1]=12+Math.random()*5;a[ix]=(Math.random()-.5)*32;a[ix+2]=(Math.random()-.5)*32;}}rainGeometry.attributes.position.needsUpdate=true;
    for(let i=0;i<260;i++){const x=(Math.random()-.5)*30,z=(Math.random()-.5)*30,y=Math.random()*13;rainStreakArray[i*6]=x;rainStreakArray[i*6+1]=y;rainStreakArray[i*6+2]=z;rainStreakArray[i*6+3]=x-.08;rainStreakArray[i*6+4]=y-.42;rainStreakArray[i*6+5]=z;}rainStreakGeometry.attributes.position.needsUpdate=true;rainStreaks.position.set(p.x,0,p.z);
  }
  weatherState.nextLightning-=dt;if(weatherState.nextLightning<=0&&outdoors){weatherState.lightning=.18;weatherState.nextLightning=38+Math.random()*55;glitchPulse=Math.max(glitchPulse,.7);}
  if(weatherState.lightning>0){weatherState.lightning-=dt;const flash=weatherState.lightning>0?Math.sin(Math.PI*(weatherState.lightning/.18))*1.4:0;const amb=zone?.ambient;if(amb)amb.intensity=.18+flash;}
  if(zone?.mist)zone.mist.rotation.y=Math.sin(t*.00007)*.012;
}
function updateCameraDirector(dt,t){
  cameraDirector.cooldown=Math.max(0,cameraDirector.cooldown-dt);
  const p=currentPosition();
  // Narrow thresholds and furniture can briefly force an over-shoulder, obstructed framing.
  const cover = (currentZone==='home'&&(Math.abs(p.x+3.2)<1.35||Math.abs(p.x-4.8)<1.1)) ||
    (currentZone==='church'&&Math.abs(Math.abs(p.x)-3.5)<.8&&p.z<7&&p.z>-11) ||
    (currentZone==='ruin'&&p.z<-2.8&&Math.abs(p.x+2.1)<1.2) ||
    (currentZone==='cellar'&&Math.abs(p.x)<1.1&&p.z<1.2&&p.z>-3.5) ||
    (currentZone==='abattoir'&&Math.abs(p.x)<3.8&&p.z<-3.5);
  if(!dialogueOpen&&!journalOpen&&!cameraDirector.active&&cameraDirector.cooldown<=0&&((cover&&Math.random()<.012)|| (fear>.38&&elapsed>24&&Math.random()<.0009))){
    cameraDirector.active=true;cameraDirector.timer=1.35+Math.random()*1.7;cameraDirector.side=Math.random()<.5?-1:1;cameraDirector.phase=0;cameraDirector.roll=(Math.random()-.5)*.035;
    showToast('THE RECORDING IS NOT BEHIND YOUR EYES.');
  }
  if(cameraDirector.active){cameraDirector.timer-=dt;cameraDirector.phase=Math.min(1,cameraDirector.phase+dt*1.7);const fade=cameraDirector.timer<.7?Math.max(0,cameraDirector.timer/.7):1;const pull=cameraDirector.phase*fade;
    const desiredZ=2.1*pull, desiredX=cameraDirector.side*.34*pull;
    camera.position.x+= (desiredX-camera.position.x)*Math.min(1,dt*4.5);camera.position.z+=(desiredZ-camera.position.z)*Math.min(1,dt*4.2);
    camera.rotation.z+=(cameraDirector.roll*pull-camera.rotation.z)*Math.min(1,dt*3.5);
    playerRig.visible=pull>.18;occludeMat.opacity=.68*pull;occludeRight.material.opacity=.46*pull;
    if(cameraDirector.timer<=0){cameraDirector.active=false;cameraDirector.cooldown=30+Math.random()*28;}
  }else{
    camera.position.x+=(0-camera.position.x)*Math.min(1,dt*3.5);camera.position.z+=(0-camera.position.z)*Math.min(1,dt*3.5);camera.rotation.z+=(0-camera.rotation.z)*Math.min(1,dt*2.5);
    playerRig.visible=false;occludeMat.opacity+=(0-occludeMat.opacity)*Math.min(1,dt*4);occludeRight.material.opacity+=(0-occludeRight.material.opacity)*Math.min(1,dt*4);
  }
  // Unstable handheld drift remains present even when the hidden camera is inactive.
  camera.rotation.z+=Math.sin(t*.00083)*.0007*(1+fear*2);
}

// -----------------------------------------------------------------------------
// Player, flashlight and target selection
// -----------------------------------------------------------------------------
const flashlight = new THREE.SpotLight(0xe4e3d6, 15, 26, Math.PI / 7.2, .5, 1.3);
flashlight.position.set(0, 0, 0); flashlight.target.position.set(0, 0, -8); flashlight.castShadow = true; flashlight.shadow.mapSize.set(1024, 1024); flashlight.shadow.bias = -.0008; flashlight.shadow.normalBias = .03; flashlight.shadow.camera.near = .2;
camera.add(flashlight); camera.add(flashlight.target);
const fillFlash = new THREE.PointLight(0xe3e2d9, .55, 4.5); fillFlash.position.set(0, -.2, -.3); camera.add(fillFlash);
function toggleFlashlight() { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; fillFlash.visible = flashlightOn; $('torch-state').textContent = flashlightOn ? 'ON' : 'OFF'; audio.stinger(.18); }
function findTarget() {
  if (!zone || !playerInputEnabled()) return null;
  controls.getDirection(forward); camera.getWorldPosition(cameraWorld);
  let best = null; let bestScore = Infinity;
  for (const item of zone.interactables) {
    if (!item.object || !item.object.parent) continue;
    const p = item.point || item.object.position; targetVec.set(p.x, p.y + (item.type === 'npc' ? 1.15 : .25), p.z);
    const dist = cameraWorld.distanceTo(targetVec); if (dist > (item.radius || 3.0)) continue;
    const dir = targetVec.clone().sub(cameraWorld).normalize(); const dot = forward.dot(dir);
    if (dot < .58) continue;
    const score = dist + (1 - dot) * 2.1;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  return best;
}
function footstepSurfaceForZone(name) {
  if (name === 'road' || name === 'forest') return 'grass';
  if (name === 'home' || name === 'ruin') return 'wood';
  return 'stone';
}
let bobPhase = 0, bobAmount = 0, sprintBlend = 0, strafeRoll = 0;
function updatePlayer(dt) {
  if (!playerInputEnabled()) { velocity.multiplyScalar(Math.max(0, 1 - dt * 8)); bobAmount *= Math.max(0, 1 - dt * 6); return; }
  applyLook(dt);
  const sprinting=keys.has('ShiftLeft') || keys.has('ShiftRight'); const speed = sprinting ? 5.4 : 3.2; if(sprinting&&wishVec.lengthSq()>.1)fear=Math.min(1,fear+dt*.012);
  const f = hiddenBreath ? 0 : ((keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0) - ((keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0);
  const s = hiddenBreath ? 0 : ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0) - ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0);
  controls.getDirection(forward); forward.y = 0; forward.normalize();
  rightVec.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  wishVec.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(rightVec, s);
  if (wishVec.lengthSq() > 1) wishVec.normalize();
  // Frame-rate independent easing: quick to start, a short natural glide when the keys are released.
  const accel = 1 - Math.exp(-dt * (wishVec.lengthSq() > 0 ? 9.5 : 11));
  velocity.x += (wishVec.x * speed - velocity.x) * accel;
  velocity.z += (wishVec.z * speed - velocity.z) * accel;
  const p = currentPosition(), previousX = p.x, previousZ = p.z; const nx = p.x + velocity.x * dt; const nz = p.z + velocity.z * dt;
  const b = zone.bounds; const r = .34;
  const collides = (x, z) => zone.solids.some(o => x + r > o.minX && x - r < o.maxX && z + r > o.minZ && z - r < o.maxZ);
  if (nx >= b.minX && nx <= b.maxX && !collides(nx, p.z)) p.x = nx; else velocity.x = 0;
  if (nz >= b.minZ && nz <= b.maxZ && !collides(p.x, nz)) p.z = nz; else velocity.z = 0;
  const moved = Math.hypot(p.x-previousX,p.z-previousZ);
  // Head-bob and footsteps share one phase: a step sounds exactly when the head dips.
  const stride = sprinting ? 1.5 : 1.12;
  const planar = Math.hypot(velocity.x, velocity.z);
  bobAmount += ((planar > .4 ? Math.min(1, planar / 3.2) : 0) - bobAmount) * (1 - Math.exp(-dt * 7));
  if (moved > .0005) {
    const before = Math.floor(bobPhase / Math.PI);
    bobPhase += moved / stride * Math.PI;
    const after = Math.floor(bobPhase / Math.PI);
    if (after !== before && audio?.ready) audio.footstep(footstepSurface(), sprinting, footstepSide++);
  }
  sprintBlend += ((sprinting && planar > 3.6 ? 1 : 0) - sprintBlend) * (1 - Math.exp(-dt * 5));
  const side = rightVec.dot(velocity) / 5.4; strafeRoll += (-side * .018 - strafeRoll) * (1 - Math.exp(-dt * 6));
  const idle = Math.sin(elapsed * 1.3) * .006 * (1 - bobAmount);
  camera.position.y = 1.63 - Math.abs(Math.sin(bobPhase)) * .045 * bobAmount + .02 * bobAmount + idle;
  camera.rotation.z += (strafeRoll + Math.sin(bobPhase) * .004 * bobAmount - camera.rotation.z) * Math.min(1, dt * 10);
}
// Footstep surface by place: asphalt and gravel on the road, boards on the boardwalk, grass elsewhere.
function footstepSurface() {
  const p = currentPosition();
  if (currentZone === 'road') {
    if (Math.abs(p.x - 27) < 1.8 && p.z > 10 && p.z < 28.5) return 'wood';
    if (Math.abs(p.x) < 6.2 && p.z > -9) return 'gravel';
    if (p.x > 36 && p.x < 52 && p.z > 12 && p.z < 24) return 'gravel';
    return 'grass';
  }
  if (currentZone === 'forest') return 'leaves';
  if (currentZone === 'home') return 'wood';
  if (currentZone === 'ruin') return 'debris';
  if (currentZone === 'church') return 'stone';
  return 'concrete';
}
function updateTargets() {
  activeTarget = findTarget();
  const prompt = $('prompt'); const cross = $('center-mark');
  if (activeTarget) { prompt.textContent = activeTarget.prompt; prompt.classList.add('visible'); cross.classList.add('targeted'); }
  else { prompt.classList.remove('visible'); cross.classList.remove('targeted'); }
}

// -----------------------------------------------------------------------------
// Input and interface
// -----------------------------------------------------------------------------
function requestMouseLock() {
  // Use the native promise-returning API so rejected pointer-lock requests are
  // handled. Pointer lock must only be requested from a real user gesture.
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {
      if (playerInputEnabled()) showToast('MOUSE LOOK PAUSED — CLICK THE SCENE TO RESUME. WASD WORKS.');
    });
  } catch (_) {
    showToast('MOUSE FREE — WASD ACTIVE, DRAG TO LOOK.');
  }
}
function startGame() {
  if (gameStarted) return;
  clearSavedEvidence();
  gameStarted = true;
  keys.clear();
  $('start-screen').classList.remove('active');
  enterZone('road', [0, 0, 29]);
  startIntroV6();
  $('hud').classList.remove('hidden-hud');
  $('hud').classList.add('intro');
  audio.playMusic('mysterious', { loop: true, fadeIn: 2.2 });
  audio.start().catch(() => {});
  requestMouseLock();
}
$('start-button').addEventListener('click', startGame);
// ---- Settings panel and difficulty picker ----
function renderDifficulty() {
  const pick = $('difficulty-pick'); pick.innerHTML = '';
  DIFFICULTY_INFO.forEach((d, i) => {
    const b = document.createElement('button'); b.textContent = d.name; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(SETTINGS.difficulty === i));
    if (SETTINGS.difficulty === i) b.classList.add('selected');
    b.addEventListener('click', () => { SETTINGS.difficulty = i; saveSettings(); renderDifficulty(); });
    pick.appendChild(b);
  });
  $('difficulty-text').textContent = DIFFICULTY_INFO[SETTINGS.difficulty].text;
  $('settings-difficulty').textContent = `DIFFICULTY: ${DIFFICULTY_INFO[SETTINGS.difficulty].name} — ${DIFFICULTY_INFO[SETTINGS.difficulty].text}`;
}
function bindSlider(key, fmt) {
  const input = $(`set-${key}`), out = $(`out-${key}`);
  input.value = SETTINGS[key]; out.textContent = fmt(SETTINGS[key]);
  input.addEventListener('input', () => { SETTINGS[key] = Number(input.value); out.textContent = fmt(SETTINGS[key]); saveSettings(); audio?.applyVolumes(); if (key === 'music' && !gameStarted) audio?.playTitleMusic(); });
}
const pct = v => `${Math.round(v * 100)}%`;
bindSlider('master', pct); bindSlider('music', pct); bindSlider('sfx', pct); bindSlider('sens', v => `${v.toFixed(2)}×`);
renderDifficulty();
function openSettings() { if (journalOpen || gameEnded && gameStarted) return; settingsOpen = true; keys.clear(); controls.unlock(); $('settings').classList.add('active'); }
function closeSettings() { settingsOpen = false; $('settings').classList.remove('active'); if (gameStarted && !gameEnded && !dialogueOpen) requestMouseLock(); }
$('settings-button').addEventListener('click', () => settingsOpen ? closeSettings() : openSettings());
$('settings-close').addEventListener('click', closeSettings);
$('start-settings').addEventListener('click', openSettings);
$('journal-button').addEventListener('click', openJournal);
$('journal-close').addEventListener('click', closeJournal);
$('sound-button').addEventListener('click', () => audio.toggle());
$('return-button').addEventListener('click', () => { clearSavedEvidence(); location.reload(); });
$('retry-button').addEventListener('click',()=>{ clearSavedEvidence(); location.reload(); });
$('ending-fill').addEventListener('click',()=>finaleThenV6('fill'));
$('ending-expose').addEventListener('click',()=>finaleThenV6('expose'));
$('ending-preserve').addEventListener('click',()=>finaleThenV6('preserve'));
$('ending-testimony').addEventListener('click',()=>finaleThenV6('testimony'));
controls.addEventListener('unlock', () => {
  fallbackLookDragging = false;
  if (gameStarted && !dialogueOpen && !journalOpen && !gameEnded) $('prompt').classList.remove('visible');
});
document.addEventListener('pointerlockerror', () => {
  if (playerInputEnabled()) showToast('MOUSE LOCK UNAVAILABLE — WASD WORKS, DRAG TO LOOK.');
});

window.addEventListener('mousedown', (e) => { if (e.button === 2 && playerInputEnabled()) rightMouse = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) rightMouse = false; });
window.addEventListener('contextmenu', (e) => { if (gameStarted) e.preventDefault(); });
const movementCodes = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (playerInputEnabled() && movementCodes.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF' && !e.repeat && playerInputEnabled()) toggleFlashlight();
  if(e.code==='KeyQ' && playerInputEnabled() && !e.repeat){hiddenBreath=true;showToast('HOLD YOUR BREATH. DO NOT MOVE.');}
  if (e.code === 'KeyM' && !e.repeat) audio.toggle();
  if (e.code === 'KeyP' && !e.repeat) { settingsOpen ? closeSettings() : openSettings(); }
  if (e.code === 'Space' && !e.repeat && storyScene && storyScene.skippable !== false && storyScene.type !== 'hold') { e.preventDefault(); skipStoryScene(); }
  if (e.code === 'Tab' && !e.repeat && !listeningPending) { e.preventDefault(); journalOpen ? closeJournal() : openJournal(); }
  if (e.code === 'KeyE' && playerInputEnabled() && activeTarget) inspectTarget(activeTarget);
  if (dialogueOpen && (e.code === 'Digit1' || e.code === 'Digit2')) $('dialogue-options').querySelectorAll('button')[Number(e.code.slice(-1)) - 1]?.click();
  // Escape exits Pointer Lock at browser level. Do not request it again in the same key event;
  // the canvas click handler will reacquire it on the next deliberate click.
  if (dialogueOpen && e.code === 'Escape') { e.preventDefault(); closeDialogue(false); }
});
window.addEventListener('keyup', e => {keys.delete(e.code);if(e.code==='KeyQ')hiddenBreath=false;});
window.addEventListener('blur', () => { keys.clear(); hiddenBreath = false; fallbackLookDragging = false; });

// Mouse-look fallback: hold the mouse button and drag over the scene if the
// browser refuses Pointer Lock. Keyboard movement works with or without it.
let fallbackLookDragging = false;
let fallbackPointerX = 0;
let fallbackPointerY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!playerInputEnabled() || controls.isLocked) return;
  fallbackLookDragging = true;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
window.addEventListener('pointermove', (e) => {
  if (!fallbackLookDragging || controls.isLocked || !playerInputEnabled()) return;
  const dx = e.clientX - fallbackPointerX;
  const dy = e.clientY - fallbackPointerY;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  look.yaw += dx * .0024 * SETTINGS.sens;
  look.pitch += dy * .0024 * SETTINGS.sens;
});
window.addEventListener('pointerup', () => { fallbackLookDragging = false; });
window.addEventListener('pointercancel', () => { fallbackLookDragging = false; });
canvas.addEventListener('click', () => {
  if (playerInputEnabled() && !controls.isLocked) requestMouseLock();
});
canvas.addEventListener('contextmenu', (e) => { if (gameStarted) e.preventDefault(); });

// -----------------------------------------------------------------------------
// Ambient motion and render loop
// -----------------------------------------------------------------------------

// =============================================================================
// v3.2: lamps and candles, distant rituals, windows, looks, digging, missions,
// the approaching Il Primo, dialogue consequences, chapter cards, lens and zoom.
// =============================================================================
function addCandle(group, x, y, z, lit = true, interactive = false) {
  const root = new THREE.Group(); root.position.set(x, y, z); group.add(root);
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(.03, .036, .2, 8), mat(0xd9d0b4, .8)); wax.position.y = .1; root.add(wax);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
  flame.scale.set(1, 1.7, 1); flame.position.y = .23; root.add(flame);
  const light = new THREE.PointLight(0xffa24a, lit ? .9 : 0, 4.2, 2); light.position.set(0, .3, 0); root.add(light);
  const c={root,wax,flame,light,lit,destroyed:false,base:.9,phase:Math.random()*9};
  candles.push(c);
  if (interactive) {
    const entry = { id: `candle_${x}_${z}`, type: 'candle', object: root, point: root.position, radius: 2.1, prompt: '[ E ] LIGHT THE CANDLE', candle: c };
    c.entry = entry; group.userData.interactables.push(entry);
  }
  return c;
}
function updateCandles(t) {
  for (const c of candles) {
    if (!c.lit) { c.light.intensity = 0; c.flame.visible = false; continue; }
    c.flame.visible = true;
    const v = .78 + .22 * Math.sin(t * .011 + c.phase) + .12 * Math.sin(t * .037 + c.phase * 2.3) + (Math.random() - .5) * .12;
    c.light.intensity = c.base * Math.max(.2, v);
    c.flame.scale.set(1 + (v - .8) * .3, 1.7 + (v - .8) * .6, 1);
  }
}
function refreshCandlePrompts(){candles.forEach(c=>{for(const z of Object.values(zones)){const entry=z.interactables.find(item=>item.type==='candle'&&item.candle===c);if(entry)entry.prompt='[ E ] LIGHT THE CANDLE';}});}
function lightCandle(c){
 if(!c||c.lit)return;
 c.lit=true;candlesLit=Math.min(3,candlesLit+1);glitchPulse=Math.max(glitchPulse,.3);audio?.stinger(.3);
 showToast('ALTAR CANDLES LIT: '+candlesLit+' / 3');
 if(candlesLit>=3&&!storyFlags.has('altar-lit')){
   storyFlags.add('altar-lit');storyFlags.add('primo-alerted');storyFlags.add('cemetery-bait');
   fear=Math.min(1,fear+.20);audio?.killSting();audio?.mechanicalEvent('bell');
   if(storyRef.cemeteryShooter)storyRef.cemeteryShooter.visible=true;
   storyLine('Il Professore: Go to the cemetery beside the industries. The missing name is waiting there.');
   placeStalker(currentZone);showToast('THREE FLAMES. A NEW INSTRUCTION ARRIVES FROM THE FACTORIES.');
 }
 updateMissions();
}

// A wall with real openings. axis 'x' runs along x at z=pos; axis 'z' runs along z at x=pos.
function addWindowedWall(group, axis, pos, a, b, height, thick, m, windows) {
  const put = (u0, u1, y0, y1) => {
    const len = u1 - u0; if (len <= .01 || y1 - y0 <= .01) return;
    const cu = (u0 + u1) / 2, cy = (y0 + y1) / 2;
    if (axis === 'x') addBox(group, cu, cy, pos, len, y1 - y0, thick, m);
    else addBox(group, pos, cy, cu, thick, y1 - y0, len, m);
  };
  let u = a;
  for (const w of windows.slice().sort((p, q) => p.at - q.at)) {
    const w0 = w.at - w.w / 2, w1 = w.at + w.w / 2;
    put(u, w0, 0, height); put(w0, w1, 0, w.y); put(w0, w1, w.y + w.h, height);
    u = w1;
  }
  put(u, b, 0, height);
}
// Tableau seen through a window: a fire, a ring of figures and a gallows with a swinging body.
function addDistantRitual(group, x, z) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 20), mat(0x1c1d19, 1)); ground.rotation.x = -Math.PI / 2; ground.position.y = .01; root.add(ground);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a24 }));
  fire.position.y = .6; fire.scale.set(1, 1.6, 1); root.add(fire);
  const figures = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, r = 2.6 + (i % 2) * .4;
    const f = new THREE.Group(); f.position.set(Math.sin(a) * r, 0, Math.cos(a) * r); f.rotation.y = a + Math.PI;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28, .9, 4, 8), mat(0x0c0c0b, 1)); body.position.y = 1.0; f.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 8), mat(0x0c0c0b, 1)); head.position.y = 1.8; f.add(head);
    root.add(f); figures.push(f);
  }
  const beamM = mat(0x17140f, 1);
  const post1 = new THREE.Mesh(new THREE.BoxGeometry(.18, 4.2, .18), beamM); post1.position.set(-6, 2.1, -6); root.add(post1);
  const post2 = new THREE.Mesh(new THREE.BoxGeometry(.18, 4.2, .18), beamM); post2.position.set(-3, 2.1, -6); root.add(post2);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.4, .18, .18), beamM); beam.position.set(-4.5, 4.1, -6); root.add(beam);
  const hung = new THREE.Group(); hung.position.set(-4.5, 4.0, -6); root.add(hung);
  const hbody = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .95, 4, 8), mat(0x0a0908, 1)); hbody.position.y = -1.0; hung.add(hbody);
  const hhead = new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 8), mat(0x0a0908, 1)); hhead.position.y = -2.0; hung.add(hhead);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.45, 48), new THREE.MeshBasicMaterial({ color: 0x7a1a12, transparent: true, opacity: .5 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .02; root.add(ring);
  makeEmitter(root, 0, .3, 0, 'fire'); makeEmitter(root, 0, .9, 0, 'smoke');
  rituals.push({ root, fire, figures, hung, phase: Math.random() * 6 });
  return root;
}
function updateRituals(t) {
  for (const r of rituals) {
    r.fire.scale.set(1 + .14 * Math.sin(t * .011 + r.phase), 1.6 + .25 * Math.sin(t * .017 + r.phase), 1 + .14 * Math.cos(t * .013 + r.phase));
    r.figures.forEach((f, i) => { f.rotation.z = Math.sin(t * .0009 + i + r.phase) * .05; });
    r.hung.rotation.z = Math.sin(t * .0013 + r.phase) * .12;
    r.hung.rotation.x = Math.sin(t * .0007 + r.phase) * .05;
  }
}
function addLook(group, x, y, z, title, text, radius = 2.4) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  marker.position.set(x, y, z); group.add(marker);
  const entry = { id: `look_${title.toLowerCase().replace(/\W/g, '_')}`, type: 'look', object: marker, point: marker.position, radius, prompt: '[ E ] LOOK CLOSER', title, text };
  group.userData.interactables.push(entry); return entry;
}
function showLook(item) {
  zoomPulse = 2.4;
  $('speaker').textContent = item.title.toUpperCase(); $('subtitle').textContent = item.text;
  $('dialogue-options').innerHTML = ''; $('subtitle-wrap').classList.add('visible');
  clearTimeout(narrationTimer);
  narrationTimer = setTimeout(() => { if (!dialogueOpen) $('subtitle-wrap').classList.remove('visible'); }, 7000);
}
function addTool(group, x, z, id, title, text) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.2, 6), mat(0x4a3424)); handle.rotation.z = Math.PI / 2; handle.position.y = .08; root.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.28, .02, .34), mat(0x6e6e68, .4)); blade.position.set(.66, .08, 0); root.add(blade);
  const entry = { id: `tool_${id}`, type: 'tool', tool: id, object: root, point: root.position, radius: 2.0, prompt: `[ E ] TAKE — ${title.toUpperCase()}`, title, text };
  group.userData.interactables.push(entry); return entry;
}
function addDigSite(group, x, z) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.22, .34, 3.4, 8), mat(0x2b2118, 1)); trunk.position.y = 1.7; root.add(trunk);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(.025, .05, 3.2, 4), mat(0x3a3a2a, 1));
    br.position.set(Math.sin(a) * 1.3, 2.4, Math.cos(a) * 1.3); br.rotation.set(Math.cos(a) * .9, 0, -Math.sin(a) * .9); root.add(br);
  }
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat(0x2e2419, 1)); mound.scale.set(1.05, .12, .62); mound.position.set(.5, .04, 1.9); root.add(mound);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(.08, .9, .08), mat(0x4a3420, 1)); cross.position.set(.5, .48, 1.9); root.add(cross);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(.5, .08, .08), mat(0x4a3420, 1)); bar.position.set(.5, .62, 1.9); root.add(bar);
  return { id: 'dig_grave', type: 'dig', object: root, point: new THREE.Vector3(x + .5, .3, z + 1.9), radius: 2.6, prompt: '[ E ] HOLD — DIG' };
}
function digAvailable() { return tools.has('shovel') && storyFlags.has('heard-dario-plan') && !digDone; }
function syncDigSite() {
  if (!digEntry) return;
  const list = zones.road.interactables; const has = list.includes(digEntry);
  if (digAvailable() && !has) list.push(digEntry);
  if (!digAvailable() && has) list.splice(list.indexOf(digEntry), 1);
}
function updateDig(dt) {
  syncDigSite();
  if (!digEntry) return;
  const digging = activeTarget === digEntry && keys.has('KeyE') && playerInputEnabled() && digAvailable();
  digProgress = digging ? Math.min(1, digProgress + dt / 4.5) : Math.max(0, digProgress - dt * .6);
  if (activeTarget === digEntry) digEntry.prompt = digProgress > 0 ? `[ E ] DIGGING… ${Math.round(digProgress * 100)}%` : '[ E ] HOLD — DIG';
  if (digging && digProgress >= 1 && !digDone) { digDone = true; completeDig(); }
}
function completeDig() {
  storyFlags.add('grave-revealed');
  journal.push({id:'grave-name',title:'The Name on the Cross',description:'Beneath the disturbed earth is a metal case. Inside, a sheet bearing one name: Aurelio, choir director. Beside it, a date and a single word: removed. The tape is missing. Perhaps it was never played.',kind:'document',zone:'road'});
  updateJournalCount(); syncDigSite();
  showToast('THERE IS A NAME UNDER THE EARTH. IT IS NOT A SINGER’S NAME.');
  audio.killSting(); glitchPulse = Math.max(glitchPulse, 1.1);
  speakVoice('Aurelio. The name was on the cross. Someone buried it before the others.', 'RECORDING 14-B');
  updateMissions();
}
function buildStoryExtras() {
  buildRoadV6();
  buildPastoraleZone();
  buildAtmosphere();
  buildStory();
  buildCinematicExtras();
  digEntry = addDigSite(zones.road.group, -22, 18);
  const shovel=addTool(zones.ruin.group,4.2,-4.6,'shovel','Shovel','The handle is damp and smooth, as if many hands have gripped it in the dark.');shovel.requiresFlag='heard-dario-plan';shovel.blockedHint='Listen through the thin wall before taking the shovel.';
  syncDigSite();
}
// The approaching Il Professore: he walks toward you whenever you are not looking at him.
function stalkerEligible(name) {
  if (!['home', 'church', 'ruin', 'abattoir', 'cellar'].includes(name)) return false;
  if (storyFlags.has('porch-primo-gone') && (name === 'abattoir' || difficultyTier() >= 2)) return true;
  return collected.size >= 3 || storyFlags.has('primo-alerted');
}
function makeStalker() {
  const g = new THREE.Group();
  const coat = new THREE.Mesh(new THREE.CapsuleGeometry(.36, 1.3, 6, 12), mat(0x050505, 1)); coat.position.y = 1.25; coat.scale.set(1, 1.1, .8); g.add(coat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), headMaterial()); head.scale.set(.82, 1.5, .9); head.position.y = 2.55; g.add(head);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xd9d2b4, emissive: 0xd9d2b4, emissiveIntensity: 1.2 });
  [-.08, .08].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(.024, 8, 6), eyeM); e.position.set(x, 2.6, .2); g.add(e); });
  [-1, 1].forEach(s => { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.07, 1.25, 4, 8), mat(0x0a0a09, .9)); arm.position.set(s * .44, 1.2, .1); arm.rotation.z = s * .12; g.add(arm); });
  return g;
}
function placeStalker(name) {
  storyFlags.add(`visited-${name}`);
  if (noEnemies() || !stalkerEligible(name)) { if (stalker) stalker.visible = false; stalkerZone = null; presence = 0; nearFlag = false; return; }
  if (!stalker) stalker = makeStalker();
  const z = zones[name];
  if (stalker.parent !== z.group) { if (stalker.parent) stalker.parent.remove(stalker); z.group.add(stalker); }
  const b = z.bounds, sp = z.spawn;
  const corners = [[b.minX + 1.2, b.minZ + 1.2], [b.maxX - 1.2, b.minZ + 1.2], [b.minX + 1.2, b.maxZ - 1.2], [b.maxX - 1.2, b.maxZ - 1.2]];
  corners.sort((p, q) => Math.hypot(q[0] - sp.x, q[1] - sp.z) - Math.hypot(p[0] - sp.x, p[1] - sp.z));
  stalker.position.set(corners[0][0], 0, corners[0][1]);
  stalker.visible = true; stalkerZone = name; presenceWarned = false; presence = 0;
}
function updatePresence(dt, t) {
  if (noEnemies()) { if (stalker) stalker.visible = false; presence = 0; nearFlag = false; return; }
  const active = stalker && stalker.visible && stalkerZone === currentZone && gameStarted && !gameEnded && !listeningPending && !cultFateActive && !dialogueOpen && !journalOpen;
  if (!active) { presence = Math.max(0, presence - dt * .8); return; }
  const p = playerAnchor.position;
  const dx = stalker.position.x - p.x, dz = stalker.position.z - p.z, dist = Math.hypot(dx, dz) || .001;
  // Static-enemy test mode: Il Professore remains fixed at his room-entry position.
  // Keep the proximity atmosphere, warning, and contact check without pursuit.
  stalker.rotation.z = 0;
  const target = THREE.MathUtils.clamp(1 - (dist - 1.2) / 8, 0, 1);
  presence += (target - presence) * Math.min(1, dt * 1.6);
  if (presence > .5 && !nearFlag) { nearFlag = true; audio.stinger(1); glitchPulse = Math.max(glitchPulse, .8); }
  if (presence < .3) nearFlag = false;
  if (dist < 2.9 && !presenceWarned) { presenceWarned = true; showToast('DO NOT TURN AROUND. HE IS NEAR. DO NOT WATCH HIM APPROACH.'); }
  if (presence > .3) { beatTimer -= dt; if (beatTimer <= 0) { audio.knock(); beatTimer = 1.1 - presence * .6; } }
}
// Missions: the first unfinished one whose prerequisites are met is shown in the objective panel.
const MISSIONS=[
 {id:'house',text:'Walk up the lane to the farmhouse porch. A man is waiting under the lamp.',done:()=>storyFlags.has('visited-home')},
 {id:'home-talk',text:'Speak with Ines (by the dining table) and Ottavio (at the harpsichord). What they know is not written down.',when:()=>storyFlags.has('visited-home'),done:()=>storyFlags.has('talked-ines')&&storyFlags.has('talked-ottavio')},
 {id:'wall',text:'Voices behind the kitchen wall, by the dresser and the crack in the plaster. Press your ear to it.',when:()=>storyFlags.has('talked-ines')&&storyFlags.has('talked-ottavio'),done:()=>storyFlags.has('heard-dario-plan')},
 {id:'dario-mass',text:'Go to the church. Dario’s Mass begins after vespers.',when:()=>storyFlags.has('heard-dario-plan'),done:()=>storyFlags.has('station-dario')},
 {id:'shovel',text:'Find a shovel in the empty house, beside the television.',when:()=>storyFlags.has('heard-dario-plan'),done:()=>tools.has('shovel')},
 {id:'grave',text:'Dig beneath the willow. Hold E until the earth gives way.',when:()=>tools.has('shovel'),done:()=>storyFlags.has('grave-revealed')},
 {id:'widow',text:'Question the Widow in the ruined house about the 1977 recording.',when:()=>storyFlags.has('grave-revealed'),done:()=>storyFlags.has('talked-widow')},
 {id:'remo',text:'Speak with Don Remo in the church. Ask him why he still wears the collar.',when:()=>collected.size>=2,done:()=>storyFlags.has('talked-remo')},
 {id:'candles',text:'Light all three altar candles. The flames are part of the way forward.',when:()=>collected.size>=2,done:()=>storyFlags.has('altar-lit')},
 {id:'cemetery',text:'Il Professore wants you in the cemetery east of the road, past the signpost, by the factory. Red grave lights mark the way. Something glints on the factory roof.',when:()=>storyFlags.has('cemetery-bait'),done:()=>storyFlags.has('cemetery-shot')},
  {id:'pino-field',text:'Follow Pino into the wheat field. The combine is still running.',when:()=>storyFlags.has('pino-sent'),done:()=>storyFlags.has('pino-collapsed')},
  {id:'bell-rope',text:'Go to the bell rope in the church nave. Il Professore says your hands are steady.',when:()=>storyFlags.has('station-dario')&&storyFlags.has('talked-remo'),done:()=>storyFlags.has('dario-bell-death')},
  {id:'pastorale',text:'After the forest, follow the waterline and recover three pastoral intervals.',when:()=>storyFlags.has('escaped-forest'),done:()=>storyFlags.has('pastorale-complete')},
  {id:'carcasses',text:'Inspect the suspended carcasses. Decide whether to release them or leave them hanging.',when:()=>currentZone==='abattoir',done:()=>storyFlags.has('carcasses-decided')}
];
function currentMissionText(){
 if(storyFlags.has('escaped-forest')&&!storyFlags.has('pastorale-complete')&&currentZone==='road')return 'FOLLOW THE WATERLINE. FIND THE THREE PASTORAL INTERVALS — '+['water','grain','reeds'].filter(k=>storyFlags.has('pastorale-'+k)).length+' / 3.';
 if(storyFlags.has('pino-sent')&&!storyFlags.has('pino-collapsed')&&currentZone==='road')return 'PINO WENT TOWARD THE WHEAT FIELD. FOLLOW THE ENGINE.';
  if(currentZone==='church'&&storyFlags.has('station-dario')&&storyFlags.has('talked-remo')&&!storyFlags.has('dario-bell-death'))return 'THE BELL ROPE HANGS BY THE LEFT WALL OF THE NAVE. IL PROFESSORE SAYS YOUR HANDS ARE STEADY.';
 if(currentZone==='abattoir'&&!storyFlags.has('carcasses-decided'))return 'DECIDE WHAT TO DO WITH THE HANGING BODIES.';
 if(currentZone==='darkroom'&&!storyFlags.has('darkroom-cleared'))return 'SEARCH THE DARK ROOM — '+darkroomFindCount()+' / 6. Keep the beam moving.';
 if(storyFlags.has('altar-lit')&&!storyFlags.has('darkroom-cleared'))return currentZone==='cellar'?'THE SIDE DOOR IS OPEN. SEARCH THE DARK ROOM FOR THE SIX RECORDS.':'RETURN TO THE CELLAR. THE SIDE DOOR HAS OPENED.';
 if(storyFlags.has('darkroom-cleared')&&!storyFlags.has('first-tea'))return currentZone==='abattoir'?'SPEAK WITH IL PROFESSORE AGAIN. ASK HIM ABOUT THE SOUND HE REFUSED TO HEAR.':'RETURN TO THE SLAUGHTERHOUSE. IL PROFESSORE IS WAITING BESIDE THE HOOKS.';
  if(storyFlags.has('first-tea')&&!storyFlags.has('listened-to-white'))return currentZone==='cellar'?'RETURN TO THE BLANK PLATTER. THE ROOM HAS BEEN RECORDED.':'THE BLANK PLATTER IS WAITING IN THE CELLAR.';
 if(currentZone==='home'&&!storyFlags.has('talked-ines'))return 'Speak with Ines before examining the Seating List.';
 if(currentZone==='home'&&!storyFlags.has('talked-ottavio'))return 'Speak with Ottavio before examining the Tuning Fork.';
 if(currentZone==='church'&&!storyFlags.has('talked-remo'))return 'Speak with Don Remo before examining the Mass Register.';
 if(currentZone==='ruin'&&!storyFlags.has('talked-widow'))return 'Speak with the Widow before examining the Burned Photograph.';
 if(storyFlags.has('cemetery-bait')&&!storyFlags.has('cemetery-shot')&&collected.size<clueCount)return 'IL PROFESSORE’S INSTRUCTION — THE CEMETERY: east of the road, past the CIMITERO signpost, follow the red grave lights to the iron gate. (Look at the factory roof before you go in.)';
 if(collected.size===7)return currentZone==='abattoir'
   ?'7 / 8 CLUES — The slaughterhouse ledger is on the north-west side, near the back wall.'
   :'7 / 8 CLUES — Follow the boardwalk east. The House of Beasts contains the final ledger.';
 if(collected.size>=clueCount&&!storyFlags.has('altar-lit'))return '8 / 8 CLUES — Return to the church and light all three altar candles.';
 if(collected.size>=2&&!storyFlags.has('altar-lit'))return 'LIGHT ALL THREE ALTAR CANDLES — The flames are part of the way forward.';
 if(collected.size>=clueCount){
   if(currentZone==='cellar')return '8 / 8 CLUES — Approach the black platter and press E to listen to The White.';
   if(currentZone==='home')return '8 / 8 CLUES — The kitchen hatch is uncovered. Descend to the cellar.';
   return '8 / 8 CLUES — Return to the farmhouse and descend through the kitchen hatch.';
 }
 for(const m of MISSIONS)if(!m.done()&&(!m.when||m.when()))return m.text;
 return null;
}

function updateMissions() {
  for (const m of MISSIONS) if (!seenMissions.has(m.id) && m.done()) { seenMissions.add(m.id); showToast('OBJECTIVE COMPLETE'); }
  const el = $('objective-text'); const text = currentMissionText();
  if (text && el.textContent !== text) el.textContent = text;
}
function triggerCemeteryAmbush(){
 if(gameEnded||storyFlags.has('cemetery-shot'))return;
 storyFlags.add('cemetery-shot');keys.clear();controls.unlock();activeTarget=null;dialogueOpen=true;
 $('speaker').textContent='THE FACTORY ROOF';$('subtitle').textContent='A rifle cracks from the industrial roof. You feel the impact before the echo reaches the cemetery.';$('subtitle-wrap').classList.add('visible');
 audio?.mechanicalNoise(.16,1850,8,.34,-.18);audio?.mechanicalTone(145,42,.24,'square',.16,-.18);audio?.killSting();
 glitchPulse=Math.max(glitchPulse,2);fear=1;camera.rotation.z+=.11;
 const world=$('world');if(world)world.style.filter='contrast(1.8) saturate(2.2) sepia(.4)';
 const flash=$('event-flash');flash.classList.add('active');setTimeout(()=>flash.classList.remove('active'),130);
 setTimeout(()=>{dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');triggerDeath('SHOT IN THE CEMETERY','You followed the instruction to the cemetery beside the industries. The shot came from the factory roof. The missing name was never there.');},820);
}
function updateCemeteryTrap(){
 if(currentZone!=='road'||!storyFlags.has('cemetery-bait')||storyFlags.has('cemetery-shot')||gameEnded||!zone)return;
 const p=currentPosition();if(p.x>=37.4&&p.x<=50&&p.z>=12.5&&p.z<=23.5)triggerCemeteryAmbushV6();
}
// Dialogue choices with consequences: some open or close missions, others move the enemy or the cult.
function applyConsequences(npc, index) {
  const key = (npc.name || '').toLowerCase();
  if (key === 'ottavio' && index === 0) { storyFlags.add('ottavio-cold'); }
  if (key === 'ines' && index === 1) { fear = Math.min(1, fear + .12); showToast('INES LOOKS AT YOU A LITTLE LONGER THAN BEFORE.'); }
  if (key === 'dario' && index === 1) { storyFlags.add('primo-alerted'); showToast('IL PROFESSORE HAS HEARD YOUR NAME.'); }
  if(key==='pino'&&index===0){storyFlags.add('pino-sent');showToast('PINO HAS SHOWN YOU THE FIELD PATH. THE ENGINE IS STILL WARM.');}

  if (key === 'sergio' && index === 1) { fear = Math.min(1, fear + .05); }
  if (key === 'the first' && npc.isOpeningPrimo) { storyFlags.add('met-primo'); storyFlags.add('primo-first-contact'); }
  else if (key === 'the first') { const d = primoDialogue(); d.actions?.[index]?.(); }
  applyChoiceEffect(key,index,npc);
  if(key==='the first'&&npc===storyRef.first&&storyFlags.has('darkroom-cleared')&&!storyFlags.has('first-tea'))startFirstTeaScene(npc);
  if (storyFlags.has('primo-alerted')) placeStalker(currentZone);
  updateMissions();
}
const CHAPTER_NAMES = { road: 'I · THE FOG ROAD', home: 'II · THE HOUSE / THIRTEEN PLACES', church: 'III · THE DECONSECRATED CHURCH', ruin: 'IV · THE EMPTY HOUSE', cellar: 'V · THE CELLAR', darkroom: 'VI · THE DARK ROOM', abattoir: 'VII · THE SLAUGHTERHOUSE' };
function showChapterCard(name) {
  if (chapterCardsShown.has(name) || !CHAPTER_NAMES[name]) return;
  chapterCardsShown.add(name);
  const el = $('chapter-card'); el.textContent = CHAPTER_NAMES[name]; el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3200);
}
// Depth of field: focus follows what you look at, so far things (windows, tableaux) blur.
function updateLens(dt) {
  if (!bokeh) return;
  camera.getWorldPosition(cameraWorld);
  const want = activeTarget ? cameraWorld.distanceTo(activeTarget.point || activeTarget.object.position) : 6.5;
  const u = bokeh.uniforms; const zoomed = keys.has('KeyZ') || rightMouse || zoomPulse > 0;
  u.focus.value += (Math.min(want, 40) - u.focus.value) * Math.min(1, dt * 4);
  u.aperture.value += ((zoomed ? .00042 : .00016) + presence * .00012 - u.aperture.value) * Math.min(1, dt * 3);
  u.maxblur.value = .0045;
}
function updateZoom(dt) {
  if (zoomPulse > 0) zoomPulse -= dt;
  const target = !gameStarted ? 72 : (keys.has('KeyZ') || rightMouse) ? 36 : zoomPulse > 0 ? 50 : 72;
  if (Math.abs(camera.fov - target) > .05) { camera.fov += (target - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
}


// =============================================================================
// v3.3: relics (easter eggs), field rituals, macabre props.
// =============================================================================
function addEgg(group, x, z, id, title, text) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  root.add(buildRelicMesh(id));
  const core = new THREE.Object3D(); root.add(core);
  const light = { intensity: 0 };
  const entry = { id, type: 'egg', object: root, point: root.position, radius: 2.0, prompt: `[ E ] COLLECT — ${title.toUpperCase()}`, title, text, core, light };
  eggs.push(entry); group.userData.interactables.push(entry); return entry;
}
function updateEggs(t) {
  for (const e of eggs) {
    if (!e.object.parent) continue;
    const p = .5 + .5 * Math.sin(t * .0022 + e.point.x * 3);
    e.light.intensity = .2 + p * .4; e.core.scale.setScalar(.8 + p * .5);
  }
}
function collectRelic(item) {
  if (relics.has(item.id)) return;
  relics.add(item.id);
  const ix = zone.interactables.indexOf(item); if (ix >= 0) zone.interactables.splice(ix, 1);
  item.object.parent?.remove(item.object);
  journal.push({ id: item.id, title: item.title, description: item.text, kind: 'reliquia', zone: currentZone });
  updateJournalCount();
  dread = Math.min(1, dread + .03); glitchPulse = Math.max(glitchPulse, .5); audio.stinger(.45);
  showToast(`RELIC ${relics.size} / ${RELIC_COUNT}`);
  if (relics.size === RELIC_COUNT) {
    journal.push({ id: 'tenth', title: 'The tenth object', description: 'Nine objects, nine empty places. The tenth has no name. It is you.', kind: 'reliquia', zone: currentZone });
    updateJournalCount(); showToast('ALL RELICS FOUND. THE HOUSE TURNS TOWARD YOU.');
  }
}
function addSkull(group, x, y, z, scale = 1) {
  const root = new THREE.Group(); root.position.set(x, y, z); root.scale.setScalar(scale); group.add(root);
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 10), mat(0xd8cfb8, .7)); cranium.scale.set(1, 1.1, 1.05); root.add(cranium);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(.2, .07, .14), mat(0xcdc3aa, .7)); jaw.position.set(0, -.17, .02); root.add(jaw);
  [-1, 1].forEach(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), M.black); e.position.set(s * .07, .02, .14); root.add(e); });
  return root;
}
function addHangingBones(group, x, y, z, count = 6) {
  for (let i = 0; i < count; i++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(.03, .22, 3, 6), mat(0xcfc6ad, .7));
    b.position.set(x + Math.sin(i * 1.3) * .08, y - i * .2, z); b.rotation.z = Math.sin(i * 2.1) * .5; group.add(b);
  }
}
function addJar(group, x, y, z) {
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .42, 12), new THREE.MeshStandardMaterial({ color: 0x9ab0a0, transparent: true, opacity: .35, roughness: .1 }));
  jar.position.set(x, y + .21, z); group.add(jar);
  const blob = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), mat(0x8a3a3a, .5)); blob.scale.set(1.2, .8, 1); blob.position.set(x, y + .2, z); group.add(blob);
}
function addCrow(group, x, y, z) {
  const c = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .22, 3, 6), M.black); c.position.set(x, y, z); c.rotation.z = .3; group.add(c);
  const h = new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), M.black); h.position.set(x + .1, y + .12, z); group.add(h);
}
// Rituals in the fields: a ring of figures around a pyre, and three posts with bodies on them.
function addFieldRitual(group, x, z) {
  addDistantRitual(group, x, z);
  for (let k = -1; k <= 1; k++) {
    const px = x + k * 4.2, pz = z + 7;
    const post = new THREE.Mesh(new THREE.BoxGeometry(.14, 3.4, .14), mat(0x17140f, 1)); post.position.set(px, 1.7, pz); group.add(post);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .8, 4, 8), mat(0x0a0908, 1)); body.position.set(px, 1.9, pz + .2); group.add(body);
  }
}
function buildAtmosphere() {
  buildRelics();
  const road = zones.road.group, home = zones.home.group, church = zones.church.group, cellar = zones.cellar.group, abat = zones.abattoir.group, ruin = zones.ruin.group;
  // Road: skulls on the fence posts, crows, and rituals out in the fields.

  [[-3.6, -9.6], [3.6, -26]].forEach(([x, z]) => addCrow(road, x, 1.55, z));
  addFieldRitual(road, -42, -22); addFieldRitual(road, 46, -40); addFieldRitual(road, -30, -56);
  // Home: a skull among the candles, a jar on a crate, bones hanging from the ceiling.

  addBox(home, -9.4, .5, -5.5, .8, 1, .8, M.darkWood); addJar(home, -9.4, 1.0, -5.5);
  // Church: a skull on the altar and one on a pew.

  // Cellar: a skull on the long table.

  // Abattoir: bone chains and a jar of something pale.
  addJar(abat, -9, .0, -7);
  // Ruin: a skull by the rubble.

  // Relics: nine easter eggs across the rooms, each with a small ominous glow.
}


// =============================================================================
// v3.4: smoke and fire, the industrial backdrop, relics as objects, the Professore's
// double-faced dialogue, the confession, the drive into the forest and the chase.
// =============================================================================
function glow(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: .5, transparent: true });
}
function softTex() {
  if (SOFT_TEX) return SOFT_TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  SOFT_TEX = new THREE.CanvasTexture(c); return SOFT_TEX;
}
function isVisibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
function respawnParticle(e, i, first) {
  const fire = e.kind === 'fire', spread = fire ? .5 : .4;
  e.life[i] = first ? Math.random() : 0;
  e.pos[i*3] = (Math.random() - .5) * spread; e.pos[i*3+1] = 0; e.pos[i*3+2] = (Math.random() - .5) * spread;
  e.vel[i*3] = (Math.random() - .5) * .15; e.vel[i*3+1] = fire ? .8 + Math.random() * 1.2 : .5 + Math.random() * .5; e.vel[i*3+2] = (Math.random() - .5) * .15;
}
function makeEmitter(group, x, y, z, kind) {
  const N = kind === 'fire' ? 90 : 60;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fire = kind === 'fire';
  const m = new THREE.PointsMaterial({ map: softTex(), size: fire ? .5 : 1.1, transparent: true, depthWrite: false,
    blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending, color: fire ? 0xff7a2a : 0x6a625a, opacity: fire ? .85 : .32 });
  const pts = new THREE.Points(geo, m); pts.position.set(x, y, z); pts.frustumCulled = false; group.add(pts);
  const e = { pts, geo, pos, life, vel, N, kind };
  for (let i = 0; i < N; i++) respawnParticle(e, i, true);
  emitters.push(e); return e;
}
function updateEmitters(dt) {
  for (const e of emitters) {
    if (!isVisibleChain(e.pts)) continue;
    for (let i = 0; i < e.N; i++) {
      e.life[i] += dt * (e.kind === 'fire' ? 1.6 : .12);
      if (e.life[i] >= 1) respawnParticle(e, i, false);
      e.pos[i*3] += e.vel[i*3] * dt; e.pos[i*3+1] += e.vel[i*3+1] * dt; e.pos[i*3+2] += e.vel[i*3+2] * dt;
      if (e.kind !== 'fire') e.pos[i*3] += Math.sin(e.life[i] * 6 + i) * .1 * dt;
    }
    e.geo.attributes.position.needsUpdate = true;
  }
  for (const r of rigs) {
    if (!isVisibleChain(r.drill)) continue;
    r.t += dt; r.drill.rotation.y += dt * 5;
    r.beacon.material.emissiveIntensity = Math.sin(r.t * 4) > .2 ? 2 : .3;
  }
}
function updateIndustryNoise(dt) {
  industryT -= dt; if (industryT > 0) return;
  industryT = 2.2 + Math.random() * 1.6;
  if (['road', 'home', 'abattoir', 'forest'].includes(currentZone))
    audio?.mechanicalNoise(1.5, 150 + Math.random() * 70, 2.4, .045, (Math.random() - .5) * .6);
}
// A chemical or drilling works on the horizon: offices with lit windows, a stack, pipes, a drill rig and a beacon.
function addIndustry(group, x, z, scale = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); root.scale.setScalar(scale); group.add(root);
  const concrete = mat(0x4a4c46, .95, { map: TEX.plaster }), rust = mat(0x7a4128, .9, { map: TEX.rust }), steel = mat(0x4c5256, .5, { map: TEX.metal });
  addBox(root, 0, 4, 0, 14, 8, 7, concrete);
  addBox(root, 0, 8.2, 0, 14.4, .3, 7.4, mat(0x22231f));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
    const lit = Math.random() < .45;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(.7, .8), lit ? glow(0xd8b070, .9) : mat(0x0c0d0d, .6));
    w.position.set(-5.4 + c * 1.8, 2.2 + r * 1.8, 3.55); root.add(w);
  }
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.15, 24, 14), rust); stack.position.set(10, 12, -2); root.add(stack);
  makeEmitter(root, 10, 24.5, -2, 'smoke');
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 20, 8), steel); p.rotation.z = Math.PI / 2; p.position.set(-1, 6.2 + i * .9, -4.4); root.add(p); }
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 30, 1.2), steel); tower.position.set(-14, 15, -6); root.add(tower);
  const drill = new THREE.Mesh(new THREE.CylinderGeometry(.1, .03, 7, 8), steel); drill.position.set(-14, 17, -6); root.add(drill);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), glow(0xff2a1a, 2)); beacon.position.set(-14, 30.2, -6); root.add(beacon);
  rigs.push({ drill, beacon, t: Math.random() * 6 });
  makeEmitter(root, -14, 20, -6, 'smoke');
  return root;
}
// Relic objects, each modelled after what it represents.
function buildRelicMesh(id) {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  const black = mat(0x111111, .5), paper = mat(0xe4dccb, .9), red = mat(0x7a1414, .6), steel = mat(0x8a8a86, .35), brown = mat(0x4a3424, .7);
  switch (id) {
    case 'relic-tape':
      add(new THREE.BoxGeometry(.2, .13, .03), black, 0, .14, 0);
      add(new THREE.BoxGeometry(.15, .07, .005), paper, 0, .16, .018);
      add(new THREE.CylinderGeometry(.03, .03, .01, 12), mat(0xddd6c4, .6), -.04, .16, .02, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(.03, .03, .01, 12), mat(0xddd6c4, .6), .04, .16, .02, 0, 0, Math.PI / 2);
      break;
    case 'relic-shoe':
      add(new THREE.BoxGeometry(.18, .03, .09), brown, 0, .02, 0);
      add(new THREE.BoxGeometry(.17, .09, .08), mat(0x5a3c28, .7), 0, .075, -.005);
      add(new THREE.BoxGeometry(.1, .012, .02), mat(0x2a1a10, .8), 0, .12, .045);
      add(new THREE.PlaneGeometry(.03, .02), paper, .08, .03, .05, 0, Math.PI / 2, 0);
      break;
    case 'relic-envelope':
      add(new THREE.BoxGeometry(.22, .005, .15), paper, 0, .01, 0);
      add(new THREE.BoxGeometry(.19, .001, .003), mat(0xcab896), 0, .0125, 0);
      add(new THREE.CylinderGeometry(.025, .025, .01, 12), red, .05, .02, .02);
      break;
    case 'relic-tooth':
      add(new THREE.BoxGeometry(.11, .03, .07), red, 0, .015, 0);
      add(new THREE.BoxGeometry(.105, .02, .065), paper, 0, .03, 0);
      add(new THREE.SphereGeometry(.018, 8, 6), mat(0xe3d7b0, .4), 0, .06, 0).scale.set(1, 1.4, 1);
      break;
    case 'relic-program':
      add(new THREE.BoxGeometry(.14, .002, .2), paper, 0, .005, 0);
      add(new THREE.BoxGeometry(.14, .002, .1), paper, 0, .012, .05, -.3, 0, 0);
      add(new THREE.BoxGeometry(.1, .002, .004), black, 0, .007, -.04);
      add(new THREE.BoxGeometry(.1, .002, .004), black, 0, .007, -.06);
      break;
    case 'relic-radio':
      add(new THREE.BoxGeometry(.2, .12, .07), mat(0x2a2a2a, .5), 0, .1, 0);
      add(new THREE.BoxGeometry(.12, .06, .005), mat(0x0a0a0a, .9), -.02, .1, .036);
      add(new THREE.CylinderGeometry(.01, .01, .02, 8), steel, .07, .12, .036, Math.PI / 2, 0, 0);
      add(new THREE.CylinderGeometry(.002, .002, .25, 4), steel, .08, .27, 0, 0, 0, .2);
      break;
    case 'relic-key':
      add(new THREE.TorusGeometry(.04, .008, 8, 16), steel, -.08, .04, 0);
      add(new THREE.BoxGeometry(.2, .018, .02), steel, .03, .02, 0);
      add(new THREE.BoxGeometry(.03, .02, .02), steel, .12, .005, 0);
      break;
    case 'relic-eye':
      add(new THREE.BoxGeometry(.16, .04, .12), mat(0x5a1414, .9), 0, .02, 0);
      const eye = add(new THREE.SphereGeometry(.035, 12, 10), mat(0xf2f0ea, .15), 0, .07, 0);
      add(new THREE.SphereGeometry(.015, 8, 6), black, 0, .07, .03);
      break;
    case 'relic-bone':
      add(new THREE.CylinderGeometry(.012, .012, .2, 8), mat(0xcfc6ad, .6), 0, .02, 0, 0, 0, Math.PI / 2);
      add(new THREE.SphereGeometry(.022, 8, 6), mat(0xcfc6ad, .6), -.1, .02, 0);
      add(new THREE.SphereGeometry(.022, 8, 6), mat(0xcfc6ad, .6), .1, .02, 0);
      break;
    default:
      add(new THREE.BoxGeometry(.12, .1, .12), black, 0, .06, 0);
  }
  return g;
}
function buildRelics() {
  const at = (zn) => zones[zn].group;
  addEgg(at('road'), -30, 12, 'relic-shoe', "Child’s shoe", 'Brown leather, stitched by hand. Inside is a card with the number 13. The number was scratched out and written smaller underneath.');
  addEgg(at('road'), 38, -18, 'relic-tape', 'Cassette 14-B', 'No title, only a marker label: 14-B. It is warm, as if someone has just finished listening to it.');
  addEgg(at('road'), -14, -44, 'relic-bone', 'Wing bone on wire', 'A small wing bone threaded on iron wire and hung from a post. It always turns in the same direction.');
  addEgg(at('home'), -8.2, 7.5, 'relic-envelope', 'Envelope with no name', 'Sealed with dark wax. Inside is a single sheet: "You are not the first to come in. You are the first to stay."');
  addEgg(at('home'), 9, -7.2, 'relic-tooth', 'Tooth in a matchbox', 'A molar in a matchbox. On the lid, in pencil: "This one was also one of them."');
  addEgg(at('church'), 7.6, -15.6, 'relic-program', 'Mass programme, 1977', 'A printed mass sheet. Beside the celebrant’s name, one line has been cut out with a razor.');
  addEgg(at('ruin'), -6, -6, 'relic-radio', 'Radio without batteries', 'A transistor radio with no batteries. When you turn the dial, between the static you hear someone breathing.');
  addEgg(at('cellar'), -7.4, 5.4, 'relic-key', 'Numbered key', 'A butcher’s key with 13 stamped into the bow. It opens nothing in this house. Perhaps it opens something beyond it.');
  addEgg(at('abattoir'), 9, -8.5, 'relic-eye', 'Glass eye', 'A glass eye in a velvet box, the kind used for mannequins. It always faces you from the same angle.');
}
function buildHand() {
  const g = new THREE.Group(); const skin = mat(0xa8927a, .7);
  g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(.22, .06, .26), skin), {}));
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(.018, .16, 3, 6), skin); f.position.set(-.075 + i * .05, .02, -.2); f.rotation.x = -.45; g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(.02, .12, 3, 6), skin); th.position.set(.13, 0, -.06); th.rotation.z = -.8; g.add(th);
  g.rotation.x = Math.PI / 2;
  return g;
}
function buildCar() {
  const g=new THREE.Group(),wheels=[];
  const paint=mat(0x24272a,.44,{map:TEX.metal,bumpScale:.018}),chrome=mat(0x8e928b,.34,{metalness:.78}),rubber=mat(0x111210,.94),glass=new THREE.MeshStandardMaterial({color:0x263032,roughness:.18,metalness:.12,transparent:true,opacity:.48,side:THREE.DoubleSide});
  const body=roundedHousing(1.78,.62,3.72,.26,paint,.07);body.position.y=.62;g.add(body);
  const hood=roundedHousing(1.70,.30,1.04,.19,paint,.045);hood.position.set(0,.99,-1.27);g.add(hood);
  const trunk=roundedHousing(1.66,.29,.78,.16,paint,.04);trunk.position.set(0,.94,1.45);g.add(trunk);
  const cabin=roundedHousing(1.52,.68,1.86,.18,glass,.04);cabin.position.set(0,1.21,.12);g.add(cabin);
  const roof=roundedHousing(1.48,.10,1.66,.07,paint,.03);roof.position.set(0,1.59,.12);g.add(roof);
  for(const side of [-1,1]){
    const pillar=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.68,4,6),paint);pillar.position.set(side*.69,1.23,.05);pillar.rotation.z=side*.15;g.add(pillar);
    const doorLine=new THREE.Mesh(new THREE.TorusGeometry(.5,.012,4,18,Math.PI),chrome);doorLine.position.set(side*.79,.96,.25);doorLine.rotation.y=side*Math.PI/2;g.add(doorLine);
  }
  // Front grille and twin headlights: old bodywork, not a toy car silhouette.
  const grille=new THREE.Mesh(new THREE.TorusGeometry(.28,.025,6,24,Math.PI),chrome);grille.position.set(0,.55,-1.89);grille.rotation.x=Math.PI/2;g.add(grille);
  for(let i=0;i<8;i++){const slat=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.4,5),chrome);slat.rotation.x=Math.PI/2;slat.position.set(-.14+i*.04,.56,-1.90);g.add(slat);}
  [-.62,.62].forEach(x=>{const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.13,.14,.07,20),glow(0xe8dcb2,.95));lamp.rotation.x=Math.PI/2;lamp.position.set(x,.72,-1.91);g.add(lamp);const rim=new THREE.Mesh(new THREE.TorusGeometry(.14,.018,5,20),chrome);rim.position.set(x,.72,-1.94);g.add(rim);});
  for(const [x,zp] of [[-.82,1.2],[.82,1.2],[-.82,-1.2],[.82,-1.2]]){
    const wheel=new THREE.Group();wheel.position.set(x,.36,zp);g.add(wheel);
    const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.24,20),rubber);tyre.rotation.z=Math.PI/2;wheel.add(tyre);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.23,.035,7,24),chrome);rim.rotation.y=Math.PI/2;wheel.add(rim);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.10,.10,.26,18),mat(0x555951,.34,{metalness:.75}));hub.rotation.z=Math.PI/2;wheel.add(hub);wheels.push(wheel);
  }
  const dash=roundedHousing(1.38,.18,.26,.06,mat(0x171815,.88),.02);dash.position.set(0,1.03,-.62);g.add(dash);
  const steering=new THREE.Mesh(new THREE.TorusGeometry(.2,.016,6,24),mat(0x1a1714,.5));steering.position.set(-.32,1.20,-.35);steering.rotation.x=.35;g.add(steering);
  const seatMat=mat(0x302c27,.95,{map:TEX.wood});for(const side of [-1,1]){
    const seat=roundedHousing(.55,.62,.60,.13,seatMat,.035);seat.position.set(side*.42,.56,.58);g.add(seat);
  }
  const thermos=buildThermos(g,.43,.96,.42);thermos.scale.setScalar(.72);thermos.rotation.z=.08;storyRef.carThermos=thermos;
  g.userData.wheels=wheels;return g;
}
// The forest beyond the canal, with the car, the chaser and the lamp that marks the starting point.
function buildForest() {
  const fz = newZone('forest', 0x0a0d0c, .05, { minX: -30, maxX: 30, minZ: -70, maxZ: 12 }, [0, 0, 0]);
  const g = fz.group;
  for (let i = 0; i < 70; i++) {
    const x = (Math.random() * 2 - 1) * 28, z = 10 - Math.random() * 80;
    if (Math.abs(x) < 3.2) continue;
    addTree(g, x, z, 6 + Math.random() * 5, i + 1);
  }
  addIndustry(g, -26, -68, .8); addIndustry(g, 26, -70, .8);
  addLight(g, 0xffa050, 2.2, 9, 0, 2.6, 0);
  addBox(g, 0, 1.5, 0, .1, 3, .1, mat(0x111111));
  addBox(g, 0, 3.05, 0, .4, .2, .4, glow(0xffb060, 1.8));
  const car = buildCar(); car.visible = false; g.add(car); storyRef.car = car;
  const ch=makeStalker();ch.visible=false;g.add(ch);storyRef.chaser=ch;
  const voidFigure=new THREE.Group();voidFigure.visible=false;voidFigure.position.set(0,0,-29);g.add(voidFigure);
  const bodyMat=new THREE.MeshStandardMaterial({color:0x111512,roughness:1,transparent:true,opacity:.66});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,1.2,7,12),bodyMat);body.position.y=1.18;voidFigure.add(body);
  const headMat=new THREE.MeshStandardMaterial({color:0x0b0d0b,roughness:1,transparent:true,opacity:.50});
  const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,10),headMat);head.position.y=2.42;voidFigure.add(head);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.45,.035,6,44),new THREE.MeshBasicMaterial({color:0x9ca58f,transparent:true,opacity:.28}));ring.rotation.x=-Math.PI/2;ring.position.y=.04;voidFigure.add(ring);storyRef.voidFigure=voidFigure;
  storyRef.voidLeaves=[];
  for(let i=0;i<42;i++){const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.18+(i%4)*.045,.055+(i%3)*.02),new THREE.MeshStandardMaterial({color:[0x5c6245,0x77714e,0x333d2d][i%3],roughness:1,transparent:true,opacity:.82,side:THREE.DoubleSide}));leaf.position.set(Math.cos(i*2.399)*(2.8+(i%3)),.18+(i%6)*.23,-29+Math.sin(i*2.399)*(2+(i%4)));leaf.userData={phase:i*2.399,radius:Math.hypot(leaf.position.x,leaf.position.z+29),height:leaf.position.y};g.add(leaf);storyRef.voidLeaves.push(leaf);}
}
// Il Professore: friendly on the surface, and every task he gives brings the new arrival closer to the void.
function primoDialogue(){
  const f=storyFlags;
  if(f.has('darkroom-cleared')&&!f.has('first-tea'))return{line:'You read the margins. The sentence about willing nothingness is printed. The timings are mine. I added one line beneath them: “What is falling must also be pushed.” Those are not instructions for falling. They are the seconds I watched after each body stopped moving. You found the earplugs, too.',choices:['Why did you wear them?','Did you ever hear The White?'],replies:['I wanted the image without the sound. Sound makes a fall belong to someone. An image can be kept.','I heard the reels turn. I heard the room when the motor stopped. I never heard an album.'],actions:[()=>storyFlags.add('first-questioned'),()=>storyFlags.add('first-questioned')]};
  if(f.has('first-tea'))return{line:'The cup was warm. The room was not. You keep looking for the moment I fell, but you have already watched it. The sound came later.',choices:['Who is left in the house?','What was The White?'],replies:['The person who pours. The person who opens the door. The person who arrives.','A room that kept being mistaken for a song. That is all I can tell you now.'],actions:[()=>storyFlags.add('ines-survivor-seen'),()=>storyFlags.add('white-questioned')]};
  if(f.has('escaped-forest'))return{line:'You came back. I thought you might. There is a particular way a person walks after seeing the place where they would disappear. You do not have to tell me what you saw.',choices:['I want to leave.','Why did you bring me there?'],replies:['Of course. I would never keep you. The door is open; you only have to decide which side of it you are on.','I wanted you to hear the trees without the village speaking over them. You heard something. That is not the same as understanding it.'],actions:[()=>storyFlags.add('primo-leave'),()=>storyFlags.add('primo-questioned')]};
  if(f.has('primo-task-dig')&&f.has('primo-task-candles'))return{line:'The album is almost ready. You have done more than I asked, and I am grateful. But you have started looking at the doors instead of the rooms. That usually means a person is close to deciding.',choices:['Take me to the car.','I want to leave.','What do you need from me?'],replies:['Good. We can speak where the walls cannot interrupt. The forest is quieter than this room.','Then go. I will not follow. I only hope you do not mistake the road for an answer.','Nothing you do not already know how to give. A little attention. A little space. Your name, perhaps, if you still feel it belongs to you.'],actions:[()=>{storyFlags.add('car-invited');pendingCar=true;},()=>storyFlags.add('primo-leave'),()=>storyFlags.add('primo-questioned')]};
  if(f.has('met-primo'))return{line:'You remember the lamp. I was glad to see you reach it. You looked relieved when I spoke to you. People rarely notice how much they need that small kindness until it is offered.',choices:['You made this place feel safe.','You knew I was coming.','Why are you helping me?'],replies:['I wanted you to feel there was somewhere to return to. A person will walk a very long way if they believe someone has noticed their arrival.','I knew the letter would find you. I did not know what you would bring with you. That part is always your own.','Because carrying yourself everywhere is exhausting. I thought you might want to set something down.'],actions:[()=>storyFlags.add('primo-trust'),()=>storyFlags.add('primo-suspicion'),()=>storyFlags.add('primo-questioned')]};
  return{line:'Good. You listened to the wrong things first, which is how everyone arrives. Let me give you something to do with your hands while you decide what you came for.',choices:['Why must I dig a grave?','What are the candles for?','Take me somewhere quiet.'],replies:['The ground under the willow remembers the first name we lost. Dig it up, and you will understand why we never say it aloud.','Three flames on the altar, so the choir can see where to fall. Light them, and the house will stop asking you questions.','Get in the car. There is a quiet place in the forest. Nobody hears a car in the forest.'],actions:[()=>storyFlags.add('primo-task-dig'),()=>storyFlags.add('primo-task-candles'),()=>{storyFlags.add('car-invited');pendingCar=true;}]};
}

function buildTeacup(group,x,y,z){
  const root=new THREE.Group();root.position.set(x,y,z);group.add(root);
  const porcelain=mat(0xb9b09d,.24,{metalness:.08}),tea=mat(0x24150f,.18,{metalness:.04});
  const profile=[new THREE.Vector2(.07,0),new THREE.Vector2(.11,.025),new THREE.Vector2(.15,.16),new THREE.Vector2(.18,.28),new THREE.Vector2(.15,.31),new THREE.Vector2(.06,.31)];
  const cup=new THREE.Mesh(new THREE.LatheGeometry(profile,24),porcelain);cup.position.y=.03;root.add(cup);
  const liquid=new THREE.Mesh(new THREE.CircleGeometry(.145,24),tea);liquid.rotation.x=-Math.PI/2;liquid.position.y=.32;root.add(liquid);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.105,.025,7,20,Math.PI*1.55),porcelain);handle.position.set(.16,.20,0);handle.rotation.z=-.6;root.add(handle);
  const saucer=new THREE.Mesh(new THREE.TorusGeometry(.19,.025,6,24),porcelain);saucer.rotation.x=Math.PI/2;saucer.position.y=.02;root.add(saucer);return root;
}
function startFirstTeaScene(primo){
  cancelHold();
  if(primo!==storyRef.first||storyFlags.has('first-tea')||storyScene||gameEnded)return;
  const ines=cultRoster.find(n=>n.name==='Ines');
  if(!ines||ines.fate!=='present'){triggerDeath('THE TEA NEVER CAME','Ines was no longer there to pour it. The room had lost the one person who knew how to make an ending gentle.');return;}
  storyFlags.add('first-tea-started');keys.clear();controls.unlock();dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');
  const z=zones.abattoir;const old=z.interactables.indexOf(primo);if(old>=0)z.interactables.splice(old,1);primo.object.visible=true;
  if(ines.object.parent!==z.group)transferCultist(ines,z,-2.4,-5.35);else ines.object.position.set(-2.4,0,-5.35);
  ines.point=ines.object.position;ines.object.rotation.y=.72;primo.object.position.set(0,0,-7.15);primo.object.rotation.y=Math.PI;
  const cup=buildTeacup(z.group,-.78,.015,-5.95);storyRef.firstCup=cup;
  const thermos=buildThermos(z.group,-2.6,0,-5.0);thermos.scale.setScalar(.72);storyRef.firstThermos=thermos;
  storyScene={type:'first-tea',t:0,dur:17,i:0,leader:primo,ines,cup,collapsed:false,sound:false,lines:[
    [.7,'Tobia: She crosses the room with the thermos. Nobody asks her to.'],
    [3.4,'Ines: You have watched so many things fall. You must be tired.'],
    [6.4,'Il Professore: I kept the image. I wore the plugs so the sound could not make a claim on me.'],
    [9.3,'Tobia: The cup touches the table. Il Professore watches the dust settle.'],
    [11.1,'Ines: Someone has to make it gentle.'],
    [14.1,'Voice: The sound arrives late. The man is already gone.']
  ]};
}
function endFirstTeaScene(){
  const s=storyScene;if(!s||s.type!=='first-tea')return;
  if(s.savedAnchor){playerAnchor.position.copy(s.savedAnchor);}setCinema(false);
  const primo=s.leader,ines=s.ines;
  if(primo){primo.fate='dead';primo.object.visible=false;}
  if(ines){ines.talkedOnce=true;ines.fate='present';ines.object.visible=true;}
  storyFlags.add('first-tea');storyFlags.add('first-dead');storyFlags.add('institution-survives');
  journal.push({id:'first-tea',title:'The cup at 03:17',description:'Ines poured tea for Il Professore as he watched dust settle. The image of his fall arrived before its sound. She stayed. The house still had someone to open the door.',kind:'witness account',zone:'abattoir'});updateJournalCount();updateMissions();
  storyScene=null;dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');camera.position.set(0,1.63,0);camera.rotation.set(0,s.savedRot?.[1]||0,0);resetLook();
  showToast('IL PROFESSORE IS GONE.');
}
function storyLine(text) {
  const m = /^([^:]+):\s*/.exec(text);
  $('speaker').textContent = m ? m[1].toUpperCase() : 'VOICE';
  $('subtitle').textContent = text.replace(/^[^:]+:\s*/, '');
  $('subtitle-wrap').classList.add('visible');
  speakVoice(text, m ? m[1] : '');
  clearTimeout(storyLine.timer);
  storyLine.timer = setTimeout(() => { if (!dialogueOpen && !storyScene) $('subtitle-wrap').classList.remove('visible'); }, 4200);
}
function addPastoraleStation(zone,id,title,description,x,z,kind){
  const root=new THREE.Group();root.position.set(x,0,z);zone.group.add(root);
  const stone=mat(0x565349,.98,{map:TEX.concrete}),reedMat=mat(0x625e43,.96),wheatMat=mat(0x8e7950,.96),dark=mat(0x262923,.98);
  if(kind==='water'){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.54,.018,5,36),new THREE.MeshStandardMaterial({color:0x9aa49a,roughness:.24,metalness:.2,transparent:true,opacity:.42}));ring.rotation.x=Math.PI/2;ring.position.y=.04;root.add(ring);
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.32,1),stone);rock.scale.set(1.2,.42,.8);rock.position.set(.36,.12,.24);root.add(rock);
    for(let i=0;i<9;i++){const a=i*2.399,reed=new THREE.Mesh(new THREE.CylinderGeometry(.012,.026,.72+(i%3)*.14,6),reedMat);reed.position.set(Math.cos(a)*(.35+(i%2)*.18),.36,Math.sin(a)*(.35+(i%2)*.18));reed.rotation.z=Math.cos(a)*.16;reed.rotation.x=Math.sin(a)*.12;root.add(reed);const blade=new THREE.Mesh(new THREE.ConeGeometry(.045,.42,5),reedMat);blade.position.set(reed.position.x+Math.cos(a)*.12,.76,reed.position.z+Math.sin(a)*.12);blade.rotation.z=-.16+Math.cos(a)*.2;root.add(blade);}
  }else if(kind==='grain'){
    const bundle=new THREE.Group();bundle.position.y=.02;root.add(bundle);
    for(let i=0;i<11;i++){
      const a=i*2.399,r=.06+(i%3)*.04,h=1.02+(i%4)*.12,xp=Math.cos(a)*r,zp=Math.sin(a)*r;
      const stalk=new THREE.Mesh(new THREE.CylinderGeometry(.012,.018,h,6),wheatMat);stalk.position.set(xp,h/2,zp);stalk.rotation.z=Math.cos(a)*.08;bundle.add(stalk);
      const head=new THREE.Mesh(new THREE.ConeGeometry(.055,.28,6),mat(0xa18b5a,.98));head.position.set(xp+Math.cos(a)*.035,h+.08,zp);head.rotation.z=-.2+Math.sin(a)*.12;bundle.add(head);
      for(let k=0;k<3;k++){const awn=new THREE.Mesh(new THREE.CylinderGeometry(.003,.005,.16,4),wheatMat);awn.position.set(head.position.x+(k-1)*.035,h+.23,head.position.z);awn.rotation.z=(k-1)*.17;bundle.add(awn);}
    }
    const twine=new THREE.Mesh(new THREE.TorusGeometry(.14,.012,5,24),mat(0x5e4a31,.95));twine.position.y=.42;twine.rotation.x=Math.PI/2;bundle.add(twine);
    const stoneBase=new THREE.Mesh(new THREE.DodecahedronGeometry(.27,1),stone);stoneBase.scale.set(1.2,.36,1);stoneBase.position.y=.05;root.add(stoneBase);
  }else{
    const branch=new THREE.Mesh(new THREE.CylinderGeometry(.018,.028,1.35,7),dark);branch.position.y=.63;branch.rotation.z=.22;root.add(branch);
    for(let i=0;i<7;i++){const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.13,.46),new THREE.MeshStandardMaterial({color:i%2?0x535d40:0x6d7050,roughness:1,side:THREE.DoubleSide}));leaf.position.set((i%2?-.15:.16),.28+i*.14,(i-3)*.035);leaf.rotation.set(.2,(i%2)*.45,(i-3)*.1);root.add(leaf);}
    for(let i=0;i<4;i++){const pebble=new THREE.Mesh(new THREE.DodecahedronGeometry(.16,1),stone);pebble.scale.set(1,.38,.7);pebble.position.set(-.35+i*.22,.055,.18);root.add(pebble);}
  }
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));marker.position.set(0,.58,0);root.add(marker);
  const flag='pastorale-'+id;
  zone.interactables.push({id:'pastorale-'+id,type:'story',object:marker,point:new THREE.Vector3(x,.58,z),radius:3.2,prompt:'[ E ] LISTEN TO THE LAND',requiresFlag:'escaped-forest',blockedHint:'The road is not ready to give this back to you.',run:()=>{
    if(storyFlags.has(flag)){showToast('THIS INTERVAL HAS ALREADY BEEN KEPT.');return;}
    storyFlags.add(flag);journal.push({id:flag,title,description,kind:'pastoral record',zone:'road'});updateJournalCount();
    flashFragment(id==='water'?'room-tone':id==='grain'?'script':'collapse',125);
    audio?.mechanicalTone(id==='water'?61:id==='grain'?73:49,id==='water'?29:id==='grain'?37:24,1.8,'sine',.025,0);
    showToast('PASTORALE RECORDED // '+title.toUpperCase());
    const all=['pastorale-water','pastorale-grain','pastorale-reeds'].every(v=>storyFlags.has(v));
    if(all&&!storyFlags.has('pastorale-complete')){
      storyFlags.add('pastorale-complete');
      startMonologue([
        'Voice: The Mass has become small enough to fit inside a field.',
        'Tobia: Nobody is buried here. The water carries the interval; the grain carries the weight.',
        'Voice: The landscape can mourn without asking the dead to return.'
      ],19);
    }
    updateMissions();
  }});
  return root;
}
function startPinoCombineScene(){
  cancelHold();
  if(storyFlags.has('pino-collapsed')){showToast('THE FIELD HAS ALREADY KEPT HIM.');return;}
  if(!storyFlags.has('pino-sent')||storyScene||gameEnded||currentZone!=='road')return;
  const pino=storyRef.pino,machine=storyRef.combine;
  if(!pino||!machine){console.error('Pino combine scene is missing its character or machine reference.');showToast('THE FIELD IS EMPTY. THE ENGINE HAS NO WITNESS.');return;}
  if(pino.fate==='dead'){showToast('PINO IS NO LONGER HERE.');return;}
  keys.clear();controls.unlock();dialogueOpen=false;activeTarget=null;
  $('subtitle-wrap').classList.remove('visible');$('dialogue-options').innerHTML='';$('prompt').classList.remove('visible');
  if(pino.object.parent!==zones.road.group)transferCultist(pino,zones.road,-49,-34);
  pino.fate='present';pino.object.visible=true;pino.object.position.set(-49,0,-34);pino.point=pino.object.position;pino.object.rotation.set(0,-Math.PI/2,0);pino.walking=true;
  machine.visible=true;machine.position.set(-42,0,-35);machine.rotation.set(0,-Math.PI/2,0);
  storyFlags.add('pino-combine-started');
  storyScene={type:'pino-combine',t:0,dur:16,i:0,pino,machine,collapse:false,sound:false,lines:[
    [.7,'Tobia: The engine is running. There is nobody in the cab.'],
    [3.1,'Pino: I thought it was only a machine. I thought that meant the work belonged to nobody.'],
    [6.1,'Tobia: Pino does not look at you. The man who sent him here is nowhere in the field.'],
    [9.2,'Voice: The blades turn. The field accepts the body as another part of the harvest.'],
    [13.1,'Tobia: The engine keeps running after the sound of him has stopped.']
  ]};
  audio?.mechanicalTone(58,30,4.2,'sawtooth',.055,0);
  showToast('THE ENGINE IS RUNNING. STAY WITH THE FIELD.');
}
function endPinoCombineScene(){
  const s=storyScene;if(!s||s.type!=='pino-combine')return;
  if(s.savedAnchor){playerAnchor.position.copy(s.savedAnchor);}setCinema(false);
  const pino=s.pino||storyRef.pino,machine=s.machine||storyRef.combine;
  if(pino){pino.fate='dead';pino.walking=false;pino.object.visible=false;}
  if(machine){machine.position.set(-52,0,-35);machine.rotation.set(0,-Math.PI/2,0);}
  storyFlags.add('pino-collapsed');storyFlags.add('complicit');
  if(!journal.some(entry=>entry.id==='pino-combine-death'))journal.push({id:'pino-combine-death',title:'The Field Kept Pino',description:'Pino ran toward the combine because he believed the road might still lead somewhere. The machine crossed the field without a driver. You watched it take him. The engine continued after there was no one left to follow.',kind:'witness account',zone:'road'});
  updateJournalCount();storyScene=null;dialogueOpen=false;$('subtitle-wrap').classList.remove('visible');
  camera.position.set(0,1.63,0);camera.rotation.set(0,s.savedRot?.[1]||0,0);resetLook();
  showToast('THE ENGINE HAS STOPPED.');
  updateMissions();
}

function buildStory() {
  addIndustry(zones.road.group, 56, -58, 1.1);
  addIndustry(zones.road.group, -60, -62, 1);
  addIndustry(zones.home.group, 14, -44, .9);
  addIndustry(zones.abattoir.group, 44, 0, .9);
  // A rusted combine rests in the wheat field, its header turned toward the road.
  const combine=buildCombineHarvester(zones.road.group,-47,-39,.92);combine.visible=true;storyRef.combine=combine;
  const pinoMarker=new THREE.Mesh(new THREE.SphereGeometry(.18,8,6),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));pinoMarker.position.set(-43,.2,-31);zones.road.group.add(pinoMarker);
  zones.road.interactables.push({id:'pino-combine-event',type:'event',object:pinoMarker,point:pinoMarker.position,radius:4.3,prompt:'[ E ] FOLLOW THE ENGINE',requiresFlag:'pino-sent',blockedHint:'Pino has not asked you to follow him into the field.',run:startPinoCombineScene});
  // After escaping the forest, mourning leaves the nave and enters the landscape.
  addPastoraleStation(zones.road,'water','Water Interval','The paddy holds the church bell without reflecting the tower. You hear a low vibration under the water. There is no congregation here, only a sound the reeds can carry.',45,-42,'water');
  addPastoraleStation(zones.road,'grain','Grain Interval','The stalks bend in one direction, then another. No wind reaches your face. The choir is not present; the interval remains in the field after the voices are gone.',-51,24,'grain');
  addPastoraleStation(zones.road,'reeds','Reed Interval','The canal keeps the shape of a funeral procession but no bodies pass. The reeds bow and rise. No one is buried here. The landscape has inherited the work of mourning.',-31,-3,'reeds');
  // The confessional: a booth in the church with a grille between the penitent and the priest.
  const booth = new THREE.Group(); booth.position.set(6.5, 0, -10); zones.church.group.add(booth);
  addBox(booth, 0, 1.1, 0, 1.4, 2.2, 1.2, mat(0x2e2016, .6));
  addBox(booth, 0, 1.45, .62, .9, .5, .05, mat(0x0a0908, .9));
  storyRef.hand = buildHand(); storyRef.hand.position.set(6.5, -1, -12.6); storyRef.hand.visible = false; zones.church.group.add(storyRef.hand);
  zones.church.interactables.push({ id: 'confession', type: 'story', object: booth, point: new THREE.Vector3(6.5, .9, -8.4), radius: 2.4, prompt: '[ E ] ENTER THE CONFESSIONAL', run: startConfession });
  // the Professore's dialogue is generated from the story so far.
  const primo = zones.abattoir.interactables.find(i => i.name === 'The First' || /primo/i.test(i.name || ''));
  if (primo) Object.defineProperty(primo, 'dialogue', { get: primoDialogue, configurable: true });
  buildForest();
}
function startConfession() {
  cancelHold(); if (storyFlags.has('confessed') || storyScene) return;
  storyFlags.add('confessed');
  storyScene = { type: 'confession', t: 0, dur: 21, i: 0, lines: [
    [.6, 'Priest (behind the grille): Kneel. Say nothing until I open the grille.'],
    [4, 'Priest: The register from the winter of 1977 is still in the sacristy. Thirteen names, one recording, one heater nobody checked.'],
    [9, 'Priest: There is a fourteenth name. It was written in the same ink, the morning after the choir died. It is yours.'],
    [13, 'Priest: The date beside it is tomorrow. You agreed to come before you ever knocked on the door.'],
    [15.1, 'Priest: Tobit was sent into blindness carrying a cure for another person. Your name is not a promise that you will heal anyone. It is a task you have not yet chosen.'],
    [16.5, 'Something is rising in the nave behind the grille. A hand, with no arm attached to it.'],
    [19.4, 'The hand sinks back into the dark. The grille closes.']] };
}
function endConfession() {
  const s = storyScene; if (s?.savedAnchor) { playerAnchor.position.copy(s.savedAnchor); camera.position.set(0, 1.63, 0); camera.rotation.set(0, s.savedRot[1], 0); resetLook(); } setCinema(false);
  storyScene = null; storyRef.hand.visible = false;
  journal.push({ id: 'register-14', title: 'The fourteenth name', description: 'Winter 1977 register: thirteen names, then a fourteenth in the same ink. The name is yours. The date beside it is tomorrow.', kind: 'document', zone: 'church' });
  updateJournalCount(); fear = Math.min(1, fear + .1); glitchPulse = Math.max(glitchPulse, .9);
  showToast('YOUR NAME IS IN THE REGISTER.');
}
function beginForestCar() {
  cancelHold();
  storyFlags.add('car-invited');
  enterZone('forest', [0, 0, 0]);
  const car = storyRef.car; car.visible = true; car.position.set(0, 0, 0); car.rotation.y = 0;
  if (!car.userData.driver) { const d = extraFigure(car, -.42, .62, 'The First', 0x171716, 1); seatNPC(d, -.42, .62, Math.PI); d.object.position.y = .22; if (d.head) d.head.material = headMaterial(); car.userData.driver = d; }
  audio?.starter(); setTimeout(() => { if (storyScene?.type === 'car') storyScene.eng = audio?.engineStart(); }, 1400);
  storyScene = { type: 'car', t: 0, dur: 17, i: 0, lines: [
    [.8, 'Il Professore: Sit. Breathe on the glass and it fogs up, then it clears. Most things work like that.'],
    [4.5, 'Il Professore: We drive a little. Nobody in the village listens to cars, and the forest does not repeat what it hears.'],
    [9, 'Il Professore: You did well at the table. Most people never ask who taught them to stop asking.'],
    [13.5, 'Il Professore: Get out now. Keep the lamp behind you.']] };
}
function updateStoryScene(dt, t) {
  const s = storyScene; s.t += dt;
  if (['pino-combine','first-tea','confession','car'].includes(s.type) && !s.savedAnchor) { s.savedAnchor = playerAnchor.position.clone(); s.savedRot = [camera.rotation.x, camera.rotation.y]; playerAnchor.position.set(0, 0, 0); setCinema(true); }
  while (s.i < s.lines.length && s.t >= s.lines[s.i][0]) { storyLine(s.lines[s.i][1]); s.i++; }
  if (s.type === 'hold') {
    // Keep the monologue visible for the duration of its final whispered line,
    // then clear the subtitle independently of the remaining scene hold.
    if (!s.subtitleHidden && s.subtitleEndAt != null && s.t >= s.subtitleEndAt) {
      s.subtitleHidden = true;
      clearTimeout(storyLine.timer);
      if (!dialogueOpen) $('subtitle-wrap').classList.remove('visible');
    }
    if (s.t >= s.dur) {
      storyScene = null;
      if (!dialogueOpen) $('subtitle-wrap').classList.remove('visible');
    }
  }
  else if(s.type==='dario-eavesdrop'){ updateDarioEavesdrop(s, dt); }
  else if(s.type==='station'){ updateStation(s, dt); }
  else if(s.type==='drive'){ updateDrive(s, dt); }
  else if(s.type==='pino-combine'){
    const pino=s.pino||storyRef.pino,machine=s.machine||storyRef.combine;
    camera.position.set(-37.2,6.8,-27.8);camera.lookAt(-51,1.0,-39.5);
    if(pino&&pino.fate!=='dead'){
      pino.object.position.x=-49-Math.min(5.75,s.t*.72);
      pino.object.position.z=-34-Math.sin(s.t*.55)*.22;
      pino.object.rotation.y=-Math.PI/2;pino.object.rotation.z=Math.sin(s.t*4)*.08;pino.walking=true;
    }
    if(machine){
      machine.position.x=-42-Math.min(10,Math.max(0,s.t-1.8)*1.62);machine.position.z=-35+Math.sin(s.t*.3)*.12;machine.rotation.y=-Math.PI/2;
      if(machine.userData.reel)machine.userData.reel.rotation.x+=dt*2.4;
      if(machine.userData.wheels)machine.userData.wheels.forEach(w=>{w.rotation.z+=dt*4.8;});
    }
    if(s.t>=8.0&&!s.collapse){s.collapse=true;if(pino){pino.fate='dead';pino.walking=false;pino.object.visible=false;}flashFragment('collapse',190);glitchPulse=Math.max(glitchPulse,1.2);}
    if(s.t>=11.3&&!s.sound){s.sound=true;audio?.mechanicalNoise(.34,360,1.1,.18,0);audio?.mechanicalTone(84,32,1.8,'sawtooth',.09,0);audio?.killSting();}
    if(s.t>=s.dur)endPinoCombineScene();
  }
  else if(s.type==='first-tea'){
    const leader=s.leader,ines=s.ines,k=THREE.MathUtils.smoothstep(s.t,0,s.dur);
    camera.position.set(-1.2+.22*Math.sin(s.t*.35),1.8,-3.25-.65*k);camera.lookAt(-.2,1.28,-6.35);
    if(ines){ines.object.rotation.y=.68+Math.sin(s.t*1.2)*.018;ines.object.position.x=-2.4+THREE.MathUtils.smoothstep(s.t,1,4)*1.2;}
    if(leader&&s.t<9.9){leader.object.rotation.y=Math.PI+Math.sin(s.t*.42)*.035;leader.object.rotation.x=Math.sin(s.t*.8)*.018;}
    if(leader&&s.t>=9.9&&!s.collapsed){s.collapsed=true;leader.object.rotation.x=1.38;leader.object.rotation.z=.12;leader.object.position.y=-.22;flashFragment('tea',185);glitchPulse=Math.max(glitchPulse,1.45);}
    if(leader&&s.t>=12.1)leader.object.visible=false;
    if(s.t>=14.1&&!s.sound){s.sound=true;audio?.mechanicalNoise(.22,2400,6,.12,.15);audio?.mechanicalTone(96,34,1.2,'sawtooth',.08,-.1);audio?.killSting();}
    if(s.t>=s.dur)endFirstTeaScene();
  }
  else if (s.type === 'finale') { updateFinaleV6(s, dt); } else if (s.type === 'intro') { updateIntroV6(s, dt); } else if (s.type === 'intro-old') {
    const k = THREE.MathUtils.smoothstep(s.t, 0, s.dur);
    camera.position.set(Math.sin(s.t * .8) * .05, 1.62 + Math.sin(s.t * 2.6) * .025, THREE.MathUtils.lerp(64, 27, k));
    camera.lookAt(Math.sin(s.t * .3) * .3, .4, -20);
    $('intro-dark').style.opacity = String(Math.max(0, 1 - s.t / 9));
    if (scene.fog) scene.fog.density = Math.min(scene.fog.density, .012);
    if (s.t >= s.dur) endIntro();
  } else if (s.type === 'car') {
    const car = storyRef.car, k = THREE.MathUtils.smoothstep(s.t, 1, s.dur - 3);
    car.position.z = -44 * k; car.position.x = Math.sin(s.t * 1.3) * .05; car.rotation.y = Math.sin(s.t * .4) * .02;
    const vib = s.eng ? .003 + k * .004 : 0; s.eng?.setRpm(850 + (THREE.MathUtils.smoothstep(s.t, 1, 5) - THREE.MathUtils.smoothstep(s.t, s.dur - 5, s.dur - 3)) * 2200);
    camera.position.set(car.position.x + .42 + (Math.random() - .5) * vib, 1.16 + Math.sin(s.t * 2.1) * .01 + (Math.random() - .5) * vib, car.position.z + .45);
    camera.lookAt(car.position.x + .02, 1.05, car.position.z - 6);
    if (s.t >= s.dur) endCarScene();
  } else if (s.type === 'confession') {
    camera.position.set(6.5,1.25,-7.7);camera.lookAt(6.5,1.35,-10.6);
    const hand=storyRef.hand,rise=THREE.MathUtils.clamp((s.t-15.5)/1.4,0,1),sink=THREE.MathUtils.clamp((s.t-18)/1.4,0,1);
    hand.visible=s.t>15.5;hand.position.y=-1+2.7*rise-2.7*sink;hand.rotation.z=Math.sin(s.t*3)*.14;if(s.t>=s.dur)endConfession();
  } else if(s.type==='ending'){
    const growth=storyRef.voidGrowth;
    if(s.t<8.2){
      const a=THREE.MathUtils.smoothstep(s.t,0,8.2);
      camera.position.set(Math.sin(s.t*.22)*.035,1.63-a*.22,-.10-a*.55);camera.lookAt(0,1.48,-2.2);
      if(growth){growth.visible=true;growth.scale.setScalar(.001+THREE.MathUtils.smoothstep(s.t,1.4,8.1));}
      if(scene.fog)scene.fog.density=.062+a*.018;scene.background.lerp(new THREE.Color(0x777e76),Math.min(1,a));
    }else{
      if(!s.switched){
        s.switched=true;zones.cellar.group.visible=false;zones.forest.group.visible=true;zone=zones.forest;currentZone='forest';playerAnchor.position.set(0,0,0);camera.position.set(0,2.15,3.8);
        zones.forest.fogColor=0xc4cbc5;zones.forest.density=.024;scene.background.set(0xc4cbc5);scene.fog=new THREE.FogExp2(0xc4cbc5,.024);
        $('location').textContent='THE FOREST / THE SHAPE OF THE VOID';audio?.setZone('forest');if(storyRef.voidFigure)storyRef.voidFigure.visible=true;storyRef.voidLeaves?.forEach(l=>l.visible=true);
      }
      const travel=THREE.MathUtils.smoothstep(s.t,8.2,19.8);camera.position.set(Math.sin(s.t*.18)*.06,2.15+Math.sin(s.t*.4)*.035,3.8-travel*24.5);camera.lookAt(0,1.65,-29);
      const figure=storyRef.voidFigure;
      if(figure){const vanish=THREE.MathUtils.smoothstep(s.t,15,20.5);figure.scale.set(1+vanish*.35,1+vanish*.55,1+vanish*.35);figure.children.forEach(o=>{if(o.material&&'opacity'in o.material)o.material.opacity=(o.geometry?.type==='TorusGeometry'?.28:.60)*(1-vanish);});}
      storyRef.voidLeaves?.forEach((leaf,i)=>{const phase=leaf.userData.phase,pull=THREE.MathUtils.smoothstep(s.t,14,20.8),r=leaf.userData.radius*(1-pull*.96);leaf.position.set(Math.cos(phase+s.t*.52)*r,leaf.userData.height+Math.sin(s.t*.7+phase)*.18,-29+Math.sin(phase+s.t*.52)*r*.72);leaf.rotation.z+=.012+(i%4)*.002;leaf.material.opacity=.82*(1-pull);});
      if(s.t>=s.dur)revealEndingChoices();
    }
  }
}
function endCarScene() {
  storyScene?.eng?.stop(); setCinema(false);
  storyScene = null;
  playerAnchor.position.set(0, 0, -42);
  const ch = storyRef.chaser; ch.visible = !noEnemies(); ch.position.set(2.5, 0, -40);
  chaseState = { t: 0, next: 2, lunge: 0 };
  storyLine('Walk back to the lamp. It is the only light in the forest, and it is pointing at you.');
  showToast('RUN. THE LAMP IS THE STARTING POINT.');
  fear = Math.min(1, fear + .2); glitchPulse = Math.max(glitchPulse, .8);
}
// Static-enemy test mode: the forest pursuer stays at its scene-entry position.
function updateChase(dt, t) {
  if (currentZone !== 'forest') { chaseState = null; storyRef.chaser.visible = false; return; }
  const ch = storyRef.chaser, p = playerAnchor.position;
  if (noEnemies()) { ch.visible = false; if (Math.hypot(p.x, p.z) < 2.6) escapeForest(); return; }
  const dx = p.x - ch.position.x, dz = p.z - ch.position.z, d = Math.hypot(dx, dz) || .001;
  // Retain contact danger, but never move or rotate the figure toward the player.
  if (d < 1.3) { if (enemyContact('forest', () => { ch.position.set(p.x + 9, 0, p.z - 9); })) { chaseState = null; return; } }
  if (Math.hypot(p.x, p.z) < 2.6) escapeForest();
}
function escapeForest() {
  chaseState = null; storyRef.chaser.visible = false;
  storyFlags.add('escaped-forest');
  enterZone('road', [zones.road.spawn.x, 0, zones.road.spawn.z]);
  showToast('THE CAR NEVER LEFT THE CLEARING. THE ROAD TAKES YOU BACK.');
  updateMissions();
}
function updateDarkroomHunt(dt,t){
  if (noEnemies()) { if (storyRef.darkroomHunter?.object) storyRef.darkroomHunter.object.visible = false; darkroomHunt.active = false; return; }
  if(currentZone!=='darkroom'||!darkroomHunt.active||storyFlags.has('darkroom-cleared')||gameEnded||dialogueOpen||journalOpen||storyScene)return;
  const npc=storyRef.darkroomHunter;if(!npc?.object)return;
  const p=playerAnchor.position,h=npc.object.position;
  darkroomHunt.elapsed+=dt;darkroomHunt.reappear-=dt;
  const dx=p.x-h.x,dz=p.z-h.z,dist=Math.hypot(dx,dz)||.001;
  camera.getWorldDirection(camDir2);const len=Math.hypot(camDir2.x,camDir2.z)||1;
  const dot=(camDir2.x*dx+camDir2.z*dz)/(len*dist);
  const lampOn=flashlightOn&&dot>.78&&dist<12;
  if(lampOn){
    npc.object.visible=true;darkroomHunt.lastFlash=t;
    npc.object.rotation.y=Math.atan2(dx,dz);
    npc.object.rotation.z=Math.sin(t*.002)*.035;
    fear=Math.max(.10,fear-.025*dt);
    if(dist<4.5&&darkroomHunt.warning<=0){darkroomHunt.warning=4;showToast('IL PROFESSORE IS STANDING IN THE LIGHT. DO NOT LOOK AWAY.');audio?.mechanicalTone(82,42,.8,'sine',.035,0);}
  }else{
    npc.object.visible=t-darkroomHunt.lastFlash<240;
    darkroomHunt.warning=Math.max(0,darkroomHunt.warning-dt);
    if(dist>1.65){
      const step=Math.min(dist-1.55,(.78+Math.min(.55,darkroomHunt.elapsed*.012))*dt*enemySpeed()/.95);
      h.x+=dx/dist*step;h.z+=dz/dist*step;
    }
  }
  // When the player keeps the beam elsewhere, Il Professore crosses the room without a footstep.
  if(darkroomHunt.reappear<=0&&!lampOn&&dist>5.5){
    const back=new THREE.Vector3(-camDir2.x,0,-camDir2.z);
    h.set(THREE.MathUtils.clamp(p.x+back.x*(4.5+Math.random()*2),-8.6,8.6),0,THREE.MathUtils.clamp(p.z+back.z*(4.5+Math.random()*2),-10.6,10.6));
    darkroomHunt.reappear=4.5+Math.random()*3.5;npc.object.visible=false;
    flashFragment('collapse',95);audio?.mechanicalEvent('scrape');
  }
  if(dist<1.45&&!lampOn){
    flashFragment('collapse',180);
    if(lethalContact()){darkroomHunt.active=false;triggerDeath('IL PROFESSORE FOUND YOU','You saw him only when the beam reached him. When the beam moved, he was already beside you. The room kept the rest of the recording.');return;}
    enemyContact('room',()=>{h.set(THREE.MathUtils.clamp(-p.x,-8.6,8.6),0,THREE.MathUtils.clamp(-p.z,-10.6,10.6));});
  }
}
function storyTick(dt, t) {
  try { updatePorchPrimo(); updateAtmosphere(); updateEscalation(dt); updateCellarHunt(dt, t); updateDarkroomHunt(dt,t); updateChurchBell(dt); updateCinematic(); } catch (err) { console.error('primo', err); }
  try {
    updateEmitters(dt);
    updateIndustryNoise(dt);
    updateWindAudio();
    updateWindParticles(dt, t);
    if (pendingCar && !dialogueOpen && gameStarted && !gameEnded && currentZone === 'abattoir') { pendingCar = false; beginForestCar(); }
    if (storyScene) updateStoryScene(dt, t);
    if (chaseState) updateChase(dt, t);
    v6Tick(dt, t);
  } catch (err) { console.error('story', err); }
}


// =============================================================================
// v3.5: textures (photos and procedural), the opening walk out of the dark,
// wind in the air and in the sound.
// =============================================================================
function repeatTex(canvas, rep) {
  const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t;
}
// A photograph loaded into a texture; until it arrives the material shows its base colour.
function photoTexture(url, rep, color = true) {
  const t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  new THREE.ImageLoader().load(url, (img) => { t.image = img; t.needsUpdate = true; }, undefined, () => console.warn('Texture not found:', url));
  return t;
}
function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#3f4a25'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, h = Math.random();
    const col = h < .55 ? 'rgba(' + Math.floor(70 + Math.random() * 40) + ',' + Math.floor(95 + Math.random() * 50) + ',40,.75)'
      : h < .85 ? 'rgba(40,50,25,.7)' : 'rgba(120,105,58,.5)';
    g.strokeStyle = col; g.lineWidth = 1 + Math.random() * 1.2;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (Math.random() - .5) * 4, y - 6, x + (Math.random() - .5) * 8, y - 12 - Math.random() * 8); g.stroke();
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(60,45,30,.35)'; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 14, 4 + Math.random() * 8, 0, 0, Math.PI * 2); g.fill(); }
  return repeatTex(c, 40);
}
function metalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#6c7074'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, len = 40 + Math.random() * 200, v = Math.floor(90 + Math.random() * 90);
    g.strokeStyle = 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',' + (.1 + Math.random() * .25) + ')';
    g.lineWidth = .6 + Math.random() * 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (Math.random() - .5) * .6); g.stroke();
  }
  for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(30,28,26,' + (.15 + Math.random() * .2) + ')'; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 10, 1 + Math.random() * 4, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(210,210,200,.25)'; g.lineWidth = 1; g.beginPath(); const x = Math.random() * 512, y = Math.random() * 512; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 60, y + (Math.random() - .5) * 60); g.stroke(); }
  return repeatTex(c, 2);
}
function rustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#6e3b22'; g.fillRect(0, 0, 512, 512);
  const cols = ['rgba(140,70,30,.35)', 'rgba(60,30,18,.4)', 'rgba(190,120,60,.25)', 'rgba(35,25,20,.35)'];
  for (let i = 0; i < 180; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.ellipse(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 30, 4 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 60; i++) { g.strokeStyle = 'rgba(40,22,14,.22)'; g.lineWidth = 2 + Math.random() * 3; const x = Math.random() * 512; g.beginPath(); g.moveTo(x, Math.random() * 512); g.lineTo(x + (Math.random() - .5) * 10, 512 * Math.random() + 80); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(210,140,70,.35)'; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  return repeatTex(c, 2);
}
// Wind strength per place: open ground and the forest feel it most; inside the house barely at all.
function windStrengthFor(name) { const W = { road: .55, forest: .95, abattoir: .35, home: .12, church: .7, ruin: .45, cellar: .02 }; return W[name] ?? .2; }
let windAudio = null;
function ensureWindAudio() {
  if (windAudio || !audio || !audio.ctx || !audio.master) return;
  const ctx = audio.ctx, len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = .6;
  const gain = ctx.createGain(); gain.gain.value = .02;
  const gust = ctx.createOscillator(); gust.frequency.value = .11; const gg = ctx.createGain(); gg.gain.value = .014;
  const sway = ctx.createOscillator(); sway.frequency.value = .37; const sg = ctx.createGain(); sg.gain.value = 160;
  gust.connect(gg); gg.connect(gain.gain); sway.connect(sg); sg.connect(bp.frequency);
  src.connect(bp); bp.connect(gain); gain.connect(audio.master);
  src.start(); gust.start(); sway.start();
  windAudio = { gain };
}
function updateWindAudio() {
  ensureWindAudio(); if (!windAudio) return;
  windAudio.gain.gain.setTargetAtTime(.02 + windStrengthFor(currentZone) * .07, audio.ctx.currentTime, .8);
}
// Dust and leaves carried past the camera; they follow the player and only show outdoors.
const WIND_N = 260, windPos = new Float32Array(WIND_N * 3);
const windGeo = new THREE.BufferGeometry(); windGeo.setAttribute('position', new THREE.BufferAttribute(windPos, 3));
const windPts = new THREE.Points(windGeo, new THREE.PointsMaterial({ color: 0xcfc8b8, size: .06, transparent: true, opacity: .35, depthWrite: false }));
windPts.frustumCulled = false; windPts.visible = false; scene.add(windPts);
function respawnWind(i) { windPos[i*3] = (Math.random() - .5) * 24; windPos[i*3+1] = Math.random() * 4; windPos[i*3+2] = (Math.random() - .5) * 24; }
for (let i = 0; i < WIND_N; i++) respawnWind(i);
function updateWindParticles(dt, t) {
  const strength = windStrengthFor(currentZone);
  windPts.visible = gameStarted && (currentZone === 'road' || currentZone === 'forest') && strength > .2;
  if (!windPts.visible) return;
  windPts.position.copy(camera.position);
  const gust = strength * (.7 + .3 * Math.sin(t * .0009) + .2 * Math.sin(t * .0023));
  for (let i = 0; i < WIND_N; i++) {
    windPos[i*3] += gust * 6 * dt; windPos[i*3+1] += (-.4 + Math.sin(t * .002 + i) * .2) * dt; windPos[i*3+2] += gust * 1.2 * dt;
    if (Math.abs(windPos[i*3]) > 12 || Math.abs(windPos[i*3+2]) > 12 || windPos[i*3+1] < 0) respawnWind(i);
  }
  windGeo.attributes.position.needsUpdate = true;
}
// The walk out of the dark: the camera comes up the road from the fog behind, and the darkness thins as he walks.
function startIntro() {
  if (storyFlags.has('intro-seen')) return;
  storyFlags.add('intro-seen');
  $('intro-dark').style.opacity = '1';
  storyScene = { type: 'intro', t: 0, dur: 44, i: 0, lines: [
    [1, 'Voice: I came up the lane in the dark. The dark is where I left everything else.'],
    [7, 'Voice: People have always said I listen too well. I hear the pause before a sentence, the room between the words.'],
    [13, 'Voice: Nothing in me has ever asked to be filled. It is easy to empty a room like that, and I have never minded the quiet.'],
    [19, 'Voice: A letter came, with a name in it. I answered by walking, because walking asks nothing back.'],
    [25, 'Voice: The house at the end of the road has waited a long time for someone who listens. I am only the one who did not leave.'],
    [31, 'Voice: Stay quiet. The fog is listening too, and it does not repeat what it hears.'],
    [37, 'Voice: The lamp is lit. Someone is holding the door open.'],
    [40, 'Il Professore: Good evening. You found us. I kept the light on.']] };
}
function endIntro() {
  storyScene = null;
  clearTimeout(storyLine.timer);
  $('subtitle-wrap').classList.remove('visible');
  $('intro-dark').style.opacity = '0';
  $('objective-text').textContent = 'Reach the farmhouse gate.';
}


// =============================================================================
// v3.6: the Professore's face, his vanishing and return, difficulty, rewards and
// penalties, one conversation per person, zone soundscapes and the finale.
// =============================================================================
// A face after Francis Bacon's Head VI (1949): a screaming head in a dark cage of brushed strokes.
function headVICanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#1b1210'; g.fillRect(0, 0, 512, 512);
  const grd = g.createRadialGradient(256, 230, 40, 256, 256, 260); grd.addColorStop(0, '#b7a28c'); grd.addColorStop(.7, '#6e5b4e'); grd.addColorStop(1, '#1b1210');
  g.fillStyle = grd; g.beginPath(); g.ellipse(256, 240, 170, 215, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 90; i++) { g.strokeStyle = 'rgba(' + (60 + Math.random() * 60 | 0) + ',' + (40 + Math.random() * 30 | 0) + ',' + (35 + Math.random() * 20 | 0) + ',.45)'; g.lineWidth = 2 + Math.random() * 7;
    const x = 110 + Math.random() * 290; g.beginPath(); g.moveTo(x, 40 + Math.random() * 80); g.quadraticCurveTo(x + (Math.random() - .5) * 40, 260, x + (Math.random() - .5) * 30, 470); g.stroke(); }
  g.fillStyle = '#0b0606'; g.beginPath(); g.ellipse(256, 330, 62, 84, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8dccb'; for (let i = 0; i < 10; i++) g.fillRect(212 + i * 8, 262, 5, 16);
  g.fillStyle = '#050303';
  [[196, 205], [316, 205]].forEach(([x, y]) => { g.beginPath(); g.ellipse(x, y, 30, 20, .2, 0, Math.PI * 2); g.fill(); });
  g.strokeStyle = 'rgba(15,10,8,.85)'; g.lineWidth = 9;
  for (let x = 60; x <= 460; x += 56) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 512); g.stroke(); }
  return c;
}
function headMaterial() {
  if (!HEAD_TEX) { HEAD_TEX = new THREE.CanvasTexture(headVICanvas()); HEAD_TEX.colorSpace = THREE.SRGBColorSpace; }
  return new THREE.MeshStandardMaterial({ map: HEAD_TEX, roughness: .85 });
}
function headVIDataUrl() { if (!JUMP_URL) JUMP_URL = headVICanvas().toDataURL(); return JUMP_URL; }
function paintingTexture(kind) {
  if (PAINT_TEX[kind]) return PAINT_TEX[kind];
  const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d');
  g.fillStyle = '#2a1d17'; g.fillRect(0, 0, 256, 320);
  if (kind === 0) { g.fillStyle = '#8a7060'; g.beginPath(); g.ellipse(128, 130, 52, 66, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0a0606'; g.beginPath(); g.ellipse(128, 160, 22, 14, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a0e0a'; g.lineWidth = 16; g.beginPath(); g.moveTo(40, 300); g.quadraticCurveTo(128, 60, 216, 300); g.stroke(); }
  else { g.fillStyle = '#050403'; g.beginPath(); g.arc(128, 120, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6a5a4a'; g.lineWidth = 6; g.strokeRect(96, 200, 64, 90); g.beginPath(); g.moveTo(96, 200); g.lineTo(96, 290); g.stroke(); }
  for (let i = 0; i < 80; i++) { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3 + Math.random() * 5; const x = Math.random() * 256; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - .5) * 20, 320); g.stroke(); }
  PAINT_TEX[kind] = new THREE.CanvasTexture(c); PAINT_TEX[kind].colorSpace = THREE.SRGBColorSpace; return PAINT_TEX[kind];
}
function difficultyTier() { return Math.min(6, seenMissions.size); }
function primoSpeedBonus() { return difficultyTier() * .13; }
// Choices lead to small rewards or penalties; the table is keyed by speaker and choice index.
function applyChoiceEffect(key,index,npc=null){
 const row=CHOICE_EFFECTS[key],entry=row?.[index]||null;
 const [severity,effect]=entry?entry.split(':'):[index>0?'bad':'good','none'];
 if(severity==='bad'){flashFragment(npc?.name?.toLowerCase()==='ines'?'tea':npc?.name?.toLowerCase()==='ottavio'?'reel':'collapse',125);fear=Math.min(1,fear+.08);}
  if (effect === 'map') {
    if (storyFlags.has('map')) return; storyFlags.add('map');
    journal.push({ id: 'map', title: 'Folded map', description: 'The farmhouse plan. The road runs north to the house. The slaughterhouse lies east, behind the barn. The church is past the canal. The forest begins where the lamp goes out.', kind: 'map', zone: currentZone });
    updateJournalCount(); showToast('YOU RECEIVE A FOLDED MAP.');
  } else if (effect === 'health') { fear = Math.max(0, fear - .22); showToast('YOUR BREATHING SLOWS.'); }
  else if (effect === 'key') {
    if (storyFlags.has('key-east')) return;
    storyFlags.add('key-east');
    const hg = zones.home.group;
    [-2.2, 2.2].forEach((x, i) => { const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshStandardMaterial({ map: paintingTexture(i), roughness: .9 })); pm.position.set(x, 1.8, 8.85); pm.rotation.y = Math.PI; hg.add(pm); });
    addLook(hg, -2.2, 1.8, 8.4, 'Two paintings', 'Two canvases. The left shows a hooded figure with its face smeared away, its mouth open. The right shows an empty chair under a black sun. Both were painted from the same chair.');
    journal.push({ id: 'key-east', title: 'Key to the east room', description: 'A brass key with a paper tag: "East room. Two paintings. Do not turn them round."', kind: 'key', zone: currentZone });
    updateJournalCount(); showToast('A KEY TO THE EAST ROOM.');
  }
  else if (effect === 'closer') {
    // Preserve the story beat without moving the stationary enemy.
    storyFlags.add('primo-closer');
    showToast('SOMETHING IS STILL WAITING.');
  }
  else if (effect === 'jumpscare') jumpscare();
  else if (effect === 'trip') trip();
}
let demiseVision=null;
function showThirteenDemises(sourceNpc=null){
 if(!zone)return;
 if(demiseVision?.group?.parent)demiseVision.group.parent.remove(demiseVision.group);
 const group=new THREE.Group(),dir=new THREE.Vector3();camera.getWorldDirection(dir);dir.y=0;dir.normalize();
 const center=playerAnchor.position.clone().addScaledVector(dir,4.8);group.position.set(center.x,0,center.z);group.rotation.y=Math.atan2(-dir.x,-dir.z);zone.group.add(group);
 const materials=[];
 for(let i=0;i<13;i++){
  const figure=new THREE.Group();
  const shadow=new THREE.MeshStandardMaterial({color:i%3===0?0x50302a:0x191a17,roughness:1,transparent:true,opacity:.86,depthWrite:false});
  const ash=new THREE.MeshStandardMaterial({color:0x82786a,roughness:1,transparent:true,opacity:.54,depthWrite:false});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.15,.56,4,7),shadow);body.position.y=.78;body.scale.set(1.05,1.12,.56);figure.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.12,8,7),ash);head.position.y=1.48;head.scale.set(.82,1.12,.7);figure.add(head);
  for(const side of [-1,1]){
   const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.04,.38,4,6),shadow);arm.position.set(side*.22,.94,0);arm.rotation.z=side*([.8,-.55,.15,1.15][(i+side+4)%4]);figure.add(arm);
   const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.05,.35,4,6),shadow);leg.position.set(side*.085,.28,.02);leg.rotation.z=side*([.45,0,-.6,.2][(i+side+4)%4]);figure.add(leg);
  }
  const noose=new THREE.Mesh(new THREE.TorusGeometry(.12,.017,5,14),ash);noose.position.y=1.68;figure.add(noose);
  const a=(i/12-.5)*2.25,offset=Math.sin(a)*5.5,depth=Math.cos(a)*.65;
  figure.position.set(offset,.02,depth);figure.rotation.z=[-.72,.24,1.18,0][i%4];figure.rotation.x=[.35,-.45,0,.85][i%4];figure.scale.setScalar(.88+(i%4)*.06);group.add(figure);
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.22+(i%3)*.04,14),new THREE.MeshBasicMaterial({color:0x2a090a,transparent:true,opacity:.62,depthWrite:false}));
  stain.rotation.x=-Math.PI/2;stain.position.set(offset,.012,depth);group.add(stain);
  [shadow,ash,stain.material].forEach(m=>{m.userData.baseOpacity=m.opacity;materials.push(m);});
 }
 demiseVision={group,materials,t:0,duration:4.8,sourceNpc};glitchPulse=Math.max(glitchPulse,1.35);fear=Math.min(1,fear+.16);audio?.killingAudio();audio?.killSting();
}
function updateThirteenDemises(dt){
 if(!demiseVision)return;
 const v=demiseVision;v.t+=dt;const fade=THREE.MathUtils.smoothstep(v.t,2.2,v.duration);
 v.materials.forEach(m=>{m.opacity=m.userData.baseOpacity*(1-fade);});
 v.group.scale.setScalar(.94+Math.sin(v.t*6)*.025);v.group.position.y=Math.sin(v.t*1.8)*.035;
 if(v.t>=v.duration){v.group.parent?.remove(v.group);demiseVision=null;}
}
function flashFragment(kind='room-tone',duration=145){
  const c=document.createElement('canvas');c.width=640;c.height=420;
  const g=c.getContext('2d');g.fillStyle='#090907';g.fillRect(0,0,640,420);
  const grain=()=>{for(let i=0;i<1100;i++){g.fillStyle=Math.random()>.5?'rgba(220,210,190,.05)':'rgba(0,0,0,.15)';g.fillRect(Math.random()*640,Math.random()*420,1+Math.random()*3,1);}};
  g.save();g.translate(320,210);g.rotate((Math.random()-.5)*.025);
  if(kind==='heater'||kind==='dark-heater'){
    g.fillStyle='#49453c';g.beginPath();g.moveTo(-110,-135);g.lineTo(92,-132);g.lineTo(116,100);g.lineTo(-124,105);g.closePath();g.fill();
    g.fillStyle='#1b1c18';g.fillRect(-100,-95,200,34);for(let i=0;i<8;i++){g.strokeStyle='rgba(180,160,130,.5)';g.lineWidth=4;g.beginPath();g.moveTo(-86+i*24,-89);g.lineTo(-86+i*24,-62);g.stroke();}
    for(let i=0;i<3;i++){g.fillStyle=['#7b3828','#a14b29','#5b3126'][i];g.beginPath();g.ellipse(-62+i*62,4,26,72,0,0,Math.PI*2);g.fill();}
    g.strokeStyle='#b3a48a';g.lineWidth=8;g.beginPath();g.arc(0,5,137,Math.PI*1.08,Math.PI*1.92);g.stroke();
  }else if(kind==='earplugs'||kind==='dark-earplugs'){
    for(const x of [-78,78]){g.fillStyle='#8f6961';g.beginPath();g.ellipse(x,0,28,68,x/150,0,Math.PI*2);g.fill();g.fillStyle='#2b2420';g.beginPath();g.arc(x,-50,19,0,Math.PI*2);g.fill();}
    g.strokeStyle='#a9926b';g.lineWidth=4;g.beginPath();g.arc(0,0,145,-1.1,1.1);g.stroke();
    g.fillStyle='#d3c5a6';g.font='18px monospace';g.fillText('C',-6,132);
  }else if(kind==='book'||kind==='dark-book'){
    g.fillStyle='#4c3b2d';g.beginPath();g.moveTo(-135,-145);g.lineTo(8,-122);g.lineTo(12,146);g.lineTo(-140,120);g.closePath();g.fill();
    g.fillStyle='#bdb39b';g.beginPath();g.moveTo(8,-122);g.lineTo(140,-145);g.lineTo(140,120);g.lineTo(12,146);g.closePath();g.fill();
    g.strokeStyle='#5a4a39';g.lineWidth=4;for(let y=-83;y<100;y+=17){g.beginPath();g.moveTo(25,y);g.lineTo(117,y-6);g.stroke();}
    g.fillStyle='#241b16';g.font='19px serif';g.fillText('WILL NOTHINGNESS',-116,-90);
  }else if(kind==='reel'||kind==='dark-reel'||kind==='room-tone'){
    for(const x of [-95,95]){g.strokeStyle='#a19a83';g.lineWidth=10;g.beginPath();g.arc(x,-10,74,0,Math.PI*2);g.stroke();g.strokeStyle='#4c4b42';g.lineWidth=5;g.beginPath();g.arc(x,-10,44,0,Math.PI*2);g.stroke();g.fillStyle='#1e201c';g.beginPath();g.arc(x,-10,15,0,Math.PI*2);g.fill();for(let i=0;i<6;i++){const a=i*Math.PI/3;g.strokeStyle='#7e796b';g.lineWidth=7;g.beginPath();g.moveTo(x,-10);g.lineTo(x+Math.cos(a)*58,-10+Math.sin(a)*58);g.stroke();}}
    g.strokeStyle='#b4a88b';g.lineWidth=3;g.beginPath();g.moveTo(-18,-3);g.lineTo(-4,28);g.lineTo(13,28);g.lineTo(23,-2);g.stroke();
  }else if(kind==='report'||kind==='dark-report'){
    g.fillStyle='#b6aa8d';g.fillRect(-120,-155,240,310);g.strokeStyle='#64584a';g.lineWidth=2;
    for(let y=-105;y<95;y+=24){g.beginPath();g.moveTo(-90,y);g.lineTo(89,y);g.stroke();}
    g.fillStyle='#7e1d18';g.font='bold 31px monospace';g.translate(4,12);g.rotate(-.22);g.fillText('03:17',-62,0);g.restore();g.save();g.translate(320,210);
  }else if(kind==='script'||kind==='dark-script'){
    g.strokeStyle='#a79a80';g.lineWidth=8;g.lineCap='round';
    for(let i=0;i<14;i++){const x=-220+i*33;g.beginPath();g.moveTo(x,-110+(i%3)*17);g.lineTo(x+12,80-(i%4)*20);g.lineTo(x+24,-60+(i%5)*13);g.stroke();}
    g.strokeStyle='#8c241f';g.lineWidth=5;g.beginPath();g.arc(0,0,156,0,Math.PI*2);g.stroke();
  }else if(kind==='tea'){
    g.fillStyle='#c8b79a';g.beginPath();g.ellipse(0,42,120,27,0,0,Math.PI*2);g.fill();
    g.fillStyle='#e1d8c4';g.beginPath();g.moveTo(-85,-46);g.quadraticCurveTo(-82,95,-26,84);g.lineTo(61,84);g.quadraticCurveTo(107,52,85,-46);g.closePath();g.fill();
    g.strokeStyle='#bfb29a';g.lineWidth=13;g.beginPath();g.arc(91,9,42,-1.2,1.5);g.stroke();
    g.fillStyle='#29211c';g.beginPath();g.ellipse(0,-44,84,17,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#61241f';g.lineWidth=5;g.beginPath();g.moveTo(-12,-8);g.lineTo(-2,58);g.stroke();
  }else if(kind==='collapse'){
    g.strokeStyle='#9a8a76';g.lineWidth=18;g.beginPath();g.moveTo(-15,-150);g.lineTo(-6,-36);g.lineTo(-78,86);g.stroke();
    g.fillStyle='#a69a86';g.beginPath();g.ellipse(-20,-165,44,62,-.2,0,Math.PI*2);g.fill();
    g.strokeStyle='#4e2621';g.lineWidth=5;g.beginPath();g.moveTo(-10,-120);g.lineTo(45,125);g.stroke();
  }else if(kind==='nosebleed'){
    g.fillStyle='#a99b89';g.beginPath();g.ellipse(0,-4,95,142,0,0,Math.PI*2);g.fill();
    g.fillStyle='#17110e';g.beginPath();g.ellipse(-35,-24,17,12,0,0,Math.PI*2);g.ellipse(35,-24,17,12,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#791b19';g.lineWidth=9;g.beginPath();g.moveTo(5,5);g.bezierCurveTo(18,45,-24,63,-13,136);g.stroke();
  }else{
    g.fillStyle='#a79b84';g.beginPath();g.ellipse(0,-14,91,128,-.08,0,Math.PI*2);g.fill();
    g.fillStyle='#080808';g.beginPath();g.ellipse(-30,-24,19,12,0,0,Math.PI*2);g.ellipse(30,-24,19,12,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#17100e';g.lineWidth=18;g.beginPath();g.moveTo(-68,145);g.quadraticCurveTo(0,0,72,144);g.stroke();
  }
  g.restore();grain();
  const el=document.createElement('div');
  el.style.cssText='position:fixed;inset:0;z-index:70;pointer-events:none;background:rgba(0,0,0,.18) center/cover no-repeat;mix-blend-mode:screen;opacity:.92;filter:contrast(1.5) sepia(.35);';
  el.style.backgroundImage='url('+c.toDataURL('image/png')+')';
  document.body.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),45);},Math.max(65,duration));
  glitchPulse=Math.max(glitchPulse,.45);return el;
}
function jumpscare() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:50;background:#000 center/cover no-repeat;pointer-events:none';
  el.style.backgroundImage = 'url(' + headVIDataUrl() + ')';
  document.body.appendChild(el);
  audio?.stinger(1); glitchPulse = Math.max(glitchPulse, 1.6); fear = Math.min(1, fear + .2);
  setTimeout(() => el.remove(), 380);
}
function trip() {
  const w = $('world'); if (!w) return;
  w.style.filter = 'hue-rotate(160deg) saturate(2.2) contrast(1.4) blur(1px)';
  glitchPulse = Math.max(glitchPulse, 2);
  setTimeout(() => { w.style.filter = ''; }, 6000);
}
// Soundscapes: a choir in the church, dissonant stabs in the slaughterhouse, scraping in the house, drones elsewhere.
function stab(ctx, dest, f, v) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + 1.6);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 3;
  o.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.7);
}
function stopAtmosphere() {
  atmo.timers.forEach(clearInterval);
  atmo.nodes.forEach(n => { try { n.stop?.(); } catch (e) {} try { n.disconnect?.(); } catch (e) {} });
  atmo.nodes = []; atmo.timers = [];
}
function startAtmosphere(name) {
  if (!audio || !audio.ctx || !audio.master) return;
  stopAtmosphere();
  const ctx = audio.ctx, g = ctx.createGain(); g.gain.value = 0; g.connect(audio.master);
  g.gain.setTargetAtTime(.34, ctx.currentTime, 2); atmo.gain = g; atmo.nodes.push(g);
  const osc = (f, type, vol) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const v = ctx.createGain(); v.gain.value = vol; o.connect(v); v.connect(g); o.start(); atmo.nodes.push(o, v); return o; };
  if (name === 'church') {
    // Orthodox-style chant: a dark modal chord with slow vibrato, and a minor second rubbing against it.
    [146.8, 174.6, 220, 261.6, 329.6].forEach((f, i) => { const o = osc(f, 'sine', .24); const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 4.6 + i * .2; lg.gain.value = 3.5; lfo.connect(lg); lg.connect(o.detune); lfo.start(); atmo.nodes.push(lfo, lg); });
    osc(277.2, 'sine', .03);
  } else if (name === 'abattoir') {
    atmo.timers.push(setInterval(() => { [0, 1, 6, 11, 13].forEach(semi => stab(ctx, g, 110 * Math.pow(2, semi / 12), .12)); }, 2600));
  } else if (name === 'home' || name === 'ruin') {
    atmo.timers.push(setInterval(() => stab(ctx, g, 700 * Math.pow(2, Math.random() * 1.4), .07), 1700));
    osc(58.3, 'triangle', .05);
  } else if (name === 'cellar') {
    osc(55, 'sine', .06); osc(57.6, 'sine', .06);
  } else if (name === 'forest' || name === 'road') {
    osc(73.4, 'sine', .05); osc(103.8, 'sine', .03);
  } else { osc(90, 'sine', .04); }
}
function updateAtmosphere() {
  if (!audio || !audio.ctx || !currentZone) return;
  if (atmo.zone !== currentZone) { atmo.zone = currentZone; startAtmosphere(currentZone); }
}
// Finale: you walk toward a fire in the fog; the noise thins to white; the eye appears once, then the screen goes white.
function eyeMesh() {
  const g = new THREE.Group();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 16), new THREE.MeshStandardMaterial({ color: 0xddd6c0, roughness: .3 }));
  sclera.scale.set(1.5, .85, .5); g.add(sclera);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: .4 }));
  iris.position.set(0, 0, .26); g.add(iris);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 10), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.set(0, 0, .33); g.add(pupil);
  return g;
}
function finaleThen(choice) {
  if (storyScene || !currentZone || !zones[currentZone]) { resolveEnding(choice); return; }
  $('ending-screen').classList.remove('active');
  const p = playerAnchor.position.clone(), zg = zones[currentZone].group;
  const fg = new THREE.Group(); fg.position.set(p.x, 0, p.z - 9); zg.add(fg);
  makeEmitter(fg, 0, .1, 0, 'fire'); makeEmitter(fg, 0, .9, 0, 'smoke');
  const eye = eyeMesh(); eye.position.set(p.x, 1.7, p.z - 11); eye.visible = false; zg.add(eye);
  storyScene = { type: 'finale', t: 0, dur: 34, i: 0, fg, eye, choice, from: p, to: new THREE.Vector3(p.x, 0, p.z - 6.5), lines: [
    [1, 'Voice: Come closer. The fire is not hot. It only looks like something that should be.'],
    [7, 'Voice: You walked this far on your own feet. Nobody dragged you. That is the part I cannot forgive, or envy.'],
    [14, 'Voice: Listen. The noise is getting thinner. You are the last thing in this room that has not been emptied.'],
    [21, 'Voice: Now there is only white. It is not a light. It is the room, finally quiet.'],
    [27, 'Voice: Look at me once. Just once.']] };
}
function updateFinale(s, dt) {
  const k = THREE.MathUtils.smoothstep(s.t, 0, s.dur - 7);
  camera.position.lerpVectors(s.from.clone().setY(1.6), s.to.clone().setY(1.6), k);
  camera.position.x += Math.sin(s.t * .6) * .04; camera.position.y += Math.sin(s.t * 2) * .02;
  camera.lookAt(s.fg.position.x, 1.4, s.fg.position.z);
  if (scene.fog) scene.fog.density = .05 + k * .24;
  if (audio && audio.ctx && Math.random() < dt * (2 + k * 4)) stab(audio.ctx, audio.master, 180 + Math.random() * 900, .04 * Math.max(0, 1 - (s.t - 18) / 14));
  const white = $('finale-white'); if (white) white.style.opacity = String(THREE.MathUtils.clamp((s.t - 24) / 8, 0, 1));
  if (s.t > 27) { s.eye.visible = true; s.eye.scale.setScalar(1 + (s.t - 27) * .03); }
  if (s.t >= s.dur) {
    storyScene = null; s.eye.visible = false; s.fg.parent?.remove(s.fg); s.eye.parent?.remove(s.eye);
    resolveEnding(s.choice);
    setTimeout(() => { if (white) white.style.opacity = '0'; }, 1600);
  }
}

// The porch Il Primo leaves after his first words, and returns later as the enemy.
function updatePorchPrimo() {
  if (!storyFlags.has('primo-first-contact') || storyFlags.has('porch-primo-gone') || dialogueOpen) return;
  for (const zn of Object.values(zones)) {
    const ix = zn.interactables.findIndex(i => i.isOpeningPrimo);
    if (ix >= 0) {
      const p = zn.interactables.splice(ix, 1)[0]; p.object.visible = false;
      storyFlags.add('porch-primo-gone'); showToast('HE IS NO LONGER ON THE PORCH.'); glitchPulse = Math.max(glitchPulse, .6);
      return;
    }
  }
}


// =============================================================================
// v5: the Professore's tiers and monologues, claustrophobic escalation, the cellar hunt
// (the record is far away, and he laughs as he moves), cinematic bars, hidden details.
// =============================================================================
let escTier = 0;
const PRIMO_TIER_LINES = {
  1: ['Il Professore: I was not born empty. I was taught to listen until listening was the only thing I had left.', 'Il Professore: You have started counting the chairs. I did that too, in the same house, on the same night.'],
  2: ['Il Professore: Every name you collect is a little less room for your own. I am not taking anything. I am making space.', 'Il Professore: Notice how quiet the rooms become when you stop answering them.'],
  3: ['Il Professore: The fog is not outside the house. It is the house, breathing out a little more each time you come back.', 'Il Professore: I stopped hearing my own voice around the third winter. It was a relief. You will see.'],
  4: ['Il Professore: Look behind you. You will not see me. That is the nature of a hollow thing: it is always just out of the frame.', 'Il Professore: The doors do not lock. They simply stop opening for people who are still full of themselves.'],
  5: ['Il Professore: Do you know the worst part? I liked it when it took me. I had been so tired of being heard.', 'Il Professore: Soon the corridor will be the only way left, and it will be very warm.'],
  6: ['Il Professore: Come down. The record is waiting, and so, a little, am I.', 'Il Professore: Listen. Can you hear the laugh? It is not mine. It is yours, coming back to you late.']
};
function startMonologue(lines, dur = 16) {
  if (storyScene) return;
  const lastLineAt = 1 + Math.max(0, lines.length - 1) * 6;
  const lastLineText = lines.length ? String(lines[lines.length - 1]) : '';
  const cleanLastLine = lastLineText.replace(/^[^:]*:\s*/, '');
  const lastWhisperDuration = Math.min(4.8, .9 + cleanLastLine.length * .045);
  const subtitleEndAt = lastLineAt + lastWhisperDuration + .16;
  storyScene = {
    type: 'hold', t: 0, dur: Math.max(dur, subtitleEndAt), i: 0,
    lines: lines.map((l, k) => [1 + k * 6, l]),
    subtitleEndAt, subtitleHidden: false
  };
}
// Escalation: each completed mission brings a monologue, thicker fog, a tighter vignette and more grain.
function updateEscalation(dt) {
  const tier = difficultyTier();
  if (tier !== escTier) {
    escTier = tier;
    if (PRIMO_TIER_LINES[tier]) startMonologue(PRIMO_TIER_LINES[tier], 15);
  }
  const z = zones[currentZone];
  if (scene.fog && z && z.fog && scene.fog === z.fog && !storyScene) scene.fog.density = z.density * (1 + tier * .11);
  const vig = document.getElementById('vignette');
  if (vig) vig.style.background = 'radial-gradient(ellipse at center,transparent ' + (46 - tier * 3 - fear * 6) + '%,rgba(0,0,0,' + (.5 + tier * .06 + fear * .2).toFixed(2) + ') 84%,#000 130%)';
  const grain = document.getElementById('post-noise');
  if (grain) grain.style.opacity = String(Math.min(.4, .12 + fear * .16 + tier * .02));
}
// The laugh: short stabs of filtered sawtooth, falling in pitch.
function laugh() {
  if (!audio || !audio.ctx || !audio.master) return;
  const ctx = audio.ctx, t0 = ctx.currentTime;
  for (let k = 0; k < 4; k++) {
    const t = t0 + k * .17, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(260 - k * 12, t); o.frequency.exponentialRampToValueAtTime(170 - k * 8, t + .14);
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 4;
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + .14);
    o.connect(bp); bp.connect(g); g.connect(audio.master); o.start(t); o.stop(t + .16);
  }
}
// Static-enemy test mode: the cellar apparition no longer relocates or laughs from new positions.
function updateCellarHunt(dt, t) {
  // Intentionally stationary in every room.
}
// Cinematic bars during scenes; they slide in and out.
const LB = { top: document.createElement('div'), bottom: document.createElement('div') };
[LB.top, LB.bottom].forEach((b, i) => Object.assign(b.style, { position: 'fixed', left: '0', right: '0', height: '0', background: '#000', zIndex: '7', transition: 'height .9s ease', pointerEvents: 'none', [i ? 'bottom' : 'top']: '0' }));
document.body.append(LB.top, LB.bottom);
function updateCinematic() {
  const on = !!storyScene && storyScene.type !== 'hold';
  LB.top.style.height = on ? '11vh' : '0'; LB.bottom.style.height = on ? '11vh' : '0';
}
function crayonTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const g = c.getContext('2d');
  g.fillStyle = '#d8d0b8'; g.fillRect(0, 0, 256, 192);
  const cols = ['#7a1f1a', '#2a2a2a', '#4a3f7a'];
  for (let i = 0; i < 13; i++) { g.fillStyle = cols[i % 3]; const x = 18 + (i % 7) * 34, y = 40 + Math.floor(i / 7) * 80;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.fillRect(x - 4, y + 9, 8, 26); }
  g.fillStyle = '#7a1f1a'; g.font = '14px monospace'; g.fillText('CONTA', 14, 180);
  return new THREE.CanvasTexture(c);
}
function tallyTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#3a342c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(210,200,170,.7)'; g.lineWidth = 3;
  for (let row = 0; row < 6; row++) for (let k = 0; k < 13; k++) {
    const x = 20 + k * 18, y = 24 + row * 36;
    if (k % 5 === 4) { g.beginPath(); g.moveTo(x - 60, y + 14); g.lineTo(x + 2, y - 14); g.stroke(); } else { g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x, y + 14); g.stroke(); }
  }
  return new THREE.CanvasTexture(c);
}
function phonographMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(.9, .18, .7), M.darkWood); base.position.y = .09; g.add(base);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .02, 28), M.black); disc.position.y = .2; g.add(disc);
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(.05, .26, .45, 20, 1, true), M.brass || M.gold); horn.position.set(.12, .55, -.14); horn.rotation.set(-.6, 0, .3); g.add(horn);
  return g;
}
function buildCinematicExtras() {
  // The record: moved to the far corner of the cellar, where the lamp barely reaches.
  const cz = zones.cellar; const listen = cz && cz.interactables.find(i => i.type === 'listen');
  if (listen) {
    const pg = phonographMesh(); pg.position.set(7.2, 0, -6.4); cz.group.add(pg);
    listen.object = pg; listen.point = new THREE.Vector3(7.2, .9, -6.4); listen.radius = 2.4;
    listen.prompt = '[ E ] LISTEN TO THE WHITE — AT THE BACK OF THE CELLAR';
  }
  // Hidden details, each one a small unsettling note.
  const hz = zones.home.group;
  const crayon = new THREE.Mesh(new THREE.PlaneGeometry(.9, .68), new THREE.MeshStandardMaterial({ map: crayonTexture(), roughness: .9 }));
  crayon.position.set(-9.82, 1.6, -3.4); crayon.rotation.y = Math.PI / 2; hz.add(crayon);
  addLook(hz, -9.5, 1.6, -3.4, 'A child’s drawing', 'Crayon figures in a ring, thirteen of them, each with a dark mark where a mouth should be. The fourteenth is drawn in a different colour, and it has no hands.');
  const tally = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshStandardMaterial({ map: tallyTexture(), roughness: .95 }));
  tally.position.set(-11.82, 1.8, 2); tally.rotation.y = Math.PI / 2; zones.abattoir.group.add(tally);
  addLook(zones.abattoir.group, -11.4, 1.6, 2, 'Tally marks', 'Rows of tally marks, scratched into the plaster. Every fifth stroke crosses the four before it. Someone has counted the days since the last name was called.');
  addLook(zones.road.group, -6, .6, -20, 'The sack on the post', 'A feed sack tied to a fence post. Something inside it is still moving very slightly, and there is a number written on the cloth: 14.');
  addLook(zones.church.group, -5, .3, -6, 'Under the pew', 'A folded hymn sheet, pushed under the pew by someone who was afraid to be seen kneeling. The hymn is the one they sing before the fourteenth name.');
  const water = new THREE.Mesh(new THREE.CylinderGeometry(.34, .3, .14, 24), new THREE.MeshStandardMaterial({ color: 0x0c1213, roughness: .02, metalness: .3 }));
  water.position.set(-6, .8, 6); cz.group.add(water);
  addLook(cz.group, -6, .9, 6, 'A bowl of water', 'Still water in a enamel bowl. It reflects the ceiling, the lamp and the top of your head, but not the room you are standing in.');
}

function animateZone(t, dt) {
  updateCandles(t); updateRituals(t); updateEggs(t);
  rotatingMachines.forEach(m=>{if(m.piston){m.mesh.position.y=.75+Math.sin(t*.001*m.speed)*.11;}else m.mesh.rotation.z+=dt*m.speed;});
  zones.abattoir?.carcasses?.forEach(c=>{c.rotation.z=Math.sin(t*.00062+c.userData.hangPhase)*.035;c.rotation.x=Math.cos(t*.00047+c.userData.hangPhase)*.018;});
  for (const z of Object.values(zones)) {
    if (!z.group.visible) continue;
    if (z.mist) z.mist.children.forEach((s, i) => {
      s.position.x += Math.sin(t * .00021 + s.userData.phase) * dt * .20;
      s.position.z += Math.cos(t * .00017 + s.userData.phase * 1.3) * dt * .13;
      s.material.opacity = (.07 + dread * .07) * (z.name === 'cellar' ? .55 : 1);
    });
    [...new Set([...z.interactables.filter(x => x.type === 'npc'),...cultRoster.filter(n=>n.object.parent===z.group)])].forEach(n => {
      const phase=t*.0011+n.phase, stride=n.walking?Math.sin(t*.008+n.phase):Math.sin(phase)*.035;
      const bob=n.walking?Math.abs(Math.sin(t*.008+n.phase))*.035:Math.sin(phase)*.009;
      n.object.position.y = n.fate==='dead'?n.object.position.y:(n.baseY||0)+(n.seated?bob*.3:bob);
      if(n.seated){n.leftArm.rotation.z=-.08+Math.sin(phase)*.01;n.rightArm.rotation.z=.08-Math.sin(phase)*.01;} else {
      n.leftArm.rotation.z = -.13 + stride*.46 + Math.sin(phase)*.018;
      n.rightArm.rotation.z = .13 - stride*.46 - Math.sin(phase)*.018;
      n.leftForearm.rotation.z=-.24+stride*.25;n.rightForearm.rotation.z=.24-stride*.25;}
      if(!n.seated&&n.legs?.length===2){n.legs[0].rotation.x=stride*.52;n.legs[1].rotation.x=-stride*.52;n.shoes?.forEach((shoe,i)=>{shoe.rotation.x=i===0?stride*.52:-stride*.52;});}
      if(n.head){const lurch=n.walking?1+.4*Math.sin(t*.0031+n.phase*3):1;n.head.rotation.z=Math.sin(t*.0009+n.phase)*.12*lurch+(n.walking?Math.sin(t*.008+n.phase)*.07:0);n.head.rotation.x=n.walking?.16:-.05+Math.sin(t*.0007+n.phase)*.05;n.object.rotation.z=n.walking?Math.sin(t*.0045+n.phase)*.035:Math.sin(t*.0013+n.phase)*.012;}
      n.blinkTimer-=dt;if(n.blinkTimer<=0){n.blinkAmount=Math.min(1,n.blinkAmount+dt*15);if(n.blinkAmount>=1){n.blinkTimer=.12;n.blinkAmount=Math.max(0,n.blinkAmount-dt*15);}if(n.blinkAmount===0)n.blinkTimer=2.4+Math.random()*4.8;}
      n.lids?.forEach(lid=>{lid.scale.y=.08+n.blinkAmount*.72;lid.position.y=1.955-n.blinkAmount*.012;});
      
    });
  }
}
function clearSavedEvidence() { try { localStorage.removeItem(EVIDENCE_SAVE_KEY); } catch (_) {} }
function triggerDeath(reason='THE ROOM HAS FOUND YOU',copy='The recording continues for eleven seconds after the body has stopped.') {
  clearSavedEvidence();
  if(gameEnded)return;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');$('death-title').textContent=reason;$('death-copy').textContent=copy;$('death-screen').classList.add('active');audio?.killSting();
}
function updateHorror(dt,t){
  if(!gameStarted||gameEnded||!zone||dialogueOpen||journalOpen)return;
  eventClock+=dt;const p=currentPosition();
  // Fear rises in darkness and falls slowly in lit, occupied rooms.
  const darkFactor=flashlightOn?0.0:.022;
  const zoneFactor=currentZone==='cellar'?.014:currentZone==='abattoir'?(flashlightOn?.002:.009):currentZone==='ruin'?.009:0;
  fear=Math.min(1,Math.max(.04,fear+(darkFactor+zoneFactor-.002)*dt*(SETTINGS.difficulty>=3?1.5:SETTINGS.difficulty===0?.6:1)));
  // Brief, mischievous anomalies: the room seems to answer from the wrong side.
  if(fear>.52&&eventClock>26&&Math.random()<.00075){glitchPulse=Math.max(glitchPulse,.65);audio?.mechanicalEvent('clock');showToast('THIRTEEN BREATHS. ONE IS OUT OF TIME.');}
  if(SETTINGS.difficulty>=3&&fear>.995&&currentZone==='abattoir'&&!flashlightOn){triggerDeath('THE ROOM HAS OCCUPIED YOUR BODY.');return;}
  if(fear>.88&&Math.random()<.0012){glitchPulse=1.15;audio?.stinger(.9);$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),130);}
  if(hiddenBreath){fear=Math.max(.08,fear-.075*dt);}
  $('fear-value').textContent=`${Math.round(fear*100)}%`;
}

function updateHud(dt) {
  elapsed += dt; const mins = Math.floor(elapsed / 60); const secs = Math.floor(elapsed % 60); const frames = Math.floor((elapsed % 1) * 25);
  $('tape-counter').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  const signal = Math.max(8, Math.round(94 - dread * 42 - Math.sin(elapsed * .31) * 4 - glitchPulse * 17));
  $('signal-value').textContent = `${signal}%`;
  $('clock').textContent = `03:${String(17 + Math.floor(elapsed / 90)).padStart(2, '0')}`;
  $('coords').textContent = currentZone === 'road' ? '45° 02′ N — 10° 41′ E' : ({ home: '45° 02′ N — 10° 41′ E', church: '45° 02′ N — 10° 41′ E', ruin: '45° 02′ N — 10° 41′ E', cellar: '45° 02′ N — 10° 41′ E', abattoir: '45° 02′ N — 10° 41′ E' })[currentZone];
}
let previousTargetId = '';
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04); const t = performance.now();
  if (gameStarted && !gameEnded) {
    updatePlayer(dt); updateCemeteryTrap(); updateTargets(); animateZone(t, dt); updateCultSequence(dt,t);
    if(listeningPending && !cultFateActive && cultFateQueue.length===0) finishListening();
    updateMissions(); updateDig(dt); updatePresence(dt, t);
    if(!gameEnded){updateHorror(dt,t);updateDayNight(dt,t);updateWeather(dt,t);updateCameraDirector(dt,t);updateHud(dt);}
    if (activeTarget?.id !== previousTargetId && activeTarget) audio.stinger(.07);
    previousTargetId = activeTarget?.id || '';
  }
  dread = Math.min(1, .12 + collected.size * .11 + fear*.36 + (currentZone === 'cellar' ? .22 : 0));
  if (zone) { scene.fog.density += (zone.density + dread * .012 - scene.fog.density) * Math.min(1, dt * .8); }
  audio.setTension(Math.max(dread, presence * .9)); updateLens(dt); updateZoom(dt);
  glitchPulse = Math.max(0, glitchPulse - dt * 1.45);
  glitchPass.uniforms.time.value = t * .001;
  baconPass.uniforms.time.value = t * .001; baconPass.uniforms.grade.value = .62 + dread * .3; baconPass.uniforms.smear.value = .05 + dread * .12;
  glitchPass.uniforms.strength.value = .10 + dread * .13 + glitchPulse * .5;
  bloom.strength = .24 + dread * .15; bloom.threshold = .78 - dread * .12;
  storyTick(dt, t);
  composer.render();
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});
window.addEventListener('error', e => { const f = $('fatal'); f.textContent = `SYSTEM ERROR\n${e.message}\n${e.filename || ''}:${e.lineno || ''}`; f.classList.remove('hidden'); });
window.addEventListener('unhandledrejection', e => {
   // Pointer-lock denial is an expected browser permission outcome, not a fatal
   // game error. Keep keyboard and drag-look controls available.
   if (e.reason?.name === 'NotAllowedError' && /requestPointerLock/i.test(e.reason?.message || '')) {
     e.preventDefault();
     if (playerInputEnabled()) showToast('MOUSE LOOK PAUSED — CLICK THE SCENE TO RESUME. WASD WORKS.');
     return;
   }
   const f = $('fatal'); f.textContent = `SYSTEM ERROR\n${e.reason?.stack || e.reason}`; f.classList.remove('hidden');
 });

// =============================================================================
// v6 — furniture and interiors at true scale: the dining table of thirteen,
// white plastic garden chairs, the kitchen corner, the Flemish harpsichord.
// (Function declarations only: these run while the zones are being built.)
// =============================================================================
function canvasTex(w, h, draw, color = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (color) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function crackTexture() {
  return canvasTex(128, 360, (g, w, h) => {
    g.strokeStyle = 'rgba(10,9,8,.85)'; g.lineWidth = 2.2; let x = 64, y = 4; g.beginPath(); g.moveTo(x, y);
    while (y < h - 6) { x += (Math.random() - .5) * 18; y += 8 + Math.random() * 16; g.lineTo(x, y); if (Math.random() < .2) { g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 40, y + 20); g.moveTo(x, y); } }
    g.stroke(); g.fillStyle = 'rgba(70,55,40,.22)'; g.beginPath(); g.ellipse(64, 260, 50, 95, 0, 0, Math.PI * 2); g.fill();
  });
}
// A monobloc white plastic garden chair, the kind the script puts at the table and in the church.
function addPlasticChair(group, x, z, rotY = 0) {
  const root = new THREE.Group(); root.position.set(x, 0, z); root.rotation.y = rotY; group.add(root);
  const plastic = storyRef.plasticMat || (storyRef.plasticMat = mat(0xe4e2da, .46, { metalness: 0 }));
  const seat = roundedHousing(.46, .035, .42, .06, plastic, .012); seat.rotation.x = -Math.PI / 2; seat.position.set(0, .44, .02); root.add(seat);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .42, 20, 1, true, -Math.PI * .32, Math.PI * .64), plastic); back.material.side = THREE.DoubleSide;
  back.rotation.y = Math.PI; back.position.set(0, .7, .18); back.scale.z = .7; root.add(back);
  for (let i = -2; i <= 2; i++) { const slot = new THREE.Mesh(new THREE.BoxGeometry(.03, .16, .02), M.black); slot.position.set(i * .07, .74, -.07 - Math.abs(i) * .02); root.add(slot); }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.022, .03, .46, 8), plastic); leg.position.set(sx * .2, .22, sz * .18); leg.rotation.set(sz * .09, 0, -sx * .09); root.add(leg); }
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.022, .34, 4, 8), plastic); arm.rotation.x = Math.PI / 2; arm.position.set(sx * .23, .64, .03); root.add(arm);
    tubeBetween(root, [sx * .23, .64, .18], [sx * .22, .46, .2], .02, plastic, 6);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}
// Tableware at real size: a 26 cm plate, a 16 cm soup bowl, a 17 cm spoon.
function addPlaceSetting(group, x, y, z, rotY = 0, { soup = true, full = false } = {}) {
  const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = rotY; group.add(root);
  const ceramic = storyRef.ceramicMat || (storyRef.ceramicMat = mat(0xe8e2d4, .28)), steel = storyRef.cutleryMat || (storyRef.cutleryMat = mat(0xb8b6ae, .28, { metalness: .85 }));
  const plate = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(.09, 0), new THREE.Vector2(.11, .008), new THREE.Vector2(.13, .016), new THREE.Vector2(.128, .019), new THREE.Vector2(.09, .006), new THREE.Vector2(0, .006)], 28), ceramic); root.add(plate);
  if (soup) {
    const bowl = buildSoupBowl(root, 0, .006, 0, full); bowl.rotation.y = rotY;
  }
  const spoon = buildSpoon(steel); spoon.position.set(.17, .002, .02); spoon.rotation.y = Math.PI / 2; root.add(spoon);
  const knife = new THREE.Mesh(new THREE.BoxGeometry(.012, .003, .2), steel); knife.position.set(.155, .002, -.01); root.add(knife);
  const fork = new THREE.Group(); const fh = new THREE.Mesh(new THREE.BoxGeometry(.012, .003, .14), steel); fh.position.z = .03; fork.add(fh);
  for (let i = 0; i < 4; i++) { const tine = new THREE.Mesh(new THREE.BoxGeometry(.0025, .003, .045), steel); tine.position.set(-.006 + i * .004, 0, -.06); fork.add(tine); }
  fork.position.set(-.16, .002, 0); root.add(fork);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(.032, .027, .09, 16, 1, true), storyRef.glassMat || (storyRef.glassMat = new THREE.MeshStandardMaterial({ color: 0xd8e2de, roughness: .06, metalness: .1, transparent: true, opacity: .32, side: THREE.DoubleSide })));
  glass.position.set(.14, .045, -.16); root.add(glass);
  const napkin = new THREE.Mesh(new THREE.PlaneGeometry(.12, .18), mat(0xd9d2c2, 1)); napkin.rotation.x = -Math.PI / 2; napkin.position.set(-.16, .0015, .01); napkin.scale.x = .8; root.add(napkin);
  root.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  return root;
}
function buildSpoon(material) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(.011, .003, .12), material); handle.position.z = .045; g.add(handle);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.02, 12, 8), material); head.scale.set(.85, .25, 1.35); head.position.set(0, .004, -.035); g.add(head);
  return g;
}
// The soup bowl, rebuilt at the size of a real bowl (the old one was half a metre wide).
function buildSoupBowl(group, x, y, z, full = true) {
  const root = new THREE.Group(); root.position.set(x, y, z); group.add(root);
  const ceramic = storyRef.ceramicMat || (storyRef.ceramicMat = mat(0xe8e2d4, .28));
  const profile = [new THREE.Vector2(.03, 0), new THREE.Vector2(.055, .004), new THREE.Vector2(.075, .025), new THREE.Vector2(.083, .045), new THREE.Vector2(.08, .047), new THREE.Vector2(.072, .03)];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), ceramic); bowl.material.side = THREE.DoubleSide; bowl.castShadow = true; root.add(bowl);
  if (full) {
    const broth = new THREE.Mesh(new THREE.CircleGeometry(.074, 24), mat(0x6b4426, .22, { emissive: 0x231006, emissiveIntensity: .1 })); broth.rotation.x = -Math.PI / 2; broth.position.y = .036; root.add(broth);
    for (let i = 0; i < 5; i++) { const bit = new THREE.Mesh(new THREE.SphereGeometry(.006, 6, 5), mat(i % 2 ? 0x6e7349 : 0xb28a52, .9)); bit.position.set((Math.random() - .5) * .09, .037, (Math.random() - .5) * .09); root.add(bit); }
    const spoon = buildSpoon(storyRef.cutleryMat || (storyRef.cutleryMat = mat(0xb8b6ae, .28, { metalness: .85 }))); spoon.position.set(.035, .05, .02); spoon.rotation.set(.35, .5, 0); root.add(spoon);
  }
  return root;
}
function buildDiningRoom(z) {
  const cx = -6.5, cz = 2.4, L = 4.6, W = 1.05, H = .76;
  const table = addWoodTable(z.group, cx, cz, L, W, H, 24); table.rotation.y = Math.PI / 2;
  const topY = H + H * .045 + .025;
  // A linen cloth with a hanging edge.
  const linen = mat(0xd8d2c3, 1);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(W + .12, .006, L + .16), linen); cloth.position.set(cx, topY + .002, cz); cloth.receiveShadow = true; z.group.add(cloth);
  for (const s of [-1, 1]) { const drape = new THREE.Mesh(new THREE.PlaneGeometry(L + .16, .2), new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 1, side: THREE.DoubleSide })); drape.position.set(cx + s * (W / 2 + .06), topY - .098, cz); drape.rotation.y = Math.PI / 2; z.group.add(drape); }
  const T = { west: [], east: [], top: [cx, cz], topY: topY + .005 };
  for (let k = 0; k < 6; k++) {
    const zz = cz - L / 2 + .45 + k * .74;
    T.west.push([cx - .83, zz]); T.east.push([cx + .83, zz]);
    addPlasticChair(z.group, cx - .83, zz, Math.PI / 2); addPlasticChair(z.group, cx + .83, zz, -Math.PI / 2);
    addPlaceSetting(z.group, cx - W / 2 + .22, T.topY, zz, Math.PI / 2, { full: k === 2 });
    addPlaceSetting(z.group, cx + W / 2 - .22, T.topY, zz, -Math.PI / 2, { full: false });
  }
  T.north = [cx, cz - L / 2 - .5]; T.south = [cx, cz + L / 2 + .5];
  addPlasticChair(z.group, T.north[0], T.north[1], 0); addPlasticChair(z.group, T.south[0], T.south[1], Math.PI);
  addPlaceSetting(z.group, cx, T.topY, cz - L / 2 + .22, 0, { full: false });
  addPlaceSetting(z.group, cx, T.topY, cz + L / 2 - .22, Math.PI, { full: true });
  storyRef.tableSeats = T;
  addCandle(z.group, cx, T.topY, cz - .2, true); addCandle(z.group, cx, T.topY, cz + 1.05, true);
  addLamp(z.group, cx, 2.62, cz + .4, { style: 'pendant', color: 0xffc887, intensity: 5.5, distance: 9, shadow: true, flicker: .03 });
  addLook(z.group, cx, topY + .25, cz + L / 2 - .2, 'Your place', 'Fourteen places at a table of thirteen. Ines set yours without asking your name. The soup in your bowl is the same soup as Anna’s.', 1.6);
  z.solids.push({ minX: cx - W / 2 - .45, maxX: cx + W / 2 + .45, minZ: cz - L / 2 - .25, maxZ: cz + L / 2 + .25 });
}
function seatNPC(npc, x, z, rotY) {
  // Sit: thighs forward, shins down, the body lowered onto the seat.
  npc.seated = true; npc.baseY = -.2;
  npc.object.position.set(x - Math.sin(rotY) * .06, -.2, z - Math.cos(rotY) * .06); npc.point = npc.object.position; npc.object.rotation.y = rotY;
  npc.legs?.forEach(h => { h.rotation.x = -Math.PI / 2 + .08; }); npc.lowerLegs?.forEach(c => { c.rotation.x = Math.PI / 2 - .1; });
  npc.leftArm.rotation.x = -.55; npc.rightArm.rotation.x = -.55; npc.leftForearm.rotation.x = -.6; npc.rightForearm.rotation.x = -.6;
}
function buildKitchenCorner(z) {
  const g = z.group;
  // A 1970s refrigerator, door open, its bulb the only cold light in the house.
  const fridge = new THREE.Group(); fridge.position.set(-6.0, 0, -8.32); g.add(fridge); storyRef.fridge = fridge;
  const enamel = mat(0xd9d6cb, .35, { metalness: .05 }), inner = mat(0xe9ebe6, .6);
  const shell = roundedHousing(.72, 1.58, .62, .07, enamel, .02); shell.position.y = .79; fridge.add(shell);
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.36, .5), new THREE.MeshStandardMaterial({ color: 0xeef1ee, roughness: .7, emissive: 0xbfd4e6, emissiveIntensity: .35, side: THREE.BackSide })); cavity.position.set(0, .82, .08); fridge.add(cavity);
  for (const yy of [.45, .82, 1.18]) { const shelf = new THREE.Mesh(new THREE.BoxGeometry(.56, .012, .44), new THREE.MeshStandardMaterial({ color: 0xd8e4e6, roughness: .1, transparent: true, opacity: .6 })); shelf.position.set(0, yy, .1); fridge.add(shelf); }
  const milk = new THREE.Mesh(new THREE.CylinderGeometry(.04, .045, .22, 12), mat(0xf2f1ea, .4)); milk.position.set(-.15, .58, .12); fridge.add(milk);
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .1, 12), new THREE.MeshStandardMaterial({ color: 0x8a3a24, roughness: .3, transparent: true, opacity: .8 })); jar.position.set(.12, .88, .1); fridge.add(jar);
  const door = new THREE.Group(); door.position.set(-.36, 0, .33); fridge.add(door); door.rotation.y = -1.95;
  const slab = roundedHousing(.72, 1.56, .07, .05, enamel, .015); slab.position.set(.36, .79, 0); door.add(slab);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(.015, .32, 4, 8), mat(0xc8c6be, .2, { metalness: .9 })); handle.position.set(.66, 1.05, .055); door.add(handle);
  const fl = new THREE.PointLight(0xdbe8ff, 2.4, 5.5, 1.8); fl.position.set(0, .9, .55); fridge.add(fl); storyRef.fridgeLight = fl;
  addLook(g, -6.0, 1.0, -7.9, 'The refrigerator', 'It hums a flat B, a semitone under where it should be. Nobody has repaired it. You heard it from the first night, and now you cannot stop hearing it.', 2.2);
  addPlasticChair(g, -6.0, -6.95, Math.PI);
  // A seed-company calendar stuck on the wrong month.
  const cal = new THREE.Mesh(new THREE.PlaneGeometry(.42, .62), new THREE.MeshStandardMaterial({ roughness: .95, map: canvasTex(256, 380, (c, w, h) => {
    c.fillStyle = '#e6dcc4'; c.fillRect(0, 0, w, h); c.fillStyle = '#5a7a3a'; c.fillRect(0, 0, w, 150);
    c.fillStyle = '#f0d27a'; for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(40 + i * 22, 100 - (i % 3) * 18, 9, 22, .3, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#20301a'; c.font = 'bold 22px serif'; c.fillText('SEMENTI PADANE', 22, 182); c.font = '20px serif'; c.fillText('MARZO 1977', 60, 210);
    c.strokeStyle = '#7a6a50'; for (let r = 0; r < 5; r++) for (let k = 0; k < 7; k++) c.strokeRect(14 + k * 33, 228 + r * 28, 33, 28);
    c.fillStyle = '#8a1a14'; c.font = '16px serif'; c.fillText('X', 14 + 3 * 33 + 11, 228 + 2 * 28 + 20);
  }) }));
  cal.position.set(-8.3, 1.9, -8.79); g.add(cal);
  addLook(g, -8.3, 1.9, -8.5, 'The calendar', 'A seed-company calendar from SEMENTI PADANE, stuck on March 1977. One day is crossed out in red. Nobody turns the page.', 2.2);
  z.solids.push({ minX: -6.45, maxX: -5.55, minZ: -8.7, maxZ: -7.95 });
}
// Flemish single-manual harpsichord after Ruckers: about 1.84 m long and 0.76 m wide, a case 25 cm deep,
// ebony naturals with bone-topped sharps, Latin motto inside the lid, trestle stand with turned legs.
function buildHarpsichord(group, x, zFront) {
  const root = new THREE.Group(); root.position.set(x, 0, zFront); group.add(root); storyRef.harpsichord = root;
  const L = 1.84, W = .76, caseH = .25, standH = .64;
  const outline = (inset = 0) => {
    const s = new THREE.Shape(); const i = inset;
    s.moveTo(-W / 2 + i, 0 + i); s.lineTo(W / 2 - i, 0 + i); s.lineTo(W / 2 - i, .5);
    s.bezierCurveTo(W / 2 - i, 1.05, -.02 - i * .5, 1.35, -.16 + i * .3, L - .05 - i);
    s.lineTo(-W / 2 + i, L - i); s.lineTo(-W / 2 + i, 0 + i); return s;
  };
  const caseMat = mat(0xa8644a, .45, { map: TEX.darkwood, normalMap: TEX.darkwoodN, normalScale: .4 }), innerMat = mat(0xb9a988, .8), gilt = mat(0xb8934e, .35, { metalness: .8 });
  const shellShape = outline(0); shellShape.holes.push(new THREE.Path(outline(.018).getPoints(48)));
  const shellGeo = new THREE.ExtrudeGeometry(shellShape, { depth: caseH, bevelEnabled: false, curveSegments: 32 }); shellGeo.rotateX(-Math.PI / 2);
  const shell = new THREE.Mesh(shellGeo, caseMat); shell.position.y = standH; root.add(shell);
  const bottom = new THREE.Mesh(new THREE.ShapeGeometry(outline(0), 32), M.darkWood); bottom.geometry.rotateX(-Math.PI / 2); bottom.position.y = standH + .002; root.add(bottom);
  // Painted soundboard with a gilt rose and flowers, sitting a little below the rim.
  const sbTex = canvasTex(256, 512, (c, w, h) => {
    c.fillStyle = '#d8c9a2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { c.strokeStyle = 'rgba(150,120,80,.25)'; c.beginPath(); c.moveTo(i * 7, 0); c.lineTo(i * 7 + 20, h); c.stroke(); }
    const flower = (fx, fy, col) => { c.fillStyle = col; for (let k = 0; k < 5; k++) { c.beginPath(); c.ellipse(fx + Math.cos(k * 1.26) * 7, fy + Math.sin(k * 1.26) * 7, 6, 3.5, k * 1.26, 0, Math.PI * 2); c.fill(); } c.fillStyle = '#c99a3a'; c.beginPath(); c.arc(fx, fy, 3, 0, 7); c.fill(); };
    [[60, 120, '#b44a3c'], [190, 90, '#3f5d8a'], [80, 300, '#b44a3c'], [170, 380, '#7a5aa0'], [120, 460, '#3f6d4a']].forEach(([a, b, col]) => flower(a, b, col));
    c.strokeStyle = '#4b6b3a'; c.lineWidth = 2; c.beginPath(); c.moveTo(40, 200); c.bezierCurveTo(120, 160, 140, 260, 220, 230); c.stroke();
  });
  sbTex.repeat.set(1 / W, 1 / L); sbTex.offset.set(.5, 0);
  const sb = new THREE.Mesh(new THREE.ShapeGeometry(outline(.02), 32), mat(0xffffff, .85, { map: sbTex })); sb.geometry.rotateX(-Math.PI / 2); sb.position.y = standH + caseH - .06; sb.position.z = 0; root.add(sb);
  const rose = new THREE.Mesh(new THREE.TorusGeometry(.045, .008, 6, 24), gilt); rose.rotation.x = -Math.PI / 2; rose.position.set(.12, standH + caseH - .055, -1.15); root.add(rose);
  const roseIn = new THREE.Mesh(new THREE.CircleGeometry(.04, 20), mat(0x2a1b10, .8)); roseIn.rotation.x = -Math.PI / 2; roseIn.position.set(.12, standH + caseH - .057, -1.15); root.add(roseIn);
  // Strings, bridge and jack rail.
  const pts = [];
  for (let i = 0; i < 26; i++) { const u = i / 25, sx = -W / 2 + .05 + u * (W - .12), len = .5 + (1 - u) * 1.15; pts.push(sx, standH + caseH - .045, -.22, sx * .96 - .02, standH + caseH - .045, -.22 - len); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); root.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xb59a64, transparent: true, opacity: .8 })));
  addBox(root, 0, standH + caseH - .02, -.2, W - .04, .05, .045, M.darkWood);
  // Keyboard: 54 keys, ebony naturals and bone-topped sharps, in a keywell between the cheeks.
  const keyY = standH + .1, naturalW = (W - .07) / 32;
  addBox(root, 0, keyY - .03, -.06, W - .036, .05, .18, M.darkWood);
  const ebony = mat(0x15110e, .35), bone = mat(0xe6dcc6, .4);
  const nat = new THREE.InstancedMesh(new THREE.BoxGeometry(naturalW * .92, .022, .13), ebony, 32), sh = new THREE.InstancedMesh(new THREE.BoxGeometry(naturalW * .55, .03, .08), bone, 22);
  const d = new THREE.Object3D(); let ni = 0, si = 0;
  for (let k = 0; k < 32; k++) { d.position.set(-W / 2 + .035 + naturalW * (k + .5), keyY, -.05); d.rotation.set(0, 0, 0); d.updateMatrix(); nat.setMatrixAt(ni++, d.matrix);
    const n = k % 7; if (k < 31 && n !== 2 && n !== 6 && si < 22) { d.position.set(-W / 2 + .035 + naturalW * (k + 1), keyY + .02, -.08); d.updateMatrix(); sh.setMatrixAt(si++, d.matrix); } }
  sh.count = si; root.add(nat, sh);
  addBox(root, 0, keyY + .07, -.15, W - .04, .1, .02, caseMat);
  // Music desk with a page of continuo figures.
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(.38, .24), new THREE.MeshStandardMaterial({ map: canvasTex(256, 160, (c, w, h) => { c.fillStyle = '#e2d7bd'; c.fillRect(0, 0, w, h); c.strokeStyle = '#3a3026'; for (let s = 0; s < 3; s++) for (let l = 0; l < 5; l++) { c.beginPath(); c.moveTo(10, 20 + s * 48 + l * 5); c.lineTo(w - 10, 20 + s * 48 + l * 5); c.stroke(); } c.fillStyle = '#2a221a'; for (let n = 0; n < 40; n++) { c.beginPath(); c.ellipse(15 + n * 6, 22 + (n % 3) * 48 + (n * 7 % 20), 2.6, 2, -.4, 0, 7); c.fill(); } }), roughness: .95, side: THREE.DoubleSide }));
  desk.position.set(0, standH + caseH + .14, -.32); desk.rotation.x = -.3; root.add(desk);
  addBox(root, 0, standH + caseH + .02, -.27, .4, .02, .05, M.darkWood);
  // Lid, hinged along the spine and propped open; Flemish block paper and a Latin motto inside.
  const lidTex = canvasTex(256, 620, (c, w, h) => {
    c.fillStyle = '#d9caa0'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(80,60,30,.35)'; for (let y = 0; y < h; y += 18) for (let x = 0; x < w; x += 18) { c.beginPath(); c.arc(x + 9, y + 9, 6, 0, 7); c.stroke(); }
    c.save(); c.translate(w / 2 + 40, h / 2); c.rotate(-Math.PI / 2); c.fillStyle = '#3a2412'; c.font = 'bold 21px serif'; c.textAlign = 'center';
    c.fillText('MVSICA COMES LAETITIAE', 0, -8); c.fillText('MEDICINA DOLORVM', 0, 22); c.restore();
    c.strokeStyle = '#8c6c34'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
  });
  lidTex.repeat.set(1 / W, 1 / L); lidTex.offset.set(.5, 0);
  const lidPivot = new THREE.Group(); lidPivot.position.set(-W / 2, standH + caseH, 0); root.add(lidPivot); lidPivot.rotation.z = .78;
  const lidGeo = new THREE.ShapeGeometry(outline(0), 32); lidGeo.rotateX(-Math.PI / 2); lidGeo.translate(W / 2, 0, 0);
  const lid = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial({ map: lidTex, roughness: .8, side: THREE.DoubleSide })); lidPivot.add(lid);
  const lidTop = new THREE.Mesh(lidGeo.clone(), caseMat); lidTop.position.y = .016; lidPivot.add(lidTop);
  tubeBetween(root, [.22, standH + caseH, -.9], [-.02, standH + caseH + .35, -.9], .01, M.darkWood, 6);
  // Trestle stand with six turned legs.
  const turned = new THREE.LatheGeometry([new THREE.Vector2(.025, 0), new THREE.Vector2(.032, .04), new THREE.Vector2(.02, .1), new THREE.Vector2(.04, .22), new THREE.Vector2(.022, .34), new THREE.Vector2(.03, .44), new THREE.Vector2(.026, .56), new THREE.Vector2(.034, standH - .02), new THREE.Vector2(.03, standH)], 12);
  for (const [lx, lz] of [[-.32, -.1], [.32, -.1], [-.32, -.95], [.25, -.85], [-.32, -1.72], [-.12, -1.62]]) { const leg = new THREE.Mesh(turned, M.darkWood); leg.position.set(lx, 0, lz); root.add(leg); }
  addBox(root, -.32, .12, -.9, .04, .05, 1.6, M.darkWood); addBox(root, 0, .12, -.1, .64, .05, .04, M.darkWood); addBox(root, .1, .12, -.95, .4, .05, .04, M.darkWood);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Stool and a small side table with tuning hammer and fork.
  const stool = new THREE.Group(); stool.position.set(x, 0, zFront + .55); group.add(stool);
  const seat = roundedHousing(.5, .05, .32, .03, mat(0x5a2a22, .9), .01); seat.rotation.x = -Math.PI / 2; seat.position.y = .48; stool.add(seat);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(turned, M.darkWood); l.scale.set(.8, .74, .8); l.position.set(sx * .2, 0, sz * .11); stool.add(l); }
  const st = addWoodTable(group, x + 1.57, zFront + .3, .5, .42, .66, 9);
  storyRef.sideTableY = .66 + .66 * .045 + .025;
  const hammer = new THREE.Group(); hammer.position.set(x + 1.47, storyRef.sideTableY + .012, zFront + .38); group.add(hammer);
  const hh = new THREE.Mesh(new THREE.CylinderGeometry(.012, .014, .12, 10), M.darkWood); hh.rotation.z = Math.PI / 2; hammer.add(hh);
  const hhead = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .07, 10), mat(0x8c8a80, .3, { metalness: .9 })); hhead.position.x = -.08; hammer.add(hhead);
  // Interaction: pluck it at baroque pitch.
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.1, 6, 5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); marker.position.set(x, standH + .2, zFront - .1); group.add(marker);
  group.userData.interactables.push({ id: 'harpsichord', type: 'story', object: marker, point: marker.position, radius: 2.4, prompt: '[ E ] PLAY A NOTE — TUNED TO A=415', run: () => {
    const notes = [207.65, 261.63 * 0.944, 311.13 * 0.944, 415 / 2 * 1.5, 415];
    notes.forEach((f, i) => setTimeout(() => audio?.pluck(f), i * 260));
    showToast('A = 415. A SEMITONE BELOW THE WORLD.');
    if (!storyFlags.has('harpsichord-played')) { storyFlags.add('harpsichord-played'); storyLine('Ottavio: (his palm flat on the soundboard) There. Now it is wrong in the right way.'); }
    const entry = group.userData.interactables.find(e => e.id === 'harpsichord'); if (entry) entry.used = false;
  } });
  if (group === zones.home?.group || true) {
    const zz = Object.values(zones).find(v => v.group === group);
    if (zz) zz.solids.push({ minX: x - .45, maxX: x + .45, minZ: zFront - 1.9, maxZ: zFront + .05 }, { minX: x + 1.3, maxX: x + 1.84, minZ: zFront + .08, maxZ: zFront + .52 });
  }
  return root;
}

// =============================================================================
// v6 — the church interior, the empty house, the road at night (lamps, chimney
// smoke, the gothic portal lit from below, the cemetery gate and its easter egg).
// =============================================================================
function buildChurchInterior(z) {
  const g = z.group;
  // A real rood beam across the nave, with its crucifix; Dario's Mass happens beneath it.
  addBox(g, 0, 4.75, -10.6, 17.6, .34, .36, M.darkWood);
  const cross = new THREE.Group(); cross.position.set(0, 4.1, -10.6); g.add(cross); storyRef.roodCross = cross;
  addBox(cross, 0, 0, 0, .16, 1.5, .12, M.darkWood); addBox(cross, 0, .35, 0, .9, .14, .12, M.darkWood);
  tubeBetween(cross, [0, .75, 0], [0, .48, 0], .008, M.black, 4);
  storyRef.roodBeamY = 4.57;
  // A lectern for the Mass Register.
  const lec = new THREE.Group(); lec.position.set(-3.6, 0, -12.2); lec.rotation.y = .5; g.add(lec);
  const turned = new THREE.LatheGeometry([new THREE.Vector2(.2, 0), new THREE.Vector2(.2, .05), new THREE.Vector2(.06, .1), new THREE.Vector2(.05, .6), new THREE.Vector2(.08, .7), new THREE.Vector2(.05, .95), new THREE.Vector2(.09, 1.02)], 14);
  lec.add(new THREE.Mesh(turned, M.darkWood));
  const top = new THREE.Mesh(worldBox(.52, .035, .4), M.darkWood); top.position.y = 1.07; top.rotation.x = .32; lec.add(top);
  const lip = new THREE.Mesh(worldBox(.52, .05, .025), M.darkWood); lip.position.set(0, 1.03, .2); lec.add(lip);
  lec.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // The register lies flat on a small shelf in front of the slope, so it rests and does not slide.
  addBox(lec, 0, .82, .16, .44, .03, .3, M.darkWood);
  const wp = new THREE.Vector3(0, .835, .16); lec.localToWorld(wp); lec.updateMatrixWorld(true); wp.set(0, .835, .16).applyMatrix4(lec.matrixWorld);
  storyRef.lectern = wp; z.solids.push({ minX: -3.95, maxX: -3.25, minZ: -12.55, maxZ: -11.85 });
  // White plastic garden chairs for the Masses (script: the blasphemy is made from the parish).
  for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) addPlasticChair(g, k * .78, -8.4 + r * 1.0, Math.PI);
  // Candle stands and sconces: warm pools of light along the walls.
  for (const sx of [-1, 1]) {
    for (const zz of [-6, 2]) addLamp(g, sx * 8.6, 2.7, zz, { style: 'lantern', rotY: sx > 0 ? -Math.PI / 2 : Math.PI / 2, color: 0xffb066, intensity: 4.5, distance: 12, flicker: .08 });
  }
  addLamp(g, 0, 5.4, -13.2, { style: 'pendant', color: 0xff6a3a, intensity: 4, distance: 12, shadow: false, flicker: .04 });
  addLook(g, 0, 4.2, -10.4, 'The rood beam', 'The beam that crosses the nave, black with smoke. Fresh rope burns on the wood, and the crucifix has been turned to face the wall.', 3.2);
}

// ---------------------------------------------------------------------------
// The empty house: broken windows, spiderwebs, mould, a collapsed ceiling.
// ---------------------------------------------------------------------------
function decalTexture(kind, seed = 1) {
  let st = seed * 9301 + 49297; const r = () => ((st = (st * 9301 + 49297) % 233280) / 233280);
  return canvasTex(256, 256, (g, w, h) => {
    if (kind === 'mould') {
      for (let i = 0; i < 260; i++) { const a = r() * 6.28, d = Math.pow(r(), .7) * 110; const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * .8, rad = 2 + r() * 16 * (1 - d / 130);
        g.fillStyle = `rgba(${18 + r() * 30 | 0},${28 + r() * 34 | 0},${16 + r() * 18 | 0},${.25 + r() * .5})`; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); }
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${90 + r() * 40 | 0},${100 + r() * 40 | 0},${60 + r() * 30 | 0},.35)`; g.fillRect(64 + r() * 128, 64 + r() * 128, 2, 2); }
    } else if (kind === 'stain') {
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, 'rgba(60,44,24,.55)'); grd.addColorStop(.7, 'rgba(70,52,30,.25)'); grd.addColorStop(1, 'rgba(70,52,30,0)');
      g.fillStyle = grd; for (let i = 0; i < 9; i++) { const x = 40 + r() * 176, ww = 6 + r() * 26; g.beginPath(); g.moveTo(x - ww, 0); g.quadraticCurveTo(x + (r() - .5) * 20, h * .6, x, h * (.6 + r() * .4)); g.quadraticCurveTo(x + ww, h * .4, x + ww, 0); g.fill(); }
      g.strokeStyle = 'rgba(50,36,20,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(10, 14); g.bezierCurveTo(90, 30, 150, 4, 246, 18); g.stroke();
    } else if (kind === 'web') {
      g.strokeStyle = 'rgba(225,225,220,.55)'; g.lineWidth = 1; const cx = 6, cy = 6;
      for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI / 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250); g.stroke(); }
      for (let k = 1; k < 13; k++) { g.beginPath(); for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2, rr = k * 19 + (i % 2) * 5 + r() * 4; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? g.quadraticCurveTo(cx + Math.cos(a - .1) * (rr - 5), cy + Math.sin(a - .1) * (rr - 5), x, y) : g.moveTo(x, y); } g.stroke(); }
      g.strokeStyle = 'rgba(225,225,220,.25)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(r() * 200, r() * 200); g.lineTo(r() * 256, r() * 256); g.stroke(); }
    } else if (kind === 'paper') {
      g.fillStyle = '#8f8466'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(70,40,30,.35)';
      for (let y = 0; y < h; y += 32) for (let x = (y / 32 % 2) * 16; x < w; x += 32) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x, y + 7); g.lineTo(x, y + 18); g.stroke(); }
      g.fillStyle = 'rgba(40,30,20,.35)'; for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 30, 2 + r() * 12, r() * 3, 0, 7); g.fill(); }
    } else if (kind === 'ghost') {
      g.fillStyle = 'rgba(205,195,170,.45)'; g.fillRect(84, 20, 88, 216); g.fillRect(36, 70, 184, 52);
    } else if (kind === 'sacred') {
      g.fillStyle = '#3b2a20'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a3a2c'; g.beginPath(); g.ellipse(128, 110, 60, 76, 0, 0, 7); g.fill();
      g.fillStyle = '#c69a5a'; g.beginPath(); g.arc(128, 70, 34, 0, 7); g.fill(); g.fillStyle = '#9a1e1a'; g.beginPath(); g.moveTo(128, 150); g.bezierCurveTo(98, 120, 110, 100, 128, 118); g.bezierCurveTo(146, 100, 158, 120, 128, 150); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(r() * w, r() * h); g.lineTo(r() * w, r() * h); g.stroke(); }
    }
  });
}
function addDecal(group, kind, x, y, z, w, h, rotY = 0, rotX = 0, seed = 1, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: decalTexture(kind, seed), transparent: true, opacity, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, side: kind === 'web' ? THREE.DoubleSide : THREE.FrontSide }));
  m.position.set(x, y, z); m.rotation.set(rotX, rotY, 0); m.receiveShadow = true; group.add(m); return m;
}
function brokenGlass(group, x, y, z, w, h, rotY) {
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9b8b6, roughness: .08, metalness: .2, transparent: true, opacity: .35, side: THREE.DoubleSide });
  const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = rotY; group.add(root);
  const shard = (pts) => { const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => sh.lineTo(p[0], p[1])); root.add(new THREE.Mesh(new THREE.ShapeGeometry(sh), glass)); };
  const W = w / 2, H = h / 2;
  shard([[-W, -H], [-W * .2, -H], [-W * .6, -H * .1], [-W, H * .3]]);
  shard([[W, H], [W * .1, H], [W * .55, H * .35], [W, -H * .2]]);
  shard([[W, -H], [W * .4, -H], [W * .8, -H * .55]]);
  // Frame.
  for (const s of [-1, 1]) { addBox(root, s * (W + .05), 0, 0, .1, h + .2, .12, M.darkWood); addBox(root, 0, s * (H + .05), 0, w + .2, .1, .12, M.darkWood); }
  return root;
}
function buildRuinV6() {
  const z = newZone('ruin', 0x2e302d, .04, { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  const g = z.group;
  addBox(g, 0, -.12, 0, 16, .24, 16, mat(0x6a5a48, .95, { map: TEX.planks, normalMap: TEX.planksN }));
  const W = M.ruinWall, H = 3.8;
  addWindowedWall(g, 'x', -8, -8.2, 8.2, H, .34, W, [{ at: -4, w: 1.3, h: 1.4, y: 1.15 }, { at: 3.5, w: 1.3, h: 1.4, y: 1.15 }]);
  addWindowedWall(g, 'z', -8, -8, 8, H, .34, W, [{ at: 1, w: 1.3, h: 1.4, y: 1.15 }]);
  addWindowedWall(g, 'z', 8, -8, 8, H, .34, W, [{ at: -2, w: 1.3, h: 1.4, y: 1.15 }]);
  addWindowedWall(g, 'x', 8, -8.2, -2.5, H, .34, W, [{ at: -5.2, w: 1.2, h: 1.3, y: 1.2 }]); addBox(g, 5.35, H / 2, 8, 5.7, H, .34, W);
  addBox(g, 0, 3.1 + .35, 8, 5, .7, .34, W);
  // Windows: broken panes and boards nailed across.
  brokenGlass(g, -4, 1.85, -7.95, 1.3, 1.4, 0); brokenGlass(g, 3.5, 1.85, -7.95, 1.3, 1.4, 0);
  brokenGlass(g, -7.95, 1.85, 1, 1.3, 1.4, Math.PI / 2); brokenGlass(g, 7.95, 1.85, -2, 1.3, 1.4, Math.PI / 2); brokenGlass(g, -5.2, 1.85, 7.95, 1.2, 1.3, 0);
  addBox(g, 3.5, 1.9, -7.82, 1.6, .16, .04, M.wood, { rotation: [0, 0, .5] }); addBox(g, 3.5, 1.7, -7.8, 1.6, .16, .04, M.wood, { rotation: [0, 0, -.35] });
  addBox(g, -5.2, 1.9, 7.84, 1.4, .15, .04, M.wood, { rotation: [0, 0, .2] });
  // Ceiling: partly collapsed, laths showing, a beam fallen into the room.
  const ceil = mat(0x5e594e, 1, { map: TEX.oldPlaster, normalMap: TEX.plasterN });
  addBox(g, -4, H + .1, -4.6, 8.2, .2, 6.8, ceil); addBox(g, 5, H + .1, 0, 6.2, .2, 16.2, ceil); addBox(g, -5, H + .1, 5.2, 6.2, .2, 5.8, ceil);
  for (let i = 0; i < 9; i++) addBox(g, -1.6 + i * .32 * (i % 2 ? 1 : .9), H - .05, -.6 + (i % 3) * .5, .05, .03, 2.6 - (i % 4) * .4, M.wood, { rotation: [0, .05 * i, (i % 3 - 1) * .06] });
  for (let i = 0; i < 5; i++) { const p = addBox(g, -1.2 + i * .9, H - .7 - (i % 2) * .4, 1.6 - i * .5, .22, 1.4 + (i % 2) * .6, .05, M.wood); p.rotation.set(.3 * (i % 2 ? 1 : -1), i * .4, .5 - i * .2); }
  const beam = addBox(g, -.6, 1.75, .9, .28, .3, 5.0, M.darkWood); beam.rotation.set(.62, .4, .08);
  // Wallpaper peeling off the plaster, mould blooms, damp stains, ghost marks where pictures hung.
  const wp = decalTexture('paper', 3); wp.wrapS = wp.wrapT = THREE.RepeatWrapping;
  const paperMat = new THREE.MeshStandardMaterial({ map: wp, roughness: 1, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) { const strip = new THREE.Mesh(new THREE.PlaneGeometry(.55, 1.4 + (i % 3) * .5, 1, 4), paperMat); const pos = strip.geometry.attributes.position; for (let k = 0; k < pos.count; k++) { const yy = pos.getY(k); if (yy < 0) pos.setZ(k, Math.pow(-yy, 2) * .55); } strip.geometry.computeVertexNormals(); strip.position.set(-7.78, 2.4 - (i % 2) * .3, -6.5 + i * 1.7); strip.rotation.y = Math.PI / 2; strip.rotation.z = (i % 2 ? .08 : -.05); g.add(strip); }
  for (let i = 0; i < 6; i++) addDecal(g, 'mould', -7.8, .9 + (i % 3) * 1.1, -7 + i * 2.4, 1.6 + (i % 2), 1.3, Math.PI / 2, 0, 10 + i, .9);
  for (let i = 0; i < 5; i++) addDecal(g, 'mould', -6 + i * 3, 2.6 + (i % 2) * .7, -7.8, 1.8, 1.5, 0, 0, 20 + i, .9);
  for (let i = 0; i < 4; i++) addDecal(g, 'mould', 7.8, 1.2 + (i % 2) * 1.6, 4 - i * 3.3, 2, 1.6, -Math.PI / 2, 0, 30 + i);
  for (let i = 0; i < 5; i++) addDecal(g, 'mould', -6 + i * 2.6, H - .02, -6 + (i % 3) * 4, 2.2, 2.2, 0, Math.PI / 2, 40 + i, .85);
  for (let i = 0; i < 4; i++) addDecal(g, 'stain', -5 + i * 3.2, 2.4, -7.8, 1.4, 2.6, 0, 0, 50 + i, .8);
  for (let i = 0; i < 3; i++) addDecal(g, 'stain', 7.8, 2.4, -6 + i * 4.5, 1.4, 2.6, -Math.PI / 2, 0, 60 + i, .8);
  addDecal(g, 'ghost', 0, 2.2, -7.81, .9, .9, 0, 0, 7, .7);
  // Spiderwebs in the upper corners and across a window.
  [[-7.8, H - .05, -7.8, 0], [7.8, H - .05, -7.8, -Math.PI / 2], [7.8, H - .05, 7.8, Math.PI], [-7.8, H - .05, 7.8, Math.PI / 2]].forEach(([x, y, zz, ry], i) => { const web = addDecal(g, 'web', x, y, zz, 1.3, 1.3, ry + Math.PI / 4, 0, 70 + i, .85); web.rotation.set(-.6, ry + Math.PI / 4, Math.PI); });
  addDecal(g, 'web', -7.9, 2.2, 1.35, .9, .9, Math.PI / 2, 0, 75, .8); addDecal(g, 'web', 3.9, 2.3, -7.9, .8, .8, 0, 0, 76, .8);
  addDecal(g, 'web', -1.6, .55, -4.4, 1.1, .7, 0, 0, 77, .7);
  // Furniture left behind: a broken table, overturned chairs, a mattress, the dead television.
  const table = addWoodTable(g, -2.1, -4.4, 2.2, 1.0, .74, 5); table.rotation.z = .045; table.children.filter(c => c.geometry?.type === 'CylinderGeometry').slice(0, 1).forEach(c => c.visible = false);
  storyRef.ruinTableTop = .74 + .74 * .045 + .025 + .03;
  const c1 = addWoodChair(g, -.4, -3.2, .8, .95); c1.rotation.z = Math.PI / 2; c1.position.y = .3;
  const c2 = addWoodChair(g, -4.2, -2.6, 2.4, .95); c2.rotation.x = -1.25; c2.position.y = .2;
  const mattress = roundedHousing(1.9, .18, .9, .08, mat(0x6f6450, 1), .03); mattress.rotation.x = -Math.PI / 2; mattress.rotation.z = .2; mattress.position.set(4.6, .1, 4.6); g.add(mattress);
  addDecal(g, 'stain', 4.6, .2, 4.6, 1.3, .7, .2, -Math.PI / 2, 80, .6);
  addBox(g, 4.8, 1.0, -4.8, 1.0, 2.0, 1.2, M.darkWood);
  const staticScreen = new THREE.Mesh(new THREE.PlaneGeometry(.66, .5), new THREE.MeshBasicMaterial({ map: makeLabelTexture('NO SIGNAL', 512, 256), color: 0x8a8b83 })); staticScreen.position.set(4.8, 1.35, -4.19); g.add(staticScreen);
  addBox(g, 4.8, 1.35, -4.3, .82, .64, .25, mat(0x22211d, .6));
  const sacred = new THREE.Mesh(new THREE.PlaneGeometry(.5, .64), new THREE.MeshStandardMaterial({ map: decalTexture('sacred', 4), roughness: .9 })); sacred.rotation.set(-Math.PI / 2, 0, .5); sacred.position.set(1.2, .02, -6.2); g.add(sacred);
  addBox(g, 1.2, .025, -6.2, .58, .03, .72, M.darkWood, { rotation: [0, -.5, 0] });
  addLook(g, 0, 2.2, -7.5, 'The pale shape on the wall', 'A cleaner patch of plaster in the shape of a cross. The crucifix was taken down long ago; the wall kept its outline. On the floor, a Sacred Heart in a broken frame, face up, the glass in pieces.', 2.8);
  // Debris: plaster chunks, glass, bottles, papers, holes in the floor.
  const chunkMat = mat(0x8c8676, 1, { map: TEX.oldPlaster });
  for (let i = 0; i < 46; i++) { const ch = new THREE.Mesh(new THREE.DodecahedronGeometry(.05 + Math.random() * .16, 0), chunkMat); ch.position.set((Math.random() - .5) * 15, .03, (Math.random() - .5) * 15); if (Math.abs(ch.position.x) < 1.5 && ch.position.z > 3) ch.position.x += 2.5; ch.scale.y = .5; ch.rotation.set(Math.random() * 3, Math.random() * 3, 0); ch.castShadow = true; g.add(ch); }
  const shardMat = new THREE.MeshStandardMaterial({ color: 0xb4c4c2, roughness: .05, metalness: .2, transparent: true, opacity: .5, side: THREE.DoubleSide });
  for (const [wx, wz] of [[-4, -7.2], [3.5, -7.2], [-7.2, 1], [7.2, -2]]) for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.CircleGeometry(.04 + Math.random() * .07, 3), shardMat); s.rotation.set(-Math.PI / 2, 0, Math.random() * 6); s.position.set(wx + (Math.random() - .5) * 1.4, .006, wz + (Math.random() - .5) * 1.0); g.add(s); }
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .26, 10), new THREE.MeshStandardMaterial({ color: [0x2f4a2a, 0x4a3a1a, 0x2a3a3a][i % 3], roughness: .1, transparent: true, opacity: .7 })); b.rotation.set(Math.PI / 2, 0, Math.random() * 6); b.position.set(-6 + Math.random() * 12, .035, -6 + Math.random() * 12); g.add(b); }
  for (let i = 0; i < 22; i++) { const pp = new THREE.Mesh(new THREE.PlaneGeometry(.21, .29), mat(0xb9ae94, 1)); pp.rotation.set(-Math.PI / 2, 0, Math.random() * 6); pp.position.set((Math.random() - .5) * 14, .005 + i * .0003, (Math.random() - .5) * 14); g.add(pp); }
  for (const [hx, hz, r] of [[2.6, -1.4, .55], [-5.4, 4.2, .4]]) { const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 9), M.black); hole.rotation.x = -Math.PI / 2; hole.position.set(hx, .004, hz); hole.scale.set(1.4, 1, 1); g.add(hole); for (let i = 0; i < 4; i++) addBox(g, hx + (i - 1.5) * .22, .02, hz, .16, .04, r * 2.4, M.wood, { rotation: [0, 0, (i % 2 ? .3 : -.25)] }); z.solids.push({ minX: hx - r * 1.2, maxX: hx + r * 1.2, minZ: hz - r * .8, maxZ: hz + r * .8 }); }
  // Light: cold daylight through the windows, with visible shafts and dust.
  addLamp(g, -4, 2.5, -9.6, { style: 'none', color: 0xc4d2d8, intensity: 14, distance: 16, shadow: true, flicker: 0, spot: { angle: .45, target: [1.5, -2.6, 7] } });
  addLamp(g, 9.6, 2.4, -2, { style: 'none', color: 0xb8c6cc, intensity: 9, distance: 14, flicker: 0, spot: { angle: .5, target: [-7, -2.4, .5] } });
  const shaftMat = new THREE.MeshBasicMaterial({ color: 0xcfd8da, transparent: true, opacity: .055, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (const [A, B] of [[[-3.66, 1.9, -8], [-2.5, 0, -2.6]], [[8, 1.85, -1.9], [2.6, 0, -1.5]]]) {
    const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B), d = a.clone().sub(b);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.5, 1.25, d.length(), 14, 1, true), shaftMat);
    shaft.position.copy(a).add(b).multiplyScalar(.5); shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(shaft);
  }
  const dustN = 220, dp = new Float32Array(dustN * 3); for (let i = 0; i < dustN; i++) { dp[i * 3] = -6 + Math.random() * 12; dp[i * 3 + 1] = Math.random() * 3.4; dp[i * 3 + 2] = -7 + Math.random() * 10; }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xe2ddcc, size: .025, transparent: true, opacity: .55, depthWrite: false })); g.add(dust); storyRef.ruinDust = dust;
  const woman = makeNPC(g, 1.4, -.5, 'The Widow', 0x2d302e, 0);
  woman.dialogue = { line: 'My husband is not dead. He simply stopped answering the telephone. Eleven winters. I keep the house as he left it — the damp did the rest.', choices: ['Why do you stay here?', 'Did you know about the recording?'], replies: ['Because night comes in through the broken windows, and somebody has to be here when it does.', 'A technician came in 1977 with an empty suitcase. He left with a song nobody remembers. He left this machine too.'] };
  addClueMesh(g, new THREE.Vector3(-2.0, storyRef.ruinTableTop, -4.35), 'Burned Photograph', 'The church in winter 1977. In one corner, almost outside the frame, a small gas heater stands behind the choir.', 'photo', 'paper', { requiresFlag: 'talked-widow', blockedHint: 'Speak with the Widow before examining the burned photograph.' });
  addWoodTable(g, 5.6, 1.6, .7, .5, .6, 13);
  addClueMesh(g, new THREE.Vector3(5.6, .6 + .6 * .045 + .025, 1.6), 'Answering Machine', 'An answering machine, its red light still blinking. One microcassette: the click of the REC button, then someone inhaling before speaking.', 'voicemail', 'machine', { requiresFlag: 'talked-widow', blockedHint: 'Speak with the Widow before playing the answering machine.' });
  addDoor(g, 0, 7.95, 'the road', 'road', [-28, 0, -2]);
  z.mist = addFog(g, 14, 20, 0xb2b7b3, 18);
  z.solids.push({ minX: -8, maxX: -7.7, minZ: -8, maxZ: 8 }, { minX: 7.7, maxX: 8, minZ: -8, maxZ: 8 }, { minX: -8, maxX: 8, minZ: -8.2, maxZ: -8 }, { minX: -8, maxX: -2.5, minZ: 7.7, maxZ: 8 }, { minX: 2.5, maxX: 8, minZ: 7.7, maxZ: 8 });
  z.solids.push({ minX: -3.3, maxX: -.9, minZ: -5.0, maxZ: -3.8 }, { minX: 4.2, maxX: 5.4, minZ: -5.5, maxZ: -4.1 }, { minX: 5.2, maxX: 6.0, minZ: 1.3, maxZ: 1.9 });
  return z;
}

// ---------------------------------------------------------------------------
// Smoke that behaves like smoke: soft sprites that rise, widen, drift with the wind and thin out.
// ---------------------------------------------------------------------------
function makeSmokeColumn(group, x, y, z, { count = 26, size = 1.4, grow = 3.2, rise = 1.1, life = 9, color = 0x8d8a84, opacity = .42, drift = .7 } = {}) {
  const root = new THREE.Group(); root.position.set(x, y, z); group.add(root);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.SpriteMaterial({ map: softTex(), color, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(m); root.add(sp); parts.push({ sp, age: (i / count) * life, seed: Math.random() * 10 });
  }
  const col = { root, parts, size, grow, rise, life, opacity, drift };
  (storyRef.smokes || (storyRef.smokes = [])).push(col); return col;
}
function updateSmoke(dt, t) {
  for (const c of storyRef.smokes || []) {
    if (!isVisibleChain(c.root)) continue;
    for (const p of c.parts) {
      p.age += dt; if (p.age > c.life) { p.age -= c.life; p.seed = Math.random() * 10; }
      const k = p.age / c.life;
      p.sp.position.set(Math.sin(p.seed + p.age * .5) * .25 + k * k * c.drift * c.life, k * c.rise * c.life, Math.cos(p.seed * 2 + p.age * .4) * .2);
      const s = c.size + k * c.grow; p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = c.opacity * Math.min(1, k * 8) * (1 - k) * (1 - k * .3);
      p.sp.material.rotation = p.seed + p.age * .08;
    }
  }
}

// ---------------------------------------------------------------------------
// The road at night.
// ---------------------------------------------------------------------------
function signTexture(lines, { w = 512, h = 160, bg = '#2a2620', fg = '#d8ccb0', font = 'bold 54px serif', alpha = false } = {}) {
  return canvasTex(w, h, (g) => {
    if (!alpha) { g.fillStyle = bg; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() > .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,240,210,.05)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 1); } }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / (lines.length + .6))));
  });
}
function buildRoadV6() {
  const z = zones.road, g = z.group;
  // Smoke from the farmhouse chimneys (one existing, one added on the west slope).
  addBox(g, -4.4, 6.25, -12.9, .62, 2.5, .62, M.brick); addBox(g, -4.4, 7.55, -12.9, .78, .14, .78, M.darkWall);
  addBox(g, 4.42, 7.98, -17.86, .8, .14, .8, M.darkWall);
  makeSmokeColumn(g, 4.42, 8.15, -17.86, { count: 34, size: 1.2, grow: 4.6, rise: 1.0, life: 12, color: 0xb4b0a8, opacity: .62, drift: .6 });
  makeSmokeColumn(g, -4.4, 7.72, -12.9, { count: 28, size: 1.0, grow: 3.8, rise: .95, life: 11, color: 0xa8a49c, opacity: .55, drift: .55 });
  // Lamps: the porch, the road, the church portal, the cemetery gate.
  addLamp(g, 1.3, 2.45, -8.25, { style: 'lantern', color: 0xffb266, intensity: 6, distance: 12, flicker: .06 });
  [[-6.9, 40, Math.PI / 2], [6.9, 22, -Math.PI / 2], [-6.9, 5, Math.PI / 2]].forEach(([x, zz, r]) => addLamp(g, x, 4.3, zz, { style: 'post', rotY: r, color: 0xffa250, intensity: 11, distance: 17, flicker: .03 }));
  buildGothicPortal(g);
  buildCemeteryGate();
  buildCemeteryGraves();
  // A signpost at the lane towards the cemetery.
  const sp = new THREE.Group(); sp.position.set(7.4, 0, 13.4); g.add(sp);
  addBox(sp, 0, 1.1, 0, .1, 2.2, .1, M.darkWood);
  const arrow = new THREE.Mesh(new THREE.BoxGeometry(1.25, .28, .04), new THREE.MeshStandardMaterial({ map: signTexture(['CIMITERO  →'], { w: 512, h: 112, font: 'bold 60px serif' }), roughness: .9 })); arrow.position.set(.55, 1.85, 0); sp.add(arrow);
  const arrow2 = new THREE.Mesh(new THREE.BoxGeometry(1.25, .28, .04), new THREE.MeshStandardMaterial({ map: signTexture(['←  CHIESA'], { w: 512, h: 112, font: 'bold 60px serif' }), roughness: .9 })); arrow2.position.set(-.5, 1.5, 0); arrow2.rotation.y = .5; sp.add(arrow2);
  // Votive grave lights (lumini) that only appear when il Professore sends you to the cemetery.
  const lumini = new THREE.Group(); lumini.visible = false; g.add(lumini); storyRef.lumini = lumini;
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x9a1810, emissive: 0xff2a10, emissiveIntensity: 1.6, roughness: .3, transparent: true, opacity: .9 });
  const path = []; for (let x = 8.5; x <= 34; x += 1.7) path.push([x, 14.3 + Math.sin(x) * .15]); path.push([35.2, 16.2], [35.6, 17.6]);
  path.forEach(([x, zz], i) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .04, .13, 10), cupMat); cup.position.set(x, .065, zz + (i % 2 ? .45 : -.45)); lumini.add(cup); if (i % 5 === 2) { const l = new THREE.PointLight(0xff3a1a, 1.2, 4, 2); l.position.set(x, .3, zz); lumini.add(l); } });
  // The marksman's scope glints on the factory roof: a warning for anyone who looks up.
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xfff4d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glint.position.set(31.6, 5.6, 7.4); glint.scale.set(.9, .9, 1); g.add(glint); storyRef.scopeGlint = glint;
  // Tobia's own car, parked where he left it at the top of the lane.
  buildTobiaCar(g);
  z.solids.push({ minX: -4.75, maxX: -4.05, minZ: -13.25, maxZ: -12.55 });
}
function buildGothicPortal(g) {
  // Church: centre x=37, facade plane at z≈-17.2.
  const stone = M.stone, fx = 37, fz = -16.95;
  // Rose window with stained glass, lit from inside.
  const roseTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#100c0a'; c.fillRect(0, 0, w, h); c.translate(256, 256);
    const cols = ['#8a1a1a', '#1c3a7a', '#b8892a', '#2a5a3a', '#6a2a6a'];
    for (let i = 0; i < 16; i++) { c.save(); c.rotate(i / 16 * Math.PI * 2); c.fillStyle = cols[i % 5]; c.beginPath(); c.ellipse(0, -150, 34, 80, 0, 0, 7); c.fill(); c.fillStyle = cols[(i + 2) % 5]; c.beginPath(); c.arc(0, -232, 18, 0, 7); c.fill(); c.restore(); }
    c.fillStyle = '#c99a3a'; c.beginPath(); c.arc(0, 0, 54, 0, 7); c.fill(); c.fillStyle = '#7a1414'; c.beginPath(); c.arc(0, 0, 30, 0, 7); c.fill();
    c.strokeStyle = '#1a1612'; c.lineWidth = 9; for (let i = 0; i < 16; i++) { c.save(); c.rotate(i / 16 * Math.PI * 2); c.beginPath(); c.moveTo(0, -56); c.lineTo(0, -250); c.stroke(); c.restore(); }
    c.beginPath(); c.arc(0, 0, 56, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 196, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 250, 0, 7); c.lineWidth = 14; c.stroke();
  });
  const rose = new THREE.Mesh(new THREE.CircleGeometry(.85, 48), new THREE.MeshStandardMaterial({ map: roseTex, emissive: 0xffffff, emissiveMap: roseTex, emissiveIntensity: .9, roughness: .4 }));
  rose.position.set(fx, 5.35, -17.12); g.add(rose); storyRef.roseWindow = rose;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.9, .1, 10, 48), stone); ring.position.set(fx, 5.35, -17.08); g.add(ring);
  // Wall lanterns either side of the portal, a lamp post on the path, and two uplights washing the facade.
  for (const s of [-1, 1]) addLamp(g, fx + s * 2.05, 2.9, -17.05, { style: 'lantern', color: 0xffb16a, intensity: 7, distance: 11, flicker: .07 });
  addLamp(g, fx - 3.6, 3.6, -12.4, { style: 'post', rotY: Math.PI / 2, color: 0xffa858, intensity: 9, distance: 15, flicker: .04 });
  addLamp(g, fx - 3.0, .12, -13.6, { style: 'none', color: 0xd9c8a8, intensity: 60, distance: 18, shadow: true, flicker: 0, spot: { angle: .55, target: [3.0, 5.2, -3.6] } });
  addLamp(g, fx + 3.0, .12, -13.6, { style: 'none', color: 0xcfd4dc, intensity: 45, distance: 18, flicker: 0, spot: { angle: .55, target: [-3.0, 5.0, -3.6] } });
  for (const s of [-1, 1]) { const fix = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, .2, 10), M.iron); fix.position.set(fx + s * 3, .1, -13.6); g.add(fix); }
}
function buildCemeteryGate() {
  const c = storyRef.cemetery; if (!c) return;
  const stone = M.stone, iron = M.iron;
  for (const zz of [-2.45, 2.45]) {
    addBox(c, -8, 1.35, zz, .55, 2.7, .55, stone); addBox(c, -8, 2.76, zz, .72, .14, .72, stone); addBox(c, -8, .1, zz, .72, .2, .72, stone);
    const urn = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.0, 0), new THREE.Vector2(.14, .02), new THREE.Vector2(.1, .12), new THREE.Vector2(.18, .3), new THREE.Vector2(.08, .44), new THREE.Vector2(.12, .5), new THREE.Vector2(0, .52)], 14), stone); urn.position.set(-8, 2.83, zz); c.add(urn);
    addLamp(c, -8.32, 2.2, zz, { style: 'lantern', rotY: -Math.PI / 2, color: 0xff6a3a, intensity: 3.2, distance: 8, flicker: .12 });
  }
  // Wrought-iron arch with the word CIMITERO cut into it, scrolls and a cross.
  const pts = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI; pts.push(new THREE.Vector3(-8, 2.83 + Math.sin(a) * .95, -Math.cos(a) * 2.45)); }
  c.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .035, 6, false), iron));
  const pts2 = pts.map(p => new THREE.Vector3(p.x, 2.83 + (p.y - 2.83) * .55, p.z * .92)); c.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 40, .025, 6, false), iron));
  const letters = canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#121212'; g.font = 'bold 120px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CIMITERO', w / 2, h / 2 + 6);
    g.strokeStyle = '#121212'; g.lineWidth = 10; for (const s of [-1, 1]) { g.beginPath(); g.arc(w / 2 + s * 420, h / 2, 40, 0, Math.PI * 1.6); g.stroke(); g.beginPath(); g.arc(w / 2 + s * 470, h / 2 + 30, 22, Math.PI, Math.PI * 2.6); g.stroke(); }
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .85), new THREE.MeshStandardMaterial({ map: letters, alphaTest: .5, metalness: .7, roughness: .5, color: 0x2a2a28, side: THREE.DoubleSide }));
  sign.position.set(-8, 3.35, 0); sign.rotation.y = -Math.PI / 2; c.add(sign); sign.castShadow = true;
  addBox(c, -8, 4.1, 0, .06, .6, .06, iron); addBox(c, -8, 4.22, 0, .06, .06, .34, iron);
  // The two gate leaves, one left ajar.
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(-8, 0, s * 2.15); c.add(pivot); pivot.rotation.y = s > 0 ? .55 : -.12;
    const leaf = new THREE.Group(); leaf.position.z = -s * 1.05; pivot.add(leaf);
    for (const yy of [.25, 1.1, 1.95]) addBox(leaf, 0, yy, 0, .05, .05, 2.05, iron);
    for (let k = 0; k < 11; k++) { const bz = -1 + k * .2; addBox(leaf, 0, 1.15, bz, .025, 2.1, .025, iron); const tip = new THREE.Mesh(new THREE.ConeGeometry(.035, .14, 4), iron); tip.position.set(0, 2.27, bz); leaf.add(tip); }
  }
  // Plaque with the old Latin warning found on Italian cemetery gates.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(.5, .32), new THREE.MeshStandardMaterial({ map: signTexture(['HODIE MIHI', 'CRAS TIBI'], { w: 256, h: 160, bg: '#bdb5a2', fg: '#2a2620', font: 'bold 34px serif' }), roughness: .8 }));
  plaque.position.set(-8.28, 1.6, -2.45); plaque.rotation.y = -Math.PI / 2; c.add(plaque);
  addLook(zones.road.group, 35.4, 1.6, 15.55, 'The plaque on the gate', 'HODIE MIHI, CRAS TIBI — “today it is me, tomorrow it is you.” The dead speak to the living in the first person, as they do on old Italian cemetery gates.', 2.4);
  c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}
function buildCemeteryGraves() {
  const c = storyRef.cemetery, graves = storyRef.graves; if (!c || !graves) return;
  const names = [['DON AURELIO M.', 'MAESTRO DEL CORO', '1931 – 1977'], ['ELSA BERTOLINI', 'SOPRANO', '1950 – 1977'], ['GIOVANNI RIVA', 'TENORE', '1946 – 1977'], ['TERESA VENTURI', 'CONTRALTO', '1958 – 1977'], ['LUCIO FERRARI', 'BASSO', '1939 – 1977'], ['ANGELA PAVESI', 'SOPRANO', '1961 – 1977']];
  const luminoMat = new THREE.MeshStandardMaterial({ color: 0x8a1610, emissive: 0xff3010, emissiveIntensity: 1.3, transparent: true, opacity: .9, roughness: .3 });
  graves.forEach(([gx, gz], i) => {
    const mound = new THREE.Mesh(new THREE.BoxGeometry(1.0, .16, 1.9), M.stone); mound.position.set(gx, .08, gz + .2); c.add(mound);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(.9, .04, 1.8), mat(0x9a968a, .7, { map: TEX.marble })); slab.position.set(gx, .18, gz + .2); c.add(slab);
    const tex = canvasTex(256, 320, (g, w, h) => {
      g.fillStyle = '#a8a497'; g.fillRect(0, 0, w, h); for (let k = 0; k < 1200; k++) { g.fillStyle = Math.random() > .5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = '#3d3a32'; g.beginPath(); g.ellipse(w / 2, 82, 38, 50, 0, 0, 7); g.fill(); g.fillStyle = '#d9ceb2'; g.beginPath(); g.ellipse(w / 2, 82, 32, 44, 0, 0, 7); g.fill();
      g.fillStyle = '#6b6252'; g.beginPath(); g.ellipse(w / 2, 74, 14, 18, 0, 0, 7); g.fill(); g.fillRect(w / 2 - 22, 92, 44, 30);
      g.fillStyle = '#2a2721'; g.textAlign = 'center'; g.font = 'bold 22px serif'; g.fillText(names[i][0], w / 2, 168); g.font = 'italic 17px serif'; g.fillText(names[i][1], w / 2, 196); g.font = '18px serif'; g.fillText(names[i][2], w / 2, 224);
      g.font = 'italic 14px serif'; g.fillText(i === 0 ? '“non nisi mota cano”' : 'R. I. P.', w / 2, 262);
      g.strokeStyle = 'rgba(40,60,30,.5)'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, h); g.quadraticCurveTo(40, h - 60, 10, h - 120); g.stroke();
    });
    const stone = new THREE.Mesh(new THREE.BoxGeometry(.72, 1.0, .14), [M.stone, M.stone, M.stone, M.stone, mat(0xffffff, .85, { map: tex }), M.stone]);
    stone.position.set(gx, .55, gz - .72); stone.rotation.z = (i % 2 ? -.04 : .03); c.add(stone);
    const cross = new THREE.Group(); cross.position.set(gx, 1.05, gz - .72); c.add(cross); addBox(cross, 0, .18, 0, .06, .36, .06, M.iron); addBox(cross, 0, .24, 0, .22, .05, .05, M.iron);
    const lum = new THREE.Mesh(new THREE.CylinderGeometry(.04, .036, .12, 10), luminoMat); lum.position.set(gx + .3, .26, gz - .45); c.add(lum);
  });
  // Easter egg: the orange foam earplugs on the choirmaster's grave (script, rule six: the album is never heard).
  const [ax, az] = graves[0];
  const plugs = new THREE.Group(); plugs.position.set(ax - .18, .2, az + .5); c.add(plugs);
  const foam = mat(0xff6a12, .9, { emissive: 0x401400, emissiveIntensity: .3 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.012, .014, .03, 10), foam); p.position.set(s * .03, .015, 0); p.rotation.z = s * .3; plugs.add(p); }
  const wp = new THREE.Vector3(); plugs.getWorldPosition(wp);
  zones.road.interactables.push({ id: 'egg-earplugs', type: 'story', object: plugs, point: new THREE.Vector3(44 + ax - .18, .3, 18 + az + .5), radius: 2.2, prompt: '[ E ] PUT IN THE ORANGE EARPLUGS', run: startChoirEgg });
  // A fourteenth stone, unnamed, earth freshly turned.
  const small = new THREE.Mesh(new THREE.BoxGeometry(.4, .55, .1), M.stone); small.position.set(6.6, .27, 4.6); small.rotation.y = -.3; c.add(small);
  const earth = new THREE.Mesh(new THREE.BoxGeometry(.6, .12, 1.2), mat(0x2e2419, 1)); earth.position.set(6.6, .06, 5.3); earth.rotation.y = -.3; c.add(earth);
  addLook(zones.road.group, 50.6, .5, 22.9, 'A stone with no name', 'A small stone in the corner, still blank. The earth in front of it has been turned this morning. Someone has scratched a tuning fork into the corner, and the number 14.', 2.2);
  c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}
function startChoirEgg() {
  if (storyRef.choirEgg?.active) return;
  const c = storyRef.cemetery, group = new THREE.Group(); c.add(group);
  const ghost = new THREE.MeshStandardMaterial({ color: 0xe9ece6, emissive: 0x9aa4a4, emissiveIntensity: .35, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
  const mouth = new THREE.MeshBasicMaterial({ color: 0x080808, transparent: true, opacity: 0 });
  const blood = new THREE.MeshBasicMaterial({ color: 0x8a0d0b, transparent: true, opacity: 0 });
  const singers = [];
  for (let i = 0; i < 13; i++) {
    const conductor = i === 0, f = new THREE.Group();
    const row = conductor ? 0 : Math.floor((i - 1) / 4), col = conductor ? 0 : (i - 1) % 4;
    f.position.set(conductor ? -6.2 : -3.2 + row * 1.3, 0, conductor ? 0 : -2.4 + col * 1.6); f.rotation.y = conductor ? Math.PI / 2 : -Math.PI / 2; group.add(f);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .9, 4, 8), ghost); body.position.y = .95; f.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 12, 10), ghost); head.position.y = 1.68; f.add(head);
    const m = new THREE.Mesh(new THREE.CircleGeometry(.04, 12), mouth); m.position.set(0, 1.62, .148); f.add(m);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(.02, .12), blood); b.position.set(0, 1.58, .152); b.scale.y = .01; f.add(b);
    singers.push({ f, m, b, sitAt: 9 + i * .7, conductor });
  }
  storyRef.choirEgg = { active: true, t: 0, group, singers, ghost, mouth, blood, dur: 26 };
  audio?.setMuffle(true, 1.2);
  showToast('THE WORLD GOES SOFT. YOU HEAR YOUR OWN BLOOD.');
  storyLine('Tobia: Orange foam. The world goes soft, like under water. And in the soft, they are singing.');
  if (!storyFlags.has('egg-choir')) { storyFlags.add('egg-choir'); journal.push({ id: 'egg-choir', title: 'Rule six: the album is never heard', description: 'With the orange earplugs in, the cemetery filled with the 1977 choir: Don Aurelio conducting, twelve voices singing without sound. One by one their noses bled and they sat down on the ground. You heard nothing. That was the point.', kind: 'easter egg', zone: 'road' }); updateJournalCount(); }
}
function updateChoirEgg(dt) {
  const e = storyRef.choirEgg; if (!e?.active) return;
  e.t += dt; const fadeIn = Math.min(1, e.t / 2.5), fadeOut = 1 - THREE.MathUtils.smoothstep(e.t, e.dur - 3, e.dur);
  e.ghost.opacity = .5 * fadeIn * fadeOut; e.mouth.opacity = .9 * fadeIn * fadeOut; e.blood.opacity = .95 * fadeOut;
  e.singers.forEach((s, i) => {
    if (s.conductor) { s.f.children[0].rotation.z = Math.sin(e.t * 2.4) * .08; return; }
    s.m.scale.set(1, .6 + Math.abs(Math.sin(e.t * 2.2 + i * .7)) * 1.6, 1);
    if (e.t > s.sitAt - 2) s.b.scale.y = Math.min(1, (e.t - s.sitAt + 2) / 1.5);
    if (e.t > s.sitAt) { const k = Math.min(1, (e.t - s.sitAt) / 1.2); s.f.position.y = -.55 * k; s.f.rotation.x = -.15 * k; }
  });
  if (e.t >= e.dur || currentZone !== 'road') { e.active = false; e.group.parent?.remove(e.group); audio?.setMuffle(false, 1.5); showToast('YOU TAKE THE EARPLUGS OUT. THE FOG HAS A SOUND AGAIN.'); }
}

// =============================================================================
// v6 — STATIONS. Each follower's death is staged as in the script: a black title
// card with the station number and the line il Professore uses, the Mass (or its
// absence) shown in the way the treatment prescribes — seen whole, in part, heard,
// as silhouette, from far away, with the sound removed — then a Pastorale: a short
// locked-off shot of landscape with no people. Space skips.
// =============================================================================
const STATION_ORDER_BY_CLUE = ['franco', 'anna', 'marta', 'gabri', 'sergio', 'livia', 'walter'];
function cultist(name) { return cultRoster.find(n => n.name === name); }
function stationAvailable(id) {
  if (storyFlags.has('station-' + id)) return false;
  const need = { franco: 'Franco', anna: 'Anna', marta: 'Marta', gabri: 'Gabri', sergio: 'Sergio', livia: 'Livia', walter: 'Walter', dario: 'Dario' }[id];
  if (need) { const n = cultist(need); if (!n || n.fate !== 'present') return false; }
  if (id === 'remo' && !storyRef.remo?.object) return false;
  return true;
}
function queueStation(id, front = false) {
  const q = storyRef.stationQueue || (storyRef.stationQueue = []);
  if (q.includes(id) || storyFlags.has('station-' + id)) return;
  front ? q.unshift(id) : q.push(id);
}
function tickStationQueue(dt = 1 / 60) {
  const q = storyRef.stationQueue; if (!q?.length) return;
  if (storyScene?.type === 'hold') cancelHold();
  if (storyScene || dialogueOpen || doorTransitioning || journalOpen || settingsOpen || listeningPending || gameEnded || cultFateActive) return;
  storyRef.stationWait = (storyRef.stationWait || 0) + dt; if (storyRef.stationWait < 1.0) return; storyRef.stationWait = 0;
  const id = q.shift(); if (!stationAvailable(id)) { if (id === 'remo') storyFlags.add('station-remo'); return; }
  startStation(id);
}
function retireNPC(npc) {
  if (!npc) return;
  npc.fate = 'dead'; npc.object.visible = false; npc.posed = false;
  for (const zn of Object.values(zones)) { const ix = zn.interactables.indexOf(npc); if (ix >= 0) zn.interactables.splice(ix, 1); }
  removeQueuedCultist(npc);
}
function extraFigure(group, x, z, name, coat = 0x1c1b19, variant = 1) {
  if (!group.userData.interactables) group.userData.interactables = [];
  const n = makeNPC(group, x, z, name, coat, variant);
  const ix = group.userData.interactables.indexOf(n); if (ix >= 0) group.userData.interactables.splice(ix, 1);
  const pi = photoNPCs.indexOf(n); if (pi >= 0) photoNPCs.splice(pi, 1);
  n.posed = true; return n;
}
function silhouette(group, x, y, z, rotY = 0, seated = false, color = 0x0d0c0b) {
  const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = rotY; group.add(f);
  const m = storyRef.silMat || (storyRef.silMat = mat(color, 1));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.22, seated ? .55 : .95, 4, 8), m); body.position.y = seated ? .78 : 1.0; f.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 12, 10), m); head.position.y = seated ? 1.38 : 1.78; f.add(head);
  if (seated) { const lap = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .3, 4, 6), m); lap.rotation.x = Math.PI / 2; lap.position.set(0, .5, .2); f.add(lap); }
  f.traverse(o => { if (o.isMesh) o.castShadow = true; }); return f;
}
function poseStanding(npc) { npc.seated = false; npc.baseY = 0; npc.legs?.forEach(h => h.rotation.set(0, 0, 0)); npc.lowerLegs?.forEach(c => c.rotation.set(0, 0, 0)); npc.object.rotation.set(0, 0, 0); npc.object.position.y = 0; }
function layNPC(npc, holder, surfaceY) {
  poseStanding(npc); npc.posed = true; holder.add(npc.object);
  npc.object.rotation.set(-Math.PI / 2, 0, 0); npc.object.position.set(0, 0, .98); holder.position.y = surfaceY + .2;
  npc.leftArm.rotation.set(0, 0, -.12); npc.rightArm.rotation.set(0, 0, .12);
}
function raiseArms(npc, k = 1) { npc.leftArm.rotation.set(-.3 * k, 0, -2.3 * k); npc.rightArm.rotation.set(-.3 * k, 0, 2.3 * k); npc.leftForearm.rotation.z = -.4 * k; npc.rightForearm.rotation.z = .4 * k; }
function viewZone(name) {
  Object.values(zones).forEach(v => { v.group.visible = false; });
  zone = zones[name]; currentZone = name; zone.group.visible = true;
  if (!zone.fog) zone.fog = new THREE.FogExp2(zone.fogColor, zone.density);
  scene.fog = zone.fog; scene.fog.density = zone.density; scene.background.set(zone.fogColor); audio?.setReverb(name);
}
function setStationCard(mode, small = '', big = '', em = '') {
  const el = $('station-card'); el.querySelector('small').textContent = small; el.querySelector('b').textContent = big; el.querySelector('em').textContent = em;
  el.classList.toggle('pastorale', mode === 'pastorale'); el.classList.toggle('visible', mode !== 'hidden');
}
function setCinema(on) { $('hud').classList.toggle('intro', on); $('skip-hint').classList.toggle('visible', on); audio?.setDuck(on ? .55 : 1, 1.4); }
function stationDef(id) {
  const D = {
    franco: { roman: 'II', name: 'FRANCO', quote: '“You have cut meat for thirty years and never once for a reason.” — Become who you are.', zone: 'church', dur: 16, pastorale: ['cows', 'Cows grazing in fog. Nothing happens.'], victim: 'Franco',
      journal: 'The first black Mass, on white plastic chairs. Don Remo consecrated, word perfect. Franco lay down on the altar and offered himself as the host. A phone buzzed in someone’s pocket; nobody moved. The cult ate.',
      lines: [[.5, 'Il Professore: You have cut meat for thirty years and never once for a reason, Franco.'], [4.5, 'Don Remo: Hoc est enim corpus meum.'], [7, '(A phone buzzes in someone’s pocket. Nobody moves. Don Remo waits for it to stop.)'], [10, 'Franco: (on the altar, calm) Then let the reason be me.'], [13, 'Tobia: They eat. I keep my eyes on Don Remo’s hands.']] },
    anna: { roman: 'IV', name: 'ANNA', quote: '“You have waited forty years. Stop waiting.” — Man would rather will nothingness than not will.', zone: 'home', dur: 21, pastorale: ['ivy', 'Ivy slowly overtaking a ruined wall.'], victim: 'Anna',
      journal: 'Heard, not seen. A wall went up in the cellar while you ate Anna’s soup at the table upstairs. Through the floor: the trowel, the bricks, Anna asking whether it was still warm. Then only the trowel.',
      lines: [[.5, 'Tobia: Ines puts a bowl in front of me. Anna’s soup. Anna is not at the table.'], [4, '(Below the floor: the scrape of a trowel. A brick set down. Another.)'], [8, 'Anna (below the floor, muffled): Is it warm? Tell me it is still warm.'], [11.5, 'Ines: It is warm, Anna.'], [14.5, '(The scraping slows. A last bowl is passed through the gap. Then only the trowel.)'], [18, 'Tobia: I finish the soup. The trowel stops. Nobody looks at the floor.']] },
    marta: { roman: 'V', name: 'MARTA', quote: '“You have been so careful with your memories. Be careless.” — One must still have chaos in oneself to give birth to a dancing star.', zone: 'cellar', dur: 19, pastorale: ['clay', 'Cracked clay under full sun. One cloud crosses.'], victim: 'Marta',
      journal: 'Under the heat lamp Livia took dictation, carving Marta’s memories into her skin while Marta narrated a golden childhood, until she could not find the next one. That night the nosebleeds began among the others.',
      lines: [[.5, 'Il Professore: You have been so careful with your memories, Marta. Be careless.'], [4, 'Marta: A summer kitchen. My mother’s hands white with flour.'], [7.5, '(Livia does not speak. She carves what she hears.)'], [9.5, 'Marta: The sun on the tiles. A dog asleep under the table. Everything gold.'], [13.5, 'Marta: Gold… it was… (she cannot find the next one)'], [16.5, 'Tobia: Upstairs someone’s nose begins to bleed. Then another.']] },
    gabri: { roman: 'VI', name: 'GABRI', quote: 'I love those who do not know how to live except by going under.', zone: 'pastorale', set: 'levee', dur: 19, pastorale: ['river', 'The river back in its bed, brown and slow.'], victim: 'Gabri', muffle: true,
      journal: 'Seen quiet. A car on the levee, the river rising, the album played to the only one in the car without earplugs. Ines passed him the thermos through the window. He asked whether everyone was looking at him. Everyone was.',
      lines: [[.6, '(The sound has been removed. A car on the levee. The river is rising.)'], [5, 'Ines: (through the window, the thermos) Drink. It is warm.'], [9, 'Gabri: Is everyone looking at me?'], [12, 'Il Professore: Everyone.'], [15.5, '(Gabri smiles at the windscreen. His head comes to rest against the glass.)']] },
    sergio: { roman: 'VII', name: 'SERGIO', quote: '“He has already gone under. Leave him the sun.”', zone: 'road', dur: 20, pastorale: ['sunflowers', 'Black dried sunflowers in the wind.'], victim: 'Sergio',
      journal: 'The only gentle death. A chair in a patch of real sunlight in the farmyard, Ines and her thermos beside him, you on the other side. No Mass. Il Professore watched from the doorway and did not come down.',
      lines: [[.6, 'Tobia: A chair in the farmyard, in the first real sunlight in weeks. Ines has brought her thermos.'], [5, 'Sergio: I stopped believing years ago. I stayed for the company.'], [9, 'Ines: Then stay a little longer.'], [12.5, 'Il Professore (from the doorway): Leave him the sun.'], [16, '(Sergio closes his eyes. Nobody says Mass. Ines holds his hand until it is cold.)']] },
    livia: { roman: 'IX', name: 'LIVIA', quote: '“Sing, or be silent for good.” — If you gaze long into an abyss, the abyss also gazes into you.', zone: 'church', dur: 17, pastorale: ['burnt', 'A burnt field at dawn. Steam, ash, one green shoot.'], victim: 'Livia',
      journal: 'Seen as silhouette. Livia locked in the confessional, singing her own aria while the group sang it back to her a semitone too low. The lattice began to glow. She did not stop singing until the shape stopped.',
      lines: [[.6, 'Il Professore: Sing, Livia. Or be silent for good.'], [4, '(Inside the confessional, Livia sings. The others answer with her own aria, a semitone too low.)'], [9, '(The lattice begins to glow.)'], [13, 'Tobia: I see her only as a shape behind the grille. She does not stop singing until the shape stops.']] },
    walter: { roman: 'X', name: 'WALTER', quote: 'Live dangerously! Build your cities on the slope of Vesuvius!', zone: 'road', dur: 16, pastorale: ['smoke', 'Smoke rising straight into still air.'], victim: 'Walter', fogDensity: .009,
      journal: 'Seen from far away. Il Professore sent Walter to test the church’s charge alone, in the shed. It went up. He watched from the rise, radiant. The sound arrived late.',
      lines: [[.6, 'Il Professore: Live dangerously, Walter. Test the charge for me. Alone.'], [4.5, 'Tobia: Walter walks into the shed with his notebook. Il Professore watches from the rise, the way other men watch football.'], [7.2, '(The shed goes up without a sound.)'], [9.6, '(The sound arrives late. It always does.)'], [12.5, 'Tobia: He is radiant. It is the only time I have seen him happy.']] },
    dario: { roman: 'VIII', name: 'DARIO', quote: '“You believe too much.” — Nothing is true, everything is permitted.', zone: 'church', dur: 19, pastorale: ['church', 'The church seen from a mile away, in fog.'], victim: 'Dario',
      journal: 'Seen in part, from below: the feet, the celebrants’ hands, the shadow on the rood beam. A full black Mass. Dario hung upside down from the beam and sang through all of it, until the final hymn. You had heard it planned through the wall, and said nothing.',
      lines: [[.6, 'Don Remo: In nomine Patris… (every word, perfectly)'], [4.5, '(Someone tries to light the thurible. The lighter will not catch. Click. Click. Click.)'], [8, 'Dario (upside down, singing): …et lux perpetua luceat eis…'], [12, 'Il Professore: Nothing is true, Dario. Everything is permitted.'], [15.5, '(At the final hymn Dario stops singing. The shadow on the wall does not move again.)']] },
    remo: { roman: 'XI', name: 'DON REMO', quote: '“God is dead, Remo. You wrote the obituary.” — God is dead… and we have killed him.', zone: 'church', dur: 23, pastorale: ['belfry', 'The bell tower, silent. Birds return.'], victim: null,
      journal: 'Il Professore handed you a rope: “Hold this, your hands are steady.” You understood only when the weight came onto it, and you did not let go. Ines rang the bell. Don Remo was the clapper.',
      lines: [[.6, 'Il Professore: Hold this. Your hands are steady.'], [4, 'Tobia: The rope is rough and dry. For a moment it weighs nothing.'], [8, '(The weight comes onto it.)'], [11, 'Tobia: I understand only now. I do not let go.'], [13.5, 'Ines: (taking the other rope) Now.'], [18.5, 'Il Professore: God is dead, Remo. You wrote the obituary.']] }
  };
  return D[id];
}
const STATION_CARD = 3.4, PAST_GAP = 1.2, PAST_DUR = 6.5, PAST_OUT = 1.0;
function startStation(id) {
  cancelHold(); const def = stationDef(id); if (!def) return;
  keys.clear(); activeTarget = null; $('prompt').classList.remove('visible'); if (dialogueOpen) closeDialogue(false);
  const save = { zone: currentZone, pos: playerAnchor.position.clone(), rx: camera.rotation.x, ry: camera.rotation.y };
  const P0 = STATION_CARD + def.dur, P1 = P0 + PAST_GAP, P2 = P1 + PAST_DUR, END = P2 + PAST_OUT;
  storyScene = { type: 'station', id, def, t: 0, dur: END, i: 0, lines: [], save, P0, P1, P2, END, li: 0, phase: 0, ctx: null };
  setStationCard('black', `STAZIONE ${def.roman}`, def.name, def.quote); setCinema(true);
  audio?.stinger(.5);
}
function updateStation(s, dt) {
  const def = s.def;
  if (s.phase === 0 && s.t >= 1.0) {
    s.phase = 1; viewZone(def.zone); playerAnchor.position.set(0, 0, 0); camera.position.set(0, 1.6, 0); camera.rotation.set(0, 0, 0);
    if (def.fogDensity) scene.fog.density = def.fogDensity;
    s.ctx = STATION_SETUP[s.id]?.(def) || {}; if (def.muffle) audio?.setMuffle(true, .8);
  }
  if (s.phase === 1 && s.t >= STATION_CARD - .7) { s.phase = 2; setStationCard('hidden'); }
  if (s.phase >= 1 && s.phase <= 2) {
    const local = s.t - STATION_CARD;
    if (def.fogDensity) scene.fog.density = def.fogDensity;
    STATION_UPDATE[s.id]?.(s.ctx, Math.max(0, local), dt);
    while (s.li < def.lines.length && local >= def.lines[s.li][0]) { stationLine(def.lines[s.li][1]); s.li++; }
    if (s.t >= s.P0) { finishStationScene(s); s.phase = 3; setStationCard('black', 'PASTORALE', '', ''); }
  }
  if (s.phase === 3 && s.t >= s.P0 + .9) { s.phase = 4; $('subtitle-wrap').classList.remove('visible'); showPastorale(def.pastorale[0]); }
  if (s.phase === 4 && s.t >= s.P1) { s.phase = 5; setStationCard('pastorale', '', 'PASTORALE', def.pastorale[1]); }
  if (s.phase >= 4 && s.phase <= 5) updatePastorale(s.t - s.P0, dt);
  if (s.phase === 5 && s.t >= s.P2) { s.phase = 6; setStationCard('black', '', '', ''); }
  if (s.phase === 6 && s.t >= s.P2 + .9) endStation(s);
}
function stationLine(text) {
  const m = /^\(/.test(text) ? null : /^([^:]+):\s*/.exec(text);
  $('speaker').textContent = m ? m[1].toUpperCase() : '';
  $('speaker').classList.toggle('through-wall', /below|through|wall/i.test(m?.[1] || ''));
  $('subtitle').textContent = m ? text.slice(m[0].length) : text;
  $('subtitle').classList.toggle('muffled', /^\(/.test(text) || /muffled|below/i.test(text));
  $('dialogue-options').innerHTML = ''; $('subtitle-wrap').classList.add('visible');
  if (m && !/^\(/.test(text)) speakVoice(text, m[1]);
}
function finishStationScene(s) {
  if (s.finished) return; s.finished = true;
  const def = s.def;
  try { STATION_FINISH[s.id]?.(s.ctx); } catch (e) { console.error(e); }
  s.ctx?.group?.parent?.remove(s.ctx.group);
  (s.ctx?.extras || []).forEach(n => n.object.parent?.remove(n.object));
  if (def.muffle) audio?.setMuffle(false, 1.2);
  if (def.victim) retireNPC(cultist(def.victim));
  storyFlags.add('station-' + s.id); storyFlags.add('station-any');
  journal.push({ id: 'station-' + s.id, title: `Station ${def.roman} · ${def.name.charAt(0) + def.name.slice(1).toLowerCase()}`, description: def.journal, kind: 'station', zone: def.zone }); updateJournalCount();
  fear = Math.min(1, fear + .08); glitchPulse = Math.max(glitchPulse, .8);
}
function endStation(s) {
  if (!s.finished) finishStationScene(s);
  zones.pastorale.group.visible = false; storyRef.pastoraleSets && Object.values(storyRef.pastoraleSets).forEach(g => g.visible = false);
  viewZone(s.save.zone); playerAnchor.position.copy(s.save.pos); camera.position.set(0, 1.63, 0); camera.rotation.set(s.save.rx, s.save.ry, 0); resetLook();
  storyScene = null; setStationCard('hidden'); setCinema(false); $('subtitle-wrap').classList.remove('visible'); $('subtitle').classList.remove('muffled'); $('speaker').classList.remove('through-wall');
  if (s.id === 'remo') { storyFlags.add('dario-bell-death'); storyFlags.add('bell-released'); }
  if (s.id === 'walter') storyFlags.add('shed-gone');
  showToast(`STATION ${s.def.roman} — ${s.def.name}. INES WILL SET THE PLACE ANYWAY.`);
  updateMissions();
}
function skipStoryScene() {
  const s = storyScene; if (!s) return;
  if (s.type === 'station') {
    if (s.phase <= 2) { s.t = Math.max(s.t, s.P0); if (s.phase === 0) { updateStation(s, 0); } }
    else if (s.phase <= 5) { s.t = s.P2; s.phase = 5; }
    return;
  }
  if (s.type === 'intro') { s.t = s.dur; return; }
  if (s.type === 'drive') { s.skip = true; return; }
  if (s.type === 'ending' || s.type === 'finale') { s.t = Math.max(s.t, s.dur - .05); return; }
  s.i = s.lines.length; s.t = s.dur;
}

// ---- per-station staging ------------------------------------------------------------------
const STATION_SETUP = {
  franco(def) {
    const z = zones.church, g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    const franco = cultist('Franco'); const holder = new THREE.Group(); holder.position.set(0, 0, -12.0); holder.rotation.y = Math.PI / 2; g.add(holder); layNPC(franco, holder, 1.89); ctx.franco = franco;
    const remo = storyRef.remo; ctx.remo = remo; ctx.remoPos = remo.object.position.clone(); remo.posed = true; remo.object.position.set(0, 0, -13.25); remo.object.rotation.set(0, 0, 0);
    for (let k = -2; k <= 2; k++) for (let r = 0; r < 2; r++) if ((k + r) % 3 !== 0) silhouette(g, k * .78, -.05, -8.4 + r, Math.PI, true);
    const red = new THREE.SpotLight(0xff3a24, 0, 14, .5, .5, 1.4); red.position.set(0, 6, -11.5); red.target.position.set(0, 1.9, -12); g.add(red, red.target); ctx.red = red;
    const gold = new THREE.PointLight(0xffb45a, 22, 9, 1.6); gold.position.set(0, 3.0, -10.8); g.add(gold);
    const key = new THREE.SpotLight(0xffd7a0, 160, 18, .45, .5, 1.4); key.position.set(.5, 4.6, -7.6); key.target.position.set(0, 1.9, -12); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); g.add(key, key.target);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.9, 2.1), mat(0xe8e2d4, .9)); cloth.rotation.x = -Math.PI / 2; cloth.position.set(0, 2.2, -12); cloth.rotation.z = Math.PI / 2; cloth.visible = false; g.add(cloth); ctx.cloth = cloth;
    const stain = new THREE.Mesh(new THREE.CircleGeometry(.5, 24), new THREE.MeshBasicMaterial({ color: 0x5a0606, transparent: true, opacity: 0 })); stain.rotation.x = -Math.PI / 2; stain.position.set(.1, 1.9, -11.25); g.add(stain); ctx.stain = stain;
    const host = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .006, 24), mat(0xf4efe0, .6, { emissive: 0xfff3d0, emissiveIntensity: .4 })); host.rotation.x = Math.PI / 2; g.add(host); ctx.host = host;
    audio?.organ([146.8 * .944, 174.6 * .944, 220 * .944, 293.7 * .944], 15);
    return ctx;
  },
  anna(def) {
    const z = zones.home, g = new THREE.Group(); z.group.add(g); const ctx = { group: g };
    const anna = cultist('Anna'); if (anna) anna.object.visible = false;
    const T = storyRef.tableSeats; ctx.bowl = new THREE.Vector3(T.top[0], T.topY + .05, T.top[1] + 4.6 / 2 - .22);
    const spoon = buildSpoon(storyRef.cutleryMat); spoon.scale.setScalar(1.1); g.add(spoon); ctx.spoon = spoon;
    ctx.nextScrape = 3.5;
    return ctx;
  },
  marta(def) {
    const z = zones.cellar, g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    const marta = cultist('Marta'); const holder = new THREE.Group(); holder.position.set(0, 0, -1.0); holder.rotation.y = -Math.PI / 2; g.add(holder); layNPC(marta, holder, .757); ctx.marta = marta;
    const livia = extraFigure(g, .35, .25, 'Livia', 0x5a4c43, 0); livia.object.rotation.y = Math.PI; livia.rightArm.rotation.set(-1.0, 0, .3); livia.rightForearm.rotation.z = .5; ctx.extras.push(livia);
    const heat = new THREE.SpotLight(0xffb85a, 140, 9, .6, .45, 1.3); heat.position.set(0, 3.0, -1.2); heat.target.position.set(0, .7, -1); heat.castShadow = true; heat.shadow.mapSize.set(1024, 1024); g.add(heat, heat.target);
    // The "page": a strip of skin that receives the carved words, close to the camera.
    const words = 'a summer kitchen · my mother’s hands in the flour · the sun on the tiles · a dog asleep under the table · gold · gold · it was';
    const cnv = document.createElement('canvas'); cnv.width = 1024; cnv.height = 160; const cg = cnv.getContext('2d'); const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace;
    const skin = new THREE.Mesh(new THREE.PlaneGeometry(.62, .1), new THREE.MeshStandardMaterial({ map: tex, roughness: .8, color: 0x8a7468 }));
    skin.rotation.x = -1.15; skin.position.set(0, .8, -.58); g.add(skin);
    ctx.paint = (k) => { cg.fillStyle = '#9c7a63'; cg.fillRect(0, 0, 1024, 160); for (let i = 0; i < 600; i++) { cg.fillStyle = 'rgba(80,50,40,.07)'; cg.fillRect(Math.random() * 1024, Math.random() * 160, 3, 2); }
      cg.font = 'italic 46px Georgia, serif'; cg.fillStyle = '#7a1612'; cg.shadowColor = '#e9b85a'; cg.shadowBlur = 8; cg.fillText(words.slice(0, Math.floor(words.length * k)), 20, 96); cg.shadowBlur = 0; tex.needsUpdate = true; };
    ctx.paint(0); ctx.lastK = -1;
    return ctx;
  },
  gabri(def) {
    const z = zones.pastorale; showPastoraleSet('levee'); const g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    const car = buildCar(); car.position.set(0, .6, 0); car.rotation.y = 0; g.add(car); ctx.car = car;
    const gabri = cultist('Gabri'); poseStanding(gabri); gabri.posed = true; car.add(gabri.object); seatNPC(gabri, .42, .62, Math.PI); gabri.object.position.y = .22; gabri.object.scale.setScalar(.92); ctx.gabri = gabri;
    const driver = extraFigure(car, -.42, .5, 'The First', 0x171716, 1); if (driver.head) driver.head.material = headMaterial(); seatNPC(driver, -.42, .62, Math.PI); driver.object.position.y = .22; driver.object.scale.setScalar(.95); driver.posed = true; ctx.extras.push(driver);
    const ines = extraFigure(g, 1.9, -1.1, 'Ines', 0x52483d, 0); ines.object.rotation.y = -1.2; ines.rightArm.rotation.set(-1.1, 0, .2); ctx.extras.push(ines);
    ctx.water = storyRef.pastoraleSets.levee.userData.water;
    const dome = new THREE.PointLight(0xffd6a0, 6, 3.5, 1.5); dome.position.set(0, 1.45, .2); car.add(dome);
    const fillK = new THREE.SpotLight(0xdfe4e8, 90, 14, .5, .5, 1.4); fillK.position.set(-2.5, 3.2, -5); fillK.target.position.set(0, 1.2, 0); g.add(fillK, fillK.target);
    return ctx;
  },
  sergio(def) {
    const z = zones.road, g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    addWoodChair(g, -5.4, -4.8, 0, 1); addWoodChair(g, -3.7, -3.9, -.6, 1);
    const sergio = cultist('Sergio'); poseStanding(sergio); g.add(sergio.object); seatNPC(sergio, -5.4, -4.75, 0); sergio.posed = true; ctx.sergio = sergio;
    const ines = extraFigure(g, -6.3, -4.2, 'Ines', 0x52483d, 0); ines.object.rotation.y = .9; ctx.extras.push(ines);
    const th = buildThermos(g, -6.0, 0, -4.9); th.scale.setScalar(.6);
    const prof = extraFigure(g, .6, -7.7, 'The First', 0x171716, 1); if (prof.head) prof.head.material = headMaterial(); ctx.extras.push(prof);
    const sun = new THREE.SpotLight(0xffe0a0, 0, 40, .22, .35, 1); sun.position.set(-14, 22, 4); sun.target.position.set(-5.2, 0, -4.8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); g.add(sun, sun.target); ctx.sun = sun;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); patch.rotation.x = -Math.PI / 2; patch.position.set(-5.2, .02, -4.8); g.add(patch); ctx.patch = patch;
    return ctx;
  },
  livia(def) {
    const z = zones.church, g = new THREE.Group(); z.group.add(g); const ctx = { group: g };
    const lattice = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#000'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.beginPath(); c.moveTo(16 + x * 32, 5 + y * 32); c.lineTo(27 + x * 32, 16 + y * 32); c.lineTo(16 + x * 32, 27 + y * 32); c.lineTo(5 + x * 32, 16 + y * 32); c.fill(); } });
    const glowTex = canvasTex(128, 128, (c) => { const gr = c.createRadialGradient(64, 70, 4, 64, 64, 70); gr.addColorStop(0, '#ffd27a'); gr.addColorStop(.5, '#ff7a22'); gr.addColorStop(1, '#3a0c02'); c.fillStyle = gr; c.fillRect(0, 0, 128, 128); });
    const glowP = new THREE.Mesh(new THREE.PlaneGeometry(.84, .84), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000 })); glowP.position.set(6.5, 1.5, -9.345); g.add(glowP); ctx.glowP = glowP;
    const silTex = canvasTex(128, 256, (c) => { c.fillStyle = '#050302'; c.beginPath(); c.ellipse(64, 70, 26, 32, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(14, 256); c.quadraticCurveTo(20, 118, 64, 108); c.quadraticCurveTo(108, 118, 114, 256); c.fill(); });
    const sil = new THREE.Mesh(new THREE.PlaneGeometry(.5, 1.0), new THREE.MeshBasicMaterial({ map: silTex, transparent: true, alphaTest: .3 })); sil.position.set(6.5, 1.45, -9.34); g.add(sil); ctx.sil = sil;
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(.86, .86), new THREE.MeshBasicMaterial({ color: 0x0a0806, alphaMap: lattice, transparent: true, alphaTest: .5 })); grille.position.set(6.5, 1.5, -9.33); g.add(grille);
    const fire = new THREE.PointLight(0xff6a20, 0, 7, 1.6); fire.position.set(6.5, 1.5, -8.9); g.add(fire); ctx.fire = fire;
    for (let k = 0; k < 6; k++) silhouette(g, 3.5 + (k % 3) * .9, -.05, -6.2 + Math.floor(k / 3) * 1.1, Math.PI + .5, true);
    ctx.emitAt = 10; audio?.choir([293.7, 349.2, 329.6, 293.7, 277.2, 293.7, 440, 392, 349.2].map(f => f * .944), 15.5);
    return ctx;
  },
  walter(def) {
    const z = zones.road, g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    const prof = extraFigure(g, -.4, 0, 'The First', 0x171716, 1); prof.object.position.set(-.4, 0, 24.6); prof.object.rotation.y = Math.atan2(24 + .4, 5 - 24.6); if (prof.head) prof.head.material = headMaterial(); ctx.extras.push(prof); ctx.prof = prof;
    const fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0 })); fireball.position.set(24, 2.5, 5); g.add(fireball); ctx.fireball = fireball;
    const flash = new THREE.PointLight(0xffa850, 0, 90, 1.2); flash.position.set(24, 6, 8); g.add(flash); ctx.flash = flash;
    ctx.debris = [];
    for (let i = 0; i < 26; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(.2 + Math.random() * .6, .08, .3 + Math.random() * .8), i % 3 ? M.darkWall : M.rust); d.position.set(24, 2, 5); d.visible = false; g.add(d); ctx.debris.push({ m: d, v: new THREE.Vector3((Math.random() - .5) * 14, 6 + Math.random() * 12, (Math.random() - .5) * 14), r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0) }); }
    return ctx;
  },
  dario(def) {
    const z = zones.church, g = new THREE.Group(); z.group.add(g); const ctx = { group: g, extras: [] };
    const dario = cultist('Dario'); poseStanding(dario); dario.posed = true; g.add(dario.object);
    dario.object.position.set(0, storyRef.roodBeamY - .15, -10.6); dario.object.rotation.set(0, 0, Math.PI); dario.leftArm.rotation.set(0, 0, -1.45); dario.rightArm.rotation.set(0, 0, 1.45); ctx.dario = dario;
    if (storyRef.roodCross) storyRef.roodCross.visible = false;
    const remo = storyRef.remo; ctx.remo = remo; ctx.remoPos = remo.object.position.clone(); remo.posed = true; remo.object.position.set(0, 0, -9.55); remo.object.rotation.set(0, 0, 0);
    for (let k = -2; k <= 0; k++) silhouette(g, k * .78, -.05, -8.4, Math.PI, true);
    const shadowLight = new THREE.SpotLight(0xffc890, 160, 30, .55, .3, 1.2); shadowLight.position.set(0, .25, -10.15); shadowLight.target.position.set(0, 5.5, -17); shadowLight.intensity = 90; shadowLight.castShadow = true; shadowLight.shadow.mapSize.set(1024, 1024); shadowLight.shadow.bias = -.001; g.add(shadowLight, shadowLight.target);
    for (const x of [-1.2, 1.2]) addCandle(g, x, 0, -9.0, true);
    audio?.organ([130.8 * .944, 155.6 * .944, 196 * .944, 261.6 * .944], 18); setTimeout(() => audio?.choir([392, 349.2, 311.1, 293.7, 311.1, 349.2, 392, 415.3, 392].map(f => f * .944), 9, true), 7500);
    return ctx;
  },
  remo(def) {
    const z = zones.church, g = new THREE.Group(); z.group.add(g); const ctx = { group: g };
    if (storyRef.remo) storyRef.remo.object.visible = false; if (storyRef.churchBell) storyRef.churchBell.visible = false;
    const bell = new THREE.Group(); bell.position.set(-6.8, 5.6, -5.8); g.add(bell); ctx.bell = bell;
    const prof = [new THREE.Vector2(.95, 0), new THREE.Vector2(.9, .15), new THREE.Vector2(.78, .4), new THREE.Vector2(.6, .8), new THREE.Vector2(.5, 1.2), new THREE.Vector2(.45, 1.4), new THREE.Vector2(.3, 1.5), new THREE.Vector2(0, 1.52)];
    const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), M.bronze); shell.material.side = THREE.DoubleSide; shell.position.y = -1.5; bell.add(shell);
    const hang = silhouette(bell, 0, -2.9, 0, 0, false, 0x050403); ctx.hang = hang;
    tubeBetween(bell, [0, -.1, 0], [0, -1.15, 0], .02, M.black, 5);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, 1, 8), mat(0x7a5f40, 1, { map: TEX.wood })); g.add(rope); ctx.rope = rope;
    const lamp = new THREE.SpotLight(0xd8c8a8, 140, 16, .55, .5, 1.3); lamp.position.set(-3.4, 1.2, -2.6); lamp.target.position.set(-6.8, 4.6, -5.8); lamp.castShadow = true; g.add(lamp, lamp.target);
    return ctx;
  }
};
const STATION_UPDATE = {
  franco(c, t) {
    const k = THREE.MathUtils.smoothstep(t, 0, 16);
    camera.position.set(.39 + Math.sin(t * .2) * .03, 2.15, THREE.MathUtils.lerp(-5.6, -8.6, k)); camera.lookAt(0, 2.0, -12.4);
    const lift = THREE.MathUtils.smoothstep(t, 3.6, 5.2) * (1 - THREE.MathUtils.smoothstep(t, 6.8, 7.4)) + THREE.MathUtils.smoothstep(t, 8.6, 9.6);
    raiseArms(c.remo, .3 + .7 * lift); c.host.position.set(0, 1.55 + lift * .75, -12.9); c.host.visible = lift > .2;
    if (t >= 7 && !c.buzz) { c.buzz = true; audio?.phoneBuzz(); }
    c.red.intensity = THREE.MathUtils.smoothstep(t, 10.5, 12) * 60;
    if (t > 11.2) { c.cloth.visible = true; c.stain.material.opacity = Math.min(.75, (t - 11.2) * .25); c.stain.scale.setScalar(.4 + Math.min(1, (t - 11.2) * .3)); }
  },
  anna(c, t) {
    const T = storyRef.tableSeats, eye = new THREE.Vector3(T.top[0] + .04, 1.18, T.top[1] + 2.3 + .7);
    camera.position.copy(eye); camera.lookAt(c.bowl.x, c.bowl.y - .05, c.bowl.z - .05);
    const cyc = (t * .32) % 1, up = Math.sin(cyc * Math.PI);
    c.spoon.position.set(c.bowl.x + .05, c.bowl.y + up * .32, c.bowl.z + up * .3); c.spoon.rotation.set(-.3 * up, Math.PI, 0);
    if (t >= c.nextScrape && t < 17.5) { c.nextScrape = t + .9 + Math.random() * .8; audio?.trowel(); if (Math.random() < .4) setTimeout(() => audio?.knock(), 300); }
    if (t >= 8 && !c.v1) { c.v1 = true; audio?.muffledVoice(2.4, 0, 260); }
  },
  marta(c, t) {
    if (t < 6.5 || t > 15.5) { const k = THREE.MathUtils.smoothstep(t, 0, 6.5); camera.position.set(2.6 - k * .6, 2.0, 1.6); camera.lookAt(0, .8, -1); }
    else { const k = (t - 6.5) / 9; camera.position.set(.12 - k * .1, 1.02, -.25); camera.lookAt(-.02 + k * .05, .83, -.55); }
    const kk = THREE.MathUtils.clamp((t - 4) / 10.5, 0, 1); if (Math.abs(kk - c.lastK) > .01) { c.lastK = kk; c.paint(kk); }
    if (t > 16.5 && !c.bleed) { c.bleed = true; flashFragment('nosebleed', 220); }
  },
  gabri(c, t) {
    const k = THREE.MathUtils.smoothstep(t, 0, 18);
    camera.position.set(-2.3 + k * 1.3, 1.85 - k * .2, -3.6 + k * 1.1); camera.lookAt(.25, 1.45, .45);
    if (c.water) c.water.position.y = -.4 + k * .35;
    if (t > 15.5) c.gabri.object.rotation.z = -Math.min(.32, (t - 15.5) * .2);
    if (t > 14.6 && !c.flash) { c.flash = true; flashFragment('tea', 130); }
  },
  sergio(c, t) {
    c.sun.intensity = THREE.MathUtils.smoothstep(t, 0, 3) * 300; c.patch.material.opacity = THREE.MathUtils.smoothstep(t, 0, 3) * .22 * (1 - THREE.MathUtils.smoothstep(t, 17, 20) * .6);
    if (t < 14) { camera.position.set(-3.55, 1.2, -3.7); camera.lookAt(-5.5, 1.25, -4.75); }
    else { const k = THREE.MathUtils.smoothstep(t, 14, 20); camera.position.set(-1.5 + k * 1.5, 2.4 + k, 3 + k * 4); camera.lookAt(-4.6, .9, -5); }
    if (t > 16) { c.sergio.head.rotation.x = Math.min(.55, (t - 16) * .25); }
  },
  livia(c, t) {
    camera.position.set(6.5 + Math.sin(t * .2) * .05, 1.5, -6.6 + THREE.MathUtils.smoothstep(t, 0, 17) * 1.6); camera.lookAt(6.5, 1.45, -9.4);
    const glowK = THREE.MathUtils.smoothstep(t, 8.5, 13), fl = .8 + Math.random() * .4; c.glowP.material.color.setScalar(glowK * fl); c.fire.intensity = glowK * 10 * fl;
    c.sil.position.y = 1.45 - Math.max(0, t - 13.5) * .18; c.sil.rotation.z = Math.sin(t * 1.3) * .04;
    if (t > c.emitAt && !c.emitted) { c.emitted = true; makeEmitter(c.group, 6.5, 2.25, -9.6, 'smoke'); }
  },
  walter(c, t, dt) {
    camera.position.set(-2.2, 2.0, 27.4); camera.lookAt(24, 3.0, 5);
    if (t >= 7 && !c.boom) { c.boom = true; c.debris.forEach(d => d.m.visible = true); (storyRef.shedMeshes || []).forEach(m => { m.material = storyRef.charMat || (storyRef.charMat = mat(0x1a1714, 1, { map: TEX.concrete })); }); makeSmokeColumn(zones.road.group, 24, 4.4, 5, { count: 34, size: 3, grow: 9, rise: 1.6, life: 14, color: 0x3a3632, opacity: .55, drift: .25 }); makeEmitter(zones.road.group, 24, 4.2, 5, 'fire'); }
    if (c.boom) {
      const e = t - 7; c.fireball.material.opacity = Math.max(0, 1 - e * .3); c.fireball.scale.setScalar(1 + Math.min(e, 2) * 5); c.flash.intensity = Math.max(0, 9000 * (1 - e * .35));
      c.debris.forEach(d => { if (d.m.position.y > .05 || d.v.y > 0) { d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt; if (d.m.position.y < .05) { d.m.position.y = .05; d.v.set(0, 0, 0); } } });
    }
    if (t >= 9.6 && !c.sound) { c.sound = true; audio?.explosion(); glitchPulse = 1.2; }
    if (t > 11 && c.prof) c.prof.object.rotation.z = Math.sin(t * 2) * .02;
  },
  dario(c, t) {
    if (t < 11) { camera.position.set(2.7, .9, -9.0); camera.lookAt(0, 3.9, -10.6); }
    else { const k = THREE.MathUtils.smoothstep(t, 11, 19); camera.position.set(2.7 - k * 1.5, .9 + k * .9, -9.0 + k * 2.4); camera.lookAt(0, 3.8 + k * .6, -16.8); }
    raiseArms(c.remo, .6 + .3 * Math.sin(t * .6));
    if (t >= 4.5 && !c.lighter) { c.lighter = true; audio?.lighterClicks(); }
    c.dario.object.rotation.y = Math.sin(t * .7) * .04 * (t < 15.5 ? 1 : .2);
  },
  remo(c, t, dt) {
    const pull = THREE.MathUtils.smoothstep(t, 7.6, 8.4), ring = t > 13.8;
    camera.position.set(-4.6, 1.55 - pull * .12 + (ring ? Math.sin(t * 9) * .01 : 0), -2.4); camera.lookAt(-6.8, 3.0 + pull * 1.0, -5.8);
    c.hang.visible = t > 7.6; c.hang.position.y = -2.9 - (1 - pull) * .8;
    const damp = t > 20 ? Math.exp(-(t - 20)) : 1, swing = ring ? Math.sin((t - 13.8) * 2.2) * .42 * damp : 0; c.bell.rotation.z = swing;
    const top = new THREE.Vector3(-6.8, 4.1, -5.8), hand = new THREE.Vector3(-4.85, 1.2 - pull * .1, -2.9), mid = top.clone().add(hand).multiplyScalar(.5), d = top.clone().sub(hand);
    c.rope.position.copy(mid); c.rope.scale.y = d.length(); c.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    if (t >= 8 && !c.jolt) { c.jolt = true; audio?.mechanicalNoise(.5, 260, 1.4, .3, 0); glitchPulse = 1; }
    if (ring && !c.rung) { c.rung = true; audio?.bell(6, 0); }
  }
};
const STATION_FINISH = {
  franco(c) { c.remo.posed = false; c.remo.object.position.copy(c.remoPos); raiseArms(c.remo, 0); },
  anna(c) { },
  dario(c) { c.remo.posed = false; c.remo.object.position.copy(c.remoPos); raiseArms(c.remo, 0); if (storyRef.roodCross) storyRef.roodCross.visible = true; },
  remo(c) { if (storyRef.churchBell) storyRef.churchBell.visible = true; if (storyRef.remo) { storyRef.remo.object.visible = false; const zc = zones.church; const ix = zc.interactables.indexOf(storyRef.remo); if (ix >= 0) zc.interactables.splice(ix, 1); } }
};

// ---- Pastorales: one extra space, white fog, no people ----------------------------------------
function buildPastoraleZone() {
  const z = newZone('pastorale', 0xdcded9, .03, { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, [0, 0, 0]);
  z.ambient.intensity = 1.0; z.moon.intensity = 1.3; z.moon.castShadow = false;
  const sets = storyRef.pastoraleSets = {};
  const mk = (name) => { const g = new THREE.Group(); g.visible = false; z.group.add(g); sets[name] = g; return g; };
  // Cows grazing in fog.
  { const g = mk('cows'); const hide = mat(0x4a3c32, 1), white = mat(0xd6d0c4, 1);
    for (const [x, zz, r, pat] of [[-3, -14, .5, 0], [2.5, -18, -1.2, 1], [7, -12, 2.2, 0], [-8, -22, .2, 1]]) { const cow = new THREE.Group(); cow.position.set(x, 0, zz); cow.rotation.y = r; g.add(cow);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.45, 1.2, 6, 10), pat ? white : hide); body.rotation.z = Math.PI / 2; body.position.y = 1.15; cow.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(.35, .38, .55), pat ? white : hide); head.position.set(1.05, .55, 0); head.rotation.z = -.9; cow.add(head); cow.userData.head = head;
      for (const [lx, lz] of [[-.6, -.25], [-.6, .25], [.55, -.25], [.55, .25]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.07, .06, .8, 8), hide); leg.position.set(lx, .4, lz); cow.add(leg); } } }
  // Ivy overtaking a ruined wall.
  { const g = mk('ivy'); addBox(g, 0, 1.6, -9, 8, 3.2, .5, M.ruinWall); addBox(g, 3.6, 3.6, -9, 1.2, 1.0, .5, M.ruinWall);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f4426, roughness: .9, side: THREE.DoubleSide }); const ivy = new THREE.InstancedMesh(new THREE.CircleGeometry(.09, 5), leafMat, 900); const d = new THREE.Object3D();
    for (let i = 0; i < 900; i++) { const x = -4 + Math.random() * 8, y = Math.pow(Math.random(), 1.6) * 3.4; d.position.set(x, y, -8.7 + Math.random() * .04); d.rotation.set(0, 0, Math.random() * 6); d.scale.setScalar(.7 + Math.random() * .8); d.updateMatrix(); ivy.setMatrixAt(i, d.matrix); }
    ivy.count = 0; g.add(ivy); g.userData.ivy = ivy; }
  // Cracked clay under full sun.
  { const g = mk('clay'); const t = canvasTex(1024, 1024, (c, w, h) => { c.fillStyle = '#b39a74'; c.fillRect(0, 0, w, h); c.strokeStyle = '#4a3a28'; c.lineWidth = 4;
      for (let i = 0; i < 160; i++) { let x = Math.random() * w, y = Math.random() * h; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 120; y += (Math.random() - .5) * 120; c.lineTo(x, y); } c.stroke(); } });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(0xffffff, 1, { map: t })); ground.rotation.x = -Math.PI / 2; ground.position.y = .01; g.add(ground);
    const cloud = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .25, depthWrite: false })); cloud.rotation.x = -Math.PI / 2; cloud.position.set(-30, .03, -14); cloud.scale.set(1.6, 1, 1); g.add(cloud); g.userData.cloud = cloud; }
  // A levee and a brown river (Gabri), the same river back in its bed afterwards.
  { const g = mk('levee'); const water = new THREE.Mesh(new THREE.PlaneGeometry(120, 26), new THREE.MeshStandardMaterial({ color: 0x5a4a36, roughness: .25, metalness: .2 })); water.rotation.x = -Math.PI / 2; water.position.set(0, -.4, -14); g.add(water); g.userData.water = water;
    addBox(g, 0, .3, 0, 120, .6, 4, mat(0x4f5a3a, 1, { map: TEX.grass })); }
  { const g = mk('river'); const water = new THREE.Mesh(new THREE.PlaneGeometry(120, 9), new THREE.MeshStandardMaterial({ color: 0x6a5638, roughness: .35, metalness: .15 })); water.rotation.x = -Math.PI / 2; water.position.set(0, -.25, -16); g.add(water); g.userData.water = water;
    addBox(g, 0, -.35, -10, 120, .7, 3, mat(0x5a4a34, 1)); addBox(g, 0, -.35, -22, 120, .7, 3, mat(0x5a4a34, 1)); }
  // Black dried sunflowers in wind.
  { const g = mk('sunflowers'); const stem = mat(0x1e1a14, 1), headM = mat(0x161210, 1); g.userData.heads = [];
    for (let i = 0; i < 70; i++) { const f = new THREE.Group(); f.position.set(-12 + (i % 14) * 1.8 + Math.random() * .6, 0, -6 - Math.floor(i / 14) * 2.2); g.add(f); const h = 1.6 + Math.random() * .6;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, h, 6), stem); s.position.y = h / 2; f.add(s); const hd = new THREE.Mesh(new THREE.CylinderGeometry(.22, .18, .08, 14), headM); hd.position.set(0, h, .12); hd.rotation.x = 1.2 + Math.random() * .3; f.add(hd); g.userData.heads.push(f); } }
  // Stubble field (Pino) — reused for its pastorale too.
  { const g = mk('stubble'); const st = new THREE.InstancedMesh(new THREE.CylinderGeometry(.01, .012, .18, 4), mat(0xa08a58, 1), 2600); const d = new THREE.Object3D();
    for (let i = 0; i < 2600; i++) { d.position.set(-30 + Math.random() * 60, .09, -40 + Math.random() * 38); d.rotation.set((Math.random() - .5) * .3, 0, (Math.random() - .5) * .3); d.updateMatrix(); st.setMatrixAt(i, d.matrix); } g.add(st);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(0x8a7650, 1)); ground.rotation.x = -Math.PI / 2; ground.position.y = .012; g.add(ground); }
  // A burnt field at dawn, with steam and one green shoot.
  { const g = mk('burnt'); const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(0x1b1816, 1)); ground.rotation.x = -Math.PI / 2; ground.position.y = .012; g.add(ground);
    for (let i = 0; i < 4; i++) makeSmokeColumn(g, -6 + i * 4, .1, -10 - i * 2, { count: 14, size: .8, grow: 3, rise: .5, life: 9, color: 0xc8c4bc, opacity: .35, drift: .2 });
    const shoot = new THREE.Group(); shoot.position.set(.4, 0, -4.2); g.add(shoot); const sm = mat(0x5aa03a, .7);
    tubeBetween(shoot, [0, 0, 0], [0, .22, 0], .006, sm, 5); for (const s of [-1, 1]) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(.04, 8, 6), sm); leaf.scale.set(1.4, .3, .7); leaf.position.set(s * .04, .2, 0); leaf.rotation.z = s * .5; shoot.add(leaf); } }
  // Smoke rising straight into still air.
  { const g = mk('smoke'); makeSmokeColumn(g, 0, 0, -30, { count: 40, size: 2, grow: 4, rise: 2.4, life: 16, color: 0x6e6a64, opacity: .5, drift: 0 }); const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x6a6e58, 1, { map: TEX.grass })); ground.rotation.x = -Math.PI / 2; ground.position.y = .01; g.add(ground); }
  // The church a mile away in fog, and the belfry with birds returning.
  { const g = mk('church'); addRomanesqueChurchExterior(g, 0, -60, 12, 15, 6.8); }
  { const g = mk('belfry'); addRomanesqueChurchExterior(g, 6, -26, 12, 15, 6.8); g.userData.birds = [];
    for (let i = 0; i < 9; i++) { const b = new THREE.Group(); const wingM = mat(0x111111, 1); for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(.35, .1), wingM); w.material.side = THREE.DoubleSide; w.position.x = s * .17; b.add(w); b.userData['w' + s] = w; } g.add(b); g.userData.birds.push({ b, phase: i * .7, r: 6 + i * .8 }); } }
}
function showPastoraleSet(name) { const sets = storyRef.pastoraleSets; Object.entries(sets).forEach(([k, g]) => { g.visible = k === name; }); }
function showPastorale(kind) {
  viewZone('pastorale'); showPastoraleSet(kind); storyRef.pastoraleKind = kind;
  const cam = { cows: [[0, 1.6, 2], [0, 1.0, -16]], ivy: [[0, 1.5, -2], [0, 1.4, -9]], clay: [[0, 1.7, 4], [0, 0, -14]], river: [[0, 1.6, -4], [0, -.2, -18]], sunflowers: [[0, 1.6, 4], [0, 1.6, -10]], stubble: [[0, 1.6, 4], [0, .4, -20]], burnt: [[0, 1.5, 1], [.4, .2, -4.2]], smoke: [[0, 1.6, 8], [0, 9, -30]], church: [[0, 1.6, 10], [0, 4, -60]], belfry: [[0, 1.6, 6], [1.75, 8, -21]] }[kind] || [[0, 1.6, 4], [0, 1, -10]];
  playerAnchor.position.set(0, 0, 0); camera.position.set(...cam[0]); camera.lookAt(...cam[1]);
  const bright = kind === 'clay' ? 2.2 : 1.1; zones.pastorale.ambient.intensity = bright; zones.pastorale.moon.intensity = kind === 'clay' ? 2.4 : 1.2;
  scene.fog.density = ({ church: .016, belfry: .022, smoke: .018, clay: .012 })[kind] ?? .028;
}
function updatePastorale(t, dt) {
  const g = storyRef.pastoraleSets?.[storyRef.pastoraleKind]; if (!g) return;
  zones.pastorale.ambient.intensity = storyRef.pastoraleKind === 'clay' ? 2.2 : 1.1;
  if (g.userData.ivy) g.userData.ivy.count = Math.min(900, Math.floor(200 + t * 110));
  if (g.userData.cloud) g.userData.cloud.position.x = -30 + t * 6;
  if (g.userData.water?.material?.map) g.userData.water.material.map.offset.x += dt * .01;
  if (g.userData.heads) g.userData.heads.forEach((f, i) => { f.rotation.z = Math.sin(t * 1.4 + i) * .08; });
  if (g.userData.birds) g.userData.birds.forEach(({ b, phase, r }) => { const a = t * .5 + phase; b.position.set(1.75 + Math.cos(a) * r * Math.max(.3, 1 - t * .08), 8 + Math.sin(a * 1.3) * .6, -21 + Math.sin(a) * r * .5); b.rotation.y = -a; b.userData['w-1'].rotation.z = Math.sin(t * 14 + phase) * .6; b.userData['w1'].rotation.z = -Math.sin(t * 14 + phase) * .6; });
  g.children.forEach(c => { if (c.userData.head) c.userData.head.rotation.z = -.9 + Math.sin(t * .6) * .05; });
}

// =============================================================================
// v6 — new sounds: harpsichord pluck, organ, choir, the engine, the radio, the
// trowel, a phone in a pocket, a lighter that will not catch, a late explosion.
// =============================================================================
Object.assign(AmbientSound.prototype, {
  noiseBuffer(seconds = 1, brown = false) {
    const len = Math.ceil(this.ctx.sampleRate * seconds), b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + .04 * w) / 1.04; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  },
  // Karplus–Strong plucked string: a harpsichord quill on a brass string.
  pluck(freq = 415, gain = .5) {
    if (!this.ctx || !this.ready || muted) return;
    const sr = this.ctx.sampleRate, dur = 2.6, len = Math.ceil(sr * dur), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq)), buf = new Float32Array(period); for (let i = 0; i < period; i++) buf[i] = Math.random() * 2 - 1;
    let idx = 0; for (let i = 0; i < len; i++) { const next = (idx + 1) % period; const v = buf[idx]; buf[idx] = .4985 * (v + buf[next]); d[i] = v * (i < 40 ? 1.4 : 1); idx = next; }
    const src = this.ctx.createBufferSource(); src.buffer = b; const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120; const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(hp); hp.connect(g); g.connect(this.master); if (this.reverbSend) g.connect(this.reverbSend); src.start();
  },
  organ(freqs, dur = 10) {
    if (!this.ctx || !this.ready) return; const t = this.ctx.currentTime, out = this.ctx.createGain(); out.gain.setValueAtTime(.0001, t); out.gain.exponentialRampToValueAtTime(.32, t + .6); out.gain.setValueAtTime(.32, t + dur - 1.5); out.gain.exponentialRampToValueAtTime(.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; out.connect(lp); lp.connect(this.master); if (this.reverbSend) lp.connect(this.reverbSend);
    freqs.forEach((f, i) => [1, 2, .5].forEach((m, k) => { const o = this.ctx.createOscillator(); o.type = k === 0 ? 'sawtooth' : 'triangle'; o.frequency.value = f * m * (1 + (Math.random() - .5) * .002); const g = this.ctx.createGain(); g.gain.value = [.07, .045, .06][k] / (1 + i * .2); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .1); }));
  },
  // A sung line: sawtooth through vowel formants ("ah"), with vibrato; several voices if `group`.
  choir(notes, dur = 12, solo = false) {
    if (!this.ctx || !this.ready) return; const t0 = this.ctx.currentTime, step = dur / notes.length, voices = solo ? 1 : 4;
    const out = this.ctx.createGain(); out.gain.value = solo ? .5 : .36; out.connect(this.master); if (this.reverbSend) out.connect(this.reverbSend);
    const formants = [[800, 6, 1], [1150, 7, .5], [2900, 9, .25]];
    for (let v = 0; v < voices; v++) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; const vib = this.ctx.createOscillator(), vg = this.ctx.createGain(); vib.frequency.value = 5 + v * .3; vg.gain.value = 4 + v; vib.connect(vg); vg.connect(o.detune);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(.12, t0 + .5); g.gain.setValueAtTime(.12, t0 + dur - 1); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      notes.forEach((f, i) => o.frequency.setTargetAtTime(f * (v === 1 ? .5 : v === 2 ? 1.5 : 1) * (1 + (v - 1.5) * .003), t0 + i * step, .05));
      formants.forEach(([ff, q, a]) => { const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff * (v === 1 ? .85 : 1); bp.Q.value = q; const fg = this.ctx.createGain(); fg.gain.value = a; o.connect(bp); bp.connect(fg); fg.connect(g); });
      g.connect(out); o.start(t0); vib.start(t0); o.stop(t0 + dur + .1); vib.stop(t0 + dur + .1);
    }
  },
  phoneBuzz() { if (!this.ctx) return; for (let k = 0; k < 3; k++) setTimeout(() => { this.mechanicalTone(182, 180, .42, 'square', .05, .35); this.mechanicalNoise(.4, 180, 3, .06, .35); }, k * 900); },
  lighterClicks() { if (!this.ctx) return; for (let k = 0; k < 4; k++) setTimeout(() => { this.mechanicalNoise(.05, 3800, 6, .2, -.2); this.mechanicalNoise(.12, 5200, 2, .05, -.2); }, k * 650); },
  trowel() { if (!this.ctx) return; const f = this.ctx.createBiquadFilter(); this.mechanicalNoise(.35 + Math.random() * .3, 900 + Math.random() * 400, 2.5, .16, (Math.random() - .5) * .3); },
  explosion() {
    if (!this.ctx || !this.ready) return; const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(4.5, true); const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(90, t + 4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(1.1, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + 4.4);
    src.connect(lp); lp.connect(g); g.connect(this.master); if (this.reverbSend) g.connect(this.reverbSend); src.start(t);
    this.mechanicalTone(48, 22, 3.5, 'sine', .5, 0);
  },
  // Speech heard through a wall: syllable-like formant noise, low-passed by plaster.
  muffledVoice(dur = 2.4, pan = 0, cutoff = 520, pitch = 1) {
    if (!this.ctx || !this.ready || muted) return; const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(dur + .2); const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 118 * pitch;
    const mix = this.ctx.createGain(); mix.gain.value = 1; const nG = this.ctx.createGain(); nG.gain.value = .25; src.connect(nG); nG.connect(mix); const oG = this.ctx.createGain(); oG.gain.value = .5; o.connect(oG); oG.connect(mix);
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4; const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const env = this.ctx.createGain(); env.gain.setValueAtTime(.0001, t);
    for (let k = 0; k * .17 < dur - .1; k++) { const s0 = t + k * .17 + Math.random() * .03; env.gain.exponentialRampToValueAtTime(.38 + Math.random() * .25, s0 + .05); env.gain.exponentialRampToValueAtTime(.05, s0 + .15); f1.frequency.setValueAtTime(350 + Math.random() * 700, s0); o.frequency.setValueAtTime(118 * pitch * (.9 + Math.random() * .25), s0); }
    env.gain.exponentialRampToValueAtTime(.0001, t + dur);
    const pn = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain(); if (pn.pan) pn.pan.value = pan;
    mix.connect(f1); f1.connect(lp); lp.connect(env); env.connect(pn); pn.connect(this.master); src.start(t); o.start(t); src.stop(t + dur + .1); o.stop(t + dur + .1);
  },
  radio(dur = 5) {
    if (!this.ctx || !this.ready) return; const t = this.ctx.currentTime, src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = .7; const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.09, t + .2);
    for (let k = 0; k < dur * 4; k++) g.gain.setValueAtTime(.03 + Math.random() * .08, t + .2 + k * .25); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);
    setTimeout(() => this.muffledVoice(1.6, .1, 2600, 1.15), 700); setTimeout(() => this.muffledVoice(1.1, .1, 2600, 1.15), 2600);
  },
  starter() { if (!this.ctx) return; for (let k = 0; k < 9; k++) setTimeout(() => { this.mechanicalTone(62, 40, .13, 'sawtooth', .09, -.1); this.mechanicalNoise(.12, 420, 1.5, .08, -.1); }, k * 150); },
  engineStart() {
    if (!this.ctx || !this.ready) return { setRpm() {}, stop() {} };
    const ctx = this.ctx, t = ctx.currentTime, out = ctx.createGain(); out.gain.setValueAtTime(.0001, t); out.gain.exponentialRampToValueAtTime(.3, t + .25); out.connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 1.2; lp.connect(out);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain(); g1.gain.value = .32; g2.gain.value = .12; g3.gain.value = .55;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(lp); g2.connect(lp); g3.connect(lp);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = 3.5; lfo.connect(lg); lg.connect(o1.frequency);
    const nz = ctx.createBufferSource(); nz.buffer = this.noiseBuffer(2, true); nz.loop = true; const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 160; const ng = ctx.createGain(); ng.gain.value = .45; nz.connect(nb); nb.connect(ng); ng.connect(lp);
    [o1, o2, o3, lfo, nz].forEach(n => n.start(t));
    // The catch: a quick rev before it settles to idle.
    const set = (rpm, tc = .15) => { const f = rpm / 60 * 2, now = ctx.currentTime; o1.frequency.setTargetAtTime(f, now, tc); o2.frequency.setTargetAtTime(f * .5, now, tc); o3.frequency.setTargetAtTime(f * .5, now, tc); lp.frequency.setTargetAtTime(280 + rpm * .45, now, tc); out.gain.setTargetAtTime(.22 + Math.min(.25, rpm / 9000), now, tc); };
    set(1900, .05); setTimeout(() => set(820, .35), 450);
    return { setRpm: set, stop: () => { const now = ctx.currentTime; set(300, .2); out.gain.setTargetAtTime(.0001, now + .25, .18); setTimeout(() => [o1, o2, o3, lfo, nz].forEach(n => { try { n.stop(); } catch (_) {} }), 1600); this.mechanicalNoise(.3, 300, 1, .1, 0); } };
  }
});

// =============================================================================
// v6 — the opening: two title cards (1977, the poem), then Tobia walks up the
// lane from his car. The HUD and the objective only appear when you can move.
// =============================================================================
function startIntroV6() {
  if (storyFlags.has('intro-seen')) return;
  storyFlags.add('intro-seen'); $('intro-dark').style.opacity = '1'; $('hud').classList.add('intro');
  playerAnchor.position.set(2.0, 0, 47); camera.position.set(0, 1.63, 0); camera.rotation.set(-.05, -2.5, 0);
  storyScene = { type: 'intro', t: 0, dur: 44, i: 0, lines: [
    [12.5, 'Tobia: A polite voice on the telephone. Cash, today. A harpsichord in a farmhouse, to be tuned to four-fifteen — baroque pitch.'],
    [19.5, 'Tobia: The radio lost its signal at the canal. Then the fog closed the road behind the car.'],
    [26.5, 'Tobia: I tune pianos for people who talk while I work. I listen to their refrigerators. I never hear my own house.'],
    [33.5, 'Tobia: Someone has left a lamp lit on the porch. Nobody has asked me anything yet.'],
    [39.5, 'Il Professore: You came. Good. The road is unpleasant once the fog comes down.']] };
  setStationCard('black', 'PO VALLEY · WINTER 1977', 'THIRTEEN VOICES', 'A priest-composer and twelve choristers record an album in a frescoed church. All thirteen die. The reel survives. Nobody has ever heard it.');
  $('skip-hint').classList.add('visible');
}
function updateIntroV6(s, dt) {
  if (s.t >= 5.6 && !s.c2) { s.c2 = true; setStationCard('black', '', 'EPISTASSI', 'I engrave my memoirs\nwith a sunshine\nthat isn’t there;'); }
  if (s.t >= 11 && !s.c3) { s.c3 = true; setStationCard('hidden'); audio?.knock(); }
  const k = THREE.MathUtils.smoothstep(s.t, 11.5, s.dur);
  playerAnchor.position.set(THREE.MathUtils.lerp(2.0, 0, k), 0, THREE.MathUtils.lerp(47, 10, k));
  const walking = s.t > 11.5 && s.t < s.dur - .3, ph = s.t * 5.4;
  camera.position.set(0, 1.63 - (walking ? Math.abs(Math.sin(ph)) * .035 : 0), 0);
  const turn = THREE.MathUtils.smoothstep(s.t, 11, 17.5);
  camera.rotation.set(-.05 + Math.sin(s.t * .23) * .02, THREE.MathUtils.lerp(-2.5, 0, turn) + Math.sin(s.t * .17) * .05 * turn, Math.sin(ph) * .004);
  if (walking && Math.floor(ph / Math.PI) !== s.lastStep) { s.lastStep = Math.floor(ph / Math.PI); audio?.footstep('gravel', false, s.lastStep); }
  $('intro-dark').style.opacity = String(s.t < 11 ? 1 : Math.max(0, 1 - (s.t - 11) / 6));
  if (s.t >= s.dur) endIntroV6();
}
function endIntroV6() {
  storyScene = null; clearTimeout(storyLine.timer); setStationCard('hidden'); $('skip-hint').classList.remove('visible');
  $('subtitle-wrap').classList.remove('visible'); $('intro-dark').style.opacity = '0';
  playerAnchor.position.set(0, 0, 10); camera.position.set(0, 1.63, 0); camera.rotation.set(-.05, 0, 0); resetLook();
  $('hud').classList.remove('intro');
  $('objective-text').textContent = 'Walk up to the porch. A man is waiting under the lamp.';
  requestMouseLock();
}

// =============================================================================
// v6 — Tobia's car: sit in, turn the key, feel the engine, watch the fog go by.
// =============================================================================
function buildTobiaCar(g) {
  const car = buildCar(); car.position.set(3.6, 0, 50); g.add(car);
  const chrome = mat(0x9a9d96, .25, { metalness: .85 }), red = new THREE.MeshStandardMaterial({ color: 0x4a0a08, emissive: 0xff2010, emissiveIntensity: .2, roughness: .3 });
  addBox(car, 0, .42, -1.95, 1.84, .12, .1, chrome); addBox(car, 0, .42, 1.92, 1.84, .12, .1, chrome);
  for (const s of [-1, 1]) { addBox(car, s * .7, .76, 1.86, .3, .12, .04, red); const mir = new THREE.Mesh(new THREE.BoxGeometry(.05, .1, .16), chrome); mir.position.set(s * .95, 1.12, -.55); car.add(mir); }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(.52, .12), new THREE.MeshStandardMaterial({ map: signTexture(['PR 415577'], { w: 256, h: 64, bg: '#e8e4d4', fg: '#1a1a1a', font: 'bold 40px monospace' }) })); plate.position.set(0, .5, 2.0); car.add(plate);
  const dashGlow = new THREE.Mesh(new THREE.PlaneGeometry(.36, .1), new THREE.MeshBasicMaterial({ color: 0x1a1408 })); dashGlow.position.set(-.32, 1.1, -.48); dashGlow.rotation.x = -.6; car.add(dashGlow);
  const heads = []; for (const s of [-1, 1]) { const sl = new THREE.SpotLight(0xfff0cc, 0, 34, .42, .5, 1.2); sl.position.set(s * .62, .72, -1.95); sl.target.position.set(s * .9, -.4, -16); sl.visible = false; car.add(sl, sl.target); heads.push(sl); }
  car.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const solid = { minX: 2.65, maxX: 4.55, minZ: 48.0, maxZ: 52.0 }; zones.road.solids.push(solid);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 5), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); marker.position.set(-1.0, 1.0, .3); car.add(marker);
  storyRef.tobiaCar = { car, heads, dashGlow, solid, at: 'lane', marker };
  zones.road.interactables.push({ id: 'tobia-car', type: 'story', object: marker, point: new THREE.Vector3(2.6, 1.0, 50.3), radius: 2.6, prompt: '[ E ] GET INTO YOUR CAR', run: startDrive });
}
function updateCarEntry() {
  const c = storyRef.tobiaCar; if (!c) return; const e = zones.road.interactables.find(i => i.id === 'tobia-car'); if (!e) return;
  e.point.set(c.car.position.x - 1.0, 1.0, c.car.position.z + .3);
  c.solid.minX = c.car.position.x - .95; c.solid.maxX = c.car.position.x + .95; c.solid.minZ = c.car.position.z - 2.0; c.solid.maxZ = c.car.position.z + 2.0;
}
function startDrive() {
  cancelHold(); const c = storyRef.tobiaCar; if (!c || storyScene) return;
  keys.clear(); activeTarget = null; $('prompt').classList.remove('visible');
  const mode = c.at === 'lane' ? 'lane' : 'porch';
  storyScene = { type: 'drive', t: 0, dur: mode === 'lane' ? 21 : 15, mode, lines: [], i: 0, from: playerAnchor.position.clone(), fromRot: camera.rotation.y, startZ: c.car.position.z, eng: null, flags: {} };
  setCinema(true);
}
function updateDrive(s, dt) {
  const c = storyRef.tobiaCar, car = c.car, F = s.flags;
  if (s.skip && !F.skipped) { F.skipped = true; s.t = Math.max(s.t, s.dur - .6); if (s.mode === 'lane') car.position.z = 9; }
  // Seat position in the car's frame: driver on the left.
  const seatLocal = new THREE.Vector3(-.4, 1.12, .5), seat = seatLocal.clone().applyMatrix4(car.matrixWorld);
  const enter = THREE.MathUtils.smoothstep(s.t, 0, 1.1);
  playerAnchor.position.set(0, 0, 0);
  const from = s.from.clone().setY(1.63);
  const shake = s.eng ? (.0025 + (F.rpm || 800) / 3000 * .004) : 0;
  camera.position.lerpVectors(from, seat, enter);
  camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake * 1.4;
  let yaw = THREE.MathUtils.lerp(s.fromRot, 0, enter), pitch = -.08;
  if (s.t >= 1.2 && !F.door) { F.door = true; audio?.knock(); audio?.mechanicalNoise(.18, 900, 2, .2, -.3); }
  if (s.t >= 1.7 && !F.key) { F.key = true; audio?.mechanicalNoise(.06, 4200, 6, .15, -.1); }
  if (s.t >= 2.0 && !F.crank) { F.crank = true; audio?.starter(); }
  if (s.t >= 3.4 && !s.eng) { s.eng = audio?.engineStart(); F.rpm = 900; c.heads.forEach(h => { h.intensity = 60; h.visible = true; }); c.dashGlow.material.color.set(0xd88a2a); glitchPulse = .4; }
  if (s.mode === 'lane') {
    // Drive down the lane to the farmhouse. The fog closes behind you.
    const k = THREE.MathUtils.smoothstep(s.t, 5.2, 15.5);
    if (!F.skipped) car.position.z = THREE.MathUtils.lerp(s.startZ, 9, k);
    const speed = (THREE.MathUtils.smoothstep(s.t, 5.2, 10.3) - THREE.MathUtils.smoothstep(s.t, 10.3, 15.5)) * 2;
    F.rpm = 850 + speed * 2200 + Math.sin(s.t * 3) * 40; s.eng?.setRpm(F.rpm);
    car.rotation.z = Math.sin(s.t * 13) * .003 * (s.eng ? 1 : 0) + Math.sin(s.t * 2.1) * .006 * speed; car.rotation.x = -speed * .01;
    car.userData.wheels?.forEach(w => { w.rotation.x -= speed * dt * 9; });
    if (s.t >= 6 && !F.radio) { F.radio = true; audio?.radio(5.5); storyLine('Radio: …nebbia fitta su tutta la Bassa… strade chiuse tra… (static)'); }
    if (s.t >= 12 && !F.l2) { F.l2 = true; storyLine('Tobia: The road only goes one way in this fog. It goes here.'); }
    if (s.t >= 16 && !F.off) { F.off = true; s.eng?.stop(); s.eng = null; c.heads.forEach(h => { h.intensity = 0; h.visible = false; }); c.dashGlow.material.color.set(0x1a1408); }
    yaw += Math.sin(s.t * .5) * .05 * speed;
  } else {
    if (!F.van) { F.van = true; storyRef.van = storyRef.van || buildVan(zones.road.group); storyRef.van.position.set(car.position.x - .6, 0, car.position.z + 11); storyRef.van.visible = true; }
    const back = THREE.MathUtils.smoothstep(s.t, 5, 7.5) - THREE.MathUtils.smoothstep(s.t, 8, 9);
    if (s.t > 5 && s.t < 9) { car.position.z = s.startZ + THREE.MathUtils.smoothstep(s.t, 5, 8.2) * 1.6; F.rpm = 1100 + back * 900; s.eng?.setRpm(F.rpm); }
    yaw += back * 2.6; pitch += back * .05;
    if (s.t >= 5.4 && !F.l1) { F.l1 = true; storyLine('Tobia: I put it in reverse.'); }
    if (s.t >= 7.6 && !F.l2) { F.l2 = true; storyLine('Tobia: Walter’s van is across the lane, headlights on. Nobody is in it. I stay.'); storyFlags.add('lane-blocked'); }
    if (s.t >= 11 && !F.off) { F.off = true; s.eng?.stop(); s.eng = null; c.heads.forEach(h => { h.intensity = 0; h.visible = false; }); }
  }
  camera.rotation.set(pitch, yaw, car.rotation.z * 2);
  updateCarEntry();
  if (s.t >= s.dur) endDrive(s);
}
function endDrive(s) {
  const c = storyRef.tobiaCar; s.eng?.stop();
  if (s.mode === 'lane') { c.at = 'porch'; c.car.position.z = 9; } else { c.car.position.z = s.startZ + 1.6; }
  c.car.rotation.set(0, 0, 0); updateCarEntry(); c.heads.forEach(h => { h.intensity = 0; h.visible = false; });
  storyScene = null; setCinema(false); playerAnchor.position.set(c.car.position.x - 1.9, 0, c.car.position.z + .4); camera.position.set(0, 1.63, 0); camera.rotation.set(-.05, 0, 0); resetLook();
  $('subtitle-wrap').classList.remove('visible');
  if (!storyFlags.has('drove-lane')) { storyFlags.add('drove-lane'); journal.push({ id: 'drove-lane', title: 'The lane', description: 'You tried the car. The engine caught, the radio found only static and the fog, and the lane brought you to the farmhouse door. It is the only place the road goes.', kind: 'witness account', zone: 'road' }); updateJournalCount(); }
}
function buildVan(g) {
  const v = new THREE.Group(); g.add(v);
  const body = roundedHousing(1.9, 1.7, 4.6, .14, mat(0xc8c2b0, .6, { map: TEX.metal }), .04); body.position.y = 1.15; v.add(body);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .6), new THREE.MeshStandardMaterial({ color: 0x1a2224, roughness: .1 })); glass.position.set(0, 1.55, -2.34); glass.rotation.y = Math.PI; v.add(glass);
  for (const [x, z] of [[-.9, 1.5], [.9, 1.5], [-.9, -1.5], [.9, -1.5]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.36, .36, .26, 18), M.black); w.rotation.z = Math.PI / 2; w.position.set(x, .36, z); v.add(w); }
  for (const s of [-1, 1]) { const l = new THREE.SpotLight(0xfff0cc, 70, 30, .45, .5, 1.2); l.position.set(s * .7, .9, -2.35); l.target.position.set(s * .6, 0, -14); v.add(l, l.target); const lens = new THREE.Mesh(new THREE.CircleGeometry(.13, 16), glow(0xfff4d8, 2)); lens.position.set(s * .7, .9, -2.36); lens.rotation.y = Math.PI; v.add(lens); }
  v.rotation.y = Math.PI * .45; v.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return v;
}

// =============================================================================
// v6 — the wall: Corrado and Don Remo planning Dario's Mass, heard clearly but muffled.
// =============================================================================
function cancelHold() { if (storyScene?.type === 'hold') { storyScene = null; clearTimeout(storyLine.timer); if (!dialogueOpen) $('subtitle-wrap').classList.remove('visible'); } }
function startDarioEavesdrop() {
  cancelHold(); if (storyFlags.has('heard-dario-plan') || storyScene || gameEnded) return;
  if (!storyFlags.has('talked-ines') || !storyFlags.has('talked-ottavio')) { showToast('SPEAK WITH INES AND OTTAVIO FIRST.'); return; }
  keys.clear(); activeTarget = null; $('prompt').classList.remove('visible');
  storyScene = { type: 'dario-eavesdrop', t: 0, dur: 31, i: 0, lines: [], li: 0, save: { pos: playerAnchor.position.clone(), rx: camera.rotation.x, ry: camera.rotation.y }, script: [
    [.8, 'Tobia: Voices behind the plaster. Two men. I press my ear to the wall.', 0],
    [4.5, 'Don Remo (through the wall): He asked for the rood beam. Upside down, like Peter. He says he is not worthy to die the right way up.', 1],
    [10.5, 'Il Professore (through the wall): Then let him have it. He believes too much, Remo. Nothing is true; everything is permitted.', 2],
    [16, 'Don Remo (through the wall): A full Mass, then. Every word. He will want to sing.', 1],
    [20, 'Il Professore (through the wall): Until the final hymn. Dario — come in. Tomorrow, after vespers.', 2],
    [24.2, 'Dario (through the wall): Tell me where to stand.', 3],
    [27.4, 'Tobia: I hear all of it. I say nothing. This is the moment I belong.', 0]] };
  setCinema(true);
}
function updateDarioEavesdrop(s, dt) {
  const lean = THREE.MathUtils.smoothstep(s.t, 0, 1.4) * (1 - THREE.MathUtils.smoothstep(s.t, s.dur - 1.2, s.dur));
  playerAnchor.position.lerpVectors(s.save.pos, new THREE.Vector3(-9.1, 0, -5.1), lean);
  camera.position.set(0, 1.63 - lean * .12, 0);
  camera.rotation.set(THREE.MathUtils.lerp(s.save.rx, -.08, lean), THREE.MathUtils.lerp(s.save.ry, Math.PI * .5 + .35, lean), lean * .2);
  while (s.li < s.script.length && s.t >= s.script[s.li][0]) {
    const [t0, text, who] = s.script[s.li]; stationLine(text);
    const next = s.script[s.li + 1]?.[0] ?? s.dur, d = Math.min(4.4, next - t0 - .5);
    if (who) audio?.muffledVoice(d, -.4, who === 3 ? 700 : 520, who === 2 ? .82 : who === 3 ? 1.12 : 1);
    s.li++;
  }
  if (s.t >= 25 && !s.flash) { s.flash = true; flashFragment('collapse', 125); }
  if (s.t >= s.dur) endDarioEavesdrop();
}
function endDarioEavesdrop() {
  const s = storyScene;
  storyFlags.add('heard-dario-plan'); storyFlags.add('complicit');
  journal.push({ id: 'dario-plan', title: 'The Words Through the Wall', description: 'Through the plaster you heard Don Remo and il Professore plan Dario’s Mass: the rood beam, upside down, a full liturgy, “until the final hymn”, tomorrow after vespers. Dario asked where to stand. You could have opened the door. You did not.', kind: 'witness account', zone: 'home' });
  updateJournalCount(); storyScene = null; setCinema(false); $('subtitle-wrap').classList.remove('visible'); $('speaker').classList.remove('through-wall'); $('subtitle').classList.remove('muffled');
  if (s?.save) { playerAnchor.position.copy(s.save.pos); camera.rotation.set(s.save.rx, s.save.ry, 0); }
  camera.position.set(0, 1.63, 0); resetLook();
  showToast('DARIO’S MASS: TOMORROW, AFTER VESPERS — IN THE CHURCH.'); updateMissions();
}

// =============================================================================
// v6 — the cemetery instruction, made legible: lumini lead you there, the roof glints.
// What it costs you depends on the difficulty.
// =============================================================================
function triggerCemeteryAmbushV6() {
  if (gameEnded || storyFlags.has('cemetery-shot')) return;
  storyFlags.add('cemetery-shot'); keys.clear(); activeTarget = null;
  audio?.mechanicalNoise(.16, 1850, 8, .34, -.18); audio?.mechanicalTone(145, 42, .24, 'square', .16, -.18);
  const flash = $('event-flash'); flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 130);
  glitchPulse = Math.max(glitchPulse, 2); camera.rotation.z += .11;
  if (storyRef.lumini) storyRef.lumini.visible = false;
  if (SETTINGS.difficulty === 0) {
    storyLine('Tobia: A crack from the factory roof. A gravestone beside me loses a corner. Nobody fires again.');
    showToast('THE SHOT MISSED. THE MISSING NAME WAS NEVER HERE — HE SENT YOU TO BE SEEN.'); fear = Math.min(1, fear + .3); updateMissions(); return;
  }
  if (SETTINGS.difficulty === 1) {
    audio?.killSting(); fear = 1; $('intro-dark').style.transition = 'opacity .25s linear'; $('intro-dark').style.opacity = '1';
    storyScene = { type: 'hold', t: 0, dur: 3.2, i: 0, lines: [], skippable: false };
    setTimeout(() => { enterZone('road', [0, 0, -2]); camera.rotation.set(0, 0, 0); resetLook(); $('intro-dark').style.transition = 'opacity 2.4s linear'; $('intro-dark').style.opacity = '0'; storyScene = null;
      storyLine('Ines: Hold still. It only grazed you. Did you think he would send you somewhere to find a name?'); showToast('THE BULLET GRAZED YOU. INES FOUND YOU AT THE GATE.'); updateMissions(); }, 2400);
    return;
  }
  dialogueOpen = true; controls.unlock();
  $('speaker').textContent = 'THE FACTORY ROOF'; $('subtitle').textContent = 'A rifle cracks from the factory roof. You feel the impact before the echo reaches the cemetery.'; $('subtitle-wrap').classList.add('visible'); audio?.killSting();
  setTimeout(() => { dialogueOpen = false; $('subtitle-wrap').classList.remove('visible'); triggerDeath('SHOT IN THE CEMETERY', 'You followed il Professore’s instruction to the cemetery beside the factory. The glint on the roof was a rifle scope. The missing name was never there.'); }, 820);
}

// =============================================================================
// v6 — pursuers that move (difficulty 1+). He walks when you are not looking.
// =============================================================================
function enemyContact(kind, onReset) {
  if (lethalContact()) { triggerDeath(kind === 'forest' ? 'THE FOREST KEPT YOU' : 'IL PROFESSORE HAS FOUND YOU', 'He was already beside you. The recording continues for eleven seconds after the body has stopped.'); return true; }
  jumpscare(); fear = Math.min(1, fear + .3); glitchPulse = 1.4; showToast('HE TOUCHED YOUR SLEEVE AND WAS GONE. NEXT TIME HE WILL NOT LET GO.'); onReset?.(); return false;
}
function moveStalker(dt) {
  if (noEnemies() || !stalker?.visible || stalkerZone !== currentZone || !playerInputEnabled()) return;
  const p = playerAnchor.position, dx = p.x - stalker.position.x, dz = p.z - stalker.position.z, d = Math.hypot(dx, dz) || .001;
  camera.getWorldDirection(camDir2); const len = Math.hypot(camDir2.x, camDir2.z) || 1;
  const seen = (-(camDir2.x * dx + camDir2.z * dz) / (len * d)) > .62;
  stalker.rotation.y = Math.atan2(dx, dz);
  if (!seen && d > 1.0) {
    const step = enemySpeed() * (1 + fear * .35) * dt, nx = stalker.position.x + dx / d * step, nz = stalker.position.z + dz / d * step;
    const hit = (x, z) => zone.solids.some(o => x + .3 > o.minX && x - .3 < o.maxX && z + .3 > o.minZ && z - .3 < o.maxZ);
    if (!hit(nx, stalker.position.z)) stalker.position.x = nx; if (!hit(stalker.position.x, nz)) stalker.position.z = nz;
  }
  storyRef.stalkerCooldown = Math.max(0, (storyRef.stalkerCooldown || 0) - dt);
  if (d < 1.15 && storyRef.stalkerCooldown <= 0) { storyRef.stalkerCooldown = 6; enemyContact('room', () => placeStalker(currentZone)); }
}
function moveChaser(dt) {
  if (noEnemies() || currentZone !== 'forest' || !chaseState || !storyRef.chaser?.visible) return;
  const ch = storyRef.chaser, p = playerAnchor.position, dx = p.x - ch.position.x, dz = p.z - ch.position.z, d = Math.hypot(dx, dz) || .001;
  const step = enemySpeed() * 1.7 * dt; ch.position.x += dx / d * step; ch.position.z += dz / d * step; ch.rotation.y = Math.atan2(dx, dz);
}

// =============================================================================
// v6 — the ending. The choice is made once; a last Pastorale (the farmhouse in fog,
// headlights on the road, a door opening) plays once; then the result card stays.
// =============================================================================
let finaleStarted = false;
function finaleThenV6(choice) {
  if (finaleStarted) return; finaleStarted = true;
  document.querySelectorAll('.ending-choice').forEach(b => { b.disabled = true; });
  $('ending-screen').classList.remove('active');
  if (storyScene) storyScene = null;
  viewZone('road'); zones.forest.group.visible = false;
  const stranger = buildCar(); stranger.position.set(-1.6, 0, 62); stranger.rotation.y = 0; zones.road.group.add(stranger);
  const beams = []; for (const sx of [-1, 1]) { const l = new THREE.SpotLight(0xfff2d0, 0, 46, .4, .5, 1.1); l.position.set(sx * .62, .72, -1.95); l.target.position.set(sx * .6, -.3, -18); stranger.add(l, l.target); beams.push(l); }
  const door = zones.road.interactables.find(i => i.destination === 'home');
  storyScene = { type: 'finale', t: 0, dur: 30, i: 0, choice, stranger, beams, door, skippable: true, lines: [
    [1.2, 'Voice: The last Pastorale. The farmhouse in fog. The fog does not lift.'],
    [8.5, 'Ines: Someone is coming up the lane. Set another place.'],
    [14.5, 'Tobia: Headlights. A stranger who listens too well.'],
    [20.5, 'Tobia: I open the door.']] };
  setCinema(true);
}
function updateFinaleV6(s, dt) {
  const k = THREE.MathUtils.smoothstep(s.t, 0, s.dur);
  playerAnchor.position.set(0, 0, 0); camera.position.set(.6, 1.7, 15 - k * 3.5); camera.lookAt(0, 2.4, -10);
  if (scene.fog) scene.fog.density = .03 - k * .008;
  const drive = THREE.MathUtils.smoothstep(s.t, 9, 21); s.stranger.position.z = 62 - drive * 46; s.beams.forEach(b => b.intensity = s.t > 9 ? 80 : 0);
  if (s.door?.doorPivot) s.door.doorPivot.rotation.y = -1.1 * THREE.MathUtils.smoothstep(s.t, 20.5, 23);
  if (s.t >= 20.5 && !s.light) { s.light = true; const spill = new THREE.PointLight(0xffc27a, 30, 14, 1.6); spill.position.set(0, 1.4, -7.6); zones.road.group.add(spill); s.spill = spill; }
  const white = $('finale-white'); if (white) white.style.opacity = String(THREE.MathUtils.clamp((s.t - 25) / 4, 0, 1));
  if (s.t >= s.dur) {
    storyScene = null; setCinema(false);
    resolveEnding(s.choice); $('ending-screen').classList.add('active');
    setTimeout(() => { if (white) white.style.opacity = '0'; }, 900);
  }
}

// =============================================================================
// v6 — per-frame upkeep for the new systems.
// =============================================================================
function updateShadowRig() {
  const z = zone; if (!z?.moon?.castShadow) return;
  const p = currentPosition(), snap = 60 / 2048, o = z.moon.userData.offset;
  const x = Math.round(p.x / snap) * snap, zz = Math.round(p.z / snap) * snap;
  z.moon.position.set(x + o.x, o.y, zz + o.z); z.moon.target.position.set(x, 0, zz); z.moon.target.updateMatrixWorld();
}
function v6Tick(dt, t) {
  updateLamps(t); updateSmoke(dt, t); updateChoirEgg(dt); updateShadowRig();
  if (gameStarted && !gameEnded) tickStationQueue(dt);
  // Dario's Mass begins the next time you enter the church after hearing it planned.
  if (currentZone === 'church' && storyFlags.has('heard-dario-plan') && !storyFlags.has('station-dario') && (!storyScene || storyScene.type === 'hold') && !(storyRef.stationQueue || []).includes('dario')) queueStation('dario', true);
  // The refrigerator hum (a flat B) is audible across the kitchen.
  if (audio?.ctx && audio.ready) {
    if (!storyRef.fridgeHum) {
      const o = audio.ctx.createOscillator(), o2 = audio.ctx.createOscillator(), g = audio.ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = 116.5; o2.type = 'sine'; o2.frequency.value = 233; const lp = audio.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; g.gain.value = 0;
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(audio.master); o.start(); o2.start(); storyRef.fridgeHum = g;
    }
    let v = 0; if (currentZone === 'home' && storyRef.fridge) { const p = currentPosition(); const d = Math.hypot(p.x + 6, p.z + 8.3); v = .05 / (1 + d * .45); }
    storyRef.fridgeHum.gain.setTargetAtTime(v, audio.ctx.currentTime, .3);
  }
  // Lumini and the scope glint appear only while the cemetery instruction stands.
  const bait = storyFlags.has('cemetery-bait') && !storyFlags.has('cemetery-shot');
  if (storyRef.lumini) storyRef.lumini.visible = bait;
  if (storyRef.scopeGlint) storyRef.scopeGlint.material.opacity = bait && currentZone === 'road' && !noEnemies() ? Math.max(0, Math.sin(t * .0021)) ** 12 * .95 : 0;
  if (storyRef.ruinDust && currentZone === 'ruin') { const a = storyRef.ruinDust.geometry.attributes.position; for (let i = 0; i < a.count; i++) { a.array[i * 3 + 1] -= dt * .03; a.array[i * 3] += Math.sin(t * .0004 + i) * dt * .03; if (a.array[i * 3 + 1] < 0) a.array[i * 3 + 1] = 3.4; } a.needsUpdate = true; }
  // Muffled voices leak through the kitchen wall once you are allowed to listen.
  if (currentZone === 'home' && storyFlags.has('talked-ines') && storyFlags.has('talked-ottavio') && !storyFlags.has('heard-dario-plan') && !storyScene && audio?.ready) {
    storyRef.wallHint = (storyRef.wallHint || 0) - dt; const p = currentPosition();
    if (storyRef.wallHint <= 0 && Math.hypot(p.x + 9.5, p.z + 5.1) < 7) { storyRef.wallHint = 5 + Math.random() * 4; audio.muffledVoice(1.6, -.6, 420, .85); }
  }
  moveStalker(dt); moveChaser(dt);
}
if (TEST_MODE) window.__epi = { zones, storyFlags, collected, journal, cultRoster, storyRef, enterZone, startStation, queueStation, camera, playerAnchor, SETTINGS, startDrive, startDarioEavesdrop, startChoirEgg, revealEndingChoices, beginListening, finishListening, finaleThenV6, collectClue, get scene() { return storyScene; }, set scene(v) { storyScene = v; }, skip: () => skipStoryScene(), startGame: () => startGame() };

updateProgress();
requestAnimationFrame(loop);
