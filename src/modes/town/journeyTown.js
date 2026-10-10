import { chooseStarterHome, findStarterDoor } from '../../world/starterHome.js';
import { TownWaypoint } from './ui/waypoint.js';
import { t } from '../../i18n/index.js';
import { registerProof } from '../../core/proofMetrics.js';

// What the town does for the First Journey: settles which house is the starter house
// (once per world), tells the journey how far the door is, shows the marker while it is
// useful, and hands the interior's events to the journey. TownMode only calls in here.

const ITEM_NAMES = ['it_apple', 'it_book', 'it_cup', 'it_candle'];
export const itemLabel = (asset) => t(ITEM_NAMES.includes(asset) ? `interior.item.${asset}` : 'interior.item.other');

export class TownJourney {
  constructor({ journey, planet, city, scene, ui, layout, doors, walkNetwork, groundAt, minimap, reducedMotion = false, makeWaypoint = (options) => new TownWaypoint(options) }) {
    this.journey = journey;
    this.minimap = minimap;
    this.groundAt = groundAt;
    this.inHomeTown = planet === journey.homePlanet && city === journey.homeCity;
    this.door = null;
    this.waypoint = null;
    this.lastView = null;
    if (this.inHomeTown) {
      let home = journey.home;
      if (!home) {
        home = chooseStarterHome({ doors, walkNetwork, spawn: layout.spawn });
        journey.setHome(home);
      }
      const found = home ? findStarterDoor(home, doors, walkNetwork) : null;
      if (found) this.door = { x: found.x, z: found.z, outYaw: found.outYaw, buildingId: found.b.id };
      else journey.markHomeLost();
    }
    journey.setView({ mode: 'town', view: 'diorama', inHomeTown: this.inHomeTown, holding: undefined,
      door: this.door && { x: this.door.x, y: groundAt(this.door.x, this.door.z), z: this.door.z, buildingId: this.door.buildingId } });
    if (this.door) {
      this.waypoint = makeWaypoint({ scene, parent: ui, groundAt, reducedMotion });
      this.waypoint.setTarget(this.door);
      this.unregister = registerProof('beacon', () => ({ ...this.waypoint.metrics(), active: this.active, door: { ...this.door } }));
    }
  }

  /** The marker is useful from J3 until the player is inside, and again when they have come back for the check (J6). */
  get active() {
    const j = this.journey;
    return !!this.door && !j.done && (j.stage === 'j3' || j.stage === 'j4' || (j.stage === 'j6' && j.away));
  }

  /** Every frame outside a building. `pos` is the player, or the car being driven. */
  update(time, { pos, view, camera, night = 0 }) {
    if (view !== this.lastView) {
      this.lastView = view;
      this.journey.setView({ view });
    }
    if (!this.door) return;
    if (pos) this.journey.near(Math.hypot(pos.x - this.door.x, pos.z - this.door.z)); // the diorama has no one standing anywhere
    const active = this.active;
    this.waypoint?.setNight(night);
    this.waypoint?.update(time, { camera, active });
    this.minimap?.setPin(active ? this.door : null);
  }

  /** A room opened: the outdoor marker goes quiet and the journey checks the saved room. */
  opened(buildingId, floors, lights) {
    this.waypoint?.update(0, { camera: null, active: false });
    this.minimap?.setPin(null);
    this.journey.setView({ mode: 'interior', holding: undefined, lights });
    this.journey.enterHome({ buildingId, floors });
  }

  closed() {
    this.journey.setView({ mode: 'town', holding: undefined, lights: undefined });
  }

  /** The player used something in a room; `before`/`after` are interior snapshots around the action. */
  used({ buildingId, floor, before, after, holding, lights }) {
    this.journey.setView({ holding: holding ? itemLabel(holding.asset) : undefined, lights });
    return this.journey.changed({ buildingId, floor, before, after });
  }

  dispose() {
    this.unregister?.();
    this.waypoint?.dispose();
    this.minimap?.setPin(null);
  }
}
