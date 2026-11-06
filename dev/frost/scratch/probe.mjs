import RAPIER from '@dimforge/rapier2d-compat';
let t=performance.now(); await RAPIER.init(); console.log('init ms', performance.now()-t);
const w = new RAPIER.World({x:0,y:9.8});
const sb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const vc = w.createCollider(RAPIER.ColliderDesc.voxels(new Int32Array([0,0, 1,0, 2,0]), {x:0.05,y:0.05}), sb);
// ray cast from above x=0.025 downward and from left
w.step(); const r = new RAPIER.Ray({x:0.025,y:-1},{x:0,y:1});
let h = w.castRay(r, 10, true); console.log('ray hit toi', h && h.timeOfImpact);
h = w.castRay(new RAPIER.Ray({x:-1,y:0.025},{x:1,y:0}), 10, true); console.log('left hit', h&&h.timeOfImpact);
h = w.castRay(new RAPIER.Ray({x:0.075,y:-1},{x:0,y:1}), 10, true); console.log('x=.075', h&&h.timeOfImpact);
vc.setVoxel(100,100,true); vc.setVoxel(2,0,false); w.step();
h = w.castRay(new RAPIER.Ray({x:0.125,y:-1},{x:0,y:1}), 10, true); console.log('x=.125 after removal', h&&h.timeOfImpact);
h = w.castRay(new RAPIER.Ray({x:5.025,y:-1},{x:0,y:1}), 10, true); console.log('x=5.025', h&&h.timeOfImpact);
console.log(Object.keys(RAPIER.World.prototype).slice(0,5), typeof w.integrationParameters);
const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,-1).setCcdEnabled(true));
console.log(rb.translation(), rb.rotation(), rb.linvel(), rb.angvel());
