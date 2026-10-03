"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, categoryKind } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { type ActionState, flag, id, NAME_ERROR, str, validName } from "./shared";

const NOT_FOUND = "Category not found.";
const DUPLICATE = "A category with that name already exists.";

// Drizzle wraps the driver error in `cause`; only the known unique constraint becomes a message.
function isDuplicate(e: unknown): boolean {
  const err = ((e as { cause?: unknown })?.cause ?? e) as { code?: string; constraint_name?: string };
  return err.code === "23505" && err.constraint_name === "categories_user_kind_name_unique";
}

async function mutate(run: () => Promise<{ id: string }[]>): Promise<ActionState> {
  try {
    if ((await run()).length === 0) return { error: NOT_FOUND };
  } catch (e) {
    if (isDuplicate(e)) return { error: DUPLICATE };
    throw e;
  }
  revalidatePath("/", "layout");
  return {};
}

export async function addCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const name = str(formData, "name");
  const kind = str(formData, "kind") as (typeof categoryKind.enumValues)[number];
  if (!validName(name)) return { error: NAME_ERROR };
  if (!categoryKind.enumValues.includes(kind)) return { error: "Choose income or expense." };

  return mutate(() =>
    db
      .insert(categories)
      .values({ userId, name, kind, isEssential: kind === "expense" && flag(formData, "isEssential") })
      .returning({ id: categories.id }),
  );
}

export async function renameCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const categoryId = id(formData, "id");
  const name = str(formData, "name");
  if (!categoryId) return { error: NOT_FOUND };
  if (!validName(name)) return { error: NAME_ERROR };

  return mutate(() =>
    db
      .update(categories)
      .set({ name })
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .returning({ id: categories.id }),
  );
}

export async function setEssential(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const categoryId = id(formData, "id");
  if (!categoryId) return { error: NOT_FOUND };

  return mutate(() =>
    db
      .update(categories)
      .set({ isEssential: flag(formData, "isEssential") })
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .returning({ id: categories.id }),
  );
}

export async function archiveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const categoryId = id(formData, "id");
  if (!categoryId) return { error: NOT_FOUND };

  return mutate(() =>
    db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
      .returning({ id: categories.id }),
  );
}
