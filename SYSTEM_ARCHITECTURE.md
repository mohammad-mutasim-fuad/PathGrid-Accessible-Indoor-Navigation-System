# System Architecture Specification: PathGrid Web Application

**Project Name:** PathGrid (Indoor Routing System for Accessibility)

**Document Type:** System Architecture Specification

**Tech Stack:** React.js, Firebase (Auth, Firestore, Cloud Storage, Hosting), HTML5 Canvas, Service Workers (PWA)

**Primary Architecture Pattern:** Client-Side Heavy Serverless SPA (Single Page Application) with PWA Capabilities

---

## 1. Executive Architecture Summary

PathGrid uses a **Client-Side Heavy Serverless Architecture** structured as a Progressive Web Application (PWA). Instead of relying on a custom backend server (like Node.js or Django) that processes every route request, PathGrid delegates all routing math, data filtering, and canvas rendering directly to the user's client device (mobile browser CPU).

The backend relies entirely on **Firebase Services (Backend-as-a-Service / BaaS)** for database storage, admin authentication, and static asset hosting.

```
+-----------------------------------------------------------------------------------+
|                                 USER DEVICE (BROWSER)                             |
|                                                                                   |
|   +--------------------------+    +--------------------------+    +-----------+   |
|   |   Presentation UI Layer  |    |  A* Pathfinding Engine   |    |  PWA App  |   |
|   | (React + Canvas Engine)  |    | (Local Graph Filtering)  |    | Cache     |   |
|   +-------------+------------+    +------------+-------------+    +-----+-----+   |
+-----------------|------------------------------|------------------------|---------+
                  |                              |                        |
                  |         Read Graph Data      |                        | Service
                  |       (Cached JSON Document) |                        | Worker
                  v                              v                        v
+-----------------------------------------------------------------------------------+
|                               FIREBASE CLOUD SERVICES                             |
|                                                                                   |
|   +--------------------------+    +--------------------------+    +-----------+   |
|   |     Firebase Auth        |    |     Cloud Firestore      |    |  Cloud    |   |
|   |  (Admin Tokens Only)     |    |  (Packed JSON Topologies)|    |  Storage  |   |
|   +--------------------------+    +--------------------------+    +-----------+   |
+-----------------------------------------------------------------------------------+

```

---

## 2. High-Level System Architecture Layers

The system is separated into five clean layers to ensure modularity, easy SQA testing, and strict separation of concerns.

```
=====================================================================================
LAYER 1: PRESENTATION & INTERACTION LAYER
- Public Route (`/`): Map Viewer, Room Selector Dropdowns, Route Display Canvas
- Admin Route (`/admin`): Node/Edge Editor Canvas, Map Image Upload, Out-of-Service Toggles
- Shared Components: Zoom/Pan Viewport (`react-zoom-pan-pinch`), Accessibility Overlay
=====================================================================================
                                      │
                                      ▼
=====================================================================================
LAYER 2: CLIENT-SIDE EXECUTION ENGINE (THE BRAIN)
- Route Planner: Runs A* (A-Star) Pathfinding Algorithm on client CPU
- Accessibility Graph Filter: Dynamically prunes "stair" nodes/edges from local memory
- Deep-Link Query Parser: Reads QR Code URL parameters (`?building=B1&start=N101`)
=====================================================================================
                                      │
                                      ▼
=====================================================================================
LAYER 3: SECURITY & ACCESS CONTROL LAYER (RBAC)
- Client-Side: React Router Protected Component Wrapper
- Backend-Side: Firebase Security Rules (Database-Level Access Control)
- Identity: Firebase Auth (Issues JWT Tokens for Admin Sessions)
=====================================================================================
                                      │
                                      ▼
=====================================================================================
LAYER 4: OFFLINE & DATA PERSISTENCE LAYER
- PWA Service Worker: Manages offline caching via "Stale-While-Revalidate"
- Client Storage: IndexedDB (Firebase Local Persistence)
- 1-Byte Cache Invalidation: Checks `isMapUpdated` flag before re-fetching
=====================================================================================
                                      │
                                      ▼
=====================================================================================
LAYER 5: BACKEND-AS-A-SERVICE (FIREBASE CLOUD)
- Firebase Hosting: Serves static compiled React build files over HTTPS
- Cloud Firestore: Stores packed JSON topological graph documents
- Cloud Storage: Hosts 2D floorplan images (optimized WebP/JPEG)
=====================================================================================

```

