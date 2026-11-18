// src/components/CreateProjectCard.tsx
import { Card } from '@/components/ui';
import { PlusLargeIcon as PlusIcon } from '@/assets/icons';

interface CreateProjectCardProps {
  onClick: () => void;
}

export function CreateProjectCard({ onClick }: CreateProjectCardProps) {
  return (
    <Card
      interactive
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full text-left bg-bg rounded-lg transition-all duration-200"
    >
      {/* Preview area with plus icon */}
      <div className="relative aspect-video bg-bg-contrast border-b border-stroke">
        <div className="absolute inset-0 flex items-center justify-center">
          <PlusIcon className="w-6 h-6 text-text-secondary" />
        </div>
      </div>

      {/* Card footer */}
      <div className="flex items-center justify-between px-3 py-2 h-10">
        <div>
          <p className="text-sm-medium text-text">Create new project</p>
        </div>
      </div>
    </Card>
  );
}
