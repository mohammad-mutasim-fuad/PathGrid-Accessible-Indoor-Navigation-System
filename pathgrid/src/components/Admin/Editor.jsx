import {
  useCallback, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import {
  CirclePlus, Info, Link2, LoaderCircle, MousePointer2, Move, Plus, Redo2, RotateCcw, Save, Search, Spline, Trash, Undo2,
  Unlink,
} from 'lucide-react';
import { useAdminData } from './AdminDataContext';
import EditorCanvas from './EditorCanvas';
import {
  BUTTON, Card, ErrorNotice, INPUT, PageHeader,
} from './AdminUi';
import {
  EDGE_TYPES,
  NODE_TYPES,
  TRANSITION_TYPES,
  applyLinkedNodeUpdates,
  computeEdgeWeight,
  connects,
  createNode,
  editorReducer,
  initEditorState,
  isTopologyChanged,
  nextNodeId,
  nextTransitionId,
  planVerticalLink,
  planVerticalUnlink,
  typeChangeDefaults,
  validateFloorForBuilding,
} from '../../services/topologyEditor';
import { findLinkedNodes } from '../../services/graphBuilder';
import { getCanvasSize } from '../../services/routeUtils';
import { describeFirestoreError } from '../../services/adminService';

const EMPTY_TOPOLOGY = Object.freeze({ nodes: [], edges: [] });
const SNAP_SIZE = 10;
const DEFAULT_UNITS_PER_METER = 10;

const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2, cursor: 'default' },
  { id: 'add', label: 'Add node', icon: CirclePlus, cursor: 'crosshair' },
  { id: 'connect', label: 'Connect', icon: Spline, cursor: 'cell' },
  { id: 'move', label: 'Move', icon: Move, cursor: 'move' },
];

const TYPE_LABELS = {
  room: 'Room',
  corridor: 'Corridor',
  entrance: 'Entrance',
  restroom: 'Restroom',
  elevator: 'Elevator',
  stairs: 'Stairs',
  ramp: 'Ramp',
};

const isEditableTarget = (target) => {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable;
};

const snapValue = (value, enabled) => (enabled ? Math.round(value / SNAP_SIZE) * SNAP_SIZE : Math.round(value));

