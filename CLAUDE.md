# PathGrid AI System Guidelines

## Tech Stack Constraints
- Framework: React.js (ES6+)
- Styling: Tailwind CSS v4 (@import "tailwindcss")
- Database & Auth: Firebase Web SDK v9+ (Firestore, Auth, Storage)
- Map Tools: HTML5 Canvas, react-zoom-pan-pinch, lucide-react
- Target Architecture: PWA (Service Workers + IndexedDB offline cache)

## Code Quality Rules
- Write modular, clean ES6+ JavaScript.
- Avoid bulky third-party UI libraries; use Tailwind utility classes.
- Use functional React components with Hooks (`useState`, `useEffect`, `useRef`).
- Keep math and business logic separated (e.g., A* pathfinding belongs in `src/services/`, UI components in `src/components/`).
- Do NOT generate placeholder `TODO` code—always write complete, executable functions.

## Project Context Summary
- Public users require ZERO login (Read-Only access to maps).
- Admins log in at `/admin` to edit graph nodes and toggle out-of-service elevators.
- Wheelchair Mode MUST filter out 'stairs' nodes/edges from the pathfinding graph array.