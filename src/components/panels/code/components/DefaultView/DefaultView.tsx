import { IDockviewPanelProps } from "dockview";
import { FC } from "react";

const DefaultView: FC<IDockviewPanelProps> = (props) => {
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        position: "relative",
        padding: 5,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          pointerEvents: "none",
          fontSize: "42px",
          opacity: 0.5,
        }}
      >
        {props.api.title}
      </span>
    </div>
  );
};

export default DefaultView;
