import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_DT, MAX_FRAME_DELTA, advanceBiome, applyGust, applyRain, averageMoisture,
  createBiome, getGeometrySignature, gustInfluenceAt, gustVectorAt, loadSnapshot,
  moistureAt, normalizeOptions, plantBend, resetBiome, saveSnapshot, setDensity,
  setPaused, setSeason, setTimeOfDay, setWind, stepBiome
} from '../src/simulation.js';
import {
  backingStoreSize, beginPointerSession, cancelPointerSession, clientToBiomePoint,
  createPointerSession, endPointerSession, movePointerSession, resetPointerSession
} from '../src/interaction.js';

function simulate(world, seconds, fps = 60) {
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) advanceBiome(world, 1 / fps);
  return world;
}
function meanGrowth(world, ids = null) {
  const allowed = ids ? new Set(ids) : null;
  const list = world.plants.filter(p => !allowed || allowed.has(p.id));
  return list.reduce((sum, p) => sum + p.growth, 0) / list.length;
}
function variance(values) {
  const list = Array.from(values);
  const mean = list.reduce((a,b)=>a+b,0)/list.length;
  return list.reduce((s,v)=>s+(v-mean)**2,0)/list.length;
}

test('deterministic initialization and vegetation variation', () => {
  const options = { seed:'same', density:1800, wind:0.4, season:'summer', timeOfDay:18.25 };
  const a = createBiome(options), b = createBiome(options);
  assert.deepEqual(saveSnapshot(a), saveSnapshot(b));
  assert.equal(a.plants.length, 1800);
  assert.deepEqual(new Set(a.plants.map(p=>p.species)), new Set(['grass','flower','stem']));
  assert.ok(new Set(a.plants.slice(0,100).map(p=>`${p.baseHeight}:${p.width}:${p.phase}`)).size > 95);
});

test('30/60/120 FPS frame chunking is equivalent with evolving plant physics', () => {
  function run(fps) {
    const w = createBiome({seed:'chunk', density:220, wind:0.52});
    applyRain(w, .34, .72, 1.1, .13);
    applyGust(w, .42, .69, 1.05, 1, -.12);
    simulate(w, 2, fps);
    return saveSnapshot(w);
  }
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(60), run(120));
});

test('large stalls are bounded and explicitly report dropped wall time', () => {
  const w = createBiome({density:80});
  const r = advanceBiome(w, 8);
  assert.equal(r.acceptedDelta, MAX_FRAME_DELTA);
  assert.equal(r.droppedDelta, 8 - MAX_FRAME_DELTA);
  assert.equal(r.steps, Math.round(MAX_FRAME_DELTA / FIXED_DT));
});

test('pause freezes all evolving simulation state and preserves substep carry', () => {
  const w = createBiome({seed:'pause', density:120});
  advanceBiome(w, FIXED_DT/2);
  applyGust(w,.5,.7,1,1,0); applyRain(w,.5,.7,1,.12);
  setPaused(w,true);
  const frozen = saveSnapshot(w);
  advanceBiome(w, 10);
  assert.deepEqual(saveSnapshot(w), frozen);
  setPaused(w,false);
  advanceBiome(w, FIXED_DT/2);
  assert.equal(w.tick, 1);
});

test('growth starts as sprouts and moisture accelerates local growth', () => {
  const dry = createBiome({seed:'growth', density:360, season:'spring'});
  const wet = createBiome({seed:'growth', density:360, season:'spring'});
  assert.ok(meanGrowth(dry) < .14);
  const ids = wet.plants.filter(p=>Math.hypot(p.x-.5,p.y-.72)<.16).map(p=>p.id);
  applyRain(wet,.5,.72,1.5,.2);
  simulate(dry,6,60); simulate(wet,6,60);
  assert.ok(meanGrowth(wet, ids) > meanGrowth(dry, ids) + .035);
});

