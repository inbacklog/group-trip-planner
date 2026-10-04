import type { Page } from "@playwright/test";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const GROUP_ID = "22222222-2222-4222-8222-222222222222";
export const TRIP_ID = "33333333-3333-4333-8333-333333333333";
export const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};
export const group = {
  id: GROUP_ID,
  name: "Συνθετική παρέα",
  created_by: USER_ID,
  created_at: "2026-01-01T00:00:00Z",
};
export const trip = {
  id: TRIP_ID,
  group_id: GROUP_ID,
  name: "Συνθετικό ταξίδι",
  currency: "EUR",
  timezone: "UTC",
  details: {} as Record<string, unknown>,
  created_by: USER_ID,
  version: 1,
  start_date: null as string | null,
  created_at: "2026-01-01T00:00:00Z",
};

/** UI transport mock only; authorization is tested separately in real PostgreSQL. */
export async function installFixture(
  page: Page,
  options: {
    signedIn?: boolean;
    withGroup?: boolean;
    withTrip?: boolean;
    failGroups?: boolean;
    memberRole?: "owner" | "member";
  } = {},
) {
  const state = {
    groups: options.withGroup ? [group] : ([] as (typeof group)[]),
    trips: options.withTrip ? [trip] : ([] as (typeof trip)[]),
    stops: [] as Record<string, unknown>[],
    activities: [] as Record<string, unknown>[],
    displayName: "",
    mutations: [] as { path: string; body: Record<string, unknown> }[],
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({ sub: USER_ID, role: "authenticated", exp: expires }),
    ).toString("base64url"),
    "synthetic-signature",
  ].join(".");
  const session = {
    access_token: token,
    refresh_token: "synthetic-refresh-only",
    expires_at: expires,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  if (options.signedIn) {
    await page.addInitScript((sessionValue) => {
      localStorage.setItem(
        "sb-synthetic-auth-token",
        JSON.stringify(sessionValue),
      );
    }, session);
  }
  await page.route("**/*.supabase.co/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "synthetic.supabase.co")
      throw new Error(
        "Browser test tried to access a non-synthetic Supabase project",
      );
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()!) : {};
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !path.includes("/rpc/get_"))
      state.mutations.push({ path, body });
    const respond = (payload: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    if (path.endsWith("/auth/v1/user")) return respond(user);
    if (path.endsWith("/auth/v1/token")) return respond(session);
    if (path.endsWith("/auth/v1/signup"))
      return respond({ user, session: null });
    if (path.endsWith("/auth/v1/logout") || path.endsWith("/auth/v1/recover"))
      return respond({});
    if (path.endsWith("/rpc/create_group")) {
      state.groups = [{ ...group, name: String(body.p_name) }];
      return respond(GROUP_ID);
    }
    if (path.endsWith("/rpc/create_trip")) {
      state.trips = [{ ...trip, name: String(body.p_name) }];
      state.stops =
        body.p_template === "china"
          ? ["Σαγκάη", "Πεκίνο"].map((name, index) => ({
              id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
              trip_id: TRIP_ID,
              name,
              position: index,
              version: 1,
            }))
          : [];
      return respond(TRIP_ID);
    }
    if (path.endsWith("/rpc/accept_invitation")) {
      state.groups = [group];
      return respond(GROUP_ID);
    }
    if (path.endsWith("/rpc/create_invitation")) return respond("a".repeat(64));
    if (path.endsWith("/rpc/import_private_trip")) {
      state.trips = [{ ...trip, ...body.p_payload.trip }];
      return respond(TRIP_ID);
    }
    if (path.endsWith("/rpc/create_item")) {
      const fields = body.p_fields;
      if ("created_by" in fields)
        return respond(
          { code: "42501", message: "Author must be derived from session" },
          403,
        );
      const id = "55555555-5555-4555-8555-555555555555";
      state.activities.push({
        ...fields,
        id,
        trip_id: body.p_trip_id,
        created_by: USER_ID,
        version: 1,
      });
      return respond(id);
    }
    if (path.endsWith("/rpc/set_member_display_name")) {
      state.displayName = String(body.p_display_name);
      return respond(null);
    }
    if (path.endsWith("/rpc/get_activity_collaboration") || path.endsWith("/rpc/get_preference_snapshot") || path.endsWith("/rpc/get_plan_snapshot")) {
      const current = state.trips[0];
      if (!current || (body.p_activity_id && !state.activities.some((activity) => activity.id === body.p_activity_id))) return respond(null);
      return respond({ trip: current, preferences: [], comments: [], days: [], items: [], approvals: [], activities: state.activities, stops: state.stops, members: [{ group_id: GROUP_ID, user_id: USER_ID, role: options.memberRole ?? "owner", display_name: state.displayName }], participants: [{ trip_id: TRIP_ID, user_id: USER_ID, status: "going" }] });
    }
    if (path.includes("/rpc/")) return respond(null);
    if (path.endsWith("/groups"))
      return options.failGroups
        ? respond({ code: "42P01", message: "relation does not exist" }, 404)
        : respond(state.groups);
    if (path.endsWith("/group_members"))
      return respond(
        state.groups.length
          ? [
              {
                group_id: GROUP_ID,
                user_id: USER_ID,
                role: options.memberRole ?? "owner",
                display_name: state.displayName,
              },
            ]
          : [],
      );
    if (path.endsWith("/trips")) return respond(state.trips);
    if (path.endsWith("/trip_stops")) return respond(state.stops);
    if (path.endsWith("/activities")) {
      if (request.method() === "PATCH") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const item = state.activities.find((entry) => entry.id === id);
        if (
          !item ||
          String(item.version) !==
            url.searchParams.get("version")?.replace(/^eq\./, "")
        )
          return respond([]);
        Object.assign(item, body, { version: Number(item.version) + 1 });
        return respond([{ id }]);
      }
      if (request.method() === "POST") {
        if ("created_by" in body)
          return respond(
            {
              code: "42501",
              message: "permission denied for column created_by",
            },
            403,
          );
        state.activities.push({
          ...body,
          id: "55555555-5555-4555-8555-555555555555",
          created_by: USER_ID,
          version: 1,
        });
        return respond(null, 201);
      }
      return respond(state.activities);
    }
    if (path.endsWith("/trip_participants"))
      return respond(
        state.trips.length
          ? [{ trip_id: TRIP_ID, user_id: USER_ID, status: "going" }]
          : [],
      );
    if (
      path.endsWith("/lodgings") ||
      path.endsWith("/transfers") ||
      path.endsWith("/group_invitations") ||
      path.endsWith("/activity_preferences") ||
      path.endsWith("/activity_comments") ||
      path.endsWith("/itinerary_days") ||
      path.endsWith("/itinerary_items") ||
      path.endsWith("/plan_approvals")
    )
      return respond([]);
    return respond({ message: "Unhandled synthetic test endpoint" }, 400);
  });
  return state;
}
