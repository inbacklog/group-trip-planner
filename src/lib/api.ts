import { requireClient } from "./supabase";
import type { PrivateTripImport } from "./privateImport";

export type Group = { id: string; name: string; created_by: string; version?: number };
export type Member = {
  group_id: string;
  user_id: string;
  role: string;
  display_name?: string;
  nickname?: string | null;
};
export type Trip = {
  id: string;
  group_id: string;
  name: string;
  currency: string;
  timezone: string;
  created_by: string;
  version: number;
  details?: Record<string, unknown>;
  start_date?: string | null;
};
export type Stop = {
  id: string;
  trip_id: string;
  name: string;
  position: number;
  version: number;
};
export type Item = {
  id: string;
  trip_id: string;
  stop_id: string | null;
  title: string;
  description: string | null;
  why_visit?: string | null;
  details: Record<string, unknown>;
  created_by: string;
  version: number;
};
export type Participant = { trip_id: string; user_id: string; status: string };
export type Invitation = {
  id: string;
  group_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  accepted_at: string | null;
};
export type ItemTable = "activities" | "lodgings" | "transfers";

function unwrap<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return unwrap(await requireClient().rpc(name, args)) as T;
}
export async function getGroups(signal?: AbortSignal): Promise<Group[]> {
  let q = requireClient()
    .from("groups")
    .select("id,name,created_by,version")
    .order("created_at");
  if (signal) q = q.abortSignal(signal);
  return unwrap(await q) ?? [];
}
export async function getGroupData(groupId: string, signal?: AbortSignal) {
  const db = requireClient();
  let trips = db
    .from("trips")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at");
  let members = db
    .from("group_members")
    .select("group_id,user_id,role,display_name,nickname")
    .eq("group_id", groupId);
  if (signal) {
    trips = trips.abortSignal(signal);
    members = members.abortSignal(signal);
  }
  const [a, b] = await Promise.all([trips, members]);
  return {
    trips: (unwrap(a) ?? []) as Trip[],
    members: (unwrap(b) ?? []) as Member[],
  };
}
export async function getTripData(tripId: string, signal?: AbortSignal) {
  const db = requireClient();
  let stops = db
    .from("trip_stops")
    .select("*")
    .eq("trip_id", tripId)
    .order("position");
  let activities = db
    .from("activities")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at");
  let lodgings = db
    .from("lodgings")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at");
  let transfers = db
    .from("transfers")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at");
  let participants = db
    .from("trip_participants")
    .select("*")
    .eq("trip_id", tripId);
  if (signal) {
    stops = stops.abortSignal(signal);
    activities = activities.abortSignal(signal);
    lodgings = lodgings.abortSignal(signal);
    transfers = transfers.abortSignal(signal);
    participants = participants.abortSignal(signal);
  }
  const [a, b, c, d, e] = await Promise.all([
    stops,
    activities,
    lodgings,
    transfers,
    participants,
  ]);
  return {
    stops: (unwrap(a) ?? []) as Stop[],
    activities: (unwrap(b) ?? []) as Item[],
    lodgings: (unwrap(c) ?? []) as Item[],
    transfers: (unwrap(d) ?? []) as Item[],
    participants: (unwrap(e) ?? []) as Participant[],
  };
}
export const createGroup = (name: string, requestId: string) =>
  rpc<string>("create_group", { p_name: name, p_request_id: requestId });
export const createTrip = (
  groupId: string,
  name: string,
  template: "blank" | "china",
  requestId: string,
) =>
  rpc<string>("create_trip", {
    p_group_id: groupId,
    p_name: name,
    p_template: template,
    p_request_id: requestId,
  });
export const createInvitation = (groupId: string) =>
  rpc<string>("create_invitation", { p_group_id: groupId });
export const acceptInvitation = (token: string) =>
  rpc<string>("accept_invitation", { p_token: token });
export const revokeInvitation = (id: string) =>
  rpc<unknown>("revoke_invitation", { p_invitation_id: id });
export const removeMember = (groupId: string, userId: string) =>
  rpc<unknown>("remove_member", { p_group_id: groupId, p_user_id: userId });