/** Text/number input that commits on blur or Enter (one undo step per edit). */
function CommitInput({
  id, label, value, onCommit, type = 'text', list, help = '',
}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);

  const commit = () => {
    if (draft === String(value ?? '')) return;
    if (type === 'number') {
      const parsed = Number(draft);
      if (draft.trim() === '' || !Number.isFinite(parsed)) {
        setDraft(String(value ?? ''));
        return;
      }
      onCommit(parsed);
    } else {
      onCommit(draft);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        id={id}
        type={type}
        list={list}
        value={draft}
        step={type === 'number' ? 'any' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className={INPUT}
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}

function Checkbox({
  label, checked, onChange, disabled = false, help = '',
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'text-slate-400' : 'text-slate-800'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-blue-700"
      />
      <span>
        <span className="font-medium">{label}</span>
        {help && <span className="block text-xs text-slate-500">{help}</span>}
      </span>
    </label>
  );
}

/**
 * Shows which nodes on other floors a staircase/elevator is linked to, and
 * lets the admin link it to a same-type node on another floor or unlink it.
 */
function VerticalLinkPanel({
  node, linked, options, onLink, onUnlink,
}) {
  const [choice, setChoice] = useState('');
  useEffect(() => setChoice(''), [node.id, node.transition_id]);
  const kind = node.type === 'stairs' ? 'staircase' : 'elevator';
  const optionFloors = [...new Set(options.map((o) => o.floor))];

  return (
    <section aria-labelledby="vertical-link-heading" className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 id="vertical-link-heading" className="text-sm font-semibold text-slate-800">Cross-floor link</h3>
      {linked.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">Not linked to any other floor.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">Linked to:</p>
          <ul aria-label="Linked floors" className="mt-1 space-y-0.5 text-sm text-slate-900">
            {linked.map(({ floor, node: other, pending }) => (
              <li key={`${floor}:${other.id}`}>
                {`Floor ${floor}: ${other.name ?? other.id}`}
                {pending && <span className="text-amber-700"> (saved with this floor)</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {options.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">{`No ${kind}s on other floors yet.`}</p>
      ) : (
        <div className="mt-3">
          <label htmlFor="vertical-link-target" className="mb-1 block text-sm font-medium text-slate-700">
            {`Link to ${kind} on another floor`}
          </label>
          <select
            id="vertical-link-target"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className={INPUT}
          >
            <option value="">{`Choose a ${kind}…`}</option>
            {optionFloors.map((floor) => (
              <optgroup key={floor} label={`Floor ${floor}`}>
                {options.filter((o) => o.floor === floor).map((o) => (
                  <option
                    key={o.node.id}
                    value={`${o.floor}:${o.node.id}`}
                    disabled={o.isLinked || Boolean(o.disabledReason)}
                    title={o.disabledReason ?? undefined}
                  >
                    {`${o.node.name ?? o.node.id}${o.isLinked ? ' (linked)' : ''}${o.disabledReason ? ' (unavailable)' : ''}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!choice}
          onClick={() => {
            const separator = choice.indexOf(':');
            onLink(Number(choice.slice(0, separator)), choice.slice(separator + 1));
            setChoice('');
          }}
          className={`${BUTTON.secondary} h-10`}
        >
          <Link2 aria-hidden="true" className="h-4 w-4" />
          Link
        </button>
        <button
          type="button"
          disabled={linked.length === 0}
          onClick={onUnlink}
          className={`${BUTTON.secondary} h-10`}
        >
          <Unlink aria-hidden="true" className="h-4 w-4" />
          Unlink
        </button>
      </div>
    </section>
  );
}

function NodePanel({
  node, topology, transitionSuggestions, onUpdate, onTypeChange, onDelete, onConnect, onSelectEdge, onDeleteEdge,
  verticalLinkPanel = null,
}) {
  const [connectTarget, setConnectTarget] = useState('');
  useEffect(() => setConnectTarget(''), [node.id]);

  const nameOf = (id) => topology.nodes.find((n) => n.id === id)?.name ?? id;
  const connections = topology.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const candidates = topology.nodes
    .filter((n) => n.id !== node.id && !connections.some((edge) => connects(edge, node.id, n.id)))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const isTransition = TRANSITION_TYPES.includes(node.type);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        ID <code className="rounded bg-slate-100 px-1 text-slate-800">{node.id}</code>
      </p>
      <CommitInput id="node-name" label="Label" value={node.name} onCommit={(name) => onUpdate({ name })} />
      <div>
        <label htmlFor="node-type" className="mb-1 block text-sm font-medium text-slate-700">Type</label>
        <select id="node-type" value={node.type} onChange={(event) => onTypeChange(event.target.value)} className={INPUT}>
          {NODE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CommitInput id="node-x" label="X" type="number" value={node.x} onCommit={(x) => onUpdate({ x })} />
        <CommitInput id="node-y" label="Y" type="number" value={node.y} onCommit={(y) => onUpdate({ y })} />
      </div>
      <Checkbox
        label="Step-free accessible"
        checked={node.is_accessible !== false}
        disabled={node.type === 'stairs'}
        help={node.type === 'stairs' ? 'Stairs are never step-free.' : 'Unchecked nodes are skipped in Wheelchair Mode.'}
        onChange={(value) => onUpdate({ is_accessible: value })}
      />
      {isTransition && (
        <>
          <CommitInput
            id="node-transition"
            label="Transition ID"
            value={node.transition_id}
            list="transition-suggestions"
            help={`Use the same ID on every floor this ${node.type === 'stairs' ? 'staircase' : 'elevator'} serves.`}
            onCommit={(value) => onUpdate({ transition_id: value.trim() || undefined })}
          />
          <datalist id="transition-suggestions">
            {transitionSuggestions.map((id) => <option key={id} value={id} />)}
          </datalist>
          {verticalLinkPanel}
        </>
      )}
      {node.type === 'elevator' && (
        <Checkbox
          label="Out of service"
          checked={node.out_of_service === true}
          help="Only this floor. Use the Dashboard to switch the whole elevator."
          onChange={(value) => onUpdate({ out_of_service: value })}
        />
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">{`Connections (${connections.length})`}</h3>
        {connections.length === 0 && <p className="text-sm text-slate-500">Not connected to anything yet.</p>}
        <ul className="space-y-1">
          {connections.map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            return (
              <li key={`${edge.source}->${edge.target}`} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectEdge(edge)}
                  className="min-h-9 flex-1 truncate rounded-md px-2 text-left text-sm text-blue-800 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700"
                >
                  {`${nameOf(otherId)} · ${edge.weight ?? '—'} m`}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteEdge(edge)}
                  aria-label={`Remove connection to ${nameOf(otherId)}`}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-red-700"
                >
                  <Trash aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex gap-2">
          <label htmlFor="connect-target" className="sr-only">Connect to node</label>
          <select
            id="connect-target"
            value={connectTarget}
            onChange={(event) => setConnectTarget(event.target.value)}
            className={INPUT}
          >
            <option value="">Connect to…</option>
            {candidates.map((n) => <option key={n.id} value={n.id}>{n.name ?? n.id}</option>)}
          </select>
          <button
            type="button"
            disabled={!connectTarget}
            onClick={() => { onConnect(connectTarget); setConnectTarget(''); }}
            className={`${BUTTON.secondary} h-10 shrink-0`}
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            Add connection
          </button>
        </div>
      </div>

      <button type="button" onClick={onDelete} className={`${BUTTON.danger} w-full`}>
        <Trash aria-hidden="true" className="h-4 w-4" />
        Delete node
      </button>
    </div>
  );
}

function EdgePanel({
  edge, topology, unitsPerMeter, onUpdate, onDelete,
}) {
  const nodeById = new Map(topology.nodes.map((n) => [n.id, n]));
  const a = nodeById.get(edge.source);
  const b = nodeById.get(edge.target);
  const distance = a && b ? computeEdgeWeight(a, b, unitsPerMeter) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-slate-900">{`${a?.name ?? edge.source} ↔ ${b?.name ?? edge.target}`}</p>
      <div>
        <label htmlFor="edge-type" className="mb-1 block text-sm font-medium text-slate-700">Type</label>
        <select
          id="edge-type"
          value={edge.type ?? 'corridor'}
          onChange={(event) => {
            const type = event.target.value;
            onUpdate(type === 'stairs' ? { type, is_accessible: false } : { type });
          }}
          className={INPUT}
        >
          {EDGE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <CommitInput
            id="edge-weight"
            label="Distance / weight (m)"
            type="number"
            value={edge.weight}
            onCommit={(weight) => onUpdate({ weight: Math.max(0, weight) })}
          />
        </div>
        <button
          type="button"
          onClick={() => onUpdate({ weight: distance })}
          disabled={distance === null || distance === edge.weight}
          className={`${BUTTON.secondary} h-10`}
          title="Recalculate from node positions"
        >
          {`Use ${distance ?? '—'} m`}
        </button>
      </div>
      <Checkbox
        label="Step-free accessible"
        checked={edge.is_accessible !== false}
        disabled={edge.type === 'stairs'}
        help={edge.type === 'stairs' ? 'Stairs are never step-free.' : 'Uncheck for steps or other barriers.'}
        onChange={(value) => onUpdate({ is_accessible: value })}
      />
      <Checkbox
        label="Closed (out of service)"
        checked={edge.out_of_service === true}
        help="Closed connections are never used in routes."
        onChange={(value) => onUpdate({ out_of_service: value })}
      />
      <button type="button" onClick={onDelete} className={`${BUTTON.danger} w-full`}>
        <Trash aria-hidden="true" className="h-4 w-4" />
        Delete connection
      </button>
    </div>
  );
}

/**
 * /admin/editor: visual topology editor for one floor at a time.
 */
export default function Editor() {
  const {
    building, floors, saveFloorTopology, addFloor, mode,
  } = useAdminData();

  // Real floor documents only. A building without floors shows an unsaved
  // "Floor 1" draft (saving creates it); more floors come from "+ Add Floor".
  const floorNumbers = useMemo(() => {
    const numbers = [...new Set(floors.map((f) => f.floor_number))].sort((a, b) => a - b);
    return numbers.length > 0 ? numbers : [1];
  }, [floors]);
  const floorExists = useCallback((n) => floors.some((f) => f.floor_number === n), [floors]);
  const [floorNumber, setFloorNumber] = useState(() => (
    floorNumbers.includes(building?.default_floor) ? building.default_floor : floorNumbers[0] ?? 1
  ));
  const floorDoc = floors.find((f) => f.floor_number === floorNumber) ?? null;
  const savedTopology = useMemo(() => floorDoc?.graph_topology ?? EMPTY_TOPOLOGY, [floorDoc]);

  const [editor, dispatch] = useReducer(editorReducer, savedTopology, initEditorState);
  const [tool, setTool] = useState('select');
  const [newNodeType, setNewNodeType] = useState('room');
  const [snap, setSnap] = useState(true);
  const [selection, setSelection] = useState(null);
  const [connectSourceId, setConnectSourceId] = useState(null);
  const [nodeQuery, setNodeQuery] = useState('');
  const [addFloorState, setAddFloorState] = useState({ status: 'idle', message: '' });
  // A ref (not just state) so two rapid clicks cannot both start a request.
  const addingFloorRef = useRef(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });

  // Node changes on OTHER floors needed by cross-floor links made in this
  // session ([{ floorNumber, nodeId, changes }]); saved atomically with the floor.
  const [pendingLinks, setPendingLinks] = useState([]);

  const { topology } = editor;
  const dirty = isTopologyChanged(topology, savedTopology) || pendingLinks.length > 0;
  const unitsPerMeter = building?.units_per_meter ?? DEFAULT_UNITS_PER_METER;

  // Load the floor (on floor switch and after a save refreshes the data).
  useEffect(() => {
    dispatch({ type: 'reset', topology: savedTopology });
    setSelection(null);
    setConnectSourceId(null);
    setValidationErrors([]);
    setPendingLinks([]);
  }, [savedTopology]);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Saved floors as they will look once pending cross-floor link changes are saved.
  const linkedFloors = useMemo(() => applyLinkedNodeUpdates(floors, pendingLinks), [floors, pendingLinks]);
  const otherFloorNodes = useMemo(
    () => linkedFloors.filter((f) => f.floor_number !== floorNumber).flatMap((f) => f.graph_topology?.nodes ?? []),
    [linkedFloors, floorNumber],
  );
  const takenIds = useMemo(
    () => new Set([...otherFloorNodes, ...topology.nodes].map((n) => n.id)),
    [otherFloorNodes, topology.nodes],
  );
  const transitionIds = useMemo(
    () => new Set([...otherFloorNodes, ...topology.nodes].map((n) => n.transition_id).filter(Boolean)),
    [otherFloorNodes, topology.nodes],
  );
  const canvasSize = useMemo(
    () => getCanvasSize(building, [...otherFloorNodes, ...topology.nodes]),
    [building, otherFloorNodes, topology.nodes],
  );

  const selectedNode = selection?.kind === 'node' ? topology.nodes.find((n) => n.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge'
    ? topology.edges.find((e) => connects(e, selection.source, selection.target)) ?? null
    : null;
  const nameOf = useCallback((id) => topology.nodes.find((n) => n.id === id)?.name ?? id, [topology.nodes]);

  const transitionSuggestions = useMemo(() => {
    if (!selectedNode || !TRANSITION_TYPES.includes(selectedNode.type)) return [];
    return [...new Set(otherFloorNodes
      .filter((n) => n.type === selectedNode.type && n.transition_id)
      .map((n) => n.transition_id))].sort();
  }, [otherFloorNodes, selectedNode]);

  // Cross-floor link status and candidates for the selected staircase/elevator.
  const verticalLink = useMemo(() => {
    if (!selectedNode || !TRANSITION_TYPES.includes(selectedNode.type)) return null;
    const linked = findLinkedNodes(linkedFloors, floorNumber, selectedNode).map((entry) => ({
      ...entry,
      pending: pendingLinks.some((p) => p.floorNumber === entry.floor && p.nodeId === entry.node.id),
    }));
    const options = linkedFloors
      .filter((f) => f.floor_number !== floorNumber)
      .sort((a, b) => a.floor_number - b.floor_number)
      .flatMap((f) => (f.graph_topology?.nodes ?? [])
        .filter((n) => n.type === selectedNode.type)
        .map((n) => {
          const target = { floor: f.floor_number, node: n };
          const isLinked = Boolean(selectedNode.transition_id) && n.transition_id === selectedNode.transition_id;
          const plan = isLinked ? null : planVerticalLink({
            floors: linkedFloors,
            floorNumber,
            topology,
            node: selectedNode,
            target,
            takenTransitionIds: transitionIds,
          });
          return { ...target, isLinked, disabledReason: plan?.error ?? null };
        }));
    return { linked, options };
  }, [selectedNode, linkedFloors, floorNumber, pendingLinks, topology, transitionIds]);

  /* ----------------------------- actions ------------------------------ */

  const clearTransient = useCallback(() => {
    setSaveState({ status: 'idle', message: '' });
    setValidationErrors([]);
  }, []);

  const addNodeAt = useCallback((x, y) => {
    const id = nextNodeId(floorNumber, newNodeType, takenIds);
    const transitionId = TRANSITION_TYPES.includes(newNodeType)
      ? nextTransitionId(newNodeType, transitionIds)
      : undefined;
    const node = createNode({
      id, type: newNodeType, x: snapValue(x, snap), y: snapValue(y, snap), transitionId,
    });
    dispatch({ type: 'addNode', node });
    setSelection({ kind: 'node', id });
    clearTransient();
  }, [floorNumber, newNodeType, takenIds, transitionIds, snap, clearTransient]);

  const updateNode = useCallback((id, changes) => {
    dispatch({
      type: 'updateNode', id, changes, unitsPerMeter,
    });
    clearTransient();
  }, [unitsPerMeter, clearTransient]);

  const changeNodeType = useCallback((node, type) => {
    const transitionId = nextTransitionId(type, transitionIds);
    updateNode(node.id, typeChangeDefaults(node, type, { transitionId }));
  }, [transitionIds, updateNode]);

  /** Links a staircase/elevator on this floor to a same-type node on another floor. */
  const linkVertical = useCallback((node, targetFloor, targetNodeId) => {
    const targetNode = linkedFloors
      .find((f) => f.floor_number === targetFloor)?.graph_topology?.nodes
      ?.find((n) => n.id === targetNodeId);
    const plan = planVerticalLink({
      floors: linkedFloors,
      floorNumber,
      topology,
      node,
      target: { floor: targetFloor, node: targetNode },
      takenTransitionIds: transitionIds,
    });
    if (plan.error) {
      setSaveState({ status: 'error', message: plan.error });
      return;
    }
    if (plan.nodeChanges) updateNode(node.id, plan.nodeChanges);
    if (plan.linkedUpdate) {
      const { linkedUpdate } = plan;
      setPendingLinks((current) => [
        ...current.filter((p) => !(p.floorNumber === linkedUpdate.floorNumber && p.nodeId === linkedUpdate.nodeId)),
        linkedUpdate,
      ]);
    }
    clearTransient();
  }, [linkedFloors, floorNumber, topology, transitionIds, updateNode, clearTransient]);

  /** Detaches a staircase/elevator from its shaft (other floors stay linked to each other). */
  const unlinkVertical = useCallback((node) => {
    const oldId = node.transition_id;
    updateNode(node.id, planVerticalUnlink({ node, takenTransitionIds: transitionIds }));
    // Drop queued changes that only existed to join other floors to this node.
    setPendingLinks((current) => current.filter((p) => p.changes.transition_id !== oldId));
    clearTransient();
  }, [transitionIds, updateNode, clearTransient]);

  const connectNodes = useCallback((source, target) => {
    dispatch({
      type: 'addEdge', source, target, unitsPerMeter,
    });
    clearTransient();
  }, [unitsPerMeter, clearTransient]);

  const updateEdge = useCallback((edge, changes) => {
    dispatch({
      type: 'updateEdge', source: edge.source, target: edge.target, changes,
    });
    clearTransient();
  }, [clearTransient]);

  const deleteEdge = useCallback((edge) => {
    dispatch({ type: 'deleteEdge', source: edge.source, target: edge.target });
    setSelection((current) => (current?.kind === 'edge' && connects(edge, current.source, current.target)
      ? null
      : current));
    clearTransient();
  }, [clearTransient]);

  const deleteSelection = useCallback(() => {
    if (selection?.kind === 'node') {
      dispatch({ type: 'deleteNode', id: selection.id });
      if (connectSourceId === selection.id) setConnectSourceId(null);
    } else if (selection?.kind === 'edge') {
      dispatch({ type: 'deleteEdge', source: selection.source, target: selection.target });
    } else {
      return;
    }
    setSelection(null);
    clearTransient();
  }, [selection, connectSourceId, clearTransient]);

  const handleCanvasClick = useCallback(({
    x, y, nodeId, edge,
  }) => {
    switch (tool) {
      case 'add':
        if (nodeId) setSelection({ kind: 'node', id: nodeId });
        else addNodeAt(x, y);
        break;
      case 'connect':
        if (!nodeId) {
          setConnectSourceId(null);
        } else if (!connectSourceId) {
          setConnectSourceId(nodeId);
          setSelection({ kind: 'node', id: nodeId });
        } else if (connectSourceId === nodeId) {
          setConnectSourceId(null);
        } else {
          connectNodes(connectSourceId, nodeId);
          setConnectSourceId(nodeId);
          setSelection({ kind: 'node', id: nodeId });
        }
        break;
      case 'move':
        if (nodeId) setSelection({ kind: 'node', id: nodeId });
        else if (selection?.kind === 'node') updateNode(selection.id, { x: snapValue(x, snap), y: snapValue(y, snap) });
        break;
      default:
        if (nodeId) setSelection({ kind: 'node', id: nodeId });
        else if (edge) setSelection({ kind: 'edge', source: edge.source, target: edge.target });
        else setSelection(null);
    }
  }, [tool, connectSourceId, selection, snap, addNodeAt, connectNodes, updateNode]);

  const selectTool = (id) => {
    setTool(id);
    setConnectSourceId(null);
  };

  /**
   * Switches floors and loads that floor's graph in the SAME state update, so
   * no render ever shows one floor's number with another floor's nodes (which
   * would make "Save" copy the old floor's graph onto the new one).
   */
  const switchToFloor = useCallback((next, topology) => {
    setFloorNumber(next);
    dispatch({ type: 'reset', topology: topology ?? EMPTY_TOPOLOGY });
    setSelection(null);
    setConnectSourceId(null);
    setPendingLinks([]);
  }, []);

  const changeFloor = (next) => {
    if (next === floorNumber) return;
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm(`Discard unsaved changes on floor ${floorNumber}?`)) return;
    switchToFloor(next, floors.find((f) => f.floor_number === next)?.graph_topology);
    setAddFloorState({ status: 'idle', message: '' });
    clearTransient();
  };

  const handleAddFloor = async () => {
    if (addingFloorRef.current) return;
    if (dirty
      // eslint-disable-next-line no-alert
      && !window.confirm(`Floor ${floorNumber} has unsaved changes. Discard them and add a new floor?`)) {
      return;
    }
    addingFloorRef.current = true;
    setAddFloorState({ status: 'adding', message: '' });
    try {
      const newFloor = await addFloor();
      // A new floor always starts with an empty graph.
      switchToFloor(newFloor, EMPTY_TOPOLOGY);
      clearTransient();
      setAddFloorState({ status: 'added', message: `Floor ${newFloor} added. You can start drawing it now.` });
    } catch (error) {
      setAddFloorState({ status: 'error', message: `Could not add a floor. ${describeFirestoreError(error)}` });
    } finally {
      addingFloorRef.current = false;
    }
  };

  const discard = () => {
    dispatch({ type: 'reset', topology: savedTopology });
    setSelection(null);
    setConnectSourceId(null);
    setPendingLinks([]);
    clearTransient();
  };

  const save = async () => {
    // Validate against the other floors as they will be after linked changes.
    const errors = validateFloorForBuilding(linkedFloors, floorNumber, topology);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setSaveState({ status: 'error', message: 'Fix the problems below before saving.' });
      return;
    }
    const linkedFloorNumbers = [...new Set(pendingLinks.map((p) => p.floorNumber))];
    setSaveState({ status: 'saving', message: 'Saving…' });
    try {
      await saveFloorTopology(floorNumber, topology, { linkedNodeUpdates: pendingLinks });
      const linkedNote = linkedFloorNumbers.length > 0
        ? ` Linked floor${linkedFloorNumbers.length > 1 ? 's' : ''} ${linkedFloorNumbers.join(', ')} updated.`
        : '';
      setSaveState({
        status: 'saved',
        message: mode === 'demo'
          ? `Floor ${floorNumber} saved (demo session only).${linkedNote}`
          : `Floor ${floorNumber} saved.${linkedNote}`,
      });
    } catch (error) {
      setSaveState({ status: 'error', message: error.message });
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const handler = (event) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection) {
          event.preventDefault();
          deleteSelection();
        }
      } else if (event.key === 'Escape') {
        setConnectSourceId(null);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, deleteSelection]);

  /* ------------------------------ render ------------------------------ */

  const hint = {
    select: 'Click a node or connection to edit it. Drag to pan, scroll or pinch to zoom.',
    add: `Click empty space to add a ${TYPE_LABELS[newNodeType].toLowerCase()} node.`,
    connect: connectSourceId
      ? `Click another node to connect it to ${nameOf(connectSourceId)}. Click empty space or press Esc to stop.`
      : 'Click the first node of the connection.',
    move: selectedNode ? `Click where ${selectedNode.name ?? selectedNode.id} should go.` : 'Click a node to pick it up.',
  }[tool];

  const filteredNodes = topology.nodes
    .filter((n) => `${n.name ?? ''} ${n.id} ${n.type}`.toLowerCase().includes(nodeQuery.trim().toLowerCase()))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  const statusText = saveState.message || (dirty ? 'Unsaved changes' : 'No unsaved changes');

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Map Editor"
        description="Add rooms and corridors, connect them, and save the floor's navigation graph."
        actions={(
          <>
            <p
              role="status"
              className={`text-sm font-medium ${
                saveState.status === 'error' ? 'text-red-700' : dirty ? 'text-amber-700' : 'text-slate-600'
              }`}
            >
              {statusText}
            </p>
            <button type="button" onClick={discard} disabled={!dirty} className={BUTTON.secondary}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" />
              Discard
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saveState.status === 'saving'}
              className={BUTTON.primary}
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              {`Save floor ${floorNumber}`}
            </button>
          </>
        )}
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div>
          <label htmlFor="editor-floor" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Floor
          </label>
          <div className="flex gap-2">
            <select
              id="editor-floor"
              value={floorNumber}
              onChange={(event) => changeFloor(Number(event.target.value))}
              disabled={addFloorState.status === 'adding'}
              className={`${INPUT} w-36`}
            >
              {floorNumbers.map((n) => (
                <option key={n} value={n}>{floorExists(n) ? `Floor ${n}` : `Floor ${n} (new)`}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddFloor}
              disabled={addFloorState.status === 'adding'}
              aria-busy={addFloorState.status === 'adding'}
              title="Create the next floor above the highest existing one"
              className={`${BUTTON.secondary} h-10 shrink-0`}
            >
              {addFloorState.status === 'adding'
                ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
                : <Plus aria-hidden="true" className="h-4 w-4" />}
              {addFloorState.status === 'adding' ? 'Adding floor…' : 'Add Floor'}
            </button>
          </div>
        </div>

        <div role="group" aria-label="Editing tool">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tool</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {TOOLS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tool === id}
                onClick={() => selectTool(id)}
                className={`flex h-10 items-center gap-1.5 border-r border-slate-300 px-3 text-sm font-medium last:border-r-0 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-blue-700 ${
                  tool === id ? 'bg-blue-700 text-white' : 'bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="new-node-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            New node type
          </label>
          <select
            id="new-node-type"
            value={newNodeType}
            onChange={(event) => setNewNodeType(event.target.value)}
            className={`${INPUT} w-36`}
          >
            {NODE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </select>
        </div>

        <button
          type="button"
          onClick={() => addNodeAt(canvasSize.width / 2, canvasSize.height / 2)}
          className={`${BUTTON.secondary} h-10`}
        >
          <CirclePlus aria-hidden="true" className="h-4 w-4" />
          Add at center
        </button>

        <label className="flex h-10 items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => setSnap(event.target.checked)}
            className="h-4 w-4 accent-blue-700"
          />
          Snap to grid
        </label>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={editor.past.length === 0}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            className={`${BUTTON.icon} h-10 w-10`}
          >
            <Undo2 aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={editor.future.length === 0}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            className={`${BUTTON.icon} h-10 w-10`}
          >
            <Redo2 aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {addFloorState.status === 'added' && (
        <p role="status" className="-mt-2 mb-4 text-sm font-medium text-emerald-800">{addFloorState.message}</p>
      )}
      {addFloorState.status === 'error' && (
        <div className="-mt-2 mb-4"><ErrorNotice message={addFloorState.message} /></div>
      )}

      {/* Fixed-height workspace: the canvas never resizes when the side panel grows. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="flex h-[60vh] min-h-[24rem] flex-col gap-2 xl:h-[calc(100dvh-18rem)]">
          <div className="min-h-0 flex-1">
            <EditorCanvas
              nodes={topology.nodes}
              edges={topology.edges}
              width={canvasSize.width}
              height={canvasSize.height}
              floorPlanImageUrl={floorDoc?.floor_plan_image_url ?? ''}
              selection={selection}
              connectSourceId={connectSourceId}
              cursor={TOOLS.find((t) => t.id === tool)?.cursor}
              onCanvasClick={handleCanvasClick}
              ariaLabel={`Editable map of floor ${floorNumber}: ${topology.nodes.length} nodes and ${topology.edges.length} connections. Use the node list to select nodes with the keyboard.`}
            />
          </div>
          <p className="flex items-start gap-2 text-sm text-slate-600">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {hint}
          </p>
        </div>

        <div className="space-y-4 xl:max-h-[calc(100dvh-18rem)] xl:min-h-[24rem] xl:overflow-y-auto xl:pr-1">
          {validationErrors.length > 0 && (
            <div role="alert" className="rounded-lg border-2 border-red-700 bg-red-50 p-4 text-sm text-red-900">
              <p className="mb-2 font-semibold">This floor can&apos;t be saved yet:</p>
              <ul className="list-disc space-y-1 pl-5">
                {validationErrors.map((message) => <li key={message}>{message}</li>)}
              </ul>
            </div>
          )}
          {saveState.status === 'error' && validationErrors.length === 0 && (
            <ErrorNotice message={saveState.message} />
          )}

          <Card title={selectedNode ? 'Node properties' : selectedEdge ? 'Connection properties' : 'Properties'}>
            {selectedNode && (
              <NodePanel
                node={selectedNode}
                topology={topology}
                transitionSuggestions={transitionSuggestions}
                onUpdate={(changes) => updateNode(selectedNode.id, changes)}
                onTypeChange={(type) => changeNodeType(selectedNode, type)}
                onDelete={deleteSelection}
                onConnect={(targetId) => connectNodes(selectedNode.id, targetId)}
                onSelectEdge={(edge) => setSelection({ kind: 'edge', source: edge.source, target: edge.target })}
                onDeleteEdge={deleteEdge}
                verticalLinkPanel={verticalLink && (
                  <VerticalLinkPanel
                    node={selectedNode}
                    linked={verticalLink.linked}
                    options={verticalLink.options}
                    onLink={(floor, nodeId) => linkVertical(selectedNode, floor, nodeId)}
                    onUnlink={() => unlinkVertical(selectedNode)}
                  />
                )}
              />
            )}
            {selectedEdge && (
              <EdgePanel
                edge={selectedEdge}
                topology={topology}
                unitsPerMeter={unitsPerMeter}
                onUpdate={(changes) => updateEdge(selectedEdge, changes)}
                onDelete={deleteSelection}
              />
            )}
            {!selectedNode && !selectedEdge && (
              <p className="text-sm text-slate-600">
                Select a node or connection on the map or from the list below to edit its properties.
              </p>
            )}
          </Card>

          <Card title={`Nodes on floor ${floorNumber} (${topology.nodes.length})`}>
            <label htmlFor="node-search" className="sr-only">Search nodes</label>
            <div className="relative mb-3">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="node-search"
                type="search"
                value={nodeQuery}
                onChange={(event) => setNodeQuery(event.target.value)}
                placeholder="Search by name, ID or type"
                className={`${INPUT} pl-9`}
              />
            </div>
            <ul aria-label="Nodes" className="max-h-72 space-y-0.5 overflow-y-auto">
              {filteredNodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: 'node', id: n.id })}
                    aria-current={selectedNode?.id === n.id ? 'true' : undefined}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-700 ${
                      selectedNode?.id === n.id ? 'bg-amber-100 font-semibold text-slate-900' : 'text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{n.name ?? n.id}</span>
                    <span className="shrink-0 text-xs text-slate-500">{TYPE_LABELS[n.type] ?? n.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
