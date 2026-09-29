/**
 * The environment kit (models/environment.glb, docs/ASSETS.md) stands in for
 * these layout names. Each model is normalised to the size the older model
 * had, so the layout's canopy widths and the scaling in buildInstances hold.
 * `keep` leaves a variant on the older model: the snowy pines.
 */
export const ENVIRONMENT = {
  t_oak: { models: ['env_tree_oak_a', 'env_tree_oak_b', 'env_tree_oak_c'], height: 8.4 },
  t_pine: { models: ['env_tree_pine_a', 'env_tree_pine_b', 'env_tree_pine_c'], height: 9, keep: (v) => v === 1 },
  t_spruce: { models: ['env_tree_pine_a', 'env_tree_pine_b', 'env_tree_pine_c'], height: 9.6, keep: (v) => v === 1 },
  b_bush: { models: ['env_shrub_round_a', 'env_shrub_round_b', 'env_shrub_round_c'], width: 2.8 },
  r_rock: { models: ['env_rock_boulder_a', 'env_rock_boulder_b', 'env_rock_boulder_c', 'env_rock_boulder_d'], width: 2.6 },
  g_tuft: { models: ['env_grass_tuft_a', 'env_grass_tuft_b', 'env_grass_tuft_c'], width: 1.1 },
  f_fence: { models: ['env_fence_straight_a'] }
};
