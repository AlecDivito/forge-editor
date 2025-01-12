import { WebSocketService } from "@/store/socket";
import { createContext, useContext, useEffect } from "react";

const WebSocketContext = createContext(WebSocketService);

export const WebSocketProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  useEffect(() => {
    WebSocketService.connect("ws://localhost:3000/api/socket");

    return () => {
      // Cleanup on unmount if needed
      //   WebSocketService.socket?.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={WebSocketService}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  return useContext(WebSocketContext);
};
