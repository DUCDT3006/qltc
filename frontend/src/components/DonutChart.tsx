import React from 'react';

export const DonutChart: React.FC = () => {
  return (
    <div className="relative w-28 h-28 flex items-center justify-center shrink-0">
      <svg width="108" height="108" viewBox="0 0 42 42">
        {/* Background ring */}
        <circle cx="21" cy="21" r="15.9" fill="none" stroke="#1E2729" strokeWidth="5.2" />
        {/* Cổ phiếu 45% */}
        <circle
          cx="21"
          cy="21"
          r="15.9"
          fill="none"
          stroke="#B8CDD0"
          strokeWidth="5.2"
          strokeDasharray="44 56"
          strokeDashoffset="25"
        />
        {/* Quỹ CCQ 30% */}
        <circle
          cx="21"
          cy="21"
          r="15.9"
          fill="none"
          stroke="#859FA4"
          strokeWidth="5.2"
          strokeDasharray="29 71"
          strokeDashoffset="80"
        />
        {/* Crypto 15% */}
        <circle
          cx="21"
          cy="21"
          r="15.9"
          fill="none"
          stroke="#657D81"
          strokeWidth="5.2"
          strokeDasharray="14 86"
          strokeDashoffset="50"
        />
        {/* Vàng SJC 10% */}
        <circle
          cx="21"
          cy="21"
          r="15.9"
          fill="none"
          stroke="#3F5154"
          strokeWidth="5.2"
          strokeDasharray="9 91"
          strokeDashoffset="35"
        />
        <text x="21" y="20" textAnchor="middle" fill="#869699" fontSize="3.4">
          4 nhóm
        </text>
        <text x="21" y="25" textAnchor="middle" fill="#F2F5F5" fontSize="4.4" fontWeight="700">
          100%
        </text>
      </svg>
    </div>
  );
};