test('ambient wind evolves per-plant spring state rather than synchronized transforms', () => {
  const w = createBiome({seed:'wind', density:160, wind:1});
  const initial = w.plants.slice(0,20).map(p=>plantBend(w,p));
  simulate(w,.8,120);
  const bends = w.plants.slice(0,20).map(p=>plantBend(w,p));
  assert.ok(new Set(bends.map(v=>v.toFixed(5))).size > 12);
  assert.ok(bends.some((v,i)=>Math.abs(v-initial[i])>.02));
  assert.ok(w.plants.some(p=>Math.abs(p.bendVelocity)>.005));
});

test('local gust is directional, spatial, propagating, decaying and removable', () => {
  const w = createBiome({seed:'gust', density:500, wind:0});
  applyGust(w,.5,.7,1.2,1,-.15);
  assert.ok(gustInfluenceAt(w,.5,.7)>.6);
  assert.equal(gustInfluenceAt(w,.05,.08),0);
  assert.ok(gustVectorAt(w,.5,.7).y<0);
  const initial = {...w.gusts[0]};
  simulate(w,.8,120);
  assert.ok(w.gusts[0].x>initial.x && w.gusts[0].radius>initial.radius && w.gusts[0].strength<initial.strength);
  simulate(w,3,120);
  assert.equal(w.gusts.length,0);
});

test('gust drives nearby plant spring state more than distant plants and meadow settles', () => {
  const w = createBiome({seed:'spring-gust', density:1200, wind:0});
  const near = w.plants.reduce((best,p)=>Math.hypot(p.x-.5,p.y-.7)<best.d?{p,d:Math.hypot(p.x-.5,p.y-.7)}:best,{p:null,d:Infinity}).p;
  const far = w.plants.reduce((best,p)=>Math.hypot(p.x-.05,p.y-.4)<best.d?{p,d:Math.hypot(p.x-.05,p.y-.4)}:best,{p:null,d:Infinity}).p;
  const nearBase = near.lean*.08, farBase = far.lean*.08;
  applyGust(w,.5,.7,1.4,1,0);
  simulate(w,.45,120);
  assert.ok(Math.abs(near.bend-nearBase) > Math.abs(far.bend-farBase) + .02);
  simulate(w,5,120);
  assert.equal(w.gusts.length,0);
  assert.ok(Math.abs(near.bend-nearBase)<.08);
});

test('rain is local and moisture diffuses/evaporates', () => {
  const w = createBiome({seed:'rain', density:100, season:'summer'});
  const nearBefore=moistureAt(w,.5,.7), farBefore=moistureAt(w,.05,.05);
  applyRain(w,.5,.7,1.25,.11);
  assert.ok(moistureAt(w,.5,.7)>nearBefore+.25);
  assert.equal(moistureAt(w,.05,.05),farBefore);
  const v=variance(w.moisture.cells), avg=averageMoisture(w);
  simulate(w,6,120);
  assert.ok(variance(w.moisture.cells)<v);
  assert.ok(averageMoisture(w)<avg);
});

test('snapshot is deep, restores plant physics, and continuation stays deterministic', () => {
  const w = createBiome({seed:'snap', density:140, wind:.42});
  applyRain(w,.4,.75,1,.1); applyGust(w,.5,.7,1.1,1,0); simulate(w,1.1,60);
  const snapshot=saveSnapshot(w), preserved=structuredClone(snapshot);
  w.plants[0].growth=.999; w.plants[0].bend=.9; w.moisture.cells[0]=1.4; w.gusts[0].strength=.01;
  assert.deepEqual(snapshot,preserved);
  const a=loadSnapshot(snapshot), b=loadSnapshot(snapshot);
  assert.deepEqual(saveSnapshot(a),snapshot);
  a.plants[0].bend=.7;
  assert.notEqual(a.plants[0].bend,snapshot.plants[0].bend);
  a.plants[0].bend=snapshot.plants[0].bend;
  applyGust(a,.62,.68,.85,1,.05); applyGust(b,.62,.68,.85,1,.05);
  simulate(a,1.8,30); simulate(b,1.8,120);
  assert.deepEqual(saveSnapshot(a),saveSnapshot(b));
});

