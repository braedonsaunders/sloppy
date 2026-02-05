import type { JSX } from 'react';
import { useState, useEffect, useRef } from 'react';

export interface ScoreBreakdown {
  security: number;
  bugs: number;
  codeQuality: number;
  maintainability: number;
  reliability: number;
  improvement: number;
}

export interface SloppyScoreProps {
  score: number;
  breakdown?: ScoreBreakdown;
  issuesBefore?: number;
  issuesAfter?: number;
  compact?: boolean;
}

/** Get color based on score range */
function getScoreColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#eab308';
  if (score >= 50) return '#f97316';
  return '#ef4444';
}

/** Get label based on score range */
function getScoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Needs Work';
  return 'Poor';
}

/** Tailwind background class based on score */
function getScoreBgClass(score: number): string {
  if (score >= 90) return 'bg-green-500';
  if (score >= 75) return 'bg-yellow-500';
  if (score >= 50) return 'bg-orange-500';
  return 'bg-red-500';
}

/** Tailwind text class based on score */
function getScoreTextClass(score: number): string {
  if (score >= 90) return 'text-green-400';
  if (score >= 75) return 'text-yellow-400';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
}

const BREAKDOWN_LABELS: Record<keyof ScoreBreakdown, string> = {
  security: 'Security',
  bugs: 'Bugs',
  codeQuality: 'Code Quality',
  maintainability: 'Maintainability',
  reliability: 'Reliability',
  improvement: 'Improvement',
};

const BREAKDOWN_WEIGHTS: Record<keyof ScoreBreakdown, string> = {
  security: '25%',
  bugs: '20%',
  codeQuality: '20%',
  maintainability: '15%',
  reliability: '10%',
  improvement: '10%',
};

/**
 * Animated number counter hook
 */
function useAnimatedNumber(target: number, duration = 1200): number {
  const [current, setCurrent] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now();
    const startValue = 0;

    function animate(now: number): void {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(startValue + (target - startValue) * eased);
      setCurrent(value);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return current;
}

/**
 * Circular score gauge (SVG)
 */
function ScoreGauge({ score, size = 160, compact = false }: { score: number; size?: number; compact?: boolean }): JSX.Element {
  const animatedScore = useAnimatedNumber(score);
  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  const strokeWidth = compact ? 6 : 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (animatedScore / 100) * circumference;
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-dark-700"
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{
            filter: `drop-shadow(0 0 6px ${color}40)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold tabular-nums"
          style={{
            fontSize: compact ? '1.5rem' : '2.5rem',
            lineHeight: 1,
            color,
          }}
        >
          {animatedScore}
        </span>
        {!compact && (
          <span className="text-xs font-medium text-dark-400 mt-1">{label}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Breakdown bar for a single category
 */
function BreakdownBar({
  label,
  weight,
  value,
}: {
  label: string;
  weight: string;
  value: number;
}): JSX.Element {
  const color = getScoreColor(value);
  const bgClass = getScoreBgClass(value);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-dark-300 font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-dark-500">{weight}</span>
          <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-dark-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${bgClass}`}
          style={{ width: `${String(value)}%`, opacity: 0.85 }}
        />
      </div>
    </div>
  );
}

/**
 * SloppyScore - A visually striking score display component
 * Designed to be screenshot-worthy, like a Lighthouse score
 */
export default function SloppyScore({
  score,
  breakdown,
  issuesBefore,
  issuesAfter,
  compact = false,
}: SloppyScoreProps): JSX.Element {
  const scoreTextClass = getScoreTextClass(score);

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <ScoreGauge score={score} size={56} compact />
        <div className="min-w-0">
          <p className={`text-xs font-semibold ${scoreTextClass}`}>
            {getScoreLabel(score)}
          </p>
          {issuesBefore !== undefined && issuesAfter !== undefined && (
            <p className="text-xs text-dark-500 truncate">
              {issuesBefore - issuesAfter} fixed
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-dark-200 uppercase tracking-wider">
          Sloppy Score
        </h3>
        {issuesBefore !== undefined && issuesAfter !== undefined && (
          <div className="flex items-center gap-3 text-xs text-dark-400">
            <span>{issuesBefore} issues found</span>
            <span className="text-dark-600">|</span>
            <span className="text-green-400">{issuesBefore - issuesAfter} fixed</span>
          </div>
        )}
      </div>

      {/* Score Gauge */}
      <div className="flex justify-center py-4">
        <ScoreGauge score={score} size={160} />
      </div>

      {/* Breakdown */}
      {breakdown && (
        <div className="mt-6 space-y-3">
          <h4 className="text-xs font-medium text-dark-400 uppercase tracking-wider mb-3">
            Breakdown
          </h4>
          {(Object.keys(BREAKDOWN_LABELS) as Array<keyof ScoreBreakdown>).map((key) => (
            <BreakdownBar
              key={key}
              label={BREAKDOWN_LABELS[key]}
              weight={BREAKDOWN_WEIGHTS[key]}
              value={breakdown[key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
