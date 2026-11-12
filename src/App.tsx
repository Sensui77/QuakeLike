import { useEffect, useRef } from "react";
import { Game } from "./game/game";

export default function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const game = new Game(ref.current);
    return () => game.dispose();
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 overflow-hidden bg-black select-none"
      style={{ cursor: "crosshair", touchAction: "none" }}
    />
  );
}
