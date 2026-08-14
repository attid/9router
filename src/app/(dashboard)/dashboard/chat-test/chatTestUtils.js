export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export function scheduleRequestAbort(controller, timeoutMs = 0) {
  if (!controller || typeof controller.abort !== "function") return () => {};

  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) return () => {};

  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return () => clearTimeout(timeoutId);
}

export function buildRequestPayload({ apiMode, model, prompt, imageDataUrl }) {
  const text = String(prompt || "").trim();

  if (apiMode === "responses") {
    const content = [{ type: "input_text", text }];
    if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl });

    return {
      model,
      stream: false,
      input: [{ role: "user", content }],
    };
  }

  const content = [{ type: "text", text }];
  if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });

  return {
    model,
    stream: false,
    messages: [{ role: "user", content }],
  };
}

export function extractAssistantText(apiMode, data) {
  if (!data || typeof data !== "object") return "";

  if (apiMode === "responses") {
    if (typeof data.output_text === "string") return data.output_text;

    const outputText = Array.isArray(data.output)
      ? data.output
          .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
          .filter((part) => part?.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("")
      : "";
    if (outputText) return outputText;
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export async function fileToDataUrl(file, maxSizeBytes = MAX_IMAGE_SIZE_BYTES) {
  if (!file || typeof File === "undefined" || !(file instanceof File)) {
    throw new Error("File is required");
  }
  if (!file.type?.startsWith("image/")) {
    throw new Error("Only image files are supported");
  }
  if (file.size > maxSizeBytes) {
    const maxMb = Math.round((maxSizeBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(`Image is too large. Max ${maxMb}MB`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export function maskApiKey(value) {
  const key = String(value || "");
  if (!key) return "(empty)";
  if (key.length <= 4) {
    const keep = Math.max(1, Math.floor(key.length / 2));
    return `${key.slice(0, keep)}...${key.slice(-keep)}`;
  }
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}
