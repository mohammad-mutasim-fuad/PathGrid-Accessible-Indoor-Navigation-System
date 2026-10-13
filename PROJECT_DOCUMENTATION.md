# System Architecture & Development Documentation: Accessible Indoor Navigation PWA

## 1. Project Overview

This web application is a mobile-first, Progressive Web App (PWA) designed to provide dynamic, multi-floor indoor navigation and routing. The core utility is to guide users from their current location to a destination within a complex facility, offering optimized pathfinding, real-time administrative updates (closures/hazards), and dedicated accessibility routes.

## 2. Scope Boundaries

| Category | In-Scope (What the App CAN Do) | Out-of-Scope (What the App CANNOT Do) |
| --- | --- | --- |
| **Routing** | Node-to-node pathfinding, multi-floor transitions (stairs/elevators), wheelchair-accessible dynamic routing. | Real-time GPS "blue-dot" tracking (indoor GPS is too inaccurate). |
| **Connectivity** | Offline map viewing, persisting the current active route during network drops, background syncing of map assets. | Live fetching of dynamic node changes when fully offline. |
| **Mapping UI** | Interactive 2D map, pinch-to-zoom, panning, animated route drawing, layer switching for floors. | 3D rendering of the building interior, AR (Augmented Reality) camera routing. |
| **Admin** | Real-time toggling of route blockages, point-of-interest (POI) management, broadcasting alerts to active users. | Automatic detection of physical blockages (relies on manual admin input). |

## 3. Technology Stack

* **Frontend:** React.js (or Next.js) for component-based UI and native PWA support. HTML5 Canvas / SVG for map rendering. Tailwind CSS for responsive styling.
* **Backend & Database:** Firebase Firestore (NoSQL database for map metadata and node statuses), Firebase Hosting.
* **Routing Engine:** Client-side A* (A-Star) or Dijkstra’s Algorithm, utilizing a weighted graph structure (nodes and edges).
* **State Management:** Redux Toolkit or React Context API for managing active routes, current floor, and network status.
* **PWA Infrastructure:** Workbox (Service Workers) and IndexedDB for local data persistence.

## 4. System Workflow

1. **Initialization:** The user opens the web app. The Service Worker intercepts the request, serving the UI and map assets from the local cache for immediate loading.
2. **Synchronization:** The app silently checks Firestore for any structural map updates or active admin flags (e.g., closed corridors) and updates the local IndexedDB graph data.
3. **Location Selection:** The user selects a starting point (via dropdown, clicking the map, or scanning a physical QR code at a landmark) and a destination.
4. **Path Calculation:** The client-side routing algorithm calculates the shortest path based on current user preferences (e.g., wheelchair accessible) and the active graph state.
5. **Navigation:** The route is rendered as an interactive layer on the map. As the user reaches transition points (elevators), the UI prompts them to switch map layers to the next floor.
6. **Admin Override (Async):** If an admin flags an elevator as broken, the Admin Flag Listener instantly pushes this to the client. If the user is currently routed through that elevator, the app recalculates the route automatically.

## 5. Functional Requirements

### 5.1 Core Features

* **Interactive Map Rendering:** Display crisp, zoomable floor plans without pixelation.
* **Graph-Based Pathfinding:** Calculate routes traversing horizontal corridors and vertical transition nodes.
* **Accessibility Toggle:** Recalculate routes to strictly avoid stairs or non-ADA compliant pathways.
* **Turn-by-Turn Text:** Generate human-readable directions (e.g., "Walk 50 feet, turn left at the Cafeteria").

### 5.2 User Functional Requirements

* Users must be able to search for destinations by name, category (e.g., "Restrooms"), or room number.
* Users must be able to switch manually between floor views.
* Users must be able to clear their current route and start a new one.
* Users must receive a visual alert if their route is recalculated due to an administrative update.

### 5.3 Admin Functional Requirements & The Admin Flag Listener

* Admins must authenticate via a secure login portal.
* Admins must be able to select any edge (corridor) or node (elevator/staircase) and toggle its status to "Inactive/Blocked".
* **Admin Flag Listener:** The application utilizes a Firebase `onSnapshot` listener specifically for a `map_status` collection. When an admin flags a node, this listener triggers a state update on all connected client devices. The client intercepts this flag, updates the local weight of the graph edge to infinity, and automatically re-runs the pathfinding algorithm if the user's active route contains the blocked node.

## 6. Non-Functional Requirements

* **Performance:** Path calculation for the maximum distance in the facility must execute in under 300ms on a standard mobile device to ensure the UI does not freeze.
* **Availability:** The application must remain operable (load maps and calculate standard routes) even if Firebase goes down, relying entirely on the PWA cache.
* **Usability:** The interface must be easily navigable with one hand on a mobile device. Buttons and interactive map elements must meet minimum touch-target sizes.

## 7. Progressive Web App (PWA) & Cache Strategy

