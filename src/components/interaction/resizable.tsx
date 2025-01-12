import React, { useState, useRef, ReactNode } from "react";

export interface ResizableSide {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

export type ResizableSides = keyof ResizableSide;

interface ResizableComponentProps {
  children?: ReactNode;
  className?: string;
  width?: number;
  height?: number;
  resizableSides: ResizableSide;
  onResize?: (side: ResizableSides, size: number) => void;
}

const ResizableComponent: React.FC<ResizableComponentProps> = ({
  children,
  className,
  onResize,
  resizableSides = { right: true },
  width: inputWidth = 300,
  height: inputHeight = 200,
}) => {
  const [width, setWidth] = useState(inputWidth); // Default width in pixels
  const [height, setHeight] = useState(inputHeight); // Default height in pixels
  const [side, setSide] = useState<ResizableSides | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef({
    left: false,
    right: false,
    top: false,
    bottom: false,
  });

  const handleMouseDown = (side: keyof typeof isResizing.current) => () => {
    isResizing.current[side] = true;
    setSide(side);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();

      if (isResizing.current.right) {
        const newWidth = e.clientX - rect.left;
        if (newWidth > 100) setWidth(newWidth);
      } else if (isResizing.current.left) {
        const newWidth = rect.right - e.clientX;
        if (newWidth > 100) {
          setWidth(newWidth);
          onResize?.(side!, newWidth);
          containerRef.current.style.left = `${e.clientX}px`;
        }
      } else if (isResizing.current.bottom) {
        const newHeight = e.clientY - rect.top;
        if (newHeight > 50) setHeight(newHeight);
      } else if (isResizing.current.top) {
        const newHeight = rect.bottom - e.clientY;
        if (newHeight > 50) {
          setHeight(newHeight);
          onResize?.(side!, newHeight);
          containerRef.current.style.top = `${e.clientY}px`;
        }
      }
    }
  };

  const handleMouseUp = () => {
    Object.keys(isResizing.current).forEach((key) => {
      isResizing.current[key as keyof typeof isResizing.current] = false;
    });
    setSide(null);
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full ${className}`}
      style={{
        width:
          resizableSides.left || resizableSides.right ? `${width}px` : "auto",
        height:
          resizableSides.top || resizableSides.bottom ? `${height}px` : "auto",
        position: "relative",
      }}
    >
      <div
        style={{
          paddingTop: resizableSides?.top ? 5 : 0,
          paddingLeft: resizableSides?.left ? 5 : 0,
          paddingRight: resizableSides?.right ? 5 : 0,
          paddingBottom: resizableSides?.bottom ? 5 : 0,
        }}
      >
        {children}
      </div>
      {resizableSides.right && (
        <div
          className="absolute top-0 right-0 h-full bg-gray-500 cursor-ew-resize"
          style={{ width: "5px" }}
          onMouseDown={handleMouseDown("right")}
        ></div>
      )}
      {resizableSides.left && (
        <div
          className="absolute top-0 left-0 h-full bg-gray-500 cursor-ew-resize"
          style={{ width: "5px" }}
          onMouseDown={handleMouseDown("left")}
        ></div>
      )}
      {resizableSides.bottom && (
        <div
          className="absolute bottom-0 left-0 w-full bg-gray-500 cursor-ns-resize"
          style={{ height: "5px" }}
          onMouseDown={handleMouseDown("bottom")}
        ></div>
      )}
      {resizableSides.top && (
        <div
          className="absolute top-0 left-0 w-full bg-gray-500 cursor-ns-resize"
          style={{ height: "5px" }}
          onMouseDown={handleMouseDown("top")}
        ></div>
      )}
    </div>
  );
};

export default ResizableComponent;
