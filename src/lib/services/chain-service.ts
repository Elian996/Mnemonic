"use server";

import { RelationType, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";

export async function saveChainAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") ?? "");
  const slug = String(formData.get("slug") || slugify(title));
  const description = String(formData.get("description") || "");
  const status = String(formData.get("status") || "DRAFT") as "DRAFT" | "PUBLISHED";
  const nodeIds = String(formData.get("nodeIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const notes = String(formData.get("notes") || "").split("\n");

  const chain = await prisma.$transaction(async (tx) => {
    const saved = await tx.memoryChain.upsert({
      where: { id: id || "__new__" },
      create: { title, slug, description, status, createdById: user.id },
      update: { title, slug, description, status }
    });
    await tx.memoryChainItem.deleteMany({ where: { chainId: saved.id } });
    for (const [index, nodeId] of nodeIds.entries()) {
      await tx.memoryChainItem.create({
        data: { chainId: saved.id, nodeId, orderIndex: index, note: notes[index] ?? "" }
      });
      if (index > 0) {
        await tx.memoryLink.create({
          data: {
            sourceNodeId: nodeIds[index - 1],
            targetNodeId: nodeId,
            relationType: RelationType.CHAIN,
            anchorText: title,
            description,
            createdById: user.id
          }
        });
      }
    }
    return saved;
  });

  revalidatePath(`/chains/${chain.slug}`);
  revalidatePath("/admin/chains");
  redirect(`/admin/chains?saved=1`);
}