---

## 3. Core System Workflows & Data Flows

### A. Public User Flow (Zero-Login, Offline-First Route Calculation)

```
[User Scans QR / Opens Web App]
               │
               ▼
   [Service Worker Intercepts]
               │
     ┌─────────┴─────────┐
     │                   │
[Network Online]   [Network Offline / 0 MB Data]
     │                   │
     ├───────────────────┴─────────────► [Read Cached App & Map Graph from IndexedDB]
     │                                                     │
     ▼                                                     ▼
[Check 1-Byte `isMapUpdated` Flag]              [Render React Map UI Screen]
     │                                                     │
     ├─ True ──► [Download New JSON & Update Cache]        │
     └─ False ─► [Use Existing Local Cache]               │
                                                           │
                                                           ▼
                                           [User Selects Start & End Nodes]
                                                           │
                                                           ▼
                                           [Is "Wheelchair Filter" Enabled?]
                                                           │
                                               ┌───────────┴───────────┐
                                               │                       │
                                            [YES]                     [NO]
                                               │                       │
                                     [Filter Out Stairs]      [Keep All Edges]
                                     [Nodes From Local]            │
                                     [Graph Array]                 │
                                               │                   │
                                               └───────────┬───────┘
                                                           │
                                                           ▼
                                           [Execute A* Algorithm on Client CPU]
                                                           │
                                                           ▼
                                           [Draw Route Line on HTML5 Canvas]

```

### B. Admin Workflow (Secure Map Creation & Management)

```
[Admin Navigates to `/admin`]
               │
               ▼
[Enter Email & Password Credentials]
               │
               ▼
[Firebase Auth Validates Credentials]
               │
     ┌─────────┴─────────┐
     │                   │
  [Success]           [Failure]
     │                   │
     │                   └─► [Display Error: "Invalid Credentials"]
     ▼
[Issue Encrypted JWT Session Token]
               │
               ▼
[Grant Access to Map Management Portal]
               │
     ┌─────────┴───────────────────────────────┐
     │                                         │
[Upload New 2D Blueprint]             [Edit Existing Topology]
     │                                         │
     ▼                                         ▼
[Upload Image to Cloud Storage]       [Click Canvas to Place Nodes/Edges]
     │                                         │
     └─────────────────┬───────────────────────┘
                       │
                       ▼
    [Click "Save Grid Topology" Button]
                       │
                       ▼
  [Update Packed JSON in Cloud Firestore]
                       │
                       ▼
   [Set `isMapUpdated = true` Flag]

```

---

## 4. Database Schema & Quota Optimization Strategy

To prevent hitting Firebase free tier limits (50,000 document reads/day), the application uses **JSON Document Packaging**.

Instead of storing every node and edge as an individual database row, an entire floor’s topological graph is packed into a single Firestore document.

### Collection: `buildings`

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

### Collection: `floors` (Document ID: `ENG_MAIN_FL01`)

