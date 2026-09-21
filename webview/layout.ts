/**
 * Build a left-to-right graph with dagre.
 * Subagent events sit on a child lane off the parent tool node.
 */

import dagre from 'dagre';
import type { AgentEvent } from '../src/shared/events';

export const NODE_WIDTH = 188;
export const NODE_HEIGHT = 52;

export interface LayoutNode {
  id: string;
  event: AgentEvent;
  x: number;
  y: number;
  current: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  branch: boolean;
}

export function eventKey(event: AgentEvent): string {
  const safe = event.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}_${event.seq}`;
}

export function layoutEvents(events: AgentEvent[]): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  if (events.length === 0) {
    return { nodes: [], edges: [] };
  }

  const laneOf = assignLanes(events);
  const edges = connect(events, laneOf);
  const positions = runDagre(events, edges);
  const currentKey = eventKey(events[events.length - 1]);

  const nodes: LayoutNode[] = events.map((event, index) => {
    const id = eventKey(event);
    const point = positions.get(id) ?? { x: index * (NODE_WIDTH + 40), y: laneOf[index] * 90 };
    return {
      id,
      event,
      x: point.x,
      y: point.y,
      current: id === currentKey,
    };
  });

  return { nodes, edges };
}

function assignLanes(events: AgentEvent[]): number[] {
  const laneOf = new Array<number>(events.length).fill(0);
  const toolIndexByUseId = new Map<string, number>();
  const stack: { key: string; lane: number }[] = [];
  let nextLane = 1;

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const key = readKey(event);

    if (event.type === 'subagent_start') {
      const lane = nextLane++;
      laneOf[index] = lane;
      stack.push({ key: key || `sub-${index}`, lane });
      rememberTool(event, index, toolIndexByUseId);
      continue;
    }

    if (event.type === 'subagent_stop' && stack.length > 0) {
      const match = key ? stack.findIndex((item) => item.key === key) : stack.length - 1;
      const open = stack[match >= 0 ? match : stack.length - 1];
      laneOf[index] = open.lane;
      stack.splice(match >= 0 ? match : stack.length - 1, 1);
      continue;
    }

    const open = key ? stack.find((item) => item.key === key) : undefined;
    laneOf[index] = open ? open.lane : 0;
    rememberTool(event, index, toolIndexByUseId);
  }

  return laneOf;
}

function connect(events: AgentEvent[], laneOf: number[]): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  const byLane = new Map<number, number[]>();
  for (let index = 0; index < events.length; index++) {
    const lane = laneOf[index];
    const list = byLane.get(lane) ?? [];
    list.push(index);
    byLane.set(lane, list);
  }

  for (const indexes of byLane.values()) {
    for (let cursor = 1; cursor < indexes.length; cursor++) {
      const source = indexes[cursor - 1];
      const target = indexes[cursor];
      edges.push({
        id: `e-${eventKey(events[source])}-${eventKey(events[target])}`,
        source: eventKey(events[source]),
        target: eventKey(events[target]),
        branch: false,
      });
    }
  }

  const toolIndexByUseId = new Map<string, number>();
  for (let index = 0; index < events.length; index++) {
    rememberTool(events[index], index, toolIndexByUseId);
    if (events[index].type !== 'subagent_start') {
      continue;
    }
    const parent = findParentIndex(events, index, laneOf, toolIndexByUseId);
    if (parent < 0) {
      continue;
    }
    edges.push({
      id: `b-${eventKey(events[parent])}-${eventKey(events[index])}`,
      source: eventKey(events[parent]),
      target: eventKey(events[index]),
      branch: true,
    });
  }

  return edges;
}

function findParentIndex(
  events: AgentEvent[],
  index: number,
  laneOf: number[],
  toolIndexByUseId: Map<string, number>,
): number {
  const event = events[index];
  const toolCallId = event.detail?.toolCallId ?? event.detail?.parentToolUseId;
  if (typeof toolCallId === 'string' && toolIndexByUseId.has(toolCallId)) {
    return toolIndexByUseId.get(toolCallId) ?? -1;
  }
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (laneOf[cursor] !== 0) {
      continue;
    }
    const type = events[cursor].type;
    if (type === 'tool_start' || type === 'mcp_start' || type === 'shell_start') {
      return cursor;
    }
  }
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (laneOf[cursor] === 0) {
      return cursor;
    }
  }
  return -1;
}

function rememberTool(event: AgentEvent, index: number, toolIndexByUseId: Map<string, number>): void {
  if (event.type !== 'tool_start' && event.type !== 'mcp_start' && event.type !== 'shell_start') {
    return;
  }
  const useId = event.detail?.toolUseId;
  if (typeof useId === 'string' && useId) {
    toolIndexByUseId.set(useId, index);
  }
}

function readKey(event: AgentEvent): string {
  const value = event.detail?.subagentId;
  return typeof value === 'string' ? value : '';
}

function runDagre(events: AgentEvent[], edges: LayoutEdge[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 84,
    ranksep: 56,
    marginx: 12,
    marginy: 12,
  });

  for (const event of events) {
    graph.setNode(eventKey(event), { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target, { weight: edge.branch ? 1 : 4 });
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const event of events) {
    const id = eventKey(event);
    const node = graph.node(id);
    if (!node) {
      continue;
    }
    positions.set(id, {
      x: node.x - NODE_WIDTH / 2,
      y: node.y - NODE_HEIGHT / 2,
    });
  }
  return positions;
}
