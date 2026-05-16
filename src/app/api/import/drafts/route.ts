import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { AgentImportPayload } from "@/lib/import-drafts/types";

export async function POST(request: Request) {
  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    const payload = (await request.json()) as AgentImportPayload;
    const normalized = await normalizeAgentImportPayload(payload);
    const draft = await prisma.importDraft.create({
      data: normalized
    });

    return NextResponse.json(
      {
        id: draft.id,
        status: draft.status,
        previewUrl: `/imports/${draft.id}`,
        word: draft.word
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid import payload" },
      { status: 400 }
    );
  }
}

export async function GET() {
  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  const drafts = await prisma.importDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return NextResponse.json({ drafts });
}
