/**
 * Shared visual language for the map canvas and the Help page legend, so the
 * legend always matches what is drawn.
 */
export const MAP_COLORS = Object.freeze({
  background: '#f8fafc',
  grid: '#e2e8f0',
  corridor: '#cbd5e1',
  corridorNode: '#94a3b8',
  inaccessible: '#b45309',
  outOfService: '#dc2626',
  route: '#1d4ed8',
  routeHalo: '#ffffff',
  room: '#ffffff',
  roomStroke: '#334155',
  inaccessibleRoomFill: '#fef3c7',
  entrance: '#15803d',
  restroom: '#0f766e',
  stairs: '#c2410c',
  elevator: '#0369a1',
  elevatorDisabled: '#6b7280',
  start: '#15803d',
  target: '#b91c1c',
  label: '#0f172a',
  labelHalo: '#ffffff',
  glyph: '#ffffff',
});

/** Legend entries rendered on the Help page (same order as drawn importance). */
export const LEGEND_ITEMS = Object.freeze([
  { key: 'route', label: 'Your route', description: 'The shortest path for your current settings.' },
  { key: 'start', label: 'Start point', description: 'Where your route begins (set by a QR code or the selector).' },
  { key: 'target', label: 'Destination', description: 'Where your route ends.' },
  { key: 'room', label: 'Room', description: 'Classrooms, labs, offices and other destinations.' },
  { key: 'entrance', label: 'Entrance', description: 'Building entrances.' },
  { key: 'restroom', label: 'Restroom', description: 'Restrooms on each floor.' },
  { key: 'elevator', label: 'Elevator', description: 'Step-free connection between floors.' },
  {
    key: 'elevatorOutOfService',
    label: 'Elevator out of service',
    description: 'Temporarily unavailable. Routes avoid it automatically.',
  },
  { key: 'stairs', label: 'Stairs', description: 'Never used when Wheelchair Mode is on.' },
  { key: 'corridor', label: 'Corridor', description: 'Walkable hallway connection.' },
  {
    key: 'inaccessible',
    label: 'Not step-free',
    description: 'Steps or stairs. Hidden from wheelchair routes.',
  },
  {
    key: 'closed',
    label: 'Closed passage',
    description: 'Closed by facility staff. No route uses it.',
  },
  {
    key: 'inaccessibleRoom',
    label: 'Room without step-free access',
    description: 'Can be reached on foot only.',
  },
]);
