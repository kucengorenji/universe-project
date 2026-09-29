/** Release only person-owned resources; outfit meshes and face atlases are shared. */
export function disposePerson(person) {
  if (!person || person.disposed) return;
  person.disposed = true;
  person.mixer.stopAllAction();
  person.mixer.uncacheRoot(person.root);
  const skeletons = new Set();
  person.root.traverse(node => { if (node.skeleton) skeletons.add(node.skeleton); });
  skeletons.forEach(skeleton => skeleton.dispose());
  person.personalMaterial?.dispose();
  person.root.removeFromParent();
}
