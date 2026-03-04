import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";
import { normalizeUsagePreset, getUsageRange, rangeIncludesNow } from "@/shared/utils/usagePeriod";

export const dynamic = "force-dynamic";

function buildUsageFilter(searchParams) {
  const rawPreset = searchParams.get("preset");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (rawPreset) {
    return { preset: normalizeUsagePreset(rawPreset) };
  }

  if (start || end) {
    return { start: start || null, end: end || null };
  }

  return {};
}

function includesLiveData(filter) {
  if (filter?.preset) {
    return rangeIncludesNow(getUsageRange(filter.preset, new Date()), new Date());
  }
  return rangeIncludesNow(filter, new Date());
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filter = buildUsageFilter(searchParams);
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats && includesLiveData(filter)) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests(filter);
            const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats(filter);
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats || !includesLiveData(filter)) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests(filter);
          const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("pending", state.sendPending);
        }
      };

      await state.send();
      console.log(`[SSE] Client connected | listeners=${statsEmitter.listenerCount("update") + 1}`);

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      statsEmitter.off("pending", state.sendPending);
      clearInterval(state.keepalive);
      console.log("[SSE] Client disconnected");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
