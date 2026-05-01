"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";
import { ROLES, type Role } from "@/lib/auth/permissions";

/**
 * All actions in this file require the caller to be an admin.
 * RLS is not enabled on auth.users (Supabase manages it), so the
 * authorization check happens here, in app code.
 */
async function requireAdmin() {
  const me = await getCurrentProfile();
  if (!me || me.role !== "admin") {
    throw new Error("Forbidden");
  }
  return me;
}

export type AdminUser = {
  id: string;
  email: string;
  role: Role | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
};

function mapUser(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}): AdminUser {
  const metadata = u.user_metadata ?? {};
  const role = (metadata as { role?: unknown }).role;
  const displayName = (metadata as { display_name?: unknown }).display_name;

  return {
    id: u.id,
    email: u.email ?? "",
    role: typeof role === "string" && (ROLES as readonly string[]).includes(role)
      ? (role as Role)
      : null,
    displayName: typeof displayName === "string" ? displayName : null,
    createdAt: u.created_at ?? "",
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
  };
}

export async function listUsers(): Promise<AdminUser[]> {
  await requireAdmin();
  const admin = getAdminClient();

  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(error.message);

  return data.users
    .map(mapUser)
    .sort((a, b) => a.email.localeCompare(b.email));
}

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export type CreateUserState = {
  error?: string;
  ok?: boolean;
};

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  try {
    await requireAdmin();
  } catch {
    return { error: "Forbidden" };
  }

  const parsed = CreateUserSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    displayName: formData.get("displayName") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const admin = getAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      role: parsed.data.role,
      display_name: parsed.data.displayName ?? null,
    },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

const UpdateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});

export async function updateUserRole(input: { userId: string; role: Role }) {
  const me = await requireAdmin();
  const parsed = UpdateRoleSchema.parse(input);

  if (parsed.userId === me.userId && parsed.role !== "admin") {
    throw new Error("You cannot demote yourself.");
  }

  const admin = getAdminClient();
  // Fetch existing metadata so we don't blow away display_name etc.
  const { data: existing, error: fetchErr } = await admin.auth.admin.getUserById(
    parsed.userId,
  );
  if (fetchErr) throw new Error(fetchErr.message);

  const nextMetadata = {
    ...(existing.user.user_metadata ?? {}),
    role: parsed.role,
  };

  const { error } = await admin.auth.admin.updateUserById(parsed.userId, {
    user_metadata: nextMetadata,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
}

export async function deleteUser(userId: string) {
  const me = await requireAdmin();
  if (userId === me.userId) {
    throw new Error("You cannot delete your own account.");
  }
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}
