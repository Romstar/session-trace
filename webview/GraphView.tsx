import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
} from '@xyflow/react';
import type { AgentEvent } from '../src/shared/events';
import { EventNode, type AgentFlowNode } from './EventNode';
import { layoutEvents } from './layout';

const nodeTypes = { agentEvent: EventNode };

function toFlowNodes(model: ReturnType<typeof layoutEvents>, selectedKey: string | null): AgentFlowNode[] {
  return model.nodes.map((node) => ({
    id: node.id,
    type: 'agentEvent',
    position: { x: node.x, y: node.y },
    data: { event: node.event, current: node.current },
    selected: node.id === selectedKey,
    draggable: true,
  }));
}

function toFlowEdges(model: ReturnType<typeof layoutEvents>): Edge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.branch,
    style: edge.branch
      ? { stroke: '#e879f9', strokeDasharray: '5 4' }
      : { stroke: 'var(--vscode-descriptionForeground, #9ca3af)' },
  }));
}

interface GraphViewProps {
  events: AgentEvent[];
  followLive: boolean;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function GraphView(props: GraphViewProps) {
  const model = useMemo(() => layoutEvents(props.events), [props.events]);
  return (
    <ReactFlowProvider>
      <FlowCanvas {...props} model={model} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({
  model,
  followLive,
  selectedKey,
  onSelect,
}: GraphViewProps & { model: ReturnType<typeof layoutEvents> }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>(toFlowNodes(model, selectedKey));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(model));
  const { setCenter, getNode } = useReactFlow();

  useEffect(() => {
    setNodes(toFlowNodes(model, selectedKey));
    setEdges(toFlowEdges(model));
  }, [model, selectedKey, setNodes, setEdges]);

  const currentId = model.nodes.find((node) => node.current)?.id;

  useEffect(() => {
    if (!followLive || !currentId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const node = getNode(currentId);
      if (!node) {
        return;
      }
      setCenter(node.position.x + 94, node.position.y + 26, { duration: 200, zoom: 1 });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [currentId, followLive, model, getNode, setCenter]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_event, node) => onSelect(node.id)}
      fitView
      nodesConnectable={false}
      deleteKeyCode={null}
      minZoom={0.25}
      maxZoom={1.6}
    >
      <Background gap={18} color="rgba(128, 128, 128, 0.25)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
