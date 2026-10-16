export const DISCLAIMER =
  "Lodeline provides supply-chain documentation and analysis, not legal advice or government certification. Applicability, exceptions, and acceptance depend on the contract and the responsible reviewer.";

export function Disclaimer({ className = "" }: { className?: string }) {
  return <p className={`text-xs leading-relaxed text-muted ${className}`}>{DISCLAIMER}</p>;
}
