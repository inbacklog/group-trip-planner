import { requireClient } from "./supabase";
import type { Item, Member, Participant, Stop, Trip } from "./api";

export type Choice = "must" | "yes" | "maybe" | "skip";
export type Preference = {
  trip_id: string;
  activity_id: string;
  user_id: string;
  choice: Choice;
  priority: number;
  note: string;
  updated_at: string;
};
export type Comment = {
  id: string;
  trip_id: string;
  activity_id: string;
  created_by: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Day = {
  id: string;
  trip_id: string;
  day_number: number;
  title: string;
  stop_id: string | null;
  notes: string;
};
export type PlanItem = {
  id: string;
  trip_id: string;
  day_id: string;
  activity_id: string | null;
  title: string;
  position: number;
  time_slot: string | null;
  duration_minutes: number | null;
  notes: string;
  is_alternative: boolean;
  subgroup: string;
};
export type Approval = {
  trip_id: string;
  user_id: string;
  version: number;
  approved_at: string;
};
export type DayFields = Partial<
  Pick<Day, "day_number" | "title" | "stop_id" | "notes">
>;
export type PlanItemFields = Partial<Omit<PlanItem, "id" | "trip_id">>;

function unwrap<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}
async function rpc<T = void>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return unwrap(await requireClient().rpc(name, args)) as T;
}
async function readSnapshot<T>(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let query = requireClient().rpc(name, args);
  if (signal) query = query.abortSignal(signal);
  const data = unwrap(await query);
  if (!data) throw Object.assign(new Error("Δεν έχεις πλέον πρόσβαση ή η καταχώριση έχει διαγραφεί."), { code: "ACCESS_LOST" });
  return data as T;
}
export type PreferenceSnapshot = { preferences: Preference[]; members: Member[]; participants: Participant[] };
export function getPreferenceOverview(
  tripId: string,
  signal?: AbortSignal,
): Promise<PreferenceSnapshot> {
  return readSnapshot("get_preference_snapshot", { p_trip_id: tripId }, signal);
}
export function getActivityCollaboration(
  activityId: string,
  signal?: AbortSignal,
): Promise<PreferenceSnapshot & { comments: Comment[] }> {
  return readSnapshot("get_activity_collaboration", { p_activity_id: activityId }, signal);
}
export const setPreference = (
  activityId: string,
  choice: Choice | null,
  priority = 0,
  note = "",
) =>
  rpc("set_activity_preference", {
    p_activity_id: activityId,
    p_choice: choice,
    p_priority: priority,
    p_note: note,
  });
export const createComment = (
  activityId: string,
  body: string,
  requestId: string,
) =>
  rpc<string>("create_activity_comment", {
    p_activity_id: activityId,
    p_body: body,
    p_request_id: requestId,
  });
export const editComment = (comment: Comment, body: string) =>
  rpc("edit_activity_comment", {
    p_comment_id: comment.id,
    p_body: body,
    p_expected_version: comment.version,
  });
export const deleteComment = (comment: Comment) =>
  rpc("delete_activity_comment", {
    p_comment_id: comment.id,
    p_expected_version: comment.version,
  });

export type PlannerSnapshot = {
  trip: Trip;
  days: Day[];
  items: PlanItem[];
  approvals: Approval[];
  members: Member[];
  participants: Participant[];
  activities: Item[];
  stops: Stop[];
};
export function getPlanner(
  tripId: string,
  signal?: AbortSignal,
): Promise<PlannerSnapshot> {
  return readSnapshot("get_plan_snapshot", { p_trip_id: tripId }, signal);
}
export const saveDay = (
  tripId: string,
  dayId: string | null,
  fields: DayFields,
  expectedVersion: number,
  requestId: string,
) =>
  rpc<string>("save_itinerary_day", {
    p_trip_id: tripId,
    p_day_id: dayId,
    p_fields: fields,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
export const deleteDay = (dayId: string, expectedVersion: number) =>
  rpc("delete_itinerary_day", {
    p_day_id: dayId,
    p_expected_version: expectedVersion,
  });
export const savePlanItem = (
  tripId: string,
  itemId: string | null,
  fields: PlanItemFields,
  expectedVersion: number,
  requestId: string,
) =>
  rpc<string>("save_itinerary_item", {
    p_trip_id: tripId,
    p_item_id: itemId,
    p_fields: fields,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
export const deletePlanItem = (itemId: string, expectedVersion: number) =>
  rpc("delete_itinerary_item", {
    p_item_id: itemId,
    p_expected_version: expectedVersion,
  });
export const setStartDate = (
  tripId: string,
  date: string | null,
  expectedVersion: number,
) =>
  rpc("set_trip_start_date", {
    p_trip_id: tripId,
    p_start_date: date,
    p_expected_version: expectedVersion,
  });
export const setApproval = (
  tripId: string,
  expectedVersion: number,
  approved: boolean,
) =>
  rpc("set_plan_approval", {
    p_trip_id: tripId,
    p_expected_version: expectedVersion,
    p_approved: approved,
  });
export const setMemberDisplayName = (groupId: string, name: string) =>
  rpc("set_member_display_name", {
    p_group_id: groupId,
    p_display_name: name,
  });
export function displayMember(
  members: Member[],
  userId: string,
  currentUserId?: string,
): string {
  const member = members.find((m) => m.user_id === userId);
  return (
    member?.display_name?.trim() ||
    (userId === currentUserId
      ? "Εσύ"
      : member
        ? `Μέλος ${userId.slice(0, 6)}`
        : "Πρώην μέλος")
  );
}
