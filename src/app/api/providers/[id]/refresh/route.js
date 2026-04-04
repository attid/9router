import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { getAccessToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";

function decodeJwtPayload(token) {
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function toSafeConnection(connection) {
  return {
    ...connection,
    tokenInfo: {
      accessTokenExpiresAt: connection.expiresAt || null,
      idTokenClaims: decodeJwtPayload(connection.idToken),
      hasRefreshToken: !!connection.refreshToken,
      authType: connection.authType,
    },
    apiKey: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    idToken: undefined,
  };
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.authType !== "oauth") {
      return NextResponse.json({ error: "Only OAuth connections can be refreshed" }, { status: 400 });
    }

    if (!connection.refreshToken) {
      return NextResponse.json({ error: "Refresh token is not available for this connection" }, { status: 400 });
    }

    const refreshed = await getAccessToken(connection.provider, {
      ...connection,
      connectionId: id,
    });

    if (!refreshed?.accessToken) {
      return NextResponse.json({ error: "Token refresh did not return new credentials" }, { status: 502 });
    }

    await updateProviderCredentials(id, refreshed);

    const updatedConnection = await getProviderConnectionById(id);

    return NextResponse.json({ connection: toSafeConnection(updatedConnection || connection) });
  } catch (error) {
    console.error("Error refreshing provider token", {
      message: error?.message,
      status: error?.status,
      details: error?.details,
    });

    return NextResponse.json(
      {
        error: error?.message || "Failed to refresh token",
        ...(error?.details ? { details: error.details } : {}),
      },
      { status: error?.status || 500 }
    );
  }
}
