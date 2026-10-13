# Product Requirement Document (PRD) & System Context: PathGrid

**Project Name:** PathGrid – Accessible Indoor Navigation System  
**Application Type:** Progressive Web Application (PWA)  
**Target Environment:** Mobile-First Web Browsers (iOS Safari, Android Chrome, Desktop)  
**Tech Stack:** React.js (ES6+), Tailwind CSS v4, Firebase (Auth, Firestore, Cloud Storage), HTML5 Canvas, Service Workers  
**Core Goal:** Provide dynamic, multi-floor indoor routing with stair-free accessibility filtering and offline resilience without requiring user logins or native app downloads.

---

## 1. System Roles & Access Control Matrix (RBAC)

PathGrid uses a single-repository React Single Page Application (SPA) architecture with strict role segregation:

| Role | Access URL | Authentication | Capabilities & Limits |
| :--- | :--- | :--- | :--- |
| **Public / Normal User** | `/` or `/?building=X&start=Y` | **None Required (0-Login)** | Read-only access to map visualizers, floor dropdowns, route calculations, and wheelchair mode toggles. Cannot modify database records. |
| **Facility Administrator** | `/admin` | **Firebase Email/Password Auth** | Upload 2D blueprint floorplan images, interactively place nodes and edges on a canvas editor, edit location names, and toggle out-of-service elevators/corridors. |

---

## 2. Technical Stack & Dependency Rules

1. **Frontend UI Framework:** React.js (Functional components with Hooks: `useState`, `useEffect`, `useRef`, `useContext`).
2. **Styling & Design System:** Tailwind CSS v4 (Imported via `@import "tailwindcss";` in `src/index.css`). No heavy third-party UI libraries (e.g., Material UI/AntD) allowed.
3. **Canvas & Pan/Zoom:** `react-zoom-pan-pinch` wrapping an HTML5 `<canvas>` or custom SVG overlay layer for smooth mobile gesture support.
4. **Icons:** `lucide-react`.
5. **Backend Services (BaaS):** Firebase Web SDK v9+ (Modular imports).
   - **Firestore:** Cloud NoSQL database for graph topology.
   - **Firebase Auth:** Admin session control.
   - **Cloud Storage:** Image hosting for floorplan blueprints (WebP/PNG).
6. **Offline Infrastructure:** PWA Service Worker (Stale-While-Revalidate caching strategy) + IndexedDB for local topological graph persistence.

---

## 3. Database Schema Specification (Firestore)

To optimize Firebase free-tier read quotas, graph topologies are **packed into single JSON floor documents** rather than individual node documents.

### Collection: `buildings`
* **Document ID:** `{building_id}` (e.g., `ENG_MAIN`)
```json
{
  "building_id": "ENG_MAIN",
  "building_name": "Engineering Complex",
  "total_floors": 3,
  "default_floor": 1,
  "isMapUpdated": false,
  "last_updated_timestamp": "2026-08-01T10:30:00Z"
}

```

### Collection: `floors`

* **Document ID:** `{building_id}_FL{floor_number}` (e.g., `ENG_MAIN_FL01`)

```json
{
  "building_id": "ENG_MAIN",
  "floor_number": 1,
  "floor_plan_image_url": "[https://firebasestorage.googleapis.com/.../eng_fl01.webp](https://firebasestorage.googleapis.com/.../eng_fl01.webp)",
  "graph_topology": {
    "nodes": [
      { "id": "N101", "name": "Main Entrance", "x": 120, "y": 450, "type": "entrance", "is_accessible": true },
      { "id": "N102", "name": "Lab 101", "x": 200, "y": 450, "type": "room", "is_accessible": true },
      { "id": "N103", "name": "Staircase A", "x": 350, "y": 200, "type": "stairs", "is_accessible": false },
      { "id": "N104", "name": "Elevator 1", "x": 370, "y": 220, "type": "elevator", "is_accessible": true, "out_of_service": false }
    ],
    "edges": [
      { "source": "N101", "target": "N102", "weight": 15, "type": "corridor", "is_accessible": true },
      { "source": "N102", "target": "N103", "weight": 20, "type": "stairs", "is_accessible": false },
      { "source": "N102", "target": "N104", "weight": 22, "type": "corridor", "is_accessible": true }
    ]
  }
}

```

---

## 4. Core Algorithms & Logic Specifications