export const setParticipation = (tripId: string, status: string) =>
  rpc<unknown>("set_participation", { p_trip_id: tripId, p_status: status });
export const reorderStops = (
  tripId: string,
  stopIds: string[],
  expectedVersion: number,
) =>
  rpc<number>("reorder_stops", {
    p_trip_id: tripId,
    p_stop_ids: stopIds,
    p_expected_version: expectedVersion,
  });
export const importPrivateTrip = (
  groupId: string,
  payload: PrivateTripImport,
  requestId: string,
) =>
  rpc<string>("import_private_trip", {
    p_group_id: groupId,
    p_payload: payload,
    p_request_id: requestId,
  });
export async function getInvitations(groupId: string): Promise<Invitation[]> {
  return (unwrap(
    await requireClient()
      .from("group_invitations")
      .select("id,group_id,created_at,expires_at,revoked_at,accepted_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false }),
  ) ?? []) as Invitation[];
}
export const addStop = (
  tripId: string,
  name: string,
  position: number,
  requestId: string,
) =>
  rpc<string>("create_stop", {
    p_trip_id: tripId,
    p_name: name,
    p_position: position,
    p_request_id: requestId,
  });
export async function updateStop(
  stop: Stop,
  patch: { name?: string; position?: number },
) {
  const result = await requireClient()
    .from("trip_stops")
    .update(patch)
    .eq("id", stop.id)
    .eq("version", stop.version)
    .select("id");
  unwrap(result);
  if (!result.data?.length)
    throw new Error(
      "Αυτή η στάση άλλαξε από άλλο μέλος. Ανανέωσε και δοκίμασε ξανά.",
    );
}
export async function deleteStop(stop: Stop) {
  const result = await requireClient()
    .from("trip_stops")
    .delete()
    .eq("id", stop.id)
    .eq("version", stop.version)
    .select("id");
  unwrap(result);
  if (!result.data?.length)
    throw new Error(
      "Η στάση άλλαξε ή δεν είναι πλέον διαθέσιμη. Ανανέωσε τη σελίδα.",
    );
}
export async function saveItem(
  table: ItemTable,
  tripId: string,
  fields: {
    title: string;
    description: string;
    why_visit?: string;
    stop_id: string | null;
    details: Record<string, unknown>;
  },
  item?: Item,
  requestId?: string,
) {
  const db = requireClient();
  if (item) {
    const result = await db
      .from(table)
      .update(fields)
      .eq("id", item.id)
      .eq("version", item.version)
      .select("id");
    unwrap(result);
    if (!result.data?.length)
      throw new Error(
        "Η καταχώριση άλλαξε από άλλο μέλος. Ανανέωσε και δοκίμασε ξανά.",
      );
  } else {
    if (!requestId)
      throw new Error(
        "Λείπει το αναγνωριστικό αποθήκευσης. Άνοιξε ξανά τη φόρμα.",
      );
    await rpc<string>("create_item", {
      p_table: table,
      p_trip_id: tripId,
      p_fields: fields,
      p_request_id: requestId,
    });
  }
}
export async function deleteItem(table: ItemTable, item: Item) {
  const result = await requireClient()
    .from(table)
    .delete()
    .eq("id", item.id)
    .eq("version", item.version)
    .select("id");
  unwrap(result);
  if (!result.data?.length)
    throw new Error(
      "Η καταχώριση άλλαξε ή δεν είναι πλέον διαθέσιμη. Ανανέωσε τη σελίδα.",
    );
}

export type Profile = { display_name: string; version: number };
export async function getMyProfile(signal?: AbortSignal): Promise<Profile> {
  let q = requireClient().rpc("get_my_profile");
  if (signal) q = q.abortSignal(signal);
  const data = unwrap(await q);
  return data ?? { display_name: "", version: 0 };
}
export const updateMyProfile = (name: string, version: number) =>
  rpc<Profile>("update_my_profile", { p_display_name: name, p_expected_version: version });
export const renameGroup = (group: Group, name: string) =>
  rpc<Group>("rename_group", { p_group_id: group.id, p_name: name, p_expected_version: group.version ?? 1 });
