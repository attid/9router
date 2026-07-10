import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildOidcAuthorizationUrl,
  createOidcNonce,
  createOidcState,
  createPkcePair,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
} from "@/lib/auth/oidc";
import { shouldUseSecureCookie } from "@/lib/auth/dashboardSession";
import { appUrl } from "@/shared/utils/basePath.mjs";

export async function GET(request) {
  try {
    const config = await getOidcRuntimeConfig();
    if (!config) {
      return NextResponse.redirect(appUrl("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const state = createOidcState();
    const nonce = createOidcNonce();
    const { verifier, challenge } = createPkcePair();
    const redirectUri = appUrl("/api/auth/oidc/callback", getPublicOrigin(request));
    const authUrl = buildOidcAuthorizationUrl({
      authorizationEndpoint: discovery.authorization_endpoint,
      clientId: config.clientId,
      redirectUri,
      scopes: config.scopes,
      state,
      nonce,
      codeChallenge: challenge,
    });

    const cookieStore = await cookies();
    const baseOptions = {
      httpOnly: true,
      secure: shouldUseSecureCookie(request),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    };
    cookieStore.set("oidc_state", state, baseOptions);
    cookieStore.set("oidc_nonce", nonce, baseOptions);
    cookieStore.set("oidc_code_verifier", verifier, baseOptions);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.redirect(appUrl(`/login?error=${encodeURIComponent(error.message || "oidc_start_failed")}`, getPublicOrigin(request)));
  }
}
