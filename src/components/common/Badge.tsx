import React from 'react';

interface BadgeProps {
  count: number;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ count, className = '' }) => {
  if (count === 0) return null;

  return (
    <span className={`
      inline-flex items-center justify-center px-2 py-1
      text-xs font-bold leading-none text-white
      bg-red-600 rounded-full
      ${className}
    `}>
      {count > 99 ? '99+' : count}
    </span>
  );
};