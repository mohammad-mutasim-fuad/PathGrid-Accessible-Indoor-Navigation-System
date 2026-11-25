import {
  useCallback, useEffect, useMemo, useReducer, useState,
} from 'react';
import {
  CirclePlus, Info, Link2, MousePointer2, Move, Redo2, RotateCcw, Save, Search, Spline, Trash, Undo2,
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
  computeEdgeWeight,
  connects,
  createNode,
  editorReducer,
  initEditorState,
  isTopologyChanged,
  nextNodeId,
  nextTransitionId,
  typeChangeDefaults,
  validateFloorForBuilding,
} from '../../services/topologyEditor';
import { getCanvasSize } from '../../services/routeUtils';

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

function NodePanel({
  node, topology, transitionSuggestions, onUpdate, onTypeChange, onDelete, onConnect, onSelectEdge, onDeleteEdge,
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
    building, floors, saveFloorTopology, mode,
  } = useAdminData();

  // Existing floors plus 1..total_floors (at least Floor 1), so a building with
  // no floor documents yet can still be drawn; saving creates the floor.
  const floorNumbers = useMemo(() => {
    const declared = Number.isInteger(building?.total_floors) && building.total_floors > 0 ? building.total_floors : 1;
    const numbers = new Set(floors.map((f) => f.floor_number));
    for (let n = 1; n <= declared; n += 1) numbers.add(n);
    return [...numbers].sort((a, b) => a - b);
  }, [floors, building]);
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
  const [validationErrors, setValidationErrors] = useState([]);
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });

  const { topology } = editor;
  const dirty = isTopologyChanged(topology, savedTopology);
  const unitsPerMeter = building?.units_per_meter ?? DEFAULT_UNITS_PER_METER;

  // Load the floor (on floor switch and after a save refreshes the data).
  useEffect(() => {
    dispatch({ type: 'reset', topology: savedTopology });
    setSelection(null);
    setConnectSourceId(null);
    setValidationErrors([]);
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

  const otherFloorNodes = useMemo(
    () => floors.filter((f) => f.floor_number !== floorNumber).flatMap((f) => f.graph_topology?.nodes ?? []),
    [floors, floorNumber],
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

  const changeFloor = (next) => {
    if (next === floorNumber) return;
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm(`Discard unsaved changes on floor ${floorNumber}?`)) return;
    setFloorNumber(next);
    clearTransient();
  };

  const discard = () => {
    dispatch({ type: 'reset', topology: savedTopology });
    setSelection(null);
    setConnectSourceId(null);
    clearTransient();
  };

  const save = async () => {
    const errors = validateFloorForBuilding(floors, floorNumber, topology);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setSaveState({ status: 'error', message: 'Fix the problems below before saving.' });
      return;
    }
    setSaveState({ status: 'saving', message: 'Saving…' });
    try {
      await saveFloorTopology(floorNumber, topology);
      setSaveState({
        status: 'saved',
        message: mode === 'demo' ? `Floor ${floorNumber} saved (demo session only).` : `Floor ${floorNumber} saved.`,
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
          <select
            id="editor-floor"
            value={floorNumber}
            onChange={(event) => changeFloor(Number(event.target.value))}
            className={`${INPUT} w-32`}
          >
            {floorNumbers.map((n) => <option key={n} value={n}>{`Floor ${n}`}</option>)}
          </select>
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
