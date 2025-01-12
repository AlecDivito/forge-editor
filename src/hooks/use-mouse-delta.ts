import { RefObject, useCallback, useEffect, useRef, useState } from "react";

const useMouseDelta = (ref?: RefObject<HTMLElement>) => {
  const [result, setResult] = useState(0);
  const dragging = useRef(false);
  const previousClientX = useRef(0);

  const handleMouseMove = useCallback((e: { clientX: number }) => {
    if (!dragging.current) {
      return;
    }

    setResult((result) => {
      const change = e.clientX - previousClientX.current;
      previousClientX.current = e.clientX;
      return result + change;
    });
  }, []);

  const handleMouseDown = useCallback((e: { clientX: number }) => {
    previousClientX.current = e.clientX;
    dragging.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  useEffect(() => {
    if (ref && ref.current) {
      ref.current.addEventListener("mousedown", handleMouseDown, false);
      ref.current.addEventListener("mouseup", handleMouseUp, false);
      ref.current.addEventListener("mousemove", handleMouseMove, false);

      return () => {
        ref.current.removeEventListener("mousedown", handleMouseDown, false);
        ref.current.removeEventListener("mouseup", handleMouseUp, false);
        ref.current.removeEventListener("mousemove", handleMouseMove, false);
      };
    }
  }, [ref, handleMouseDown, handleMouseUp, handleMouseMove]);

  return result === 0 ? "unset" : result;
};

export default useMouseDelta;
