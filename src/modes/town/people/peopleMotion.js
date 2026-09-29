import * as THREE from 'three';

const clipCache=new WeakMap();
export function locomotionClips(gltf){
  if(clipCache.has(gltf))return clipCache.get(gltf);
  const q=new THREE.Quaternion();
  const clips=gltf.animations.map(source=>{
    if(!['walk','run','panic'].includes(source.name))return source;
    const clip=source.clone();
    for(const track of clip.tracks){
      const split=track.name.lastIndexOf('.'),name=track.name.slice(0,split),property=track.name.slice(split+1),bone=gltf.scene.getObjectByName(name);
      if(!bone)continue;
      const factor=/arm/.test(name)? .72 : /shin/.test(name)? .84 : /spine|head/.test(name)? .72 : 1;
      if(property==='quaternion'&&factor<1)for(let i=0;i<track.values.length;i+=4){q.fromArray(track.values,i).slerp(bone.quaternion,1-factor).toArray(track.values,i);}
      if(name==='hips'&&property==='position')for(let i=0;i<track.values.length;i+=3)for(let a=0;a<3;a++)track.values[i+a]=bone.position.getComponent(a)+(track.values[i+a]-bone.position.getComponent(a))*.7;
    }
    return clip;
  });
  clipCache.set(gltf,clips);return clips;
}

/** Blend idle / walk / run (or panic) from a speed; or hold one pose (sit, sleep, drive). */
export function animatePerson(p, dt, speed, { panic = false, pose = null } = {}) {
  const A = p.actions;
  const sm = THREE.MathUtils.smoothstep;
  const set = (name, w) => A[name] && A[name].setEffectiveWeight(w);
  if (pose && A[pose]) {
    for (const k of Object.keys(A)) set(k, k === pose ? 1 : 0);
  } else {
    p.animSpeed+=(Math.max(0,speed)-p.animSpeed)*(1-Math.exp(-dt*12));
    speed=p.animSpeed;
    const idle = 1 - sm(speed, 0.1, 0.9);
    const run = sm(speed, 2.8, 4.6);
    const walk = Math.max(0, 1 - idle - run);
    set('idle', idle);
    set('walk', walk);
    set('run', panic ? 0 : run);
    set('panic', panic ? run : 0);
    set('sit', 0);
    set('sleep', 0);
    set('drive', 0);
    // Walk/run share a contact phase while blending, instead of the legs from
    // two unrelated clip clocks cancelling each other out at jogging speed.
    const stride=THREE.MathUtils.lerp(1.45,3.45,run)*p.root.scale.y;
    p.gaitPhase=(p.gaitPhase+dt*speed/stride)%1;
    for(const name of ['walk','run','panic'])if(A[name]){A[name].setEffectiveTimeScale(0);A[name].time=p.gaitPhase*A[name].getClip().duration;}
  }
  p.mixer.update(dt);
}