### 4.1 Client-Side A* Pathfinding Engine (`src/services/aStarEngine.js`)

* **Execution Location:** Runs purely on the user's client browser CPU (0ms network request latency).
* **Inputs:** `(graphData, startNodeId, targetNodeId, isWheelchairModeActive)`
* **Accessibility Filtering Logic:**
* If `isWheelchairModeActive === true`: The engine must pre-filter the graph's `nodes` and `edges` arrays before running the A* heuristic evaluation.
* Any node or edge where `type === 'stairs'` or `is_accessible === false` is pruned from the working adjacency matrix.
* Any elevator marked with `out_of_service === true` must be treated as an impassable obstacle (edge weight = $\infty$).


* **Output:** An ordered array of node objects representing the continuous spatial path, total calculated distance, and step-by-step turn directions.

### 4.2 Multi-Floor Transition Logic

* Elevator and Stair nodes that span multiple levels share matching transition IDs (e.g., `Elevator_A` exists on Floor 1, Floor 2, Floor 3).
* The routing engine computes the entire 3D continuous path in memory across all floor sub-graphs.
* The UI slices the calculated path array per floor level, drawing the active segment for the current floor and displaying a "Switch to Floor X" interactive prompt when a transition node (Elevator) is reached.

---

## 5. Key Functional Workflows & Features

### 5.1 QR Code Location Auto-Initialization

* Wall-mounted QR codes point directly to the app URL with pre-filled starting query parameters:
`https://pathgrid.app/?building=ENG_MAIN&floor=1&startNode=N101`
* Upon mounting, the React app parses the window URL parameters and auto-populates the "Starting Point" dropdown state without manual user searching.

### 5.2 Real-Time Admin Flag Listener

* When a public user is navigating, an active Firestore `onSnapshot` listener monitors the `isMapUpdated` flag.
* If an admin flags an elevator as "Out of Service" at `/admin`, the client receives the push flag. If the user's active computed path relies on that broken elevator, the app automatically triggers a recalculation and displays an alert toast: *"Route updated due to facility change."*

### 5.3 Offline PWA Caching Strategy

* **Static Web Assets (JS/CSS/HTML):** Service Worker serves via **Cache-First** strategy.
* **Map Blueprints & Topologies:** Stored in browser **IndexedDB** on initial load.
* Mid-route network drops will **NOT** disrupt active navigation, as pathfinding math executes entirely on local client memory.

---

## 6. Directory Architecture & File Responsibilities

```text
pathgrid/
├── public/
│   ├── favicon.ico
│   ├── manifest.json         # PWA Manifest configuration
│   └── service-worker.js     # Service worker caching engine
├── src/
│   ├── assets/               # Static icons & placeholder floorplans
│   ├── components/
│   │   ├── MapCanvas.jsx     # HTML5 Canvas / react-zoom-pan-pinch route renderer
│   │   ├── RoomSelector.jsx  # Search, start/destination dropdowns, wheelchair toggle
│   │   ├── FloorPicker.jsx   # Level switching control bar
│   │   └── Admin/
│   │       ├── Login.jsx     # Protected admin authentication UI
│   │       └── Editor.jsx    # Interactive node/edge plotting tool
│   ├── data/
│   │   └── mockMapData.json  # Fallback offline map graph
│   ├── services/
│   │   ├── firebase.js       # Firebase initialization & SDK exports
│   │   ├── aStarEngine.js    # Pure JS A* algorithm & accessibility graph pruning
│   │   └── dbService.js      # Firestore fetchers & IndexedDB caching logic
│   ├── App.jsx               # Master React Router layout & state orchestration
│   ├── index.css             # Tailwind CSS v4 entry (@import "tailwindcss";)
│   └── index.js              # React DOM entry point
├── CLAUDE.md                 # AI prompt guidelines
└── PRD_Context.md            # Master system specifications (This File)

```

---

## 7. Development Safety Constraints

1. **Do Not Overwrite Main:** All team additions must occur in dedicated feature branches (`feature/ui-and-components`, `feature/sqa-and-tests`) and undergo PR approval.
2. **Deterministic Output:** Never rely on server API calls for path calculation; all graph mathematics must be contained inside `src/services/aStarEngine.js`.
3. **No External Maps API:** Do not import Google Maps or Mapbox APIs. The system relies entirely on custom 2D facility floorplans rendered on canvas overlays.

```

```