import React from 'react';

interface SparklineProps {
  points?: number[];
  color?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({ points, color = '#8CC7AE' }) => {
  // Nếu không có dữ liệu hoặc toàn số 0, vẽ đường baseline phẳng trung tính
  const validPoints = points && points.length >= 2 ? points : [0, 0, 0, 0, 0, 0, 0];
  const minVal = Math.min(...validPoints);
  const maxVal = Math.max(...validPoints);
  const isFlat = minVal === maxVal;

  const width = 320;
  const height = 40;
  const paddingY = 6;

  // Tính tọa độ SVG cho các điểm
  const coordinates = validPoints.map((v, idx) => {
    const x = (idx / (validPoints.length - 1)) * width;
    let y = height / 2;
    if (!isFlat) {
      y = height - paddingY - ((v - minVal) / (maxVal - minVal)) * (height - paddingY * 2);
    }
    return { x, y };
  });

  // Tạo đường dẫn path d
  let pathD = `M ${coordinates[0].x},${coordinates[0].y}`;
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    const cpX = (prev.x + curr.x) / 2;
    pathD += ` C ${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y}`;
  }

  const fillD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const strokeColor = isFlat ? '#657D81' : color;
  const lastPoint = coordinates[coordinates.length - 1];

  return (
    <div className="w-full h-11 mt-1 overflow-hidden">
      <svg width="100%" height="44" viewBox="0 0 320 44" preserveAspectRatio="none">
        <defs>
          <linearGradient id="dynamicSparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity={isFlat ? 0.08 : 0.28} />
            <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#dynamicSparkGrad)" />
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="3.5" fill={isFlat ? '#95B0B4' : '#F2F5F5'} />
      </svg>
    </div>
  );
};
