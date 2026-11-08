import React from 'react';

interface Segment {
  label: string;
  percent: number;
  color: string;
}

interface DonutChartProps {
  segments?: Segment[];
  centerLabel?: string;
  centerValue?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  segments,
  centerLabel = 'Tài sản',
  centerValue = '0%'
}) => {
  // V2-24: Không dùng danh mục mẫu ảo nếu người dùng chưa có tài sản
  const hasData = segments && segments.length > 0 && segments.some(s => s.percent > 0);
  const activeSegments = hasData ? segments! : [];
  const circumference = 100;
  let accumulated = 0;

  return (
    <div className="relative w-28 h-28 flex items-center justify-center shrink-0">
      <svg width="108" height="108" viewBox="0 0 42 42">
        {/* Vòng nền */}
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#1E2729" strokeWidth="5.2" />

        {activeSegments.map((seg, idx) => {
          if (seg.percent <= 0) return null;
          const strokeDasharray = `${seg.percent} ${circumference - seg.percent}`;
          const strokeDashoffset = 25 - accumulated;
          accumulated += seg.percent;

          return (
            <circle
              key={idx}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke={seg.color}
              strokeWidth="5.2"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          );
        })}

        <text x="21" y="19.5" textAnchor="middle" fill="#869699" fontSize="3.2">
          {centerLabel}
        </text>
        <text x="21" y="24.8" textAnchor="middle" fill="#F2F5F5" fontSize="4.2" fontWeight="700">
          {centerValue}
        </text>
      </svg>
    </div>
  );
};
