import { SquaresExclude } from "lucide-react";

export function Logo({ size = "default" }: { size?: "default" | "sm" }) {
  const iconSize = size === "sm" ? "w-5 h-5" : "w-7 h-7";
  const textSize = size === "sm" ? "text-lg" : "text-xl";

  return (
    <div className="flex items-center gap-2">
      <SquaresExclude className={`${iconSize} text-primary`} />
      <span
        className={`${textSize} font-semibold tracking-tight`}
        style={{ fontFamily: "var(--font-geist-pixel-line), monospace" }}
      >
        <span className="text-primary">pay</span>
        <span className="text-foreground">an</span>
        <span className="text-primary">agent</span>
      </span>
    </div>
  );
}
