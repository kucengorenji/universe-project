// The mission checklists, as data only: the game (missions.js) and the
// dashboard (dashboard/) both read them. Labels live in the i18n files under
// mission.<id>.title / mission.<id>.<item>.
export const MISSIONS = [
  {
    id: 'home',
    items: [
      { id: 'enter', event: 'enter_house' },
      { id: 'sit', event: 'sit' },
      { id: 'light', event: 'light_on' },
      { id: 'fridge', event: 'open' },
      { id: 'apple', event: 'pickup_apple' },
      { id: 'sleep', event: 'sleep' }
    ]
  },
  {
    id: 'cozy',
    items: [
      { id: 'tv', event: 'media_on' },
      { id: 'fire', event: 'fire_on' },
      { id: 'book', event: 'pickup_book' },
      { id: 'place', event: 'place_item' }
    ]
  },
  {
    id: 'explorer',
    items: [
      { id: 'land3', event: 'land', distinct: 3 },
      { id: 'town', event: 'visit_town' },
      { id: 'drive', event: 'drive_m', total: 1000 },
      { id: 'jack', event: 'carjack' }
    ]
  },
  {
    id: 'pilot',
    items: [
      { id: 'boost', event: 'boost' },
      { id: 'hangar', event: 'hangar' },
      { id: 'orbit3', event: 'orbit', distinct: 3 },
      { id: 'rover', event: 'rover_m', total: 1000 }
    ]
  }
];
