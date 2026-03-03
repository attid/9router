export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

export function buildRequestPayload({ apiMode, model, prompt, imageDataUrl }) {
  const normalizedPrompt = String(prompt || "").trim();
  const normalizedImage = imageDataUrl || null;

  if (apiMode === "responses") {
    const content = [{ type: "input_text", text: normalizedPrompt }];
    if (normalizedImage) {
      content.push({ type: "image_url", image_url: { url: normalizedImage } });
    }

    return {
      model,
      stream: false,
      input: [{ role: "user", content }],
    };
  }

  const content = [{ type: "text", text: normalizedPrompt }];
  if (normalizedImage) {
    content.push({ type: "image_url", image_url: { url: normalizedImage } });
  }

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

    if (Array.isArray(data.output)) {
      const text = data.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .filter((part) => part?.type === "output_text" && typeof part?.text === "string")
        .map((part) => part.text)
        .join("");
      if (text) return text;
    }
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === "text" && typeof part?.text === "string")
      .map((part) => part.text)
      .join("");
  }

  return "";
}

export async function fileToDataUrl(file, maxSizeBytes = MAX_IMAGE_SIZE_BYTES) {
  if (!file || !(file instanceof File)) {
    throw new Error("File is required");
  }

  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("Only image files are supported");
  }

  if (file.size > maxSizeBytes) {
    const mb = Math.round((maxSizeBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(`Image is too large. Max ${mb}MB`);
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

export function maskApiKey(value) {
  const raw = String(value || "");
  if (!raw) return "(empty)";
  if (raw.length <= 4) {
    const keep = Math.max(1, Math.floor(raw.length / 2));
    return `${raw.slice(0, keep)}...${raw.slice(-keep)}`;
  }
  return `${raw.slice(0, 3)}...${raw.slice(-4)}`;
}