test('reset baseline, new seed geometry, and minor controls preserve geometry', () => {
  const w=createBiome({seed:'geometry', density:220, wind:.6, season:'autumn', timeOfDay:21});
  const geometry=getGeometrySignature(w);
  setSeason(w,'winter'); setTimeOfDay(w,2.5); setWind(w,.9);
  assert.deepEqual(getGeometrySignature(w),geometry);
  applyRain(w,.5,.7,1.4,.13); simulate(w,1,60);
  assert.deepEqual(saveSnapshot(resetBiome(w)),saveSnapshot(createBiome(w.options)));
  assert.notDeepEqual(getGeometrySignature(createBiome({seed:'a',density:220})),getGeometrySignature(createBiome({seed:'b',density:220})));
});

test('density changes actual population while preserving surviving object/state identity', () => {
  const w=createBiome({seed:'density', density:300}); simulate(w,.5,60);
  const saved=new Map(w.plants.slice(0,40).map(p=>[p.id,p]));
  setDensity(w,1800);
  assert.equal(w.plants.length,1800);
  for(const [id,p] of saved) assert.equal(w.plants.find(c=>c.id===id),p);
});

test('high-density world remains structurally valid and effects remain bounded', () => {
  const w=createBiome({seed:'dense',density:2400});
  for(let i=0;i<80;i++){applyGust(w,(i%10)/10,.7,.8,1,0);applyRain(w,(i%12)/12,.72,.7,.08);}
  assert.equal(w.plants.length,2400);
  assert.equal(new Set(w.plants.map(p=>p.id)).size,2400);
  assert.ok(w.gusts.length<=24 && w.rainBursts.length<=20);
  const first=w.plants[0]; stepBiome(w,.25); assert.equal(w.plants[0],first);
});

test('snapshot rejects deterministic identity and clock corruption', () => {
  const s=saveSnapshot(createBiome({seed:'integrity',density:90}));
  const wrongSeed=structuredClone(s); wrongSeed.seedHash=(wrongSeed.seedHash+1)>>>0;
  assert.throws(()=>loadSnapshot(wrongSeed),/deterministic identity/);
  const wrongClock=structuredClone(s); wrongClock.time=FIXED_DT;
  assert.throws(()=>loadSnapshot(wrongClock),/simulation clock/);
});

test('options clamp zero and high values correctly', () => {
  assert.deepEqual(normalizeOptions({density:0,wind:0,timeOfDay:0,season:'bad'}),{seed:'meadow-42',density:60,wind:0,season:'spring',timeOfDay:0});
  const hi=normalizeOptions({density:9999,wind:4,timeOfDay:99});
  assert.equal(hi.density,2400); assert.equal(hi.wind,1); assert.equal(hi.timeOfDay,24);
});

test('CSS coordinates remain DPR-independent and follow latest layout rect', () => {
  const rect={left:100,top:50,width:400,height:200};
  assert.deepEqual(clientToBiomePoint(rect,300,150),{x:.5,y:.5});
  assert.deepEqual(backingStoreSize(400,200,2.5),{width:1000,height:500,dpr:2.5});
  const resized={left:20,top:10,width:200,height:400};
  assert.deepEqual(clientToBiomePoint(resized,120,210),{x:.5,y:.5});
});

test('pointer lifecycle handles movement, up, cancellation, second pointers and forced reset', () => {
  const s=createPointerSession();
  assert.ok(beginPointerSession(s,7,'wind',{x:.2,y:.7}));
  assert.equal(beginPointerSession(s,8,'rain',{x:.7,y:.7}),null);
  const a=movePointerSession(s,7,{x:.28,y:.66});
  assert.ok(a.dx>0 && a.dy<0 && a.intensity>.38);
  assert.equal(endPointerSession(s,8),false);
  assert.equal(cancelPointerSession(s,7),true);
  assert.equal(s.active,false);
  beginPointerSession(s,9,'rain',{x:.3,y:.7});
  assert.equal(resetPointerSession(s),true);
  assert.equal(movePointerSession(s,9,{x:.4,y:.7}),null);
});
