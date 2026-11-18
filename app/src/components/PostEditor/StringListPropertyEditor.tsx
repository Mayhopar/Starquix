import { useEffect, useRef } from 'react';
import { Button, Field, IconButton, Row } from '@/components/ui';
export function StringListPropertyEditor({ value, onChange }: { value: readonly string[]; onChange: (value: string[]) => void }) {
  const ids = useRef<number[]>([]); const next = useRef(0);
  const inputs = useRef(new Map<number, HTMLElement>());
  useEffect(() => { inputs.current.get(ids.current[0])?.focus(); }, []);
  while (ids.current.length < value.length) ids.current.push(next.current++);
  ids.current.length = value.length;
  return <div className="space-y-1">
    {value.map((item, index) => <Row key={ids.current[index]} size="sm" hover={false} className="sq-post-property-item px-0"
      title={<Field ref={element => { if (element) inputs.current.set(ids.current[index], element); }} value={item} aria-label={`Item ${index + 1}`} onChange={text => onChange(value.map((previous, at) => at === index ? text : previous))} />}
      right={[{ type: 'custom', unboxed: true, node: <IconButton aria-label={`Remove item ${index + 1}`} onClick={() => {
        const [removed] = ids.current.splice(index, 1); inputs.current.delete(removed);
        onChange(value.filter((_, at) => at !== index));
        queueMicrotask(() => inputs.current.get(ids.current[Math.min(index, ids.current.length - 1)])?.focus());
      }}>×</IconButton> }]} />)}
    <Button variant="ghost" size="sm" label="Add item" onClick={() => { onChange([...value, '']); queueMicrotask(() => inputs.current.get(ids.current[ids.current.length - 1])?.focus()); }} />
  </div>;
}
