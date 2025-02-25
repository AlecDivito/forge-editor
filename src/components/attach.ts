"use client";

import { AttachAddon } from "@xterm/addon-attach";

export default (sockets: any): AttachAddon => {
  return new AttachAddon(sockets);
};
