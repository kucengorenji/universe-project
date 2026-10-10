export const GOODS = ['wheat', 'bread', 'wood', 'stone', 'ore', 'tools'];
export const PRICE = { wheat: 250, bread: 1000, wood: 500, stone: 450, ore: 650, tools: 2200 };
export const ICONS = { wheat: '◍', bread: '◒', wood: '▥', stone: '◆', ore: '⬟', tools: '⚒' };
export const LIMITS = { cities: 12, routes: 24, vehicles: 64 };
export const FACILITIES = {
  farm: { cost: 12000, materials: { wood: 5, stone: 2 }, seconds: 15, output: { wheat: 2 }, cycle: 15, upkeep: 100, asset: 'wheat' },
  bakery: { cost: 16000, materials: { wood: 8, stone: 4, tools: 1 }, seconds: 15, input: { wheat: 3 }, output: { bread: 2 }, cycle: 30, upkeep: 300, asset: 'windmill' },
  logging: { cost: 14000, materials: { wood: 4, stone: 2 }, seconds: 15, output: { wood: 2 }, cycle: 30, upkeep: 150, asset: 'barn' },
  quarry: { cost: 18000, materials: { wood: 6, tools: 1 }, seconds: 20, output: { stone: 2 }, cycle: 30, upkeep: 150, asset: 'barn' },
  mine: { cost: 22000, materials: { wood: 8, stone: 4, tools: 2 }, seconds: 25, output: { ore: 2 }, cycle: 30, upkeep: 200, asset: 'tower' },
  workshop: { cost: 26000, materials: { wood: 8, stone: 6, tools: 2 }, seconds: 25, input: { ore: 1, wood: 1 }, output: { tools: 1 }, cycle: 30, upkeep: 250, asset: 'barn' },
  warehouse: { cost: 18000, materials: { wood: 8, stone: 4 }, seconds: 20, capacity: 80, upkeep: 100, asset: 'barn' },
  depot: { cost: 16000, materials: { wood: 6, stone: 4, tools: 1 }, seconds: 20, slots: 4, upkeep: 100, asset: 'house_a' },
  port: { cost: 30000, materials: { wood: 12, stone: 10, tools: 2 }, seconds: 30, upkeep: 200, asset: 'port' }
};
export const emptyStock = () => Object.fromEntries(GOODS.map(g => [g, 0]));
export const stockTotal = stock => GOODS.reduce((sum, g) => sum + (stock[g] || 0), 0);
export const MILESTONES = ['production', 'trade', 'network', 'city', 'kingdom'];
