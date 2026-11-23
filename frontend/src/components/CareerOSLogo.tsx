export default function CareerOSLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-[#0E131F] border border-cyan-500/25 flex items-center justify-center p-1.5 shadow-sm shadow-cyan-950/40 shrink-0 ${className}`}
    >
      <svg
        viewBox="0 0 256 256"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <title>CareerOS</title>
        {/* Inner Trailing Chevron: Vault Base & Prompt */}
        <path
          d="M 64 72 L 120 128 L 64 184"
          stroke="#94A3B8"
          strokeWidth="32"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Outer Leading Chevron: Electric Cyan Pipeline Acceleration */}
        <path
          d="M 136 72 L 192 128 L 136 184"
          stroke="#22D3EE"
          strokeWidth="32"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
