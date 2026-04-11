type SkeletonLineWidth = 'full' | '3/4' | '1/2' | '1/3';
type SkeletonLineHeight = 'sm' | 'md';

const widthClass: Record<SkeletonLineWidth, string> = {
  full: 'w-full',
  '3/4': 'w-3/4',
  '1/2': 'w-1/2',
  '1/3': 'w-1/3',
};

const heightClass: Record<SkeletonLineHeight, string> = {
  sm: 'h-3',
  md: 'h-4',
};

export function SkeletonLine({
  width = 'full',
  height = 'md',
}: {
  width?: SkeletonLineWidth;
  height?: SkeletonLineHeight;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${widthClass[width]} ${heightClass[height]}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card-surface p-4 space-y-3">
      <SkeletonLine width="3/4" />
      <SkeletonLine width="full" />
      <SkeletonLine width="1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-subtle bg-elevated">
      <table className="w-full border-collapse">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-subtle last:border-0">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="p-3 align-middle">
                  <SkeletonLine width="full" height="sm" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
