import { seedFor } from './identity.js';

// Planet context decides whether relief exists; seed only chooses its form.
// Long wavelengths bound street grades and preserve the coastal water datum.
export function describeRelief(tiles, cityR, seed) {
 const nearby=tiles.filter(t=>Math.hypot(t.x,t.z)<cityR+180);
 const mountains=nearby.filter(t=>t.mountain || t.biome==='mountain');
 const enabled=mountains.length>0 && seedFor(seed,'relief-enabled')%4!==0;
 const sum=mountains.reduce((v,t)=>[v[0]+t.x,v[1]+t.z],[0,0]);
 return { enabled, amplitude: enabled?8+seedFor(seed,'relief-height')%7:0, axis:Math.atan2(sum[1],sum[0]), wavelength:Math.max(260,cityR*2) };
}
export function townSurfaceHeight(relief,x,z,land=1) {
 if(!relief?.enabled)return 1.1;
 const u=x*Math.cos(relief.axis)+z*Math.sin(relief.axis);
 const coast=Math.max(0,Math.min(1,(land-.7)/.3));
 return 1.1+relief.amplitude*(.5+.5*Math.sin(u/relief.wavelength))*coast*coast;
}
