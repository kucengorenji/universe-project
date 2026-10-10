// The 2D town planner overlay (layout variants and density).
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import { generateTownLayout } from '../layout/townLayout.js';
import { townPlanVersion, saveTownPlanChoice, townHasSavedRooms, townHasSavedHomes } from '../../../world/townGeneration.js';
import { TownPlanner } from '../planner/townPlanner.js';
import { t as tr } from '../../../i18n/index.js';

export class PlannerMethods {
  /** The 2D town planner (diorama view only). Applying rebuilds this mode with the chosen plan. */
  openPlanner() {
    if (this.planner || this.view !== 'diorama' || this.tween || this.transfer || this.interior) return;
    const { world, director } = this.ctx;
    if (townHasSavedHomes(world.state, this.route.planet, this.townSeed)) {
      this.showHomeMessage(tr('town.plan.locked'));
      return;
    }
    const planet = this.route.planet;
    this.planner = new TownPlanner({
      name: this.city.name,
      layout: this.layout,
      choice: { variant: this.plan.variant, density: this.plan.density },
      footprints: this.footprints,
      generate: (choice) => generateTownLayout({ ...this.genArgs, layoutVersion: townPlanVersion(world.state, planet, this.townSeed, choice), variant: choice.variant, options: { density: choice.density } }),
      hasRooms: (layout) => townHasSavedRooms(world.state, planet, layout.seed),
      onApply: (choice) => {
        saveTownPlanChoice(world.state, planet, this.townSeed, choice);
        director.go({ ...this.route });
      },
      onClose: () => this.closePlanner()
    });
  }

  closePlanner() {
    this.planner?.dispose();
    this.planner = null;
  }
}
