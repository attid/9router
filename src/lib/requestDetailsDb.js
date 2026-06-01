import fs from "node:fs/promises";

import {
  saveRequestDetail,
  getRequestDetails,
  getRequestDetailById,
} from "./db/index.js";

// Shim -> re-export from new SQLite-based DB layer (src/lib/db/).
export {
  saveRequestDetail,
  getRequestDetails,
  getRequestDetailById,
};

export async function getRequestDetailsDb() {
  return {
    async backup(destinationPath) {
      const { details } = await getRequestDetails({ page: 1, pageSize: Number.MAX_SAFE_INTEGER });
      await fs.writeFile(destinationPath, JSON.stringify(details, null, 2));
      return destinationPath;
    },
  };
}