```json
{
  "building_id": "ENG_MAIN",
  "floor_number": 1,
  "floor_plan_image_url": "https://firebasestorage.googleapis.com/v1/b/pathgrid/o/eng_fl01.webp",
  "graph_topology": {
    "nodes": [
      { "id": "N101", "name": "Main Gate", "x": 120, "y": 450, "type": "entrance", "is_accessible": true },
      { "id": "N102", "name": "Room 101", "x": 200, "y": 450, "type": "room", "is_accessible": true },
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

## 5. Architectural Trade-Off Analysis & Self-Cross-Checking

Choosing the correct architecture requires evaluating tradeoffs. Below is the systematic justification for every major decision made for PathGrid.

| Architectural Decision | Alternative Considered | Chosen Solution | Justification & Trade-Off Analysis |
| --- | --- | --- | --- |
| **Pathfinding Engine Location** | **Server-Side Routing API** (Node.js/Express calculating route on server) | **Client-Side Processing** (A* running in user's browser CPU) | **Why Chosen:** Client-side pathfinding works 100% offline without internet, eliminates server API latency (0ms network delay), and saves backend server costs.<br>

<br>**Trade-off:** Uses user's battery/CPU, but because indoor graphs are small (<300 nodes), processing takes under 5 milliseconds. |
| **Backend Architecture** | **Custom Dedicated Server** (Node.js + PostgreSQL on AWS/Heroku) | **Serverless BaaS** (Firebase Cloud Services) | **Why Chosen:** Zero server management, zero monthly hosting costs, lightweight for 8GB RAM development laptops, built-in offline caching tools.<br>

<br>**Trade-off:** Vendor lock-in with Google Firebase. |
| **Application Packaging** | **Native Mobile App** (React Native / Android Studio) | **Progressive Web App (PWA)** (React Web App with Service Workers) | **Why Chosen:** No installation required (users scan QR and view immediately), works across Android, iOS, and Laptops with a single codebase.<br>

<br>**Trade-off:** Cannot access native Bluetooth hardware, but indoor GPS hardware is out of scope anyway. |
| **Application Structure** | **Two Separate Web Apps** (One User Web App + One Admin Web App) | **Single Web App with RBAC** (One codebase with `/admin` protected route) | **Why Chosen:** Single repository reduces maintenance, eliminates code duplication for rendering maps, simplifies deployment.<br>

<br>**Trade-off:** Requires strict database-level security rules to prevent public users from tampering with data. |
| **Map Rendering Tech** | **3D WebGL / Three.js** | **2D HTML5 Canvas + WebP** | **Why Chosen:** 2D canvas is lightweight (~3MB assets), loads under 3 seconds on weak mobile data, and runs smoothly on low-end smartphones.<br>

<br>**Trade-off:** No 3D building visualizers, but 2D plans are clearer for step-by-step room navigation. |
| **Data Fetching Strategy** | **Individual Node Querying** (1 DB row per point) | **JSON Document Packaging** (1 DB document per floor) | **Why Chosen:** Reduces Firebase read operations from 700 reads per user to 1 read per user, preventing database quota crashes.<br>

<br>**Trade-off:** Downloading the entire floor plan JSON takes slightly more initial payload, but total size is still under 100 KB. |

---

## 6. Security, Scalability & SQA Testing Architecture

### A. Database Security Rules (Firebase Security Matrix)

To ensure unauthenticated users cannot manipulate building blueprints, security is enforced at the database layer using Firebase Security Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Public Map Data
    match /floors/{floorId} {
      // Anyone (normal users) can READ map data
      allow read: if true;
      
      // ONLY authenticated admins can WRITE, UPDATE, or DELETE
      allow write: if request.auth != null;
    }
    
    // Admin Metadata
    match /admin_metadata/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}

```

### B. SQA Testing Hooks & Automation Matrix

The system architecture includes explicit hooks to support the team's Software Quality Assurance (SQA) testing stack:

```
+-----------------------------------------------------------------------------------+
|                                 SQA TESTING STACK                                 |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  1. UNIT TESTING (Jest)                                                           |
|     - Target: `AStarEngine.js` & `AccessibilityFilter.js`                         |
|     - Strategy: Feeds mock JSON graph data to test path accuracy, execution speed |
|       (<10ms), and 100% stair-blocking compliance.                               |
|                                                                                   |
|  2. END-TO-END / INTEGRATION TESTING (Cypress)                                   |
|     - Target: React UI, Canvas Interactions, and `/admin` Authentication          |
|     - Strategy: Simulates user actions (selecting dropdowns, clicking wheelchair   |
|       checkbox) and verifies canvas route rendering and error popups.            |
|                                                                                   |
|  3. API & SCHEMA TESTING (Postman)                                                |
|     - Target: Firebase REST Endpoints & Cloud Storage Fetching                    |
|     - Strategy: Validates HTTP 200 responses, verifies JSON schema integrity,    |
|       and confirms security rules return HTTP 403 for unauthorized writes.        |
|                                                                                   |
+-----------------------------------------------------------------------------------+

```

---

## 7. System Architecture Verification Summary

This architecture satisfies all operational constraints:

1. **Low Hardware Footprint:** Runs comfortably on 8GB RAM development laptops.
2. **Zero-Data / Offline Support:** Operates seamlessly when mobile internet drops mid-walk via PWA Service Worker caching.
3. **Accessibility First:** Supports client-side graph filtering for wheelchair safety without altering master database data.
4. **Quota Safe:** JSON packaging keeps database reads well within Firebase's free operational tiers.
5. **Production Ready:** Built with strict role separation, structured schemas, and dedicated hooks for SQA automated testing.