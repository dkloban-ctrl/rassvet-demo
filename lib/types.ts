export type Role = "admin" | "helper" | "parent" | "teen";
export type Status = "pending" | "active" | "blocked";

export type Profile = {
  id: string;
  display_name: string;
  role: Role;
  is_minor: boolean;
  status: Status;
  created_at: string;
};

export type Leaflet = {
  id: string;
  week: string;
  title: string;
  body: string;
  verse_ref: string | null;
  verse_text: string | null;
  published_at: string | null;
};

export type Question = {
  id: string;
  week: string;
  body: string;
  published_at: string | null;
  closes_at: string | null;
};

export type FeedItem = {
  id: string;
  body: string;
  is_anonymous: boolean;
  author_id: string | null;
  author_name: string | null;
  is_mine: boolean;
  is_hidden: boolean;
  created_at: string;
};

export type Reply = { id: string; answer_id: string; author_id: string | null; body: string; created_at: string };

export type Announcement = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string | null;
  created_at: string;
};

export type EventItem = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  place: string | null;
  note: string | null;
};

export type Thread = { id: string; author_id: string | null; kind: "message" | "report"; status: "open" | "closed"; created_at: string };
export type Message = { id: string; thread_id: string; author_id: string | null; body: string; created_at: string };

export type Invite = {
  id: string;
  code: string;
  role: Role;
  email: string | null;
  parent_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};

export type InboxAccess = {
  id: string;
  parent_id: string;
  teen_id: string;
  granted_at: string;
  revoked_at: string | null;
};

export type Consent = { id: string; teen_id: string; parent_id: string; version: string; signed_at: string; revoked_at: string | null };

export const ROLE_LABEL: Record<Role, string> = {
  admin: "лидер",
  helper: "помощник",
  parent: "родитель",
  teen: "подросток",
};

export const STATUS_LABEL: Record<Status, string> = {
  pending: "ждёт активации",
  active: "активен",
  blocked: "заблокирован",
};
