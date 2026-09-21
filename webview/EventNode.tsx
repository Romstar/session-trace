import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { AgentEvent, EventType } from '../src/shared/events';

export interface AgentNodeData extends Record<string, unknown> {
  event: AgentEvent;
  current: boolean;
}

export type AgentFlowNode = Node<AgentNodeData, 'agentEvent'>;

export function EventNode({ data }: NodeProps<AgentFlowNode>) {
  const event = data.event;
  return (
    <div
      className={`ag-node ag-${event.type}${data.current ? ' is-current' : ''}`}
      title={event.label}
      data-event-type={event.type}
      data-seq={String(event.seq)}
    >
      <Handle type="target" position={Position.Left} />
      <span className="ag-kind">{kindLabel(event.type)}</span>
      <span className="ag-label">{event.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function kindLabel(type: EventType): string {
  switch (type) {
    case 'thought':
      return 'thought';
    case 'tool_start':
    case 'tool_end':
      return 'tool';
    case 'shell_start':
    case 'shell_end':
      return 'shell';
    case 'file_edit':
      return 'edit';
    case 'file_read':
      return 'read';
    case 'error':
      return 'error';
    case 'session_start':
    case 'session_end':
      return 'session';
    case 'compact':
      return 'compact';
    case 'mcp_start':
    case 'mcp_end':
      return 'mcp';
    case 'prompt_submit':
      return 'prompt';
    case 'agent_response':
      return 'response';
    case 'subagent_start':
    case 'subagent_stop':
      return 'subagent';
    case 'stop':
      return 'stop';
    default:
      return type;
  }
}
