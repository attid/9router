import {
  saveRequestDetail,
  flushRequestDetails,
  getRequestDetails,
  getRequestDetailById,
  iterateRequestDetailJsonRows,
} from "./db/index.js";

// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  saveRequestDetail,
  flushRequestDetails,
  getRequestDetails,
  getRequestDetailById,
};

export async function createRequestDetailsExportStream() {
  await flushRequestDetails();
  const rows = iterateRequestDetailJsonRows();
  const encoder = new TextEncoder();
  const exportedAt = new Date().toISOString();
  let firstRow = true;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        `{"format":"9router-request-details-export","version":1,"exportedAt":${JSON.stringify(exportedAt)},"requestDetails":[`
      ));
    },
    async pull(controller) {
      try {
        const { value, done } = await rows.next();
        if (done) {
          controller.enqueue(encoder.encode("]}\n"));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${firstRow ? "" : ","}${value}`));
        firstRow = false;
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await rows.return?.();
    },
  });
}
