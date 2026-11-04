import React from 'react';

export const Sparkline: React.FC = () => {
  return (
    <div className="w-full h-11 mt-1 overflow-hidden">
      <svg width="100%" height="44" viewBox="0 0 320 44" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8BA5AA" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#657D81" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,34 C40,32 55,22 90,25 C125,28 150,14 185,17 C220,20 245,8 280,10 C300,11 310,4 320,4 L320,44 L0,44 Z"
          fill="url(#sparkGrad)"
        />
        <path
          d="M0,34 C40,32 55,22 90,25 C125,28 150,14 185,17 C220,20 245,8 280,10 C300,11 310,4 320,4"
          fill="none"
          stroke="#95B0B4"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="320" cy="4" r="3.5" fill="#F2F5F5" />
      </svg>
    </div>
  );
};