The app is built as a PWA to ensure high performance and offline survivability.

* **Asset Caching:** We utilize a **Cache-First** strategy for all static assets (HTML, CSS, JS bundles, and map SVGs). The Service Worker intercepts network requests and serves these instantly from the browser cache.
* **Data Caching:** The routing graph (nodes and edges coordinates) is stored in **IndexedDB**.
* **Dynamic State (Admin Flags):** We use a **Network-First, fallback to Cache** strategy for the node statuses. The app will attempt to fetch real-time blockages from Firebase. If the network drops, it relies on the last-known state in IndexedDB.

## 8. Risk Management & Engineering Solutions

### 8.1 Solving Algorithm Accuracy (The Wheelchair Safety Risk)

* **The Risk:** The algorithm routes a wheelchair user to a staircase because it is mathematically the shortest path, posing a severe safety hazard.
* **The Solution:** We implement Edge Weighting. Every connection (edge) in the graph has an accessibility boolean and a base distance weight. When the "Wheelchair Mode" toggle is active in the UI, the routing engine dynamically multiplies the weight of all non-accessible edges (stairs) by infinity. The A* algorithm will mathematically bypass stairs, seeking elevators or ramps, guaranteeing a safe route.

### 8.2 Solving Multi-Floor Logic Complexity

* **The Risk:** Pathfinding algorithms natively prefer 2D planes. Calculating a path from Floor 1, through an elevator, to Floor 3, and down a hall is highly complex to map and render.
* **The Solution:** We structure the graph as a unified 3D matrix. Transition nodes (elevators/stairs) exist on multiple floors simultaneously with an ID linking them (e.g., `Elevator_A_F1` connects directly to `Elevator_A_F2`). The algorithm calculates the entire continuous path in the background. The UI simply slices the output array by floor. It renders the F1 segment, pauses the line at the elevator, and displays a "Switch to Floor 2" button.

### 8.3 Solving UI Responsiveness (Mobile Zooming)

* **The Risk:** Users pinch-to-zoom on their mobile device and accidentally zoom out into white space, losing the map entirely, or browser-native zoom conflicts with map-zoom.
* **The Solution:** We disable native browser zooming via the HTML viewport meta tag (`user-scalable=no`). We wrap the Map SVG inside a dedicated gesture library (e.g., `react-zoom-pan-pinch`). We set strict mathematical boundaries (min-scale, max-scale) and translation limits (bounding boxes) so the user can never pan the map off the screen.

### 8.4 The "Mid-Route Internet Drop" Risk

* **The Risk:** A user calculates a route, walks into a concrete stairwell or basement, loses 4G/WiFi, and the app crashes or the map blanks out, stranding them.
* **The Solution:** Because this is a PWA, all map SVGs and the routing graph are pre-cached. Crucially, the entire route (from start to finish) is computed *client-side* immediately upon request and saved in the local Redux state. A mid-route internet drop changes nothing for the user; the drawn line and text instructions remain fully functional because no further server calls are required to complete the journey.

### 8.5 The "Lost at the Start" Risk (User Location Error)

* **The Risk:** Without accurate indoor GPS, users don't know where they are on the map to set an accurate starting point, leading to immediate frustration and useless routes.
* **The Solution:** We deploy physical QR codes on walls, pillars, and directories throughout the building. The web app includes a lightweight QR scanner. Scanning a code passes a URL parameter (e.g., `?startNode=Lobby_Pillar_3`). The app initializes with the user's exact starting position pre-filled. We also provide a dropdown of highly visible, unambiguous landmarks (e.g., "Main Reception Desk") for manual entry.

### 8.6 The "Firebase Quota Crash" Risk (Database Overload)

* **The Risk:** If thousands of users open the app simultaneously and each requests the massive map graph from Firestore, we will exceed Firebase read quotas in minutes, leading to massive billing or app shutdown.
* **The Solution:** The base graph data (node coordinates, static edges) is bundled directly into the static frontend build or cached in IndexedDB on the first visit. The Firebase database is *only* used for the Admin Flag Listener (handling dynamic state changes). Instead of downloading 10,000 nodes, clients simply listen for a tiny payload of active "blocked" node IDs.

### 8.7 The "Spiderweb Line" Risk (Confusing Map UI)

* **The Risk:** The pathfinding algorithm draws a direct geometric line from Point A to Point B that cuts visually through walls, bathrooms, and restricted areas, confusing the user.
* **The Solution:** We create a rigid "NavMesh" (Navigation Mesh). Nodes are manually placed exclusively down the center of hallways and corridors during the mapping phase. The visual route line interpolates strictly between these central nodes. Furthermore, we style the route line using an animated, highly contrasting SVG stroke (e.g., a thick blue dashed line with a drop shadow that moves in the direction of travel) to clearly differentiate the route from the architectural lines of the floorplan.